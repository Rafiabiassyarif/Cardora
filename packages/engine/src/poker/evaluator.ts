// poker/evaluator.ts — evaluator tangan poker standar.
//
// Skor tangan = array angka yang dibandingkan secara leksikografis:
//   [kategori, ...tiebreak]  (kategori 9 = Royal Flush ... 0 = High Card)
// Suit TIDAK pernah dipakai untuk memecah seri (aturan poker standar).
// Wheel A-2-3-4-5 adalah straight dengan high card 5.

import { type Card, rankOf, suitOf } from '../cards';

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export const CATEGORY_NAME: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.OnePair]: 'One Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
  [HandCategory.RoyalFlush]: 'Royal Flush',
};

export interface HandValue {
  category: HandCategory;
  /** [kategori, ...tiebreak] */
  score: number[];
  /** Lima kartu yang membentuk tangan terbaik. */
  cards: Card[];
  name: string;
}

/** Jika lima rank membentuk straight, kembalikan high card-nya (5 untuk wheel), else 0. */
function straightHigh(ranksDesc: number[]): number {
  const u = [...new Set(ranksDesc)];
  if (u.length !== 5) return 0;
  if (u[0] - u[4] === 4) return u[0];
  if (u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2) return 5;
  return 0;
}

/** Evaluasi tepat lima kartu. */
export function evaluate5(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5 butuh 5 kartu');
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every(c => suitOf(c) === suitOf(cards[0]));
  const sHigh = straightHigh(ranks);

  // Kelompokkan rank: urut berdasarkan jumlah, lalu rank.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]).join('');
  const byGroup = groups.map(g => g[0]);

  let category: HandCategory;
  let tiebreak: number[];
  if (sHigh && flush) {
    category = sHigh === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
    tiebreak = [sHigh];
  } else if (shape === '41') {
    category = HandCategory.FourOfAKind; tiebreak = byGroup;
  } else if (shape === '32') {
    category = HandCategory.FullHouse; tiebreak = byGroup;
  } else if (flush) {
    category = HandCategory.Flush; tiebreak = ranks;
  } else if (sHigh) {
    category = HandCategory.Straight; tiebreak = [sHigh];
  } else if (shape === '311') {
    category = HandCategory.ThreeOfAKind; tiebreak = byGroup;
  } else if (shape === '221') {
    category = HandCategory.TwoPair; tiebreak = byGroup;
  } else if (shape === '2111') {
    category = HandCategory.OnePair; tiebreak = byGroup;
  } else {
    category = HandCategory.HighCard; tiebreak = ranks;
  }
  return { category, score: [category, ...tiebreak], cards: cards.slice(), name: CATEGORY_NAME[category] };
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

/** Kombinasi lima kartu terbaik dari 5–7 kartu (Hold'em: 2 hole + 5 board). */
export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('bestHand butuh minimal 5 kartu');
  let best: HandValue | null = null;
  for (const combo of combinations(cards, 5)) {
    const v = evaluate5(combo);
    if (!best || compareScores(v.score, best.score) > 0) best = v;
  }
  return best!;
}

/**
 * Omaha: WAJIB tepat 2 dari 4 kartu tangan + tepat 3 dari board.
 * (Disediakan untuk Tahap 3; sudah diuji.)
 */
export function bestOmahaHand(hole: Card[], board: Card[]): HandValue {
  let best: HandValue | null = null;
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const v = evaluate5([...h, ...b]);
      if (!best || compareScores(v.score, best.score) > 0) best = v;
    }
  }
  if (!best) throw new Error('Kartu Omaha tidak cukup');
  return best;
}
