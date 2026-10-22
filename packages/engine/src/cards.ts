// cards.ts — kartu standar 52 lembar, dikodekan sebagai string 2 karakter: "AS", "TD", "9H".
// Rank: 2..9, T(10), J, Q, K, A. Suit: S (♠ sekop), H (♥ hati), D (♦ wajik), C (♣ keriting).

import type { Rng } from './rng';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Card = string;

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const RANK_CHARS = '23456789TJQKA';

/** Nilai rank numerik: 2..14 (As = 14). */
export function rankOf(card: Card): number {
  const i = RANK_CHARS.indexOf(card[0]);
  if (i < 0) throw new Error(`Kartu tidak valid: ${card}`);
  return i + 2;
}

export function suitOf(card: Card): Suit {
  const s = card[1] as Suit;
  if (!SUITS.includes(s)) throw new Error(`Kartu tidak valid: ${card}`);
  return s;
}

export function makeCard(rank: number, suit: Suit): Card {
  return RANK_CHARS[rank - 2] + suit;
}

export function isValidCard(card: unknown): card is Card {
  return typeof card === 'string' && card.length === 2 &&
    RANK_CHARS.includes(card[0]) && SUITS.includes(card[1] as Suit);
}

/** Deck 52 kartu, urut. */
export function standardDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(makeCard(r, s));
  return deck;
}

/** Fisher–Yates; memakai sumber random yang diberikan (crypto di server). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function shuffledDeck(rng: Rng, decks = 1): Card[] {
  const all: Card[] = [];
  for (let d = 0; d < decks; d++) all.push(...standardDeck());
  return shuffle(all, rng);
}

/** Ambil n kartu dari atas deck (mutasi). */
export function draw(deck: Card[], n: number): Card[] {
  if (deck.length < n) throw new Error('Deck habis');
  return deck.splice(0, n);
}

const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

export function cardLabel(card: Card): string {
  return (RANK_LABEL[card[0]] ?? card[0]) + SUIT_SYMBOL[suitOf(card)];
}
