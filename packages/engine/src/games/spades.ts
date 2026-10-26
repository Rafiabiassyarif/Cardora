// games/spades.ts — Spades berpasangan, tepat 4 pemain (Tim A: seat 0 & 2, Tim B: seat 1 & 3).
//
// Aturan:
//  1. Deck 52, tiap pemain 13 kartu. Dealer bergilir; pemain di kiri dealer menawar dan membuka duluan.
//  2. Penawaran (bid): tiap pemain bergiliran menawar 0–13 trik. Bid 0 = "Nil".
//  3. Sekop (♠) selalu truf. Wajib mengikuti suit pembuka bila punya. Sekop tidak boleh dibuka
//     sebelum "pecah" (ada sekop dimainkan) kecuali tangan tinggal sekop.
//  4. Kontrak tim = jumlah bid anggota yang bukan Nil. Tercapai: 10 × kontrak + 1 per trik lebih (bag).
//     Gagal: −10 × kontrak. Nil: +100 bila pemainnya tidak mengambil trik sama sekali, −100 bila gagal
//     (trik pemain Nil tidak membantu kontrak rekan, tetapi dihitung sebagai bag).
//  5. Setiap 10 bag terkumpul: −100 (bag dikurangi 10).
//  6. Permainan selesai setelah deal di mana ada tim mencapai target (200/300) dan skor tidak seri,
//     tim jatuh ke −target, atau batas jumlah deal tercapai. Kedua rekan berbagi peringkat.

import { type Card, rankOf, suitOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, SUIT_SYMBOL, trickWinner, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface SpadesOptions { turnSeconds: number; passAndPlay: boolean; target: number; maxDeals: number }

export type SpadesPhase = 'bid' | 'play' | 'trickDone' | 'dealEnd';

export interface SpadesState {
  gameId: 'spades';
  options: SpadesOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  phase: SpadesPhase;
  dealNo: number;
  dealer: number;
  bids: (number | null)[];
  trick: { seat: number; card: Card }[];
  turn: number | null;
  trickNo: number;
  spadesBroken: boolean;
  /** Kartu yang diambil tiap pemain di deal ini. */
  taken: Card[][];
  tricksWon: number[];
  /** Skor tim [A, B]. */
  teamScores: number[];
  bags: number[];
  trickWinnerSeat: number | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'target', label: 'Target Poin', type: 'select', choices: [{ value: 200, label: '200 Poin (Cepat)' }, { value: 300, label: '300 Poin (Standar)' }] },
  { key: 'maxDeals', label: 'Batas Deal', type: 'select', choices: [{ value: 6, label: '6 Deal' }, { value: 10, label: '10 Deal' }],
    help: 'Permainan berhenti setelah jumlah deal ini walau target belum tercapai' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: SpadesOptions = { turnSeconds: 25, passAndPlay: false, target: 200, maxDeals: 10 };
const TRICK_PAUSE = 1200;
const DEAL_PAUSE = 3000;
const SUIT_ORDER: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };
const TEAM = ['Tim A', 'Tim B'];

const sortHand = (h: Card[]) => h.sort((a, b) => SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || rankOf(a) - rankOf(b));
const teamOf = (seat: number) => seat % 2;
const bidText = (b: number | null) => (b === null ? '—' : b === 0 ? 'Nil' : `Bid ${b}`);

/** Skor satu tim untuk satu deal. bids/tricks = [pemain pertama, rekannya]. */
export function scoreTeam(bids: number[], tricks: number[], bagsBefore: number): { delta: number; bags: number; penalties: number } {
  let delta = 0, newBags = 0, contract = 0, made = 0;
  for (let k = 0; k < 2; k++) {
    if (bids[k] === 0) {
      if (tricks[k] === 0) delta += 100;
      else { delta -= 100; newBags += tricks[k]; delta += tricks[k]; }
    } else { contract += bids[k]; made += tricks[k]; }
  }
  if (contract > 0) {
    if (made >= contract) { delta += 10 * contract + (made - contract); newBags += made - contract; }
    else delta -= 10 * contract;
  }
  let bags = bagsBefore + newBags, penalties = 0;
  while (bags >= 10) { bags -= 10; delta -= 100; penalties++; }
  return { delta, bags, penalties };
}

/** Kartu yang sah dimainkan seat (fase play). */
export function legalCards(s: SpadesState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.trick.length === 0) {
    if (!s.spadesBroken) {
      const non = hand.filter(c => suitOf(c) !== 'S');
      if (non.length) return non;
    }
    return hand.slice();
  }
  const lead = suitOf(s.trick[0].card);
  const follow = hand.filter(c => suitOf(c) === lead);
  return follow.length ? follow : hand.slice();
}

/** Perkiraan jumlah trik dari tangan (dipakai bot & timeout). */
export function estimateTricks(hand: Card[]): number {
  let t = 0;
  for (const suit of ['C', 'D', 'H', 'S']) {
    const cs = hand.filter(c => suitOf(c) === suit).map(rankOf);
    const len = cs.length;
    const has = (r: number) => cs.includes(r);
    if (suit === 'S') {
      if (has(14)) t += 1;
      if (has(13)) t += len >= 2 ? 1 : 0.5;
      if (has(12)) t += len >= 3 ? 0.7 : 0.2;
      t += Math.max(0, len - 3) * 0.9;
    } else {
      if (has(14)) t += len <= 5 ? 1 : 0.7;
      if (has(13) && len >= 2 && len <= 5) t += has(14) ? 0.8 : 0.5;
      if (has(12) && len >= 3 && len <= 4 && (has(14) || has(13))) t += 0.3;
      const spades = hand.filter(c => suitOf(c) === 'S').length;
      if (len === 0 && spades >= 2) t += 0.6;
      else if (len === 1 && spades >= 3) t += 0.3;
    }
  }
  return Math.max(0, Math.min(13, Math.round(t)));
}

function actionsFor(s: SpadesState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'bid') {
    const est = Math.max(1, estimateTricks(s.hands[seat]));
    return [
      { id: 'bid', label: 'Bid', style: 'primary', amount: { min: 0, max: 13, step: 1, default: est }, hint: 'Jumlah trik yang akan kamu ambil (0 = Nil)' },
      { id: 'nil', label: 'Nil (0)', style: 'danger', hint: 'Bertaruh tidak mengambil trik sama sekali: +100 / −100' },
    ];
  }
  if (s.phase === 'play') return [{ id: 'play', label: 'Mainkan', style: 'primary', cards: { min: 1, max: 1 } }];
  return [];
}

function startDeal(s: SpadesState, rng: Rng) {
  const deck = shuffledDeck(rng);
  s.hands = [0, 1, 2, 3].map(() => sortHand(deck.splice(0, 13)));
  s.bids = [null, null, null, null];
  s.trick = [];
  s.trickNo = 0;
  s.spadesBroken = false;
  s.taken = [[], [], [], []];
  s.tricksWon = [0, 0, 0, 0];
  s.trickWinnerSeat = null;
  s.banner = null;
  s.phase = 'bid';
  s.turn = (s.dealer + 1) % 4;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo} — dealer ${s.names[s.dealer]}. Silakan menawar.` });
}

function finishDeal(s: SpadesState) {
  const parts: string[] = [];
  for (const t of [0, 1]) {
    const seatsT = [t, t + 2];
    const r = scoreTeam(seatsT.map(i => s.bids[i]!), seatsT.map(i => s.tricksWon[i]), s.bags[t]);
    s.teamScores[t] += r.delta;
    s.bags[t] = r.bags;
    parts.push(`${TEAM[t]} ${r.delta >= 0 ? '+' : ''}${r.delta}${r.penalties ? ' (10 bag −100)' : ''}`);
  }
  s.banner = `Deal ${s.dealNo}: ${parts.join(', ')}`;
  pushLog(s.log, { seat: null, text: s.banner });
  s.turn = null;
  s.turnDeadline = null;
  s.phase = 'dealEnd';
  const [a, b] = s.teamScores;
  const t = s.options.target;
  if (((a >= t || b >= t) && a !== b) || a <= -t || b <= -t || s.dealNo >= s.options.maxDeals) {
    s.over = true;
    pushLog(s.log, { seat: null, text: a === b ? `Seri ${a}–${b}!` : `🏆 ${TEAM[a > b ? 0 : 1]} menang ${Math.max(a, b)}–${Math.min(a, b)}!` });
  }
}

/** Info yang bisa dibaca bot dari status pemain. */
function parseStatus(status: string | undefined): { bid: number | null; tricks: number } {
  if (!status) return { bid: null, tricks: 0 };
  const nil = /^Nil/.test(status);
  const b = /^Bid (\d+)/.exec(status);
  const t = /(\d+) trik/.exec(status);
  return { bid: nil ? 0 : b ? Number(b[1]) : null, tricks: t ? Number(t[1]) : 0 };
}

export const spades: GameModule<SpadesState, GenericAction, GenericView, SpadesOptions> = {
  id: 'spades',
  minPlayers: 4,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      target: Number(r.target) === 300 ? 300 : 200,
      maxDeals: Number(r.maxDeals) === 6 ? 6 : 10,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length !== 4) throw new RuleError('Spades butuh tepat 4 pemain');
    const s: SpadesState = {
      gameId: 'spades', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], phase: 'bid', dealNo: 1, dealer: rng.int(4), bids: [], trick: [], turn: null,
      trickNo: 0, spadesBroken: false, taken: [], tricksWon: [], teamScores: [0, 0], bags: [0, 0],
      trickWinnerSeat: null, banner: null, over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
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

    if (spec.id === 'bid' || spec.id === 'nil') {
      const amt = spec.id === 'nil' ? 0 : a.amount;
      if (amt === undefined || !Number.isInteger(amt) || amt < 0 || amt > 13) throw new RuleError('Bid harus 0–13');
      s.bids[seat] = amt;
      pushLog(s.log, { seat, text: `${name} menawar ${amt === 0 ? 'Nil' : amt}` });
      if (s.bids.every(b => b !== null)) {
        s.phase = 'play';
        s.turn = (s.dealer + 1) % 4;
        pushLog(s.log, { seat: null, text: `Kontrak: ${TEAM[0]} ${s.bids[0]! + s.bids[2]!}, ${TEAM[1]} ${s.bids[1]! + s.bids[3]!}. ${s.names[s.turn]} membuka.` });
      } else s.turn = (seat + 1) % 4;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }

    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!legalCards(s, seat).includes(card)) {
      if (s.trick.length) throw new RuleError(`Wajib mengikuti ${SUIT_SYMBOL[suitOf(s.trick[0].card)]}`);
      throw new RuleError('Sekop belum pecah — belum boleh membuka dengan Sekop');
    }
    removeCards(hand, [card]);
    s.trick.push({ seat, card });
    pushLog(s.log, { seat, text: `${name} memainkan ${cardLabel(card)}` });
    if (suitOf(card) === 'S' && !s.spadesBroken) {
      s.spadesBroken = true;
      if (s.trick.length > 1) pushLog(s.log, { seat: null, text: '♠ Sekop sudah pecah!' });
    }
    if (s.trick.length === 4) {
      const w = trickWinner(s.trick, 'S');
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

  autoDelay: s => (s.over ? null : s.phase === 'trickDone' ? TRICK_PAUSE : s.phase === 'dealEnd' ? DEAL_PAUSE : null),

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
      if (s.trickNo >= 13) { finishDeal(s); return s; }
      s.phase = 'play';
      s.turn = w;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    if (s.phase === 'dealEnd') {
      s.dealNo += 1;
      s.dealer = (s.dealer + 1) % 4;
      startDeal(s, rng);
    }
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'bid') return { type: 'act', id: 'bid', amount: Math.max(1, estimateTricks(s.hands[seat])) };
    const legal = legalCards(s, seat).sort((a, b) => (suitOf(a) === 'S' ? 1 : 0) - (suitOf(b) === 'S' ? 1 : 0) || rankOf(a) - rankOf(b));
    return { type: 'act', id: 'play', cards: [legal[0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < 4 ? seat : null;
    const myTurn = me !== null && s.turn === me;
    const winnerName = s.trickWinnerSeat !== null ? s.names[s.trickWinnerSeat] : null;
    const contract = (t: number) => [t, t + 2].reduce((x, i) => x + (s.bids[i] ?? 0), 0);
    return {
      gameId: 'spades',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: spades.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.teamScores[teamOf(i)]} pt`,
        tag: `${teamOf(i) === 0 ? 'A' : 'B'}${s.dealer === i ? ' · D' : ''}`,
        status: s.phase === 'bid' && s.bids[i] === null ? (s.turn === i ? 'Menawar…' : '—') : `${bidText(s.bids[i])} · ${s.tricksWon[i]} trik`,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [{
        id: 'trick', label: s.phase === 'trickDone' ? `Trik ${s.trickNo + 1} — ${winnerName} ambil` : `Trik ${Math.min(13, s.trickNo + 1)}/13`,
        cards: s.trick.map(t => t.card), spread: true, highlight: s.phase === 'trickDone',
        caption: s.trick.length ? s.trick.map(t => s.names[t.seat]).join(' · ') : undefined,
      }],
      actions: actionsFor(s, me),
      playable: myTurn && s.phase === 'play' ? legalCards(s, me!) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'trickDone' ? `${winnerName} mengambil trik ini`
        : s.phase === 'dealEnd' ? 'Deal selesai — deal berikutnya segera dimulai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.phase === 'bid' ? 'Berapa trik yang akan kamu ambil? (0 = Nil)'
        : s.trick.length === 0 ? (s.spadesBroken ? 'Buka trik dengan kartu apa saja' : 'Buka trik (Sekop belum pecah)')
        : `Ikuti ${SUIT_SYMBOL[suitOf(s.trick[0].card)]} bila punya — bila tidak, boleh potong ♠`,
      badges: [
        `Deal ${s.dealNo}/${s.options.maxDeals}`,
        `A ${s.teamScores[0]} (${s.bags[0]} bag)${s.phase !== 'bid' ? ` · kontrak ${contract(0)}` : ''}`,
        `B ${s.teamScores[1]} (${s.bags[1]} bag)${s.phase !== 'bid' ? ` · kontrak ${contract(1)}` : ''}`,
        s.spadesBroken ? 'Sekop pecah ♠' : 'Sekop belum pecah',
        `Target ${s.options.target}`,
      ],
      banner: s.banner,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const me = v.you!;
    if (ids.includes('bid')) {
      const est = estimateTricks(v.hand);
      if (difficulty === 'easy') return { type: 'act', id: 'bid', amount: Math.max(1, Math.min(13, est + rng.int(3) - 1)) };
      const highSpade = v.hand.some(c => suitOf(c) === 'S' && rankOf(c) >= 11);
      const aces = v.hand.filter(c => rankOf(c) === 14).length;
      const partnerNil = parseStatus(v.players[(me + 2) % 4].status).bid === 0;
      if (est === 0 && !highSpade && aces === 0 && !partnerNil) return { type: 'act', id: 'nil' };
      return { type: 'act', id: 'bid', amount: Math.max(1, est) };
    }
    const legal = (v.playable ?? []).slice();
    if (difficulty === 'easy' && rng.float() < 0.5) return { type: 'act', id: 'play', cards: [legal[rng.int(legal.length)]] };
    const pick = chooseCard(v, legal, me);
    return { type: 'act', id: 'play', cards: [pick] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore([0, 1, 2, 3].map(i => s.teamScores[teamOf(i)]));
  },
};

/** Heuristik main kartu bot (hanya dari view). */
function chooseCard(v: GenericView, legal: Card[], me: number): Card {
  const trick = (v.piles.find(p => p.id === 'trick')?.cards ?? []).filter((c): c is Card => c !== null);
  const val = (c: Card) => rankOf(c) + (suitOf(c) === 'S' ? 20 : 0);
  const asc = legal.slice().sort((a, b) => val(a) - val(b));
  const lowest = asc[0];
  const highest = asc[asc.length - 1];
  const mine = parseStatus(v.players[me].status);
  const partner = (me + 2) % 4;
  const pStat = parseStatus(v.players[partner].status);
  const iAmNil = mine.bid === 0 && mine.tricks === 0;
  const teamBid = (mine.bid ?? 0) + (pStat.bid ?? 0);
  const teamTricks = mine.tricks + pStat.tricks;
  const needMore = teamTricks < teamBid;

  if (trick.length === 0) {
    if (iAmNil) return lowest;
    const aces = legal.filter(c => rankOf(c) === 14 && suitOf(c) !== 'S');
    if (needMore && aces.length) return aces[0];
    if (needMore && legal.some(c => c === 'AS')) return 'AS';
    // Kartu rendah dari suit non-sekop terpanjang.
    const nonS = legal.filter(c => suitOf(c) !== 'S');
    const pool = nonS.length ? nonS : legal;
    const counts = new Map<string, number>();
    for (const c of v.hand) counts.set(suitOf(c), (counts.get(suitOf(c)) ?? 0) + 1);
    return pool.slice().sort((a, b) => (counts.get(suitOf(b))! - counts.get(suitOf(a))!) || rankOf(a) - rankOf(b))[0];
  }
  const leader = (me - trick.length + 4) % 4;
  const played = trick.map((card, i) => ({ seat: (leader + i) % 4, card }));
  const winSeat = trickWinner(played, 'S');
  const winCard = played.find(p => p.seat === winSeat)!.card;
  const beats = (c: Card) => trickWinner([...played, { seat: me, card: c }], 'S') === me;
  const winners = asc.filter(beats);
  const losers = asc.filter(c => !beats(c));
  if (iAmNil) return losers.length ? losers[losers.length - 1] : highest;
  const partnerNil = pStat.bid === 0 && pStat.tricks === 0;
  if (winSeat === partner && !partnerNil) {
    const solid = trick.length === 3 || rankOf(winCard) >= 13 || suitOf(winCard) === 'S';
    if (solid) return losers.length ? losers[0] : lowest;
  }
  if (partnerNil && winSeat === partner && winners.length) return winners[0];
  if (needMore && winners.length) {
    // Orang terakhir: cukup kartu terendah yang menang; selain itu juga terendah yang menang.
    return winners[0];
  }
  return losers.length ? losers[0] : lowest;
}
