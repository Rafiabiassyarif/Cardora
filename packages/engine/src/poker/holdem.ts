// poker/holdem.ts — Texas Hold'em No-Limit, mesin aturan authoritative.
//
// Urutan: button → small blind → big blind → pre-flop → flop → turn → river →
// showdown (atau menang karena semua lawan fold). Mendukung all-in, side pot,
// split pot, pengembalian taruhan yang tidak di-call, heads-up (button = SB),
// raise minimum, dan all-in "incomplete raise" yang tidak membuka ulang aksi.

import { type Card, draw, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import {
  type BaseView, type Difficulty, type GameModule, type LogEntry, type OptionSpec,
  type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog,
} from '../types';
import { bestHand, compareScores } from './evaluator';
import { buildPots, splitPot } from './pots';
import { estimateEquity } from './equity';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'handOver' | 'gameOver';

export type HoldemAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }    // total taruhan street ini ("bet to")
  | { type: 'raise'; amount: number }  // total taruhan street ini ("raise to")
  | { type: 'allin' };

export interface HoldemOptions {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  /** 0 = main sampai tersisa satu pemain. */
  maxHands: number;
  blindStructure?: 'static' | 'turbo' | 'hyper';
  turnSeconds?: number;
  showHandStrength?: boolean;
  autoMuck?: boolean;
  passAndPlay?: boolean;
}

export interface HoldemSeat {
  id: string;
  name: string;
  isBot: boolean;
  stack: number;
  hole: Card[];
  /** Taruhan pada street berjalan. */
  bet: number;
  /** Total kontribusi pada tangan ini. */
  contributed: number;
  folded: boolean;
  allIn: boolean;
  /** Tidak ikut tangan ini (chip habis). */
  out: boolean;
  acted: boolean;
  /** Nilai fullRaiseCount saat seat ini terakhir beraksi. */
  actedRaiseCount: number;
  /** Kartu dibuka di showdown. */
  shown: boolean;
}

export interface HandSummary {
  handNo: number;
  board: Card[];
  winners: { seat: number; amount: number; hand: string | null }[];
  showdown: boolean;
}

export interface HoldemState {
  gameId: 'holdem';
  options: HoldemOptions;
  seats: HoldemSeat[];
  handNo: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  street: Street;
  deck: Card[];
  board: Card[];
  currentBet: number;
  /** Besar raise penuh terakhir (raise minimum berikutnya). */
  minRaise: number;
  fullRaiseCount: number;
  toAct: number | null;
  log: LogEntry[];
  lastHand: HandSummary | null;
}

export interface HoldemSeatView {
  name: string;
  isBot: boolean;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  out: boolean;
  /** Kartu hanya terlihat untuk pemilik atau saat dibuka di showdown. */
  hole: (Card | null)[];
}

export interface HoldemLegal {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;      // 0 jika tidak bisa call
  minBet: number | null;   // untuk bet (currentBet = 0)
  minRaiseTo: number | null;
  maxTo: number;           // bet+stack (all-in)
  canAllIn: boolean;
}

export interface HoldemView extends BaseView {
  gameId: 'holdem';
  seats: HoldemSeatView[];
  board: Card[];
  street: Street;
  pot: number;
  currentBet: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  bigBlind: number;
  handNo: number;
  legal: HoldemLegal | null;
  lastHand: HandSummary | null;
}

const OPTIONS: OptionSpec[] = [
  {
    key: 'startingStack',
    label: 'Modal Chip Awal',
    type: 'select',
    choices: [
      { value: 500, label: '500 Chip (Santai)' },
      { value: 1000, label: '1.000 Chip (Standar)' },
      { value: 2500, label: '2.500 Chip (Kompetitif)' },
      { value: 5000, label: '5.000 Chip (High Roller)' },
      { value: 10000, label: '10.000 Chip (Deep Stack)' },
    ],
    help: 'Jumlah modal chip yang didapat setiap pemain di meja'
  },
  {
    key: 'bigBlind',
    label: 'Taruhan Big Blind',
    type: 'select',
    choices: [
      { value: 10, label: '10 Chip (SB 5)' },
      { value: 20, label: '20 Chip (SB 10)' },
      { value: 50, label: '50 Chip (SB 25)' },
      { value: 100, label: '100 Chip (SB 50)' },
      { value: 200, label: '200 Chip (SB 100)' },
    ],
    help: 'Taruhan wajib; Small Blind otomatis setengah dari Big Blind'
  },
  {
    key: 'blindStructure',
    label: 'Kenaikan Blind',
    type: 'select',
    choices: [
      { value: 'static', label: 'Tetap (Cash Game Standar)' },
      { value: 'turbo', label: 'Turbo (Naik 50% Tiap 5 Tangan)' },
      { value: 'hyper', label: 'Hyper-Turbo (Naik Tiap 3 Tangan)' },
    ],
    help: 'Kecepatan eliminasi pemain melalui kenaikan taruhan berkala'
  },
  {
    key: 'turnSeconds',
    label: 'Batas Waktu Giliran',
    type: 'select',
    choices: [
      { value: 0, label: '♾️ Tanpa Batas Waktu (Santai)' },
      { value: 15, label: '15 Detik (Cepat)' },
      { value: 25, label: '25 Detik (Standar Kasino)' },
      { value: 40, label: '40 Detik (Berpikir Dalam)' },
    ],
    help: 'Waktu berpikir sebelum sistem otomatis Check atau Fold'
  },
  {
    key: 'showHandStrength',
    label: 'Kalkulator Pot Odds & Kekuatan Kartu',
    type: 'boolean',
    help: 'Tampilkan persentase kemenangan dan analisis kombinasi kartu secara langsung di layar'
  },
  {
    key: 'autoMuck',
    label: 'Auto-Muck (Sembunyikan Kartu Kalah)',
    type: 'boolean',
    help: 'Sembunyikan kartu tangan yang kalah saat showdown tanpa diperlihatkan ke lawan'
  },
  {
    key: 'passAndPlay',
    label: 'Mode Operan HP (Multiplayer Lokal)',
    type: 'boolean',
    help: 'Tampilkan layar privasi saat giliran berganti ke pemain manusia berikutnya'
  },
  { key: 'maxHands', label: 'Batas Tangan (0 = sampai satu juara)', type: 'number', min: 0, max: 200, step: 5 },
];

const DEFAULTS: HoldemOptions = {
  startingStack: 1000,
  smallBlind: 10,
  bigBlind: 20,
  maxHands: 0,
  blindStructure: 'static',
  turnSeconds: 25,
  showHandStrength: true,
  autoMuck: true,
  passAndPlay: false,
};

/* ------------------------------ helpers -------------------------------- */

const n = (s: HoldemState) => s.seats.length;
const nextSeat = (s: HoldemState, from: number, pred: (x: HoldemSeat, i: number) => boolean): number => {
  for (let k = 1; k <= n(s); k++) {
    const i = (from + k) % n(s);
    if (pred(s.seats[i], i)) return i;
  }
  return -1;
};
const inHand = (x: HoldemSeat) => !x.out && !x.folded;
const canAct = (x: HoldemSeat) => inHand(x) && !x.allIn;
const potTotal = (s: HoldemState) => s.seats.reduce((t, x) => t + x.contributed, 0);
const log = (s: HoldemState, seat: number | null, text: string) => pushLog(s.log, { seat, text });

function needsAction(s: HoldemState, x: HoldemSeat): boolean {
  if (!canAct(x)) return false;
  const others = s.seats.filter(o => o !== x && canAct(o)).length;
  if (others === 0) return x.bet < s.currentBet; // tak ada lawan untuk taruhan baru
  return !x.acted || x.bet < s.currentBet;
}

function put(x: HoldemSeat, amount: number) {
  const a = Math.min(amount, x.stack);
  x.stack -= a;
  x.bet += a;
  x.contributed += a;
  if (x.stack === 0) x.allIn = true;
  return a;
}

/* ------------------------------ hand flow ------------------------------ */

function startHand(s: HoldemState, rng: Rng, first: boolean) {
  for (const x of s.seats) {
    x.out = x.stack <= 0;
    Object.assign(x, { hole: [], bet: 0, contributed: 0, folded: false, allIn: false, acted: false, actedRaiseCount: 0, shown: false });
  }
  s.handNo += 1;
  s.board = [];
  s.deck = shuffledDeck(rng);
  s.street = 'preflop';
  s.fullRaiseCount = 0;
  s.minRaise = s.options.bigBlind;

  // Dealer button bergeser ke pemain aktif berikutnya.
  s.button = first ? s.button : nextSeat(s, s.button, x => !x.out);
  if (s.seats[s.button].out) s.button = nextSeat(s, s.button, x => !x.out);
  const active = s.seats.filter(x => !x.out).length;
  // Heads-up: button = small blind dan beraksi pertama pre-flop.
  s.sbSeat = active === 2 ? s.button : nextSeat(s, s.button, x => !x.out);
  s.bbSeat = nextSeat(s, s.sbSeat, x => !x.out);

  const sb = s.seats[s.sbSeat], bb = s.seats[s.bbSeat];
  const sbPaid = put(sb, s.options.smallBlind);
  const bbPaid = put(bb, s.options.bigBlind);
  s.currentBet = Math.max(sbPaid, bbPaid, s.options.bigBlind);
  log(s, null, `Tangan #${s.handNo} — dealer: ${s.seats[s.button].name}`);
  log(s, s.sbSeat, `${sb.name} pasang small blind ${sbPaid}`);
  log(s, s.bbSeat, `${bb.name} pasang big blind ${bbPaid}`);

  // Bagikan 2 kartu, satu per satu mulai kiri button.
  for (let round = 0; round < 2; round++) {
    let i = s.button;
    for (let k = 0; k < active; k++) {
      i = nextSeat(s, i, x => !x.out);
      s.seats[i].hole.push(...draw(s.deck, 1));
    }
  }
  s.toAct = null;
  s.toAct = firstToAct(s, s.bbSeat);
  if (s.toAct === null) finishStreet(s);
}

/** Seat pertama setelah `after` yang perlu beraksi. */
function firstToAct(s: HoldemState, after: number): number | null {
  const i = nextSeat(s, after, x => needsAction(s, x));
  return i < 0 ? null : i;
}

function onlyOneLeft(s: HoldemState) {
  return s.seats.filter(inHand).length === 1;
}

/** Dipanggil setelah setiap aksi. */
function progress(s: HoldemState, actor: number) {
  if (onlyOneLeft(s)) { settleHand(s, false); return; }
  const next = firstToAct(s, actor);
  if (next !== null) { s.toAct = next; return; }
  finishStreet(s);
}

/** Taruhan street selesai: kumpulkan & lanjut street berikutnya (dengan jeda otomatis). */
function finishStreet(s: HoldemState) {
  for (const x of s.seats) { x.bet = 0; x.acted = false; x.actedRaiseCount = 0; }
  s.currentBet = 0;
  s.fullRaiseCount = 0;
  s.minRaise = s.options.bigBlind;
  s.toAct = null;
  if (s.street === 'river') { settleHand(s, true); return; }
  // toAct = null + street belum handOver → advance() membuka street berikutnya.
}

function dealNextStreet(s: HoldemState) {
  draw(s.deck, 1); // burn card
  if (s.street === 'preflop') { s.board.push(...draw(s.deck, 3)); s.street = 'flop'; }
  else if (s.street === 'flop') { s.board.push(...draw(s.deck, 1)); s.street = 'turn'; }
  else if (s.street === 'turn') { s.board.push(...draw(s.deck, 1)); s.street = 'river'; }
  log(s, null, `${s.street.toUpperCase()}: ${s.board.map(cardLabel).join(' ')}`);
  // Post-flop: mulai dari pemain aktif pertama di kiri button.
  s.toAct = firstToAct(s, s.button);
  if (s.toAct === null) finishStreet(s);
}

function settleHand(s: HoldemState, showdown: boolean) {
  const contributed = s.seats.map(x => x.contributed);
  const folded = s.seats.map(x => x.folded || x.out);
  const { pots, refunds } = buildPots(contributed, folded);
  for (const r of refunds) {
    s.seats[r.seat].stack += r.amount;
    if (r.amount > 0) log(s, r.seat, `${s.seats[r.seat].name} menerima kembali ${r.amount} (taruhan tidak di-call)`);
  }

  const won = new Map<number, number>();
  const handName = new Map<number, string>();
  const contenders = s.seats.map((x, i) => i).filter(i => inHand(s.seats[i]));

  if (showdown && contenders.length > 1) {
    const values = new Map(contenders.map(i => [i, bestHand([...s.seats[i].hole, ...s.board])]));
    for (const i of contenders) { s.seats[i].shown = true; handName.set(i, values.get(i)!.name); }
    for (const pot of pots) {
      const elig = pot.eligible.filter(i => values.has(i));
      if (!elig.length) continue;
      let best = elig[0];
      for (const i of elig) if (compareScores(values.get(i)!.score, values.get(best)!.score) > 0) best = i;
      const winners = elig.filter(i => compareScores(values.get(i)!.score, values.get(best)!.score) === 0);
      for (const [seat, amt] of splitPot(pot.amount, winners, s.button, n(s))) won.set(seat, (won.get(seat) ?? 0) + amt);
    }
  } else {
    // Semua lawan fold: seluruh pot ke pemain tersisa.
    const winner = contenders[0];
    won.set(winner, pots.reduce((t, p) => t + p.amount, 0));
  }

  for (const [seat, amt] of won) {
    s.seats[seat].stack += amt;
    const h = handName.get(seat);
    log(s, seat, `${s.seats[seat].name} menang ${amt}${h ? ` dengan ${h}` : ''}`);
  }
  s.lastHand = {
    handNo: s.handNo,
    board: s.board.slice(),
    winners: [...won].map(([seat, amount]) => ({ seat, amount, hand: handName.get(seat) ?? null })),
    showdown: showdown && contenders.length > 1,
  };
  for (const x of s.seats) { x.bet = 0; }
  s.toAct = null;
  const alive = s.seats.filter(x => x.stack > 0).length;
  const limitHit = s.options.maxHands > 0 && s.handNo >= s.options.maxHands;
  s.street = alive <= 1 || limitHit ? 'gameOver' : 'handOver';
  if (s.street === 'gameOver') log(s, null, 'Permainan selesai');
}

/* ------------------------------ legal moves ---------------------------- */

export function legalFor(s: HoldemState, seat: number): HoldemLegal | null {
  if (s.toAct !== seat) return null;
  const x = s.seats[seat];
  const toCall = Math.max(0, s.currentBet - x.bet);
  const maxTo = x.bet + x.stack;
  const mayRaise = !x.acted || x.actedRaiseCount < s.fullRaiseCount;
  const othersCanAct = s.seats.some((o, i) => i !== seat && canAct(o));
  const minBet = s.currentBet === 0 && othersCanAct && maxTo >= s.options.bigBlind ? Math.min(s.options.bigBlind, maxTo) : null;
  const minRaiseTo = s.currentBet > 0 && mayRaise && othersCanAct && maxTo > s.currentBet + s.minRaise - 1
    ? s.currentBet + s.minRaise : null;
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, x.stack) : 0,
    minBet,
    minRaiseTo: minRaiseTo !== null && minRaiseTo <= maxTo ? minRaiseTo : null,
    maxTo,
    // All-in diperbolehkan jika: tidak cukup untuk call penuh (all-in call), atau boleh raise.
    canAllIn: x.stack > 0 && (x.stack <= toCall || (mayRaise && othersCanAct)),
  };
}

/* ------------------------------ module --------------------------------- */

export const holdem: GameModule<HoldemState, HoldemAction, HoldemView, HoldemOptions> = {
  id: 'holdem',
  minPlayers: 2,
  maxPlayers: 9,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Partial<HoldemOptions>;
    const bigBlind = clampInt(r.bigBlind, 2, 2000, DEFAULTS.bigBlind);
    const bb = bigBlind % 2 === 0 ? bigBlind : bigBlind + 1;
    const startingStack = clampInt(r.startingStack, Math.max(200, bb * 10), 100000, DEFAULTS.startingStack);
    return {
      startingStack,
      bigBlind: bb,
      smallBlind: bb / 2,
      maxHands: clampInt(r.maxHands, 0, 500, 0),
      blindStructure: r.blindStructure === 'turbo' || r.blindStructure === 'hyper' ? r.blindStructure : 'static',
      turnSeconds: Number(r.turnSeconds) === 0 ? 0 : (typeof r.turnSeconds === 'number' ? clampInt(r.turnSeconds, 10, 60, 25) : 25),
      showHandStrength: r.showHandStrength !== undefined ? Boolean(r.showHandStrength) : true,
      autoMuck: r.autoMuck !== undefined ? Boolean(r.autoMuck) : true,
      passAndPlay: Boolean(r.passAndPlay),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 9) throw new RuleError('Texas Hold\'em butuh 2–9 pemain');
    const s: HoldemState = {
      gameId: 'holdem',
      options,
      seats: seats.map(p => ({
        id: p.id, name: p.name, isBot: !!p.isBot, stack: options.startingStack, hole: [], bet: 0,
        contributed: 0, folded: false, allIn: false, out: false, acted: false, actedRaiseCount: 0, shown: false,
      })),
      handNo: 0,
      button: rng.int(seats.length), // dealer awal diundi
      sbSeat: 0, bbSeat: 0,
      street: 'preflop', deck: [], board: [], currentBet: 0, minRaise: options.bigBlind, fullRaiseCount: 0,
      toAct: null, log: [], lastHand: null,
    };
    startHand(s, rng, true);
    return s;
  },

  currentSeat: s => s.toAct,

  apply(state, seat, action, _rng) {
    if (state.street === 'handOver' || state.street === 'gameOver') throw new RuleError('Tangan sudah selesai');
    if (state.toAct !== seat) throw new RuleError('Bukan giliranmu');
    const legal = legalFor(state, seat)!;
    const s = clone(state);
    const x = s.seats[seat];
    const name = x.name;
    const raiseTo = (to: number, label: string) => {
      const increment = to - s.currentBet;
      put(x, to - x.bet);
      if (increment >= s.minRaise) {          // raise penuh → buka ulang aksi
        s.minRaise = increment;
        s.fullRaiseCount += 1;
      }
      s.currentBet = Math.max(s.currentBet, x.bet);
      log(s, seat, `${name} ${label} ${x.bet}${x.allIn ? ' (all-in)' : ''}`);
    };

    switch (action?.type) {
      case 'fold':
        x.folded = true;
        log(s, seat, `${name} fold`);
        break;
      case 'check':
        if (!legal.canCheck) throw new RuleError('Tidak bisa check — ada taruhan yang harus di-call');
        log(s, seat, `${name} check`);
        break;
      case 'call': {
        if (legal.callAmount <= 0) throw new RuleError('Tidak ada taruhan untuk di-call');
        const paid = put(x, legal.callAmount);
        log(s, seat, `${name} call ${paid}${x.allIn ? ' (all-in)' : ''}`);
        break;
      }
      case 'bet': {
        const amt = Math.floor(Number((action as { amount: number }).amount));
        if (legal.minBet === null) throw new RuleError('Tidak bisa bet sekarang');
        if (!Number.isFinite(amt) || amt < legal.minBet) throw new RuleError(`Bet minimum ${legal.minBet}`);
        if (amt > legal.maxTo) throw new RuleError('Chip tidak cukup');
        raiseTo(amt, 'bet');
        break;
      }
      case 'raise': {
        const amt = Math.floor(Number((action as { amount: number }).amount));
        if (legal.minRaiseTo === null) throw new RuleError('Tidak bisa raise sekarang');
        if (!Number.isFinite(amt) || amt < legal.minRaiseTo) throw new RuleError(`Raise minimum ke ${legal.minRaiseTo}`);
        if (amt > legal.maxTo) throw new RuleError('Chip tidak cukup');
        raiseTo(amt, 'raise ke');
        break;
      }
      case 'allin': {
        if (!legal.canAllIn) throw new RuleError('Tidak bisa all-in sekarang');
        const to = x.bet + x.stack;
        if (to > s.currentBet) raiseTo(to, s.currentBet === 0 ? 'bet' : 'raise ke');
        else { put(x, x.stack); log(s, seat, `${name} call ${x.bet} (all-in)`); }
        break;
      }
      default:
        throw new RuleError('Aksi tidak dikenal');
    }
    x.acted = true;
    x.actedRaiseCount = s.fullRaiseCount;
    progress(s, seat);
    return s;
  },

  autoDelay(s) {
    if (s.street === 'gameOver') return null;
    if (s.street === 'handOver') return 3500;
    return s.toAct === null ? 900 : null;
  },

  advance(state, rng) {
    const s = clone(state);
    if (s.street === 'handOver') startHand(s, rng, false);
    else if (s.street !== 'gameOver' && s.toAct === null) dealNextStreet(s);
    return s;
  },

  timeoutAction(s, seat) {
    const legal = legalFor(s, seat);
    return legal?.canCheck ? { type: 'check' } : { type: 'fold' };
  },

  view(s, seat) {
    const reveal = (i: number) => i === seat || s.seats[i].shown;
    return {
      gameId: 'holdem',
      you: seat,
      turn: s.toAct,
      over: s.street === 'gameOver',
      log: s.log.slice(-30),
      results: holdem.results(s),
      seats: s.seats.map((x, i) => ({
        name: x.name, isBot: x.isBot, stack: x.stack, bet: x.bet, folded: x.folded, allIn: x.allIn, out: x.out,
        hole: x.hole.map(c => (reveal(i) ? c : null)),
      })),
      board: s.board.slice(),
      street: s.street,
      pot: potTotal(s),
      currentBet: s.currentBet,
      button: s.button, sbSeat: s.sbSeat, bbSeat: s.bbSeat,
      bigBlind: s.options.bigBlind,
      handNo: s.handNo,
      legal: seat === null ? null : legalFor(s, seat),
      lastHand: s.street === 'handOver' || s.street === 'gameOver' ? s.lastHand : null,
    };
  },

  bot(v, difficulty, rng) {
    return holdemBot(v, difficulty, rng);
  },

  isOver: s => s.street === 'gameOver',

  results(s) {
    if (s.street !== 'gameOver') return null;
    const order = s.seats.map((x, i) => ({ seat: i, score: x.stack })).sort((a, b) => b.score - a.score);
    let rank = 0, prev = -1;
    return order.map((o, k) => {
      if (o.score !== prev) { rank = k + 1; prev = o.score; }
      return { seat: o.seat, rank, score: o.score } satisfies SeatResult;
    });
  },
};

/* --------------------------------- bot --------------------------------- */
// Hanya memakai informasi sah: kartu sendiri, board, pot, taruhan. Tidak melihat kartu lawan.

export function holdemBot(v: HoldemView, difficulty: Difficulty, rng: Rng): HoldemAction {
  const me = v.you!;
  const legal = v.legal;
  if (!legal) return { type: 'fold' };
  const hole = v.seats[me].hole.filter((c): c is Card => !!c);
  const opponents = v.seats.filter((x, i) => i !== me && !x.folded && !x.out).length;
  const iters = difficulty === 'hard' ? 400 : difficulty === 'normal' ? 160 : 60;
  let equity = estimateEquity(hole, v.board, Math.max(1, opponents), iters, rng);
  if (difficulty === 'easy') equity = Math.min(1, Math.max(0, equity + (rng.float() - 0.5) * 0.3));

  const pot = v.pot;
  const toCall = legal.callAmount;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const bluff = difficulty !== 'easy' && rng.float() < (difficulty === 'hard' ? 0.07 : 0.04);
  const strong = equity > (difficulty === 'hard' ? 0.62 : 0.68);
  const sizing = (fraction: number) => Math.round((v.currentBet + Math.max(v.bigBlind, pot * fraction)) / 2) * 2;

  if ((strong || bluff) && (legal.minBet !== null || legal.minRaiseTo !== null)) {
    const min = legal.minBet ?? legal.minRaiseTo!;
    const target = Math.min(legal.maxTo, Math.max(min, sizing(equity > 0.8 ? 0.9 : 0.6)));
    if (target >= legal.maxTo && legal.canAllIn) return { type: 'allin' };
    return legal.minBet !== null ? { type: 'bet', amount: target } : { type: 'raise', amount: target };
  }
  if (toCall === 0) return { type: 'check' };
  const margin = difficulty === 'hard' ? 0.02 : difficulty === 'normal' ? 0.05 : 0.12;
  if (equity >= potOdds + margin || (toCall <= v.bigBlind && equity > 0.3)) {
    return legal.callAmount > 0 ? { type: 'call' } : legal.canAllIn ? { type: 'allin' } : { type: 'fold' };
  }
  return { type: 'fold' };
}
