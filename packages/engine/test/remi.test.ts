import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { remi, isValidMeld, bestPartition, canCloseHand, type RemiState } from '../src/games/remi';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(11);

function rigged(): RemiState {
  const s = remi.setup(seats(2), remi.sanitizeOptions({ deals: 1 }), r());
  s.hands = [['3H', '4H', '5H', '7S', '7D', '7C', 'KD'], ['2C', '9D', 'JS', 'QH', '4S', '8C', '5D']];
  s.deck = ['6H', '2S', '3S', '9C', 'TC'];
  s.discard = ['AS'];
  s.turn = 0; s.phase = 'draw';
  return s;
}

describe('Remi — solver kombinasi', () => {
  it('set & run sah / tidak sah', () => {
    expect(isValidMeld(['7S', '7D', '7C'])).toBe(true);
    expect(isValidMeld(['7S', '7D', '7C', '7H'])).toBe(true);
    expect(isValidMeld(['7S', '7D'])).toBe(false);
    expect(isValidMeld(['3H', '4H', '5H', '6H'])).toBe(true);
    expect(isValidMeld(['AH', '2H', '3H'])).toBe(true);
    expect(isValidMeld(['QH', 'KH', 'AH'])).toBe(true);
    expect(isValidMeld(['KH', 'AH', '2H'])).toBe(false);
    expect(isValidMeld(['3H', '4H', '5S'])).toBe(false);
    expect(isValidMeld(['3H', '5H', '6H'])).toBe(false);
  });
  it('partisi tangan', () => {
    expect(canCloseHand(['3H', '4H', '5H', '6H', '7S', '7D', '7C'])).toBe(true);
    expect(canCloseHand(['AH', '2H', '3H', 'QS', 'KS', 'AS', 'AD'])).toBe(false);
    expect(canCloseHand(['AH', '2H', '3H', 'QS', 'KS', 'AS', '4H'])).toBe(true);
    // 5H dipakai di set ATAU run — solver harus menemukan pembagian yang benar.
    expect(canCloseHand(['3H', '4H', '5H', '5S', '5D', '5C', '6S'])).toBe(false);
    expect(canCloseHand(['3H', '4H', '5H', '5S', '5D', '6C', '6S'])).toBe(false);
    expect(canCloseHand(['5H', '5S', '5D', '5C', 'TC', 'JC', 'QC'])).toBe(true);
    expect(canCloseHand(['3H', '4H', '5H', '6H', '5S', '5D', '5C'])).toBe(true);
    const p = bestPartition(['3H', '4H', '5H', 'KS', 'AD', '9C', '9D']);
    expect(p.melds).toHaveLength(1);
    expect(p.points).toBe(10 + 15 + 5 + 5);
  });
});

describe('Remi — aturan', () => {
  it('Tutup setelah membuang = menang deal', () => {
    let s = remi.apply(rigged(), 0, { type: 'act', id: 'deck' }, r());
    expect(s.hands[0]).toContain('6H');
    s = remi.apply(s, 0, { type: 'act', id: 'discard', cards: ['KD'] }, r());
    expect(s.phase).toBe('dealEnd');
    expect(s.winner).toBe(0);
    expect(s.scores[0]).toBe(50);
    expect(s.scores[1]).toBeLessThan(0);
    s = remi.advance(s, r());
    expect(s.over).toBe(true);
    expect(remi.results(s)![0]).toMatchObject({ seat: 0, rank: 1 });
  });
  it('buang biasa memindah giliran; kartu buangan yang diambil tak boleh dibuang lagi', () => {
    let s = remi.apply(rigged(), 0, { type: 'act', id: 'take' }, r());
    expect(() => remi.apply(s, 0, { type: 'act', id: 'discard', cards: ['AS'] }, r())).toThrow(RuleError);
    s = remi.apply(s, 0, { type: 'act', id: 'discard', cards: ['KD'] }, r());
    expect(s.phase).toBe('draw');
    expect(s.turn).toBe(1);
    expect(() => remi.apply(s, 0, { type: 'act', id: 'deck' }, r())).toThrow(RuleError);
  });
  it('view tidak membocorkan kartu lawan maupun deck', () => {
    const s = rigged();
    expectNoLeak(remi, s, 0, [s.hands[1], s.deck]);
  });
  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(remi, { players: n, seed, check: (s: RemiState) => {
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(52);
      } });
    });
  }
});
