import { describe, expect, it } from 'vitest';
import { seededRng, RuleError, shuffledDeck } from '../src';
import { capsaSusun, score3, isFoul, autoArrange, pairPoints, type CapsaSusunState } from '../src/games/capsaSusun';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(9);

const HAND0 = ['AS', 'AH', 'AD', 'KS', 'KH', '2C', '3C', '4C', '5C', '9C', '7D', '8H', 'JS'];

function rigged(): CapsaSusunState {
  const s = capsaSusun.setup(seats(2), capsaSusun.sanitizeOptions({ deals: 1 }), r());
  s.hands[0] = HAND0.slice();
  s.hands[1] = ['2S', '3S', '4S', '5S', '6S', '2H', '3H', '4H', '5H', '6H', '2D', '3D', '4D'];
  s.turn = 0;
  return s;
}

describe('Capsa Susun — evaluator', () => {
  it('skor 3 kartu & perbandingan dengan baris 5 kartu', () => {
    expect(score3(['AS', 'AH', 'AD'])[0]).toBe(3);
    expect(score3(['KS', 'KH', '2D'])).toEqual([1, 13, 2]);
    expect(score3(['KS', '9H', '2D'])).toEqual([0, 13, 9, 2]);
    // Atas pair K vs Tengah pair Q → mati.
    expect(isFoul(['KS', 'KH', '2D'], ['QS', 'QH', '3D', '4C', '5H'], ['AS', 'AH', 'AD', '9C', '9D'])).toBe(true);
    // Atas pair K kicker 2 vs Tengah pair K dengan kicker lebih tinggi → sah.
    expect(isFoul(['KS', 'KH', '2D'], ['KC', 'KD', '3D', '4C', '5H'], ['AS', 'AH', 'AD', '9C', '9D'])).toBe(false);
    // Tengah lebih kuat dari Bawah → mati.
    expect(isFoul(['2S', '3H', '4D'], ['AS', 'AH', 'AD', '9C', '9D'], ['KC', 'KD', '3D', '4C', '5H'])).toBe(true);
  });
  it('susun otomatis selalu sah', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const cards = shuffledDeck(seededRng(seed)).slice(0, 13);
      const a = autoArrange(cards);
      expect([...a.top, ...a.mid, ...a.bot].sort()).toEqual(cards.slice().sort());
      expect(isFoul(a.top, a.mid, a.bot)).toBe(false);
      const g = autoArrange(cards, true);
      expect(isFoul(g.top, g.mid, g.bot)).toBe(false);
    }
  });
  it('skor pasangan: per baris, sapu bersih dobel, mati kalah semua', () => {
    const strong = { top: ['QS', 'QH', '2D'], mid: ['KC', 'KD', '3D', '4C', '5H'], bot: ['AS', 'AH', 'AD', '9C', '8D'] };
    const weak = { top: ['2S', '3H', '5D'], mid: ['7C', '7D', '8D', '4S', '6H'], bot: ['TS', 'TH', 'JD', '9S', '8C'] };
    const mixed = { top: ['AC', 'KH', '2C'], mid: ['8S', '8H', 'JC', '9H', 'TC'], bot: ['2H', '3S', '4H', '5S', '6C'] };
    const foul = { top: ['KS', 'KH', '2D'], mid: ['QS', 'QH', '3D', '4C', '5H'], bot: ['AS', 'AH', 'AD', '9C', '9D'] };
    expect(pairPoints(strong, weak)).toBe(6);
    expect(pairPoints(weak, strong)).toBe(-6);
    expect(pairPoints(mixed, strong)).toBe(1 - 2);
    expect(pairPoints(foul, weak)).toBe(-6);
    expect(pairPoints(foul, foul)).toBe(0);
  });
});

describe('Capsa Susun — alur', () => {
  it('set baris, ulang, kunci; giliran tersembunyi bergantian; showdown', () => {
    let s = rigged();
    expect(() => capsaSusun.apply(s, 1, { type: 'act', id: 'auto' }, r())).toThrow(RuleError);
    expect(() => capsaSusun.apply(s, 0, { type: 'act', id: 'lock' }, r())).toThrow(RuleError);
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'top', cards: ['7D', '8H', 'JS'] }, r());
    expect(s.hands[0]).toHaveLength(10);
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'reset' }, r());
    expect(s.hands[0]).toHaveLength(13);
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'top', cards: ['7D', '8H', 'JS'] }, r());
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'mid', cards: ['AS', 'AH', 'AD', 'KS', 'KH'] }, r());
    // Tengah full house > Bawah flush → mati, tapi tetap boleh dikunci.
    expect(capsaSusun.view(s, 0).prompt).toContain('Mati');
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'reset' }, r());
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'top', cards: ['7D', '8H', 'JS'] }, r());
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'mid', cards: ['2C', '3C', '4C', '5C', '9C'] }, r());
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'lock' }, r());
    expect(s.rows[0].bot).toHaveLength(5);
    expect(s.turn).toBe(1);
    s = capsaSusun.apply(s, 1, { type: 'act', id: 'auto' }, r());
    s = capsaSusun.apply(s, 1, { type: 'act', id: 'lock' }, r());
    expect(s.phase).toBe('showdown');
    expect(s.lastDeal![0] + s.lastDeal![1]).toBe(0);
    s = capsaSusun.advance(s, r());
    expect(s.over).toBe(true);
  });
  it('baris pemain lain tidak terlihat', () => {
    let s = rigged();
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'auto' }, r());
    s = capsaSusun.apply(s, 0, { type: 'act', id: 'lock' }, r());
    expectNoLeak(capsaSusun, s, 1, [HAND0]);
    expectNoLeak(capsaSusun, s, 0, [s.hands[1]]);
    const v0 = capsaSusun.view(s, 0);
    expect(v0.piles.map(p => p.id)).toEqual(['rowTop', 'rowMid', 'rowBot']);
  });
  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(capsaSusun, { players: n, seed, check: (s: CapsaSusunState) => {
        const all: string[] = [];
        for (let i = 0; i < n; i++) {
          const row = s.rows[i];
          const cards = [...s.hands[i], ...(row.top ?? []), ...(row.mid ?? []), ...(row.bot ?? [])];
          expect(cards).toHaveLength(13);
          all.push(...cards);
        }
        expect(new Set(all).size).toBe(13 * n);
      } });
    });
  }
});
