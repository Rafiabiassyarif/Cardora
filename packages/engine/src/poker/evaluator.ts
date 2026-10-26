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

/**
 * Kekuatan kategori untuk Short Deck (aturan Triton): Flush > Full House dan
 * Three of a Kind > Straight. Indeks = HandCategory, nilai = kekuatan.
 */
const SHORT_DECK_STRENGTH: Record<HandCategory, number> = {
  [HandCategory.HighCard]: 0,
  [HandCategory.OnePair]: 1,
  [HandCategory.TwoPair]: 2,
  [HandCategory.Straight]: 3,
  [HandCategory.ThreeOfAKind]: 4,
  [HandCategory.FullHouse]: 5,
  [HandCategory.Flush]: 6,
  [HandCategory.FourOfAKind]: 7,
  [HandCategory.StraightFlush]: 8,
  [HandCategory.RoyalFlush]: 9,
};

function evaluate5With(cards: Card[], shortDeck: boolean): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5 butuh 5 kartu');
  // Rank urut menurun (insertion sort 5 elemen — jalur panas untuk bot & equity).
  const ranks = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const r = rankOf(cards[i]);
    let j = i;
    while (j > 0 && ranks[j - 1] < r) { ranks[j] = ranks[j - 1]; j--; }
    ranks[j] = r;
  }
  const s0 = suitOf(cards[0]);
  const flush = suitOf(cards[1]) === s0 && suitOf(cards[2]) === s0 && suitOf(cards[3]) === s0 && suitOf(cards[4]) === s0;

  // Kelompokkan rank (rank sama bersebelahan): urut berdasarkan jumlah, lalu rank.
  const gRank: number[] = [];
  const gCount: number[] = [];
  for (let i = 0; i < 5; i++) {
    const k = gRank.length - 1;
    if (k >= 0 && gRank[k] === ranks[i]) gCount[k]++;
    else { gRank.push(ranks[i]); gCount.push(1); }
  }
  const order = gRank.map((_, i) => i).sort((x, y) => gCount[y] - gCount[x] || gRank[y] - gRank[x]);
  const byGroup = order.map(i => gRank[i]);
  const top = gCount[order[0]];
  const groups = gRank.length;

  // Straight: lima rank unik berurutan; As rendah → A-2-3-4-5 (standar) atau A-6-7-8-9 (Short Deck).
  let sHigh = 0;
  if (groups === 5) {
    const lowAce = shortDeck ? 9 : 5;
    if (ranks[0] - ranks[4] === 4) sHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === lowAce && ranks[1] - ranks[4] === 3) sHigh = lowAce;
  }

  let category: HandCategory;
  let tiebreak: number[];
  if (sHigh && flush) {
    category = sHigh === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
    tiebreak = [sHigh];
  } else if (top === 4) {
    category = HandCategory.FourOfAKind; tiebreak = byGroup;
  } else if (top === 3 && groups === 2) {
    category = HandCategory.FullHouse; tiebreak = byGroup;
  } else if (flush) {
    category = HandCategory.Flush; tiebreak = ranks;
  } else if (sHigh) {
    category = HandCategory.Straight; tiebreak = [sHigh];
  } else if (top === 3) {
    category = HandCategory.ThreeOfAKind; tiebreak = byGroup;
  } else if (top === 2 && groups === 3) {
    category = HandCategory.TwoPair; tiebreak = byGroup;
  } else if (top === 2) {
    category = HandCategory.OnePair; tiebreak = byGroup;
  } else {
    category = HandCategory.HighCard; tiebreak = ranks;
  }
  const strength = shortDeck ? SHORT_DECK_STRENGTH[category] : category;
  return { category, score: [strength, ...tiebreak], cards: cards.slice(), name: CATEGORY_NAME[category] };
}

/** Evaluasi tepat lima kartu. */
export function evaluate5(cards: Card[]): HandValue {
  return evaluate5With(cards, false);
}

/**
 * Evaluasi tepat lima kartu dengan aturan Short Deck (6+ Hold'em, aturan Triton):
 * A-6-7-8-9 adalah straight (high card 9), A-2-3-4-5 BUKAN straight,
 * Flush mengalahkan Full House, Three of a Kind mengalahkan Straight.
 * `category` tetap kategori aslinya (untuk nama); `score[0]` = kekuatan Short Deck.
 */
export function evaluate5ShortDeck(cards: Card[]): HandValue {
  return evaluate5With(cards, true);
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Tangan terbaik dari semua kombinasi 5 kartu (loop indeks — tanpa generator, jalur panas). */
function bestOf(cards: Card[], shortDeck: boolean): HandValue {
  const n = cards.length;
  let best: HandValue | null = null;
  const combo: Card[] = ['', '', '', '', ''];
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      combo[0] = cards[a]; combo[1] = cards[b]; combo[2] = cards[c]; combo[3] = cards[d]; combo[4] = cards[e];
      const v = evaluate5With(combo, shortDeck);
      if (!best || compareScores(v.score, best.score) > 0) best = v;
    }
  return best!;
}

/** Kombinasi lima kartu terbaik dari 5–7 kartu (Hold'em: 2 hole + 5 board). */
export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('bestHand butuh minimal 5 kartu');
  return bestOf(cards, false);
}

/** Kombinasi lima kartu terbaik dari 5–7 kartu dengan aturan Short Deck. */
export function bestShortDeckHand(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('bestShortDeckHand butuh minimal 5 kartu');
  return bestOf(cards, true);
}

/**
 * Omaha: WAJIB tepat 2 dari 4 kartu tangan + tepat 3 dari board.
 */
export function bestOmahaHand(hole: Card[], board: Card[]): HandValue {
  let best: HandValue | null = null;
  const combo: Card[] = ['', '', '', '', ''];
  const h = hole.length, b = board.length;
  for (let i = 0; i < h - 1; i++) for (let j = i + 1; j < h; j++) {
    combo[0] = hole[i]; combo[1] = hole[j];
    for (let x = 0; x < b - 2; x++) for (let y = x + 1; y < b - 1; y++) for (let z = y + 1; z < b; z++) {
      combo[2] = board[x]; combo[3] = board[y]; combo[4] = board[z];
      const v = evaluate5With(combo, false);
      if (!best || compareScores(v.score, best.score) > 0) best = v;
    }
  }
  if (!best) throw new Error('Kartu Omaha tidak cukup');
  return best;
}
