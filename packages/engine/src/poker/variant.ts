// poker/variant.ts — konfigurasi varian poker kartu komunitas yang memakai mesin Hold'em:
//  - 'holdem'     : Texas Hold'em No-Limit, deck 52, 2 kartu tangan.
//  - 'omaha'      : Omaha Pot-Limit, deck 52, 4 kartu tangan, wajib 2 tangan + 3 board.
//  - 'short-deck' : Short Deck (6+) Hold'em No-Limit, deck 36 (6..A), aturan Triton.

import { type Card, SUITS, makeCard, standardDeck } from '../cards';
import { type HandValue, bestHand, bestOmahaHand, bestShortDeckHand } from './evaluator';

export type HoldemVariant = 'holdem' | 'omaha' | 'short-deck';

export interface VariantSpec {
  id: HoldemVariant;
  /** Nama tampilan. */
  name: string;
  holeCards: number;
  potLimit: boolean;
}

export const VARIANTS: Record<HoldemVariant, VariantSpec> = {
  holdem: { id: 'holdem', name: "Texas Hold'em", holeCards: 2, potLimit: false },
  omaha: { id: 'omaha', name: 'Omaha Poker', holeCards: 4, potLimit: true },
  'short-deck': { id: 'short-deck', name: 'Short Deck Hold\'em', holeCards: 2, potLimit: false },
};

export function isHoldemVariant(id: unknown): id is HoldemVariant {
  return id === 'holdem' || id === 'omaha' || id === 'short-deck';
}

/** Spesifikasi varian; id tak dikenal diperlakukan sebagai Hold'em. */
export function variantSpec(id: string | undefined): VariantSpec {
  return isHoldemVariant(id) ? VARIANTS[id] : VARIANTS.holdem;
}

/** Deck 36 kartu Short Deck: 6, 7, 8, 9, T, J, Q, K, A × 4 suit. */
export function shortDeckCards(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 6; r <= 14; r++) deck.push(makeCard(r, s));
  return deck;
}

/** Deck (urut) untuk varian. */
export function variantDeck(id: HoldemVariant): Card[] {
  return id === 'short-deck' ? shortDeckCards() : standardDeck();
}

/**
 * Tangan terbaik sesuai varian. Untuk Omaha butuh board ≥ 3 kartu
 * (tepat 2 kartu tangan + tepat 3 kartu board).
 */
export function evaluateVariant(id: string | undefined, hole: Card[], board: Card[]): HandValue {
  const v = variantSpec(id).id;
  if (v === 'omaha') return bestOmahaHand(hole, board);
  if (v === 'short-deck') return bestShortDeckHand([...hole, ...board]);
  return bestHand([...hole, ...board]);
}
