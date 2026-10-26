// games/euchre.ts — Euchre berpasangan, tepat 4 pemain (Tim A: seat 0 & 2, Tim B: seat 1 & 3).
//
// Aturan:
//  1. Deck 24 kartu (9, 10, J, Q, K, A tiap suit). Tiap pemain 5 kartu; 1 kartu dibuka (turn-up),
//     sisanya tertutup. Dealer bergilir tiap hand.
//  2. Lelang ronde 1 (mulai kiri dealer): "Pesan" suit kartu terbuka sebagai truf, atau Lewat.
//     Bila dipesan, dealer mengambil kartu terbuka lalu membuang 1 kartu (tertutup).
//  3. Ronde 2 (bila semua lewat; kartu terbuka ditutup): tiap pemain boleh menyebut suit LAIN
//     sebagai truf atau Lewat. "Stick the dealer": dealer wajib menyebut suit.
//     (Opsi "main sendiri"/go alone tidak dipakai.)
//  4. Urutan truf: Right Bower (J truf) > Left Bower (J sewarna, dianggap suit truf) > A > K > Q > 10 > 9.
//     Wajib mengikuti suit pembuka (Left Bower mengikuti truf, bukan suit aslinya).
//     Pemimpin pertama: kiri dealer; pemenang trik membuka trik berikutnya.
//  5. Skor: tim pemesan menang 3–4 trik = 1 poin, 5 trik (march) = 2 poin;
//     pemesan < 3 trik (euchred) = 2 poin untuk tim bertahan.
//  6. Tim pertama yang mencapai target (5/10) menang; kedua rekan berbagi peringkat.

import { type Card, rankOf, suitOf, shuffle, cardLabel, SUITS, makeCard } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  rankByScore, SUIT_NAME, SUIT_SYMBOL, trickWinner, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface EuchreOptions { turnSeconds: number; passAndPlay: boolean; target: number }

export type EuchrePhase = 'bid1' | 'bid2' | 'discard' | 'play' | 'trickDone' | 'handEnd';

export interface EuchreState {
  gameId: 'euchre';
  options: EuchreOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  /** Kartu tertutup (sisa deck + kartu buangan dealer + kartu terbuka yang ditolak). */
  kitty: Card[];
  /** Kartu terbuka selama lelang ronde 1 (null setelah diambil/ditolak). */
  upcard: Card | null;
  upSuit: string;
  phase: EuchrePhase;
  dealNo: number;
  dealer: number;
  trump: string | null;
  maker: number | null;
  /** Pemain yang sudah lewat di ronde lelang saat ini. */
  passed: boolean[];
  trick: { seat: number; card: Card }[];
  turn: number | null;
  trickNo: number;
  taken: Card[][];
  tricksWon: number[];
  teamScores: number[];
  trickWinnerSeat: number | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'target', label: 'Target Poin', type: 'select', choices: [{ value: 5, label: '5 Poin (Cepat)' }, { value: 10, label: '10 Poin (Klasik)' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: EuchreOptions = { turnSeconds: 25, passAndPlay: false, target: 5 };
const TRICK_PAUSE = 1200;
const HAND_PAUSE = 2500;
const MAX_HANDS = 60; // pengaman (tiap hand selalu memberi ≥1 poin, jadi praktis tak tercapai)
const TEAM = ['Tim A', 'Tim B'];

export const sameColor = (suit: string) => ({ S: 'C', C: 'S', H: 'D', D: 'H' } as Record<string, string>)[suit];
export const isRight = (c: Card, trump: string) => c[0] === 'J' && suitOf(c) === trump;
export const isLeft = (c: Card, trump: string) => c[0] === 'J' && suitOf(c) === sameColor(trump);
/** Suit efektif: Left Bower dihitung sebagai suit truf. */
export const effSuit = (c: Card, trump: string | null) => (trump && isLeft(c, trump) ? trump : suitOf(c));
/** Rank efektif: Right 100, Left 99, lainnya 9..14. */
export const effRank = (c: Card, trump: string | null) => (trump && isRight(c, trump) ? 100 : trump && isLeft(c, trump) ? 99 : rankOf(c));

export function euchreDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (let r = 9; r <= 14; r++) d.push(makeCard(r, s));
  return d;
}

export function euchreTrickWinner(trick: { seat: number; card: Card }[], trump: string): number {
  return trickWinner(trick, trump, c => effRank(c, trump), c => effSuit(c, trump));
}

const teamOf = (seat: number) => seat % 2;
const sortHand = (h: Card[], trump: string | null) => {
  const order: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
  return h.sort((a, b) => {
    const sa = effSuit(a, trump), sb = effSuit(b, trump);
    const ka = sa === trump ? 9 : order[sa], kb = sb === trump ? 9 : order[sb];
    return ka - kb || effRank(a, trump) - effRank(b, trump);
  });
};

/** Kartu yang sah dimainkan seat (fase play). */
export function legalCards(s: EuchreState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.trick.length === 0) return hand.slice();
  const lead = effSuit(s.trick[0].card, s.trump);
  const follow = hand.filter(c => effSuit(c, s.trump) === lead);
  return follow.length ? follow : hand.slice();
}

function actionsFor(s: EuchreState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'bid1') {
    return [
      { id: 'order', label: seat === s.dealer ? `Ambil ${SUIT_SYMBOL[s.upSuit]}` : `Pesan ${SUIT_SYMBOL[s.upSuit]}`, style: 'primary',
        hint: `Jadikan ${SUIT_NAME[s.upSuit]} truf; dealer mengambil kartu terbuka` },
      { id: 'pass', label: 'Lewat' },
    ];
  }
  if (s.phase === 'bid2') {
    const acts: GActionSpec[] = SUITS.filter(x => x !== s.upSuit)
      .map(x => ({ id: `suit:${x}`, label: `Truf ${SUIT_SYMBOL[x]}`, style: 'primary' as const }));
    if (seat !== s.dealer) acts.push({ id: 'pass', label: 'Lewat' });
    return acts;
  }
  if (s.phase === 'discard') return [{ id: 'discard', label: 'Buang', style: 'primary', cards: { min: 1, max: 1 }, hint: 'Buang 1 kartu (tertutup)' }];
  if (s.phase === 'play') return [{ id: 'play', label: 'Mainkan', style: 'primary', cards: { min: 1, max: 1 } }];
  return [];
}

function startHand(s: EuchreState, rng: Rng) {
  const deck = shuffle(euchreDeck(), rng);
  s.hands = [0, 1, 2, 3].map(() => sortHand(deck.splice(0, 5), null));
  s.upcard = deck.shift()!;
  s.upSuit = suitOf(s.upcard);
  s.kitty = deck;
  s.trump = null;
  s.maker = null;
  s.passed = [false, false, false, false];
  s.trick = [];
  s.trickNo = 0;
  s.taken = [[], [], [], []];
  s.tricksWon = [0, 0, 0, 0];
  s.trickWinnerSeat = null;
  s.banner = null;
  s.phase = 'bid1';
  s.turn = (s.dealer + 1) % 4;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Hand ${s.dealNo} — dealer ${s.names[s.dealer]}. Kartu terbuka: ${cardLabel(s.upcard)}.` });
}

function beginPlay(s: EuchreState) {
  s.phase = 'play';
  s.hands.forEach(h => sortHand(h, s.trump));
  s.turn = (s.dealer + 1) % 4;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function finishHand(s: EuchreState) {
  const mt = teamOf(s.maker!);
  const made = s.tricksWon[mt] + s.tricksWon[mt + 2];
  let team: number, pts: number, what: string;
  if (made === 5) { team = mt; pts = 2; what = 'menyapu 5 trik (march)'; }
  else if (made >= 3) { team = mt; pts = 1; what = `menang ${made} trik`; }
  else { team = 1 - mt; pts = 2; what = `menjegal pemesan (euchre!)`; }
  s.teamScores[team] += pts;
  s.banner = `${TEAM[team]} ${what}: +${pts} poin`;
  pushLog(s.log, { seat: null, text: s.banner });
  s.turn = null;
  s.turnDeadline = null;
  s.phase = 'handEnd';
  if (Math.max(...s.teamScores) >= s.options.target || s.dealNo >= MAX_HANDS) {
    s.over = true;
    const [a, b] = s.teamScores;
    pushLog(s.log, { seat: null, text: a === b ? `Seri ${a}–${b}` : `🏆 ${TEAM[a > b ? 0 : 1]} menang ${Math.max(a, b)}–${Math.min(a, b)}!` });
  }
}

/* ------------------------------ bot helpers ----------------------------- */

/** Kekuatan tangan bila `trump` dijadikan truf. */
export function handStrength(hand: Card[], trump: string): number {
  let t = 0;
  let trumps = 0;
  for (const c of hand) {
    if (isRight(c, trump)) { t += 3; trumps++; continue; }
    if (isLeft(c, trump)) { t += 2.5; trumps++; continue; }
    const r = rankOf(c);
    if (suitOf(c) === trump) { t += r === 14 ? 2 : r === 13 ? 1.7 : r === 12 ? 1.5 : 1.3; trumps++; }
    else if (r === 14) t += 1;
  }
  if (trumps >= 2) {
    for (const x of SUITS) if (x !== trump && !hand.some(c => effSuit(c, trump) === x)) t += 0.5;
  }
  return t;
}

const SYMBOL_TO_SUIT: Record<string, string> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
function trumpFromView(v: GenericView): string | null {
  const b = v.badges.find(x => x.startsWith('Truf '));
  return b ? SYMBOL_TO_SUIT[b.slice(5).trim()[0]] ?? null : null;
}

function chooseDiscard(hand: Card[], trump: string): Card {
  const val = (c: Card) => (effSuit(c, trump) === trump ? 50 : 0) + effRank(c, trump);
  const nonTrump = hand.filter(c => effSuit(c, trump) !== trump && rankOf(c) !== 14);
  if (nonTrump.length) {
    // Utamakan membuat suit kosong (singleton), lalu kartu terendah.
    const cnt = (c: Card) => hand.filter(x => effSuit(x, trump) === effSuit(c, trump)).length;
    return nonTrump.sort((a, b) => cnt(a) - cnt(b) || val(a) - val(b))[0];
  }
  return hand.slice().sort((a, b) => val(a) - val(b))[0];
}

function choosePlay(v: GenericView, legal: Card[], me: number, trump: string): Card {
  const trick = (v.piles.find(p => p.id === 'trick')?.cards ?? []).filter((c): c is Card => c !== null);
  const val = (c: Card) => (effSuit(c, trump) === trump ? 50 : 0) + effRank(c, trump);
  const asc = legal.slice().sort((a, b) => val(a) - val(b));
  const partner = (me + 2) % 4;
  const makers = v.players.findIndex(p => p.status?.includes('Pemesan'));
  const weMade = makers >= 0 && makers % 2 === me % 2;
  if (trick.length === 0) {
    const trumps = asc.filter(c => effSuit(c, trump) === trump);
    if (weMade && trumps.length >= 2) return trumps[trumps.length - 1];
    const offAces = asc.filter(c => effSuit(c, trump) !== trump && rankOf(c) === 14);
    if (offAces.length) return offAces[0];
    const nonT = asc.filter(c => effSuit(c, trump) !== trump);
    return nonT.length ? nonT[0] : asc[0];
  }
  const leader = (me - trick.length + 4) % 4;
  const played = trick.map((card, i) => ({ seat: (leader + i) % 4, card }));
  const winSeat = euchreTrickWinner(played, trump);
  const winCard = played.find(p => p.seat === winSeat)!.card;
  const beats = (c: Card) => euchreTrickWinner([...played, { seat: me, card: c }], trump) === me;
  const winners = asc.filter(beats);
  const losers = asc.filter(c => !beats(c));
  if (winSeat === partner && (trick.length === 3 || val(winCard) >= 13)) return losers.length ? losers[0] : asc[0];
  if (winners.length) return trick.length === 3 ? winners[0] : winners[winners.length > 1 && val(winners[0]) < 13 ? winners.length - 1 : 0];
  return losers.length ? losers[0] : asc[0];
}

export const euchre: GameModule<EuchreState, GenericAction, GenericView, EuchreOptions> = {
  id: 'euchre',
  minPlayers: 4,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      target: Number(r.target) === 10 ? 10 : 5,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length !== 4) throw new RuleError('Euchre butuh tepat 4 pemain');
    const s: EuchreState = {
      gameId: 'euchre', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], kitty: [], upcard: null, upSuit: 'S', phase: 'bid1', dealNo: 1, dealer: rng.int(4),
      trump: null, maker: null, passed: [], trick: [], turn: null, trickNo: 0, taken: [], tricksWon: [],
      teamScores: [0, 0], trickWinnerSeat: null, banner: null, over: false, log: [], turnDeadline: null,
    };
    startHand(s, rng);
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw, _rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (s.phase === 'bid1') {
      if (spec.id === 'order') {
        s.trump = s.upSuit;
        s.maker = seat;
        pushLog(s.log, { seat, text: seat === s.dealer ? `${name} mengambil ${cardLabel(s.upcard!)} — truf ${SUIT_NAME[s.trump]}` : `${name} memesan ${SUIT_NAME[s.trump]} sebagai truf` });
        s.hands[s.dealer].push(s.upcard!);
        sortHand(s.hands[s.dealer], s.trump);
        s.upcard = null;
        s.phase = 'discard';
        s.turn = s.dealer;
        s.turnDeadline = deadline(s.options.turnSeconds);
        return s;
      }
      s.passed[seat] = true;
      pushLog(s.log, { seat, text: `${name} lewat` });
      if (seat === s.dealer) {
        s.kitty.push(s.upcard!);
        s.upcard = null;
        s.phase = 'bid2';
        s.passed = [false, false, false, false];
        pushLog(s.log, { seat: null, text: `Semua lewat — kartu ditutup. Ronde 2: sebut truf selain ${SUIT_SYMBOL[s.upSuit]}.` });
      }
      s.turn = (seat + 1) % 4;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }

    if (s.phase === 'bid2') {
      if (spec.id === 'pass') {
        s.passed[seat] = true;
        pushLog(s.log, { seat, text: `${name} lewat` });
        s.turn = (seat + 1) % 4;
        s.turnDeadline = deadline(s.options.turnSeconds);
        return s;
      }
      s.trump = spec.id.slice(5);
      s.maker = seat;
      pushLog(s.log, { seat, text: `${name} memilih truf ${SUIT_NAME[s.trump]}` });
      beginPlay(s);
      return s;
    }

    if (s.phase === 'discard') {
      const [card] = takeCards(hand, a.cards, 1, 1);
      removeCards(hand, [card]);
      s.kitty.push(card);
      pushLog(s.log, { seat, text: `${name} membuang 1 kartu` });
      beginPlay(s);
      return s;
    }

    // play
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!legalCards(s, seat).includes(card)) {
      const lead = effSuit(s.trick[0].card, s.trump);
      throw new RuleError(`Wajib mengikuti ${SUIT_SYMBOL[lead]}${lead === s.trump ? ' (truf, termasuk Left Bower)' : ''}`);
    }
    removeCards(hand, [card]);
    s.trick.push({ seat, card });
    pushLog(s.log, { seat, text: `${name} memainkan ${cardLabel(card)}` });
    if (s.trick.length === 4) {
      const w = euchreTrickWinner(s.trick, s.trump!);
      s.trickWinnerSeat = w;
      s.phase = 'trickDone';
      s.turn = null;
      s.turnDeadline = null;
      pushLog(s.log, { seat: w, text: `${s.names[w]} mengambil trik` });
      return s;
    }
    s.turn = (seat + 1) % 4;
    s.turnDeadline = deadline(s.options.turnSeconds);
    return s;
  },

  autoDelay: s => (s.over ? null : s.phase === 'trickDone' ? TRICK_PAUSE : s.phase === 'handEnd' ? HAND_PAUSE : null),

  advance(state, rng) {
    if (state.over) return state;
    const s = clone(state);
    if (s.phase === 'trickDone') {
      const w = s.trickWinnerSeat!;
      s.taken[w].push(...s.trick.map(t => t.card));
      s.tricksWon[w] += 1;
      s.trick = [];
      s.trickWinnerSeat = null;
      s.trickNo += 1;
      if (s.trickNo >= 5) { finishHand(s); return s; }
      s.phase = 'play';
      s.turn = w;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    if (s.phase === 'handEnd') {
      s.dealNo += 1;
      s.dealer = (s.dealer + 1) % 4;
      startHand(s, rng);
    }
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'bid1') return { type: 'act', id: 'pass' };
    if (s.phase === 'bid2') {
      if (seat !== s.dealer) return { type: 'act', id: 'pass' };
      const best = SUITS.filter(x => x !== s.upSuit).sort((a, b) => handStrength(s.hands[seat], b) - handStrength(s.hands[seat], a))[0];
      return { type: 'act', id: `suit:${best}` };
    }
    if (s.phase === 'discard') return { type: 'act', id: 'discard', cards: [chooseDiscard(s.hands[seat], s.trump!)] };
    const legal = legalCards(s, seat).sort((a, b) => effRank(a, s.trump) - effRank(b, s.trump));
    return { type: 'act', id: 'play', cards: [legal[0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < 4 ? seat : null;
    const myTurn = me !== null && s.turn === me;
    const winnerName = s.trickWinnerSeat !== null ? s.names[s.trickWinnerSeat] : null;
    const bidding = s.phase === 'bid1' || s.phase === 'bid2';
    const piles: GPile[] = [];
    if (s.phase === 'bid1' && s.upcard) {
      piles.push({ id: 'upcard', label: 'Kartu terbuka', cards: [s.upcard], highlight: true, caption: `Dealer: ${s.names[s.dealer]}` });
    }
    if (bidding) piles.push({ id: 'kitty', label: 'Sisa', cards: [null], count: s.kitty.length });
    else {
      piles.push({
        id: 'trick', label: s.phase === 'trickDone' ? `Trik ${s.trickNo + 1} — ${winnerName} ambil` : `Trik ${Math.min(5, s.trickNo + 1)}/5`,
        cards: s.trick.map(t => t.card), spread: true, highlight: s.phase === 'trickDone',
        caption: s.trick.length ? s.trick.map(t => s.names[t.seat]).join(' · ') : undefined,
      });
    }
    const badges = [`Hand ${s.dealNo}`];
    if (s.trump) badges.push(`Truf ${SUIT_SYMBOL[s.trump]}`);
    else if (s.phase === 'bid2') badges.push(`Ditolak ${SUIT_SYMBOL[s.upSuit]}`);
    badges.push(`A ${s.teamScores[0]}`, `B ${s.teamScores[1]}`, `Target ${s.options.target}`);
    return {
      gameId: 'euchre',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: euchre.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.teamScores[teamOf(i)]} pt`,
        tag: `${teamOf(i) === 0 ? 'A' : 'B'}${s.dealer === i ? ' · D' : ''}`,
        status: bidding ? (s.passed[i] ? 'Lewat' : s.turn === i ? 'Memilih…' : undefined)
          : `${s.tricksWon[i]} trik${s.maker === i ? ' · Pemesan' : ''}`,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles,
      actions: actionsFor(s, me),
      playable: myTurn && s.phase === 'play' ? legalCards(s, me!) : myTurn && s.phase === 'discard' ? s.hands[me!].slice() : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'trickDone' ? `${winnerName} mengambil trik ini`
        : s.phase === 'handEnd' ? 'Hand selesai — hand berikutnya segera dimulai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.phase === 'bid1' ? `Jadikan ${SUIT_NAME[s.upSuit]} truf?`
        : s.phase === 'bid2' ? (me === s.dealer ? 'Kamu dealer: wajib memilih truf' : `Pilih truf (selain ${SUIT_SYMBOL[s.upSuit]}) atau lewat`)
        : s.phase === 'discard' ? 'Buang 1 kartu'
        : s.trick.length === 0 ? 'Buka trik dengan kartu apa saja'
        : `Ikuti ${SUIT_SYMBOL[effSuit(s.trick[0].card, s.trump)]} bila punya`,
      badges,
      banner: s.banner,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const me = v.you!;
    const isDealer = v.players[me].tag?.includes('D') ?? false;
    const dealerSeat = v.players.findIndex(p => p.tag?.includes('D'));
    const threshold = difficulty === 'easy' ? 5.5 + rng.float() * 3 : 6.5;
    if (ids.includes('order')) {
      const up = v.piles.find(p => p.id === 'upcard')?.cards[0] ?? null;
      if (!up) return { type: 'act', id: 'pass' };
      const suit = suitOf(up);
      let str: number;
      if (isDealer) {
        const hand = v.hand.concat([up]);
        const drop = chooseDiscard(hand, suit);
        str = handStrength(hand.filter(c => c !== drop), suit);
      } else {
        str = handStrength(v.hand, suit);
        const upVal = isRight(up, suit) ? 3 : rankOf(up) >= 13 ? 1.5 : 1;
        str += dealerSeat >= 0 && dealerSeat % 2 === me % 2 ? upVal * 0.5 : -upVal * 0.5;
      }
      return { type: 'act', id: str >= threshold ? 'order' : 'pass' };
    }
    if (ids.some(i => i.startsWith('suit:'))) {
      const opts = ids.filter(i => i.startsWith('suit:')).map(i => i.slice(5));
      const best = opts.sort((a, b) => handStrength(v.hand, b) - handStrength(v.hand, a))[0];
      if (!ids.includes('pass') || handStrength(v.hand, best) >= threshold) return { type: 'act', id: `suit:${best}` };
      return { type: 'act', id: 'pass' };
    }
    const trump = trumpFromView(v) ?? 'S';
    if (ids.includes('discard')) return { type: 'act', id: 'discard', cards: [chooseDiscard(v.hand, trump)] };
    const legal = (v.playable ?? []).slice();
    if (difficulty === 'easy' && rng.float() < 0.5) return { type: 'act', id: 'play', cards: [legal[rng.int(legal.length)]] };
    return { type: 'act', id: 'play', cards: [choosePlay(v, legal, me, trump)] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore([0, 1, 2, 3].map(i => s.teamScores[teamOf(i)]));
  },
};
