// games/sevenCardStud.ts — Seven Card Stud (fixed-limit), 2–8 pemain.
//
// Aturan yang diimplementasikan:
//  1. Taruhan: ante = 1/5 small bet, bring-in = 1/2 small bet, small bet di street 3–4,
//     big bet (2× small) di street 5–7. Fixed-limit: maksimal 1 bet + 3 raise per street.
//  2. Third street: setiap pemain membayar ante lalu menerima 2 kartu tertutup + 1 terbuka.
//     Kartu terbuka TERENDAH wajib bring-in (As tinggi; seri dipecah suit ♣ < ♦ < ♥ < ♠).
//     Pemain bring-in memilih membayar bring-in atau langsung melengkapi (complete) ke small bet;
//     pemain berikutnya boleh fold, call bring-in, atau melengkapi. "Lengkapi" dihitung sebagai bet.
//  3. Fourth–sixth street: masing-masing 1 kartu terbuka; seventh street (river): 1 kartu tertutup.
//     Mulai fourth street, pemain dengan kartu terbuka TERBAIK (pair/trips/quads lalu kartu tinggi;
//     straight/flush tidak dihitung) beraksi pertama; seri → yang terdekat di kiri dealer.
//  4. Bila deck tidak cukup untuk seventh street (8 pemain bertahan), satu kartu KOMUNITAS
//     dibuka di tengah dan dipakai bersama oleh semua pemain.
//  5. Showdown: 5 kartu terbaik dari 7 kartu sendiri; all-in, side pot, split pot, dan
//     pengembalian taruhan yang tidak di-call ditangani mesin taruhan bersama.
//  6. Banyak tangan berturut-turut sampai tersisa satu pemain bermodal atau batas tangan;
//     peringkat akhir = jumlah chip. (Tanpa burn card; tanpa opsi double bet saat pair terbuka.)

import { type Card, rankOf, suitOf, shuffledDeck, standardDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { bestHand, compareScores } from '../poker/evaluator';
import {
  type BetRound, type PSeat, newSeat, inHand, canAct, potTotal, nextSeatWhere, put, resetForHand,
  startRound, endRound, legalFor, betActionSpecs, applyBet, postForced, progressAfter, settlePots, botBetDecision,
} from './pokerBetting';

export interface SevenCardStudOptions {
  turnSeconds: number;
  passAndPlay: boolean;
  startingChips: number;
  /** Small bet; ante = 1/5, bring-in = 1/2, big bet = 2×. */
  smallBet: number;
  maxHands: number;
}

export interface StudSeat extends PSeat {
  name: string;
  isBot: boolean;
  down: Card[];
  up: Card[];
  shown: boolean;
}

export type StudPhase = 'bet' | 'deal' | 'handOver' | 'gameOver';

export interface SevenCardStudState {
  gameId: 'seven-card-stud';
  options: SevenCardStudOptions;
  seats: StudSeat[];
  handNo: number;
  dealer: number;
  street: number; // 3..7
  phase: StudPhase;
  /** Seat yang wajib bring-in (belum memilih), atau null. */
  bringIn: number | null;
  round: BetRound;
  deck: Card[];
  community: Card | null;
  log: LogEntry[];
  turnDeadline: number | null;
  lastHand: string | null;
}

export interface StudPokerInfo { pot: number; toCall: number; currentBet: number; unit: number; opponents: number; raiseLevel: number }

const OPTIONS: OptionSpec[] = [
  {
    key: 'startingChips', label: 'Modal Chip Awal', type: 'select',
    choices: [{ value: 500, label: '500 Chip' }, { value: 1000, label: '1.000 Chip' }, { value: 2000, label: '2.000 Chip' }],
  },
  {
    key: 'smallBet', label: 'Limit Taruhan', type: 'select',
    choices: [
      { value: 10, label: '10/20 (ante 2, bring-in 5)' },
      { value: 20, label: '20/40 (ante 4, bring-in 10)' },
      { value: 50, label: '50/100 (ante 10, bring-in 25)' },
    ],
    help: 'Small bet di street 3–4, big bet di street 5–7',
  },
  { key: 'maxHands', label: 'Jumlah Tangan', type: 'number', min: 3, max: 30, step: 1, help: 'Permainan berakhir setelah sekian tangan (atau saat tersisa satu pemain)' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: SevenCardStudOptions = { turnSeconds: 25, passAndPlay: false, startingChips: 1000, smallBet: 20, maxHands: 10 };

const ante = (s: SevenCardStudState) => s.options.smallBet / 5;
const bringInAmt = (s: SevenCardStudState) => s.options.smallBet / 2;
const unitFor = (s: SevenCardStudState, street: number) => (street <= 4 ? s.options.smallBet : s.options.smallBet * 2);
const log = (s: SevenCardStudState, seat: number | null, text: string) => pushLog(s.log, { seat, text });
const SUIT_ORDER: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };
const STREET_NAME: Record<number, string> = { 3: 'Third Street', 4: 'Fourth Street', 5: 'Fifth Street', 6: 'Sixth Street', 7: 'Seventh Street' };

/** Nilai kartu untuk bring-in: rank lalu suit (♣ terendah). */
export const bringInValue = (c: Card) => rankOf(c) * 4 + SUIT_ORDER[suitOf(c)];

/** Skor kartu terbuka (1–4 kartu): [kategori, ...rank]. 4=quads, 3=trips, 2=two pair, 1=pair, 0=high. */
export function showingScore(up: Card[]): number[] {
  const counts = new Map<number, number>();
  for (const c of up) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]);
  const cat = shape[0] === 4 ? 4 : shape[0] === 3 ? 3 : shape[0] === 2 && shape[1] === 2 ? 2 : shape[0] === 2 ? 1 : 0;
  return [cat, ...groups.map(g => g[0])];
}

/** Seat bring-in: kartu terbuka terendah di antara pemain yang masih bisa beraksi. */
export function findBringIn(s: SevenCardStudState): number | null {
  let best: number | null = null;
  s.seats.forEach((x, i) => {
    if (!canAct(x) || !x.up.length) return;
    if (best === null || bringInValue(x.up[0]) < bringInValue(s.seats[best].up[0])) best = i;
  });
  return best;
}

/** Seat dengan kartu terbuka terbaik (seri: terdekat di kiri dealer). */
export function bestShowing(s: SevenCardStudState): number {
  let best = -1;
  for (let k = 1; k <= s.seats.length; k++) {
    const i = (s.dealer + k) % s.seats.length;
    if (!inHand(s.seats[i])) continue;
    if (best < 0 || compareScores(showingScore(s.seats[i].up), showingScore(s.seats[best].up)) > 0) best = i;
  }
  return best;
}

/* ------------------------------ hand flow ------------------------------ */

function startHand(s: SevenCardStudState, rng: Rng, first: boolean) {
  resetForHand(s.seats);
  for (const x of s.seats) { x.down = []; x.up = []; x.shown = false; }
  s.handNo += 1;
  s.lastHand = null;
  s.community = null;
  s.bringIn = null;
  if (!first || s.seats[s.dealer].out) s.dealer = nextSeatWhere(s.seats, s.dealer, x => !x.out);
  s.deck = shuffledDeck(rng);
  log(s, null, `Tangan #${s.handNo} — dealer: ${s.seats[s.dealer].name}`);
  for (const x of s.seats) if (!x.out) put(x, ante(s), false);
  log(s, null, `Semua pemain membayar ante ${ante(s)}`);
  for (let k = 0; k < 3; k++) {
    for (let j = 1; j <= s.seats.length; j++) {
      const x = s.seats[(s.dealer + j) % s.seats.length];
      if (x.out) continue;
      (k < 2 ? x.down : x.up).push(s.deck.shift()!);
    }
  }
  s.street = 3;
  s.phase = 'bet';
  startRound(s.seats, s.round, unitFor(s, 3), s.dealer + 1);
  const canActCount = s.seats.filter(canAct).length;
  const bi = canActCount >= 2 ? findBringIn(s) : null;
  if (bi !== null) {
    s.bringIn = bi;
    s.round.toAct = bi;
    log(s, bi, `${s.seats[bi].name} wajib bring-in (kartu terbuka terendah ${cardLabel(s.seats[bi].up[0])})`);
  } else {
    s.round.toAct = null;
    endStreet(s);
  }
}

function endStreet(s: SevenCardStudState) {
  endRound(s.seats, s.round);
  s.bringIn = null;
  if (s.street >= 7) showdown(s);
  else s.phase = 'deal';
}

function dealStreet(s: SevenCardStudState) {
  s.street += 1;
  const order: StudSeat[] = [];
  for (let j = 1; j <= s.seats.length; j++) {
    const x = s.seats[(s.dealer + j) % s.seats.length];
    if (inHand(x)) order.push(x);
  }
  if (s.street === 7 && s.deck.length < order.length) {
    s.community = s.deck.shift()!;
    log(s, null, `Deck tidak cukup — kartu komunitas ${cardLabel(s.community)} dipakai bersama`);
  } else {
    for (const x of order) (s.street === 7 ? x.down : x.up).push(s.deck.shift()!);
  }
  log(s, null, STREET_NAME[s.street]);
  s.phase = 'bet';
  const first = bestShowing(s);
  startRound(s.seats, s.round, unitFor(s, s.street), first);
  if (s.round.toAct === null) endStreet(s);
}

function allCards(s: SevenCardStudState, x: StudSeat): Card[] {
  return [...x.down, ...x.up, ...(s.community ? [s.community] : [])];
}

function showdown(s: SevenCardStudState) {
  endRound(s.seats, s.round);
  const scores = new Map<number, number[]>();
  const names = new Map<number, string>();
  s.seats.forEach((x, i) => {
    if (!inHand(x)) return;
    const v = bestHand(allCards(s, x));
    scores.set(i, v.score); names.set(i, v.name); x.shown = true;
  });
  finishHand(s, scores, names);
}

function finishHand(s: SevenCardStudState, scores: Map<number, number[]> | null, names: Map<number, string> | null) {
  s.round.toAct = null;
  s.bringIn = null;
  const res = settlePots(s.seats, scores, s.dealer);
  for (const rf of res.refunds) if (rf.amount > 0) log(s, rf.seat, `${s.seats[rf.seat].name} menerima kembali ${rf.amount} (taruhan tidak di-call)`);
  const parts: string[] = [];
  for (const [seat, amt] of res.won) {
    const h = names?.get(seat);
    const t = `${s.seats[seat].name} menang ${amt}${h ? ` dengan ${h}` : ''}`;
    log(s, seat, t); parts.push(t);
  }
  s.lastHand = parts.join(' · ') || null;
  const alive = s.seats.filter(x => x.stack > 0).length;
  s.phase = alive <= 1 || s.handNo >= s.options.maxHands ? 'gameOver' : 'handOver';
  if (s.phase === 'gameOver') log(s, null, 'Permainan selesai');
}

/* ------------------------------ actions -------------------------------- */

function actionsFor(s: SevenCardStudState, seat: number | null): GActionSpec[] {
  if (seat === null || s.phase !== 'bet' || s.round.toAct !== seat) return [];
  if (s.bringIn === seat) {
    const x = s.seats[seat];
    const L = legalFor(s.seats, s.round, seat)!;
    const amt = Math.min(bringInAmt(s), x.stack);
    const acts: GActionSpec[] = [{ id: 'bringin', label: `Bring-in ${amt}${amt >= x.stack ? ' (all-in)' : ''}`, style: 'primary' }];
    if (L.raise) acts.push({ id: 'bet', label: `Lengkapi ${L.raise.min}`, hint: 'Langsung bet small bet penuh' });
    else if (L.allInTo !== null && L.allInTo > amt) acts.push({ id: 'allin', label: `All-in ${L.allInTo}`, style: 'danger' });
    return acts;
  }
  return betActionSpecs(s.seats, s.round, seat, 'Lengkapi');
}

function info(s: SevenCardStudState, seat: number | null): StudPokerInfo {
  const L = seat === null ? null : legalFor(s.seats, s.round, seat);
  return {
    pot: potTotal(s.seats), toCall: L?.callAmount ?? 0, currentBet: s.round.currentBet, unit: s.round.unit,
    opponents: s.seats.filter((x, i) => i !== seat && inHand(x)).length,
    raiseLevel: s.round.fullRaiseCount,
  };
}

/* ------------------------------ module --------------------------------- */

export const sevenCardStud: GameModule<SevenCardStudState, GenericAction, GenericView, SevenCardStudOptions> = {
  id: 'seven-card-stud',
  minPlayers: 2,
  maxPlayers: 8,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const chips = Number(r.startingChips);
    const sb = Number(r.smallBet);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      startingChips: [500, 1000, 2000].includes(chips) ? chips : DEFAULTS.startingChips,
      smallBet: [10, 20, 50].includes(sb) ? sb : DEFAULTS.smallBet,
      maxHands: clampInt(r.maxHands, 3, 30, DEFAULTS.maxHands),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 8) throw new RuleError('Seven Card Stud butuh 2–8 pemain');
    const s: SevenCardStudState = {
      gameId: 'seven-card-stud', options,
      seats: seats.map(p => ({ ...newSeat(options.startingChips), name: p.name, isBot: !!p.isBot, down: [], up: [], shown: false })),
      handNo: 0, dealer: rng.int(seats.length), street: 3, phase: 'bet', bringIn: null,
      round: { structure: 'fl', unit: options.smallBet, currentBet: 0, minRaise: options.smallBet, fullRaiseCount: 0, cap: 4, toAct: null },
      deck: [], community: null, log: [], turnDeadline: null, lastHand: null,
    };
    startHand(s, rng, true);
    s.turnDeadline = s.round.toAct === null ? null : deadline(options.turnSeconds);
    return s;
  },

  currentSeat: s => (s.phase === 'bet' ? s.round.toAct : null),

  apply(state, seat, raw, _rng) {
    if (state.phase !== 'bet') throw new RuleError(state.phase === 'deal' ? 'Tunggu kartu dibagikan' : 'Tangan sudah selesai');
    if (state.round.toAct !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const x = s.seats[seat];
    if (spec.id === 'bringin') {
      const paid = postForced(s.seats, s.round, seat, bringInAmt(s));
      log(s, seat, `${x.name} bring-in ${paid}${x.allIn ? ' (all-in)' : ''}`);
    } else {
      log(s, seat, applyBet(s.seats, s.round, seat, a, x.name));
    }
    s.bringIn = null;
    const res = progressAfter(s.seats, s.round, seat);
    if (res === 'won') { endRound(s.seats, s.round); finishHand(s, null, null); }
    else if (res === 'done') endStreet(s);
    s.turnDeadline = s.round.toAct === null ? null : deadline(s.options.turnSeconds);
    return s;
  },

  autoDelay(s) {
    if (s.phase === 'handOver') return 3500;
    if (s.phase === 'deal') return 900;
    return null;
  },

  advance(state, rng) {
    if (state.phase !== 'handOver' && state.phase !== 'deal') return state;
    const s = clone(state);
    if (s.phase === 'handOver') startHand(s, rng, false);
    else dealStreet(s);
    s.turnDeadline = s.round.toAct === null || s.phase !== 'bet' ? null : deadline(s.options.turnSeconds);
    return s;
  },

  timeoutAction(s, seat) {
    if (s.bringIn === seat) return { type: 'act', id: 'bringin' };
    const acts = actionsFor(s, seat);
    return { type: 'act', id: acts.some(x => x.id === 'check') ? 'check' : 'fold' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.seats.length ? seat : null;
    const over = s.phase === 'gameOver';
    const ended = s.phase === 'handOver' || over;
    const turn = s.phase === 'bet' ? s.round.toAct : null;
    const inf = info(s, me);
    let prompt: string;
    if (over) prompt = 'Permainan selesai';
    else if (s.phase === 'handOver') prompt = 'Tangan berikutnya segera dimulai…';
    else if (s.phase === 'deal') prompt = 'Membagikan kartu…';
    else if (turn !== me || me === null) prompt = `Menunggu ${s.seats[turn ?? 0].name}…`;
    else if (s.bringIn === me) prompt = `Kartu terbukamu terendah: bayar bring-in ${bringInAmt(s)} atau lengkapi ke ${s.options.smallBet}`;
    else prompt = inf.toCall > 0 ? `Call ${inf.toCall}, raise, atau fold` : 'Check atau bet';
    const piles = [];
    if (s.community) piles.push({ id: 'community', label: 'Kartu Komunitas', cards: [s.community], highlight: true });
    piles.push({ id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length });
    const v: GenericView & { poker: StudPokerInfo } = {
      gameId: 'seven-card-stud',
      generic: true,
      you: me,
      turn,
      over,
      log: s.log.slice(-30),
      results: sevenCardStud.results(s),
      players: s.seats.map((x, i) => {
        const st: string[] = [];
        if (x.out) st.push('Habis');
        else if (x.folded) st.push('Fold');
        else {
          if (x.bet > 0) st.push(`Bet ${x.bet}`);
          if (x.allIn) st.push('All-in');
          if (s.bringIn === i) st.push('Bring-in');
        }
        return {
          name: x.name, isBot: x.isBot, count: x.down.length + x.up.length, score: `${x.stack} chip`,
          status: st.join(' · ') || undefined,
          tag: i === s.dealer ? 'D' : undefined,
          out: x.out || x.folded,
          // Kartu tertutup hanya dibuka saat showdown.
          faceUp: x.out ? undefined : x.shown ? [...x.down, ...x.up] : x.up.slice(),
        };
      }),
      hand: me !== null ? [...s.seats[me].down, ...s.seats[me].up] : [],
      piles,
      actions: actionsFor(s, me),
      prompt,
      badges: [`Tangan ${s.handNo}/${s.options.maxHands}`, STREET_NAME[s.street], `Pot ${potTotal(s.seats)}`,
        `Limit ${s.options.smallBet}/${s.options.smallBet * 2}`],
      banner: ended ? s.lastHand : null,
      poker: inf,
    };
    return v;
  },

  bot(v, difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const inf = (v as GenericView & { poker?: StudPokerInfo }).poker
      ?? { pot: 0, toCall: 0, currentBet: 0, unit: 1, opponents: 1, raiseLevel: 0 };
    const me = v.you ?? 0;
    const myUp = v.players[me]?.faceUp ?? [];
    const opps: Card[][] = [];
    const dead: Card[] = [];
    v.players.forEach((p, i) => {
      if (i === me) return;
      const up = (p.faceUp ?? []).filter((c): c is Card => !!c);
      if (p.out) dead.push(...up); else opps.push(up);
    });
    const community = v.piles.find(p => p.id === 'community')?.cards.filter((c): c is Card => !!c) ?? [];
    const iters = difficulty === 'hard' ? 80 : difficulty === 'normal' ? 50 : 25;
    const equity = studEquity(v.hand, opps, [...dead, ...myUp.filter((c): c is Card => !!c)], community, iters, rng);
    if (ids.includes('bringin')) {
      const strong = equity > Math.min(0.72, 1.3 / (opps.length + 1) + 0.08);
      if (strong && ids.includes('bet')) return { type: 'act', id: 'bet' };
      return { type: 'act', id: 'bringin' };
    }
    return botBetDecision(v.actions, inf, equity, difficulty, rng);
  },

  isOver: s => s.phase === 'gameOver',

  results(s): SeatResult[] | null {
    if (s.phase !== 'gameOver') return null;
    return rankByScore(s.seats.map(x => x.stack));
  },
};

/* --------------------------------- bot --------------------------------- */

/**
 * Monte Carlo: kartu sendiri + kartu terbuka lawan yang terlihat; sisa kartu diacak dari kartu
 * yang tidak terlihat. Maksimal 3 lawan disimulasikan; hasil diskalakan untuk lawan lebih banyak.
 */
export function studEquity(mine: Card[], opps: Card[][], seen: Card[], community: Card[], iters: number, rng: Rng): number {
  if (!opps.length) return 1;
  const known = new Set([...mine, ...opps.flat(), ...seen, ...community]);
  const pool = standardDeck().filter(c => !known.has(c));
  const perPlayer = community.length ? 6 : 7;
  const sim = opps.slice(0, 3);
  const myNeed = Math.max(0, perPlayer - mine.length);
  const needs = sim.map(o => Math.max(0, perPlayer - o.length));
  const total = myNeed + needs.reduce((t, x) => t + x, 0);
  if (pool.length === 0) return 0.5;
  let score = 0;
  for (let it = 0; it < iters; it++) {
    const n = Math.min(total, pool.length);
    for (let i = 0; i < n; i++) {
      const j = i + rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let k = 0;
    const take = (m: number) => { const out: Card[] = []; for (let q = 0; q < m; q++) out.push(pool[(k++) % pool.length]); return out; };
    const myCards = [...mine, ...take(myNeed), ...community];
    if (myCards.length < 5) return 0.5;
    const my = bestHand(myCards).score;
    let lost = false, ties = 1;
    for (let o = 0; o < sim.length && !lost; o++) {
      const cards = [...sim[o], ...take(needs[o]), ...community];
      if (cards.length < 5) continue;
      const c = compareScores(my, bestHand(cards).score);
      if (c < 0) lost = true; else if (c === 0) ties++;
    }
    if (!lost) score += 1 / ties;
  }
  const e = score / iters;
  return opps.length > sim.length ? Math.pow(e, opps.length / sim.length) : e;
}

