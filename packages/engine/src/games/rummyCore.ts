// games/rummyCore.ts — utilitas bersama Gin Rummy & Classic Rummy:
// validasi meld (set/run), nilai deadwood, dan solver susunan meld optimal (deadwood minimum).
//
//  - Set: 3–4 kartu ber-rank sama.
//  - Run: 3+ kartu selambang berurutan. As selalu rendah (A-2-3); bila aceHigh, As juga boleh
//    tinggi (Q-K-A), tetapi tidak memutar (K-A-2 tidak sah).
//  - Nilai kartu: As = 1, 2–10 = nominal, J/Q/K = 10.

import { type Card, rankOf, suitOf } from '../cards';

export const deadwoodValue = (c: Card): number => {
  const r = rankOf(c);
  return r === 14 ? 1 : r >= 10 ? 10 : r;
};

export const handValue = (cards: Card[]): number => cards.reduce((t, c) => t + deadwoodValue(c), 0);

const consecutive = (ps: number[]): boolean => {
  const a = ps.slice().sort((x, y) => x - y);
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1] + 1) return false;
  return true;
};

/** Apakah kartu-kartu ini membentuk satu meld sah (set atau run)? */
export function isValidMeld(cards: Card[], aceHigh = false): boolean {
  if (cards.length < 3) return false;
  if (new Set(cards).size !== cards.length) return false;
  const r0 = rankOf(cards[0]);
  if (cards.every(c => rankOf(c) === r0)) return cards.length <= 4;
  const s0 = suitOf(cards[0]);
  if (!cards.every(c => suitOf(c) === s0)) return false;
  if (consecutive(cards.map(c => (rankOf(c) === 14 ? 1 : rankOf(c))))) return true;
  return aceHigh && consecutive(cards.map(rankOf));
}

/** Urutkan meld untuk ditampilkan (run naik; As di depan bila rendah). */
export function sortMeld(cards: Card[], aceHigh = false): Card[] {
  const isSet = cards.every(c => rankOf(c) === rankOf(cards[0]));
  if (isSet) return cards.slice().sort((a, b) => 'SHDC'.indexOf(suitOf(a)) - 'SHDC'.indexOf(suitOf(b)));
  const lowOk = consecutive(cards.map(c => (rankOf(c) === 14 ? 1 : rankOf(c))));
  const pos = (c: Card) => (rankOf(c) === 14 && (lowOk || !aceHigh) ? 1 : rankOf(c));
  return cards.slice().sort((a, b) => pos(a) - pos(b));
}

/** Urutkan tangan: per lambang, lalu rank (As rendah). */
export function sortHand(cards: Card[]): Card[] {
  const pos = (c: Card) => 'SHDC'.indexOf(suitOf(c)) * 20 + (rankOf(c) === 14 ? 1 : rankOf(c));
  return cards.slice().sort((a, b) => pos(a) - pos(b));
}

/** Semua meld yang mungkin di dalam `cards`, sebagai bitmask indeks. */
function allMeldMasks(cards: Card[], aceHigh: boolean): number[] {
  const out: number[] = [];
  const byRank = new Map<number, number[]>();
  cards.forEach((c, i) => {
    const r = rankOf(c);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(i);
  });
  for (const idx of byRank.values()) {
    if (idx.length < 3) continue;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) for (let c = b + 1; c < idx.length; c++) {
      out.push((1 << idx[a]) | (1 << idx[b]) | (1 << idx[c]));
    }
    if (idx.length === 4) out.push(idx.reduce((m, i) => m | (1 << i), 0));
  }
  for (const s of ['S', 'H', 'D', 'C']) {
    const at = new Map<number, number>();
    cards.forEach((c, i) => {
      if (suitOf(c) !== s) return;
      const r = rankOf(c);
      if (r === 14) { at.set(1, i); if (aceHigh) at.set(14, i); } else at.set(r, i);
    });
    for (let p = 1; p <= 12; p++) {
      if (!at.has(p)) continue;
      let mask = 1 << at.get(p)!;
      let len = 1;
      for (let q = p + 1; q <= 14 && at.has(q); q++) {
        const bit = 1 << at.get(q)!;
        if (mask & bit) break;
        mask |= bit;
        len++;
        if (len >= 3) out.push(mask);
      }
    }
  }
  return out;
}

export interface MeldSolution {
  /** Total nilai deadwood minimum. */
  deadwood: number;
  melds: Card[][];
  /** Kartu yang tidak masuk meld. */
  dead: Card[];
}

/** Susunan meld yang meminimalkan deadwood (pencarian lengkap dengan memo). */
export function solveMelds(cards: Card[], aceHigh = false): MeldSolution {
  const n = cards.length;
  if (n > 30) throw new Error('Terlalu banyak kartu untuk solver');
  const masks = allMeldMasks(cards, aceHigh);
  const byCard: number[][] = cards.map((_, i) => masks.filter(m => (m & (1 << i)) !== 0));
  const vals = cards.map(deadwoodValue);
  const memo = new Map<number, number>();
  const choice = new Map<number, number>();
  const f = (mask: number): number => {
    if (mask === 0) return 0;
    const got = memo.get(mask);
    if (got !== undefined) return got;
    const i = 31 - Math.clz32(mask & -mask);
    let best = vals[i] + f(mask & ~(1 << i));
    let ch = 0;
    for (const m of byCard[i]) {
      if ((m & mask) !== m) continue;
      const v = f(mask & ~m);
      if (v < best) { best = v; ch = m; }
    }
    memo.set(mask, best);
    choice.set(mask, ch);
    return best;
  };
  const full = n === 0 ? 0 : (2 ** n) - 1;
  const deadwood = f(full);
  const melds: Card[][] = [];
  const dead: Card[] = [];
  let mask = full;
  while (mask) {
    const ch = choice.get(mask)!;
    if (ch === 0) {
      const i = 31 - Math.clz32(mask & -mask);
      dead.push(cards[i]);
      mask &= ~(1 << i);
    } else {
      melds.push(sortMeld(cards.filter((_, i) => (ch & (1 << i)) !== 0), aceHigh));
      mask &= ~ch;
    }
  }
  return { deadwood, melds, dead: sortHand(dead) };
}

/**
 * Tempelkan kartu `chosen` ke meld `targets` sampai titik tetap. Kembalikan meld hasil
 * dan kartu yang tidak bisa ditempel.
 */
export function absorb(targets: Card[][], chosen: Card[], aceHigh = false): { melds: Card[][]; left: Card[] } {
  const melds = targets.map(m => m.slice());
  let left = chosen.slice();
  let changed = true;
  while (changed && left.length) {
    changed = false;
    for (const c of left.slice()) {
      const m = melds.find(x => isValidMeld([...x, c], aceHigh));
      if (m) { m.push(c); left = left.filter(x => x !== c); changed = true; }
    }
  }
  return { melds: melds.map(m => sortMeld(m, aceHigh)), left };
}

export interface LayoffSolution extends MeldSolution {
  /** Kartu bertahan yang ditempel ke meld lawan. */
  laidOff: Card[];
}

/** Deadwood minimum bertahan bila boleh menempel kartu ke meld `targets` (dipakai Gin Rummy). */
export function solveWithLayoffs(hand: Card[], targets: Card[][], aceHigh = false): LayoffSolution {
  const cand = hand.filter(c => !absorb(targets, hand, aceHigh).left.includes(c));
  let best: LayoffSolution = { ...solveMelds(hand, aceHigh), laidOff: [] };
  const k = cand.length;
  for (let m = 1; m < (1 << k); m++) {
    const chosen = cand.filter((_, i) => (m & (1 << i)) !== 0);
    if (absorb(targets, chosen, aceHigh).left.length) continue;
    const rest = hand.filter(c => !chosen.includes(c));
    const sol = solveMelds(rest, aceHigh);
    if (sol.deadwood < best.deadwood || (sol.deadwood === best.deadwood && chosen.length < best.laidOff.length)) {
      best = { ...sol, laidOff: chosen };
    }
  }
  return best;
}
