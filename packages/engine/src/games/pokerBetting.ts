// games/pokerBetting.ts — mesin taruhan poker bersama untuk game generik (Five Card Draw, Seven Card Stud).
//
// Semantik meniru poker/holdem.ts (yang sudah teruji):
//  - Struktur: no-limit ('nl'), pot-limit ('pl'), fixed-limit ('fl' — 1 bet + 3 raise per street).
//  - Raise penuh (increment ≥ raise minimum) membuka ulang aksi; all-in yang kurang dari raise
//    penuh ("incomplete raise") TIDAK membuka ulang aksi bagi pemain yang sudah beraksi.
//  - Bet pembuka minimum = `unit`. Pada fixed-limit, bet/raise selalu tepat `unit`
//    (bring-in yang di-"lengkapi" ke `unit` dihitung sebagai bet pertama).
//  - Taruhan yang tidak di-call dikembalikan; main pot & side pot dihitung dengan buildPots,
//    pembagian (termasuk odd chip) dengan splitPot.
//  - Aksi diekspos lewat protokol generik: Fold / Check / Call N / Bet / Raise (nilai = "raise ke")
//    / All-in. Pada fixed-limit, Bet/Raise tanpa angka.

import type { Rng } from '../rng';
import { type Difficulty, RuleError } from '../types';
import type { GActionSpec, GenericAction } from '../generic';
import { buildPots, splitPot } from '../poker/pots';
import { compareScores } from '../poker/evaluator';

export type BetStructure = 'nl' | 'pl' | 'fl';

export interface PSeat {
  stack: number;
  /** Taruhan pada street berjalan. */
  bet: number;
  /** Total kontribusi pada tangan ini (ante + semua taruhan). */
  contributed: number;
  folded: boolean;
  allIn: boolean;
  /** Tidak ikut tangan ini (chip habis). */
  out: boolean;
  acted: boolean;
  /** Nilai fullRaiseCount saat seat ini terakhir beraksi. */
  actedRaiseCount: number;
}

export interface BetRound {
  structure: BetStructure;
  /** Bet minimum (nl/pl) atau ukuran bet tetap (fl) untuk street ini. */
  unit: number;
  currentBet: number;
  /** Besar raise penuh terakhir. */
  minRaise: number;
  /** Jumlah bet/raise penuh pada street ini. */
  fullRaiseCount: number;
  /** Batas bet+raise per street (0 = tanpa batas). */
  cap: number;
  toAct: number | null;
}

export interface BetLegal {
  canCheck: boolean;
  /** 0 = tidak ada yang perlu di-call. Sudah dibatasi stack. */
  callAmount: number;
  /** Rentang "raise ke"/"bet ke" (total taruhan street ini), atau null. */
  raise: { min: number; max: number } | null;
  /** id aksi agresif: 'bet' (belum ada bet penuh) atau 'raise'. */
  raiseId: 'bet' | 'raise';
  /** Total taruhan bila all-in (sebagai bet/raise), atau null bila tidak boleh. */
  allInTo: number | null;
  maxTo: number;
}

export const newSeat = (stack: number): PSeat => ({
  stack, bet: 0, contributed: 0, folded: false, allIn: false, out: stack <= 0, acted: false, actedRaiseCount: 0,
});

export const inHand = (x: PSeat) => !x.out && !x.folded;
export const canAct = (x: PSeat) => inHand(x) && !x.allIn;
export const potTotal = (seats: PSeat[]) => seats.reduce((t, x) => t + x.contributed, 0);

export function nextSeatWhere<T>(seats: T[], from: number, pred: (x: T, i: number) => boolean, inclusive = false): number {
  const n = seats.length;
  for (let k = inclusive ? 0 : 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (pred(seats[i], i)) return i;
  }
  return -1;
}

/** Masukkan chip ke pot (bet street bila toBet; ante bila tidak). Dibatasi stack. */
export function put(x: PSeat, amount: number, toBet = true): number {
  const a = Math.max(0, Math.min(amount, x.stack));
  x.stack -= a;
  if (toBet) x.bet += a;
  x.contributed += a;
  if (x.stack === 0 && !x.out) x.allIn = true;
  return a;
}

/** Reset seat untuk tangan baru; seat tanpa chip menjadi out. */
export function resetForHand(seats: PSeat[]) {
  for (const x of seats) {
    Object.assign(x, { bet: 0, contributed: 0, folded: false, allIn: false, acted: false, actedRaiseCount: 0 });
    x.out = x.stack <= 0;
  }
}

export function needsAction(seats: PSeat[], r: BetRound, i: number): boolean {
  const x = seats[i];
  if (!canAct(x)) return false;
  const others = seats.filter((o, j) => j !== i && canAct(o)).length;
  if (others === 0) return x.bet < r.currentBet; // tak ada lawan untuk taruhan baru
  return !x.acted || x.bet < r.currentBet;
}

/** Seat pertama mulai `from` (inklusif) yang perlu beraksi. */
export function firstToActFrom(seats: PSeat[], r: BetRound, from: number): number | null {
  const i = nextSeatWhere(seats, from, (_x, j) => needsAction(seats, r, j), true);
  return i < 0 ? null : i;
}

/** Mulai street taruhan baru; toAct = seat pertama mulai `from` yang perlu beraksi. */
export function startRound(seats: PSeat[], r: BetRound, unit: number, from: number) {
  for (const x of seats) { x.bet = 0; x.acted = false; x.actedRaiseCount = 0; }
  r.unit = unit;
  r.currentBet = 0;
  r.minRaise = unit;
  r.fullRaiseCount = 0;
  r.toAct = firstToActFrom(seats, r, from);
}

/** Akhiri street: taruhan sudah masuk `contributed`, kosongkan bet. */
export function endRound(seats: PSeat[], r: BetRound) {
  for (const x of seats) { x.bet = 0; x.acted = false; x.actedRaiseCount = 0; }
  r.currentBet = 0;
  r.fullRaiseCount = 0;
  r.minRaise = r.unit;
  r.toAct = null;
}

/** Taruhan paksa (bring-in): dihitung sebagai aksi seat ini, bukan bet penuh. */
export function postForced(seats: PSeat[], r: BetRound, seat: number, amount: number): number {
  const x = seats[seat];
  const paid = put(x, amount, true);
  r.currentBet = Math.max(r.currentBet, x.bet);
  x.acted = true;
  x.actedRaiseCount = r.fullRaiseCount;
  return paid;
}

export function legalFor(seats: PSeat[], r: BetRound, seat: number): BetLegal | null {
  if (r.toAct !== seat) return null;
  const x = seats[seat];
  const toCall = Math.max(0, r.currentBet - x.bet);
  const maxTo = x.bet + x.stack;
  const othersCanAct = seats.some((o, i) => i !== seat && canAct(o));
  const capOk = r.cap <= 0 || r.fullRaiseCount < r.cap;
  const mayRaise = (!x.acted || x.actedRaiseCount < r.fullRaiseCount) && othersCanAct && capOk;
  const fullMin = r.fullRaiseCount === 0 ? Math.max(r.unit, r.currentBet + 1) : r.currentBet + r.minRaise;
  let rangeMax: number;
  if (r.structure === 'fl') rangeMax = fullMin;
  else if (r.structure === 'pl') rangeMax = Math.max(fullMin, r.currentBet + potTotal(seats) + toCall);
  else rangeMax = maxTo;
  const raise = mayRaise && maxTo >= fullMin ? { min: fullMin, max: Math.min(rangeMax, maxTo) } : null;
  const allInOk = mayRaise && x.stack > 0 && maxTo > r.currentBet && (
    maxTo < fullMin || r.structure === 'nl' || (r.structure === 'pl' && maxTo <= rangeMax));
  return {
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, x.stack) : 0,
    raise,
    raiseId: r.fullRaiseCount === 0 ? 'bet' : 'raise',
    allInTo: allInOk ? maxTo : null,
    maxTo,
  };
}

/** Tombol aksi taruhan untuk seat yang sedang giliran. */
export function betActionSpecs(seats: PSeat[], r: BetRound, seat: number | null, completeLabel?: string): GActionSpec[] {
  if (seat === null) return [];
  const L = legalFor(seats, r, seat);
  if (!L) return [];
  const acts: GActionSpec[] = [];
  if (L.callAmount > 0) acts.push({ id: 'fold', label: 'Fold', style: 'danger' });
  if (L.canCheck) acts.push({ id: 'check', label: 'Check' });
  if (L.callAmount > 0) {
    const allin = L.callAmount >= seats[seat].stack;
    acts.push({ id: 'call', label: `Call ${L.callAmount}${allin ? ' (all-in)' : ''}`, style: 'primary' });
  }
  if (L.raise) {
    const label = L.raiseId === 'bet' ? (r.currentBet > 0 && completeLabel ? completeLabel : 'Bet') : 'Raise';
    if (r.structure === 'fl') {
      acts.push({ id: L.raiseId, label: `${label} ${L.raise.min}`, hint: `Taruhan menjadi ${L.raise.min}` });
    } else {
      acts.push({
        id: L.raiseId, label, amount: { min: L.raise.min, max: L.raise.max, step: 1, default: L.raise.min },
        hint: 'Nilai = total taruhanmu di street ini',
      });
    }
  }
  if (L.allInTo !== null) acts.push({ id: 'allin', label: `All-in ${L.allInTo}`, style: 'danger' });
  return acts;
}

/**
 * Terapkan aksi taruhan (sudah divalidasi ulang di sini). Kembalikan teks log.
 * Tidak memajukan giliran — panggil progressAfter() sesudahnya.
 */
export function applyBet(seats: PSeat[], r: BetRound, seat: number, a: GenericAction, name: string): string {
  const L = legalFor(seats, r, seat);
  if (!L) throw new RuleError('Bukan giliranmu');
  const x = seats[seat];
  let text: string;
  const raiseTo = (to: number) => {
    const fullMin = L.raise?.min ?? (r.fullRaiseCount === 0 ? Math.max(r.unit, r.currentBet + 1) : r.currentBet + r.minRaise);
    const prev = r.currentBet;
    const wasOpen = r.fullRaiseCount === 0;
    put(x, to - x.bet, true);
    if (to >= fullMin) {
      r.minRaise = r.structure === 'fl' ? r.unit : wasOpen ? Math.max(r.unit, to) : to - prev;
      r.fullRaiseCount += 1;
    }
    r.currentBet = Math.max(r.currentBet, x.bet);
  };
  switch (a.id) {
    case 'fold':
      if (L.callAmount <= 0) throw new RuleError('Tidak perlu fold — kamu bisa check');
      x.folded = true;
      text = `${name} fold`;
      break;
    case 'check':
      if (!L.canCheck) throw new RuleError('Tidak bisa check — ada taruhan yang harus di-call');
      text = `${name} check`;
      break;
    case 'call': {
      if (L.callAmount <= 0) throw new RuleError('Tidak ada taruhan untuk di-call');
      const paid = put(x, L.callAmount, true);
      text = `${name} call ${paid}${x.allIn ? ' (all-in)' : ''}`;
      break;
    }
    case 'bet':
    case 'raise': {
      if (!L.raise || a.id !== L.raiseId) throw new RuleError(a.id === 'bet' ? 'Tidak bisa bet sekarang' : 'Tidak bisa raise sekarang');
      let to: number;
      if (r.structure === 'fl') to = L.raise.min;
      else {
        if (a.amount === undefined || !Number.isFinite(a.amount)) throw new RuleError('Masukkan jumlah taruhan');
        to = Math.floor(a.amount);
        if (to < L.raise.min) throw new RuleError(`Minimum ${L.raise.min}`);
        if (to > L.raise.max) throw new RuleError(to > L.maxTo ? 'Chip tidak cukup' : `Maksimum ${L.raise.max}`);
      }
      const opening = r.currentBet === 0;
      raiseTo(to);
      text = `${name} ${opening ? 'bet' : a.id === 'bet' ? 'melengkapi ke' : 'raise ke'} ${x.bet}${x.allIn ? ' (all-in)' : ''}`;
      break;
    }
    case 'allin': {
      if (L.allInTo === null) throw new RuleError('Tidak bisa all-in sekarang');
      raiseTo(L.allInTo);
      text = `${name} all-in ${x.bet}`;
      break;
    }
    default:
      throw new RuleError('Aksi tidak dikenal');
  }
  x.acted = true;
  x.actedRaiseCount = r.fullRaiseCount;
  return text;
}

/** Setelah aksi: 'won' = tinggal satu pemain, 'done' = street selesai, 'next' = r.toAct diperbarui. */
export function progressAfter(seats: PSeat[], r: BetRound, actor: number): 'won' | 'done' | 'next' {
  if (seats.filter(inHand).length <= 1) { r.toAct = null; return 'won'; }
  const next = firstToActFrom(seats, r, actor + 1);
  if (next !== null) { r.toAct = next; return 'next'; }
  r.toAct = null;
  return 'done';
}

export interface SettleResult {
  won: Map<number, number>;
  refunds: { seat: number; amount: number }[];
  pot: number;
}

/**
 * Selesaikan pot. `scores` = skor tangan untuk pemain showdown (null = menang karena lawan fold).
 * Menambah stack pemenang & refund, lalu mengosongkan contributed/bet.
 */
export function settlePots(seats: PSeat[], scores: Map<number, number[]> | null, oddFrom: number): SettleResult {
  const contributed = seats.map(x => x.contributed);
  const folded = seats.map(x => x.folded || x.out);
  const { pots, refunds } = buildPots(contributed, folded);
  for (const rf of refunds) seats[rf.seat].stack += rf.amount;
  const contenders = seats.map((_x, i) => i).filter(i => inHand(seats[i]));
  const won = new Map<number, number>();
  const add = (seat: number, amt: number) => won.set(seat, (won.get(seat) ?? 0) + amt);
  let pot = 0;
  for (const p of pots) {
    pot += p.amount;
    let elig = p.eligible.filter(i => contenders.includes(i));
    if (!elig.length) elig = contenders.slice(); // pengaman: chip tidak pernah hilang
    if (!elig.length) continue;
    if (elig.length === 1) { add(elig[0], p.amount); continue; }
    if (!scores) {
      for (const [s, amt] of splitPot(p.amount, elig, oddFrom, seats.length)) add(s, amt);
      continue;
    }
    const withScore = elig.filter(i => scores.has(i));
    const pool = withScore.length ? withScore : elig;
    let best = pool[0];
    for (const i of pool) if (scores.has(i) && compareScores(scores.get(i)!, scores.get(best) ?? []) > 0) best = i;
    const winners = pool.filter(i => compareScores(scores.get(i) ?? [], scores.get(best) ?? []) === 0);
    for (const [s, amt] of splitPot(p.amount, winners, oddFrom, seats.length)) add(s, amt);
  }
  for (const [s, amt] of won) seats[s].stack += amt;
  for (const x of seats) { x.contributed = 0; x.bet = 0; }
  return { won, refunds, pot };
}

/* --------------------------------- bot --------------------------------- */

export interface BotBetInfo {
  pot: number;
  toCall: number;
  currentBet: number;
  opponents: number;
  unit: number;
  /** Jumlah bet/raise penuh di street ini (menaikkan ambang re-raise). */
  raiseLevel?: number;
}

/**
 * Keputusan taruhan bot berdasarkan estimasi peluang menang (equity 0..1) dan daftar aksi sah.
 * Selalu mengembalikan aksi yang ada di `actions`.
 */
export function botBetDecision(actions: GActionSpec[], info: BotBetInfo, equity: number, difficulty: Difficulty, rng: Rng): GenericAction {
  const has = (id: string) => actions.find(a => a.id === id);
  let e = equity;
  if (difficulty === 'easy') e = Math.min(1, Math.max(0, e + (rng.float() - 0.5) * 0.3));
  const share = 1 / (Math.max(1, info.opponents) + 1);
  const strongAt = Math.min(0.72, share * 1.3 + 0.08) + 0.08 * (info.raiseLevel ?? 0);
  const strong = e >= strongAt;
  const bluff = difficulty !== 'easy' && !info.raiseLevel && rng.float() < (difficulty === 'hard' ? 0.06 : 0.03);
  const agg = has('bet') ?? has('raise');
  if ((strong || bluff) && (agg || has('allin'))) {
    if (agg) {
      if (!agg.amount) return { type: 'act', id: agg.id };
      const frac = e > 0.8 ? 0.75 : 0.5;
      const target = Math.round(info.currentBet + Math.max(info.unit, info.pot * frac));
      const amt = Math.min(agg.amount.max, Math.max(agg.amount.min, target));
      if (amt >= agg.amount.max && has('allin') && e > 0.75) return { type: 'act', id: 'allin' };
      return { type: 'act', id: agg.id, amount: amt };
    }
    if (e > 0.7) return { type: 'act', id: 'allin' };
  }
  if (has('check')) return { type: 'act', id: 'check' };
  const potOdds = info.toCall > 0 ? info.toCall / (info.pot + info.toCall) : 0;
  const margin = difficulty === 'hard' ? 0.02 : difficulty === 'normal' ? 0.05 : 0.1;
  const cheap = info.toCall <= info.unit && e > share * 0.8;
  if (has('call') && (e >= potOdds + margin || cheap)) return { type: 'act', id: 'call' };
  if (has('fold')) return { type: 'act', id: 'fold' };
  return { type: 'act', id: actions[0].id };
}
