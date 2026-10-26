// poker/equity.ts — estimasi peluang menang Monte Carlo untuk bot & HUD.
// Hanya memakai kartu sendiri + board; kartu lawan diambil acak dari sisa deck
// (bot TIDAK pernah melihat kartu lawan yang sebenarnya).
// Mendukung varian Hold'em, Omaha (4 kartu tangan) dan Short Deck (deck 36).

import type { Card } from '../cards';
import type { Rng } from '../rng';
import { compareScores } from './evaluator';
import { type HoldemVariant, evaluateVariant, variantDeck, variantSpec } from './variant';

export function estimateEquity(
  hole: Card[], board: Card[], opponents: number, iterations: number, rng: Rng,
  variant: HoldemVariant = 'holdem',
): number {
  const spec = variantSpec(variant);
  const holeN = spec.holeCards;
  if (hole.length !== holeN || iterations <= 0) return 0;
  const known = new Set([...hole, ...board]);
  const rest = variantDeck(spec.id).filter(c => !known.has(c));
  // Jangan meminta lebih banyak kartu daripada sisa deck.
  const maxOpp = Math.floor((rest.length - (5 - board.length)) / holeN);
  const opps = Math.max(0, Math.min(opponents, maxOpp));
  const need = (5 - board.length) + opps * holeN;
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // Partial Fisher–Yates: cukup ambil kartu yang dibutuhkan.
    const pool = rest.slice();
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const fullBoard = board.concat(pool.slice(0, 5 - board.length));
    let k = 5 - board.length;
    const mine = evaluateVariant(spec.id, hole, fullBoard).score;
    let best = 1; // 1 = menang, 0.5.. = split, 0 = kalah
    let ties = 1;
    for (let o = 0; o < opps; o++) {
      const opp = evaluateVariant(spec.id, pool.slice(k, k + holeN), fullBoard).score;
      k += holeN;
      const cmp = compareScores(mine, opp);
      if (cmp < 0) { best = 0; break; }
      if (cmp === 0) ties++;
    }
    score += best === 0 ? 0 : 1 / ties;
  }
  return score / iterations;
}
