// poker/equity.ts — estimasi peluang menang Monte Carlo untuk bot.
// Hanya memakai kartu sendiri + board; kartu lawan diambil acak dari sisa deck
// (bot TIDAK pernah melihat kartu lawan yang sebenarnya).

import { type Card, standardDeck } from '../cards';
import type { Rng } from '../rng';
import { bestHand, compareScores } from './evaluator';

export function estimateEquity(hole: Card[], board: Card[], opponents: number, iterations: number, rng: Rng): number {
  if (hole.length !== 2) return 0;
  const known = new Set([...hole, ...board]);
  const rest = standardDeck().filter(c => !known.has(c));
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // Partial Fisher–Yates: cukup ambil kartu yang dibutuhkan.
    const need = (5 - board.length) + opponents * 2;
    const pool = rest.slice();
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const fullBoard = board.concat(pool.slice(0, 5 - board.length));
    let k = 5 - board.length;
    const mine = bestHand([...hole, ...fullBoard]).score;
    let best = 1; // 1 = menang, 0.5.. = split, 0 = kalah
    let ties = 1;
    for (let o = 0; o < opponents; o++) {
      const opp = bestHand([pool[k], pool[k + 1], ...fullBoard]).score;
      k += 2;
      const cmp = compareScores(mine, opp);
      if (cmp < 0) { best = 0; break; }
      if (cmp === 0) ties++;
    }
    score += best === 0 ? 0 : 1 / ties;
  }
  return score / iterations;
}
