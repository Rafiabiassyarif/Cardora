// games/hearts.ts — Hearts, tepat 4 pemain.
//
// Aturan:
//  1. Deck 52, tiap pemain 13 kartu. Sebelum bermain, tiap pemain mengoper 3 kartu:
//     deal 1 ke kiri, deal 2 ke kanan, deal 3 ke seberang, deal 4 tanpa oper (berulang).
//     Operan dipilih bergiliran secara tertutup; kartu baru ditukar setelah SEMUA memilih.
//  2. Pemegang 2♣ membuka trik pertama dengan 2♣. Wajib mengikuti suit pembuka bila punya.
//  3. Di trik pertama, kartu Hati dan Q♠ tidak boleh dimainkan kecuali tidak ada pilihan lain.
//  4. Hati tidak boleh dibuka (lead) sebelum "pecah" (ada Hati yang dibuang),
//     kecuali tangan tinggal berisi Hati saja.
//  5. Kartu tertinggi dari suit pembuka memenangkan trik (tanpa truf); pemenang membuka trik berikutnya.
//  6. Tiap Hati = 1 poin, Q♠ = 13 poin. "Shoot the moon": mengambil ke-26 poin → dia 0, lawan +26.
//  7. Setelah satu deal, bila ada yang mencapai target (50/100), permainan selesai;
//     poin terendah menang (seri berbagi peringkat).

import { type Card, rankOf, suitOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  rankByScore, SUIT_SYMBOL, trickWinner, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface HeartsOptions { turnSeconds: number; passAndPlay: boolean; target: number }

export type HeartsPhase = 'pass' | 'play' | 'trickDone' | 'dealEnd';

export interface HeartsState {
  gameId: 'hearts';
  options: HeartsOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  phase: HeartsPhase;
  /** Nomor deal (mulai 1). */
  dealNo: number;
  /** 0 = kiri, 1 = kanan, 2 = seberang, 3 = tanpa oper. */
  passDir: number;
  /** Kartu yang sudah dipilih untuk dioper (tertutup), per seat. */
  passed: (Card[] | null)[];
  /** Kartu yang diterima dari operan (hanya terlihat oleh pemiliknya, selama trik pertama). */
  received: (Card[] | null)[];
  trick: { seat: number; card: Card }[];
  turn: number | null;
  /** Nomor trik di deal ini (0..12). */
  trickNo: number;
  heartsBroken: boolean;
  /** Semua kartu yang diambil tiap pemain di deal ini. */
  taken: Card[][];
  tricksWon: number[];
  scores: number[];
  /** Pemenang trik yang sedang dijeda (fase trickDone). */
  trickWinnerSeat: number | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'target', label: 'Target Poin', type: 'select', choices: [{ value: 50, label: '50 Poin (Cepat)' }, { value: 100, label: '100 Poin (Klasik)' }],
    help: 'Permainan selesai saat ada pemain mencapai poin ini; poin terendah menang' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: HeartsOptions = { turnSeconds: 25, passAndPlay: false, target: 50 };
const MAX_DEALS = 40; // pengaman (praktis tak pernah tercapai: total poin bertambah 26 per deal)
const TRICK_PAUSE = 1200;
const DEAL_PAUSE = 3000;

const PASS_LABEL = ['Kiri', 'Kanan', 'Seberang', 'Tanpa Oper'];
const SUIT_ORDER: Record<string, number> = { C: 0, D: 1, S: 2, H: 3 };

export const pointsOf = (c: Card) => (c === 'QS' ? 13 : suitOf(c) === 'H' ? 1 : 0);
const sortHand = (h: Card[]) => h.sort((a, b) => SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || rankOf(a) - rankOf(b));
const passTarget = (seat: number, dir: number) => (dir === 0 ? (seat + 1) % 4 : dir === 1 ? (seat + 3) % 4 : (seat + 2) % 4);
const dealPoints = (s: HeartsState) => s.taken.map(t => t.reduce((x, c) => x + pointsOf(c), 0));

/** Kartu yang sah dimainkan seat (fase play). */
export function legalCards(s: HeartsState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.trick.length === 0) {
    if (s.trickNo === 0 && hand.includes('2C')) return ['2C'];
    if (!s.heartsBroken) {
      const non = hand.filter(c => suitOf(c) !== 'H');
      if (non.length) return non;
    }
    return hand.slice();
  }
  const lead = suitOf(s.trick[0].card);
  const follow = hand.filter(c => suitOf(c) === lead);
  const pool = follow.length ? follow : hand.slice();
  if (s.trickNo === 0) {
    const safe = pool.filter(c => pointsOf(c) === 0);
    if (safe.length) return safe;
  }
  return pool;
}

function actionsFor(s: HeartsState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'pass') {
    return [{ id: 'pass', label: `Oper ke ${PASS_LABEL[s.passDir]}`, style: 'primary', cards: { min: 3, max: 3 }, hint: 'Pilih 3 kartu untuk dioper' }];
  }
  if (s.phase === 'play') return [{ id: 'play', label: 'Mainkan', style: 'primary', cards: { min: 1, max: 1 } }];
  return [];
}

function beginPlay(s: HeartsState) {
  s.phase = 'play';
  const starter = s.hands.findIndex(h => h.includes('2C'));
  s.turn = starter;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: starter, text: `${s.names[starter]} memegang 2♣ dan membuka trik pertama.` });
}

function startDeal(s: HeartsState, rng: Rng) {
  const deck = shuffledDeck(rng);
  s.hands = [0, 1, 2, 3].map(() => sortHand(deck.splice(0, 13)));
  s.passDir = (s.dealNo - 1) % 4;
  s.passed = [null, null, null, null];
  s.received = [null, null, null, null];
  s.trick = [];
  s.trickNo = 0;
  s.heartsBroken = false;
  s.taken = [[], [], [], []];
  s.tricksWon = [0, 0, 0, 0];
  s.trickWinnerSeat = null;
  s.banner = null;
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo} dimulai — oper: ${PASS_LABEL[s.passDir]}.` });
  if (s.passDir === 3) { beginPlay(s); return; }
  s.phase = 'pass';
  s.turn = (s.dealNo - 1) % 4;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function finishDeal(s: HeartsState) {
  const pts = dealPoints(s);
  const shooter = pts.findIndex(p => p === 26);
  let add = pts.slice();
  if (shooter >= 0) {
    add = pts.map((_, i) => (i === shooter ? 0 : 26));
    pushLog(s.log, { seat: shooter, text: `🌙 ${s.names[shooter]} Shoot the Moon! Semua lawan +26.` });
  }
  s.scores = s.scores.map((v, i) => v + add[i]);
  s.banner = `Deal ${s.dealNo}: ` + s.names.map((n, i) => `${n} +${add[i]}`).join(', ');
  pushLog(s.log, { seat: null, text: s.banner });
  s.turn = null;
  s.turnDeadline = null;
  if (Math.max(...s.scores) >= s.options.target || s.dealNo >= MAX_DEALS) {
    s.over = true;
    s.phase = 'dealEnd';
    const best = Math.min(...s.scores);
    const winners = s.names.filter((_, i) => s.scores[i] === best);
    pushLog(s.log, { seat: null, text: `🏆 ${winners.join(' & ')} menang dengan ${best} poin!` });
    return;
  }
  s.phase = 'dealEnd';
}

/** Tingkat "bahaya" kartu untuk dioper (makin besar makin ingin dibuang). */
function passDanger(c: Card): number {
  if (c === 'QS') return 100;
  if (c === 'AS') return 95;
  if (c === 'KS') return 90;
  const r = rankOf(c);
  if (suitOf(c) === 'H') return 20 + r * 2;
  if (suitOf(c) === 'S') return r - 5; // sekop rendah berguna untuk melindungi diri
  return r + 5;
}

const highestPass = (hand: Card[]) => hand.slice().sort((a, b) => passDanger(b) - passDanger(a)).slice(0, 3);

export const hearts: GameModule<HeartsState, GenericAction, GenericView, HeartsOptions> = {
  id: 'hearts',
  minPlayers: 4,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      target: Number(r.target) === 100 ? 100 : 50,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length !== 4) throw new RuleError('Hearts butuh tepat 4 pemain');
    const s: HeartsState = {
      gameId: 'hearts', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], phase: 'pass', dealNo: 1, passDir: 0, passed: [], received: [], trick: [], turn: null,
      trickNo: 0, heartsBroken: false, taken: [], tricksWon: [], scores: [0, 0, 0, 0],
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

    if (spec.id === 'pass') {
      const cards = takeCards(hand, a.cards, 3, 3);
      removeCards(hand, cards);
      s.passed[seat] = cards;
      pushLog(s.log, { seat, text: `${name} sudah memilih 3 kartu untuk dioper` });
      const next = [1, 2, 3].map(k => (seat + k) % 4).find(i => s.passed[i] === null);
      if (next !== undefined) {
        s.turn = next;
        s.turnDeadline = deadline(s.options.turnSeconds);
        return s;
      }
      for (let i = 0; i < 4; i++) {
        const to = passTarget(i, s.passDir);
        s.hands[to].push(...s.passed[i]!);
        s.received[to] = s.passed[i];
      }
      s.passed = [null, null, null, null];
      s.hands.forEach(sortHand);
      pushLog(s.log, { seat: null, text: `Kartu dioper ke ${PASS_LABEL[s.passDir].toLowerCase()}.` });
      beginPlay(s);
      return s;
    }

    // play
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!legalCards(s, seat).includes(card)) {
      if (s.trickNo === 0 && s.trick.length === 0) throw new RuleError('Trik pertama harus dibuka dengan 2♣');
      if (s.trick.length && hand.some(c => suitOf(c) === suitOf(s.trick[0].card))) {
        throw new RuleError(`Wajib mengikuti ${SUIT_SYMBOL[suitOf(s.trick[0].card)]}`);
      }
      if (s.trickNo === 0) throw new RuleError('Hati dan Q♠ tidak boleh dimainkan di trik pertama');
      throw new RuleError('Hati belum pecah — belum boleh membuka dengan Hati');
    }
    removeCards(hand, [card]);
    s.trick.push({ seat, card });
    pushLog(s.log, { seat, text: `${name} memainkan ${cardLabel(card)}` });
    if (suitOf(card) === 'H' && !s.heartsBroken) {
      s.heartsBroken = true;
      pushLog(s.log, { seat: null, text: '💔 Hati sudah pecah!' });
    }
    if (s.trick.length === 4) {
      const w = trickWinner(s.trick, null);
      s.trickWinnerSeat = w;
      s.phase = 'trickDone';
      s.turn = null;
      s.turnDeadline = null;
      const pts = s.trick.reduce((x, t) => x + pointsOf(t.card), 0);
      pushLog(s.log, { seat: w, text: `${s.names[w]} mengambil trik${pts ? ` (+${pts} poin)` : ''}` });
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
      s.received = [null, null, null, null];
      if (s.trickNo >= 13) { finishDeal(s); return s; }
      s.phase = 'play';
      s.turn = w;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    if (s.phase === 'dealEnd') {
      s.dealNo += 1;
      startDeal(s, rng);
      return s;
    }
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'pass') return { type: 'act', id: 'pass', cards: highestPass(s.hands[seat]) };
    const legal = legalCards(s, seat).sort((a, b) => pointsOf(a) - pointsOf(b) || rankOf(a) - rankOf(b));
    return { type: 'act', id: 'play', cards: [legal[0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < 4 ? seat : null;
    const pts = dealPoints(s);
    const piles: GPile[] = [];
    const winnerName = s.trickWinnerSeat !== null ? s.names[s.trickWinnerSeat] : null;
    piles.push({
      id: 'trick', label: s.phase === 'trickDone' ? `Trik ${s.trickNo + 1} — ${winnerName} ambil` : `Trik ${Math.min(13, s.trickNo + 1)}/13`,
      cards: s.trick.map(t => t.card), spread: true, highlight: s.phase === 'trickDone',
      caption: s.trick.length ? s.trick.map(t => s.names[t.seat]).join(' · ') : undefined,
    });
    if (me !== null && s.phase === 'pass' && s.passed[me]) {
      piles.push({ id: 'myPass', label: `Kartu operanmu (${PASS_LABEL[s.passDir]})`, cards: s.passed[me]!.slice(), spread: true });
    }
    if (me !== null && s.received[me] && s.trickNo === 0) {
      piles.push({ id: 'received', label: 'Kartu yang kamu terima', cards: s.received[me]!.slice(), spread: true });
    }
    const myTurn = me !== null && s.turn === me;
    return {
      gameId: 'hearts',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: hearts.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        status: s.phase === 'pass' ? (s.passed[i] ? 'Sudah oper' : 'Memilih operan') : `${s.tricksWon[i]} trik · ${pts[i]} pt`,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles,
      actions: actionsFor(s, me),
      playable: myTurn && s.phase === 'play' ? legalCards(s, me!) : myTurn && s.phase === 'pass' ? s.hands[me!].slice() : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'trickDone' ? `${winnerName} mengambil trik ini`
        : s.phase === 'dealEnd' ? 'Deal selesai — deal berikutnya segera dimulai'
        : !myTurn ? (s.phase === 'pass' ? `Menunggu ${s.names[s.turn ?? 0]} memilih operan…` : `Menunggu ${s.names[s.turn ?? 0]}…`)
        : s.phase === 'pass' ? `Pilih 3 kartu untuk dioper ke ${PASS_LABEL[s.passDir].toLowerCase()}`
        : s.trickNo === 0 && s.trick.length === 0 ? 'Buka trik pertama dengan 2♣'
        : s.trick.length === 0 ? (s.heartsBroken ? 'Buka trik dengan kartu apa saja' : 'Buka trik (Hati belum pecah)')
        : `Ikuti ${SUIT_SYMBOL[suitOf(s.trick[0].card)]} bila punya`,
      badges: [`Deal ${s.dealNo}`, `Oper: ${PASS_LABEL[s.passDir]}`, s.heartsBroken ? 'Hati pecah 💔' : 'Hati belum pecah', `Target ${s.options.target}`],
      banner: s.banner,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.includes('pass')) {
      if (difficulty === 'easy') {
        const h = v.hand.slice();
        const pick: Card[] = [];
        while (pick.length < 3) pick.push(h.splice(rng.int(h.length), 1)[0]);
        return { type: 'act', id: 'pass', cards: pick };
      }
      return { type: 'act', id: 'pass', cards: highestPass(v.hand) };
    }
    const legal = (v.playable ?? []).slice();
    if (difficulty === 'easy' && rng.float() < 0.6) return { type: 'act', id: 'play', cards: [legal[rng.int(legal.length)]] };
    const trick = (v.piles.find(p => p.id === 'trick')?.cards ?? []).filter((c): c is Card => c !== null);
    const byRank = (a: Card, b: Card) => rankOf(a) - rankOf(b);
    let pick: Card;
    if (trick.length === 0) {
      // Buka dengan kartu terendah; hindari membuka sekop tinggi.
      const safe = legal.filter(c => !(suitOf(c) === 'S' && rankOf(c) >= 12));
      pick = (safe.length ? safe : legal).sort(byRank)[0];
    } else {
      const lead = suitOf(trick[0]);
      const following = legal.filter(c => suitOf(c) === lead);
      if (following.length) {
        const high = Math.max(...trick.filter(c => suitOf(c) === lead).map(rankOf));
        const under = following.filter(c => rankOf(c) < high).sort(byRank);
        const trickPts = trick.reduce((x, c) => x + pointsOf(c), 0);
        if (under.length) pick = under[under.length - 1];
        else if (trick.length === 3 && trickPts === 0) {
          const noQ = following.filter(c => c !== 'QS').sort(byRank);
          pick = noQ.length ? noQ[noQ.length - 1] : following[0];
        } else pick = following.filter(c => c !== 'QS').sort(byRank)[0] ?? following[0];
      } else {
        const hs = legal.filter(c => suitOf(c) === 'H').sort(byRank);
        const bigS = legal.filter(c => c === 'AS' || c === 'KS');
        pick = legal.includes('QS') ? 'QS' : bigS.length ? bigS[0] : hs.length ? hs[hs.length - 1] : legal.sort(byRank)[legal.length - 1];
      }
    }
    return { type: 'act', id: 'play', cards: [pick] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, false);
  },
};
