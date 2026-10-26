import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { samhong, evalSamhong, compareSamhong, type SamhongState } from '../src/games/samhong';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(3);

function rigged(n = 3): SamhongState {
  const s = samhong.setup(seats(n), samhong.sanitizeOptions({ deals: 1 }), r());
  s.hands = [['9S', 'KH', 'QD'], ['5C', '5D', '5H'], ['AS', '7C', '2D']].slice(0, n);
  s.deck = ['8C', 'JD', '3S', '4H'];
  s.discard = [];
  s.turn = 0; s.choices = s.hands.map(() => null); s.phase = 'swap';
  return s;
}

describe('Samhong', () => {
  it('evaluasi tangan', () => {
    expect(evalSamhong(['5C', '5D', '5H']).name).toBe('Tris');
    expect(evalSamhong(['JC', 'QD', 'KH']).name).toBe('Samhong');
    expect(evalSamhong(['KC', 'KD', 'KH']).name).toBe('Tris');
    expect(evalSamhong(['9S', 'KH', 'QD']).points).toBe(9);
    expect(evalSamhong(['AS', '7C', '2D']).points).toBe(0);
    expect(evalSamhong(['TS', 'KH', 'QD']).name).toBe('0 poin');
  });
  it('urutan: Tris > Samhong > 9 poin > … ; seri dipecah kartu tertinggi', () => {
    expect(compareSamhong(['2C', '2D', '2H'], ['JC', 'QD', 'KH'])).toBe(1);
    expect(compareSamhong(['JC', 'QD', 'KH'], ['9S', 'KH', 'QD'])).toBe(1);
    expect(compareSamhong(['9S', 'KH', 'QD'], ['8S', 'KH', 'QD'])).toBe(1);
    expect(compareSamhong(['8S', 'AH', 'TD'], ['9C', 'KH', 'QD'])).toBe(1);
    expect(compareSamhong(['9S', 'KH', 'QD'], ['9C', 'KD', 'QH'])).toBe(0);
  });
  it('tukar: buang 1, ambil 1; tahan; lalu showdown dan skor', () => {
    let s = rigged();
    s = samhong.apply(s, 0, { type: 'act', id: 'stand' }, r());
    expect(() => samhong.apply(s, 0, { type: 'act', id: 'stand' }, r())).toThrow(RuleError);
    s = samhong.apply(s, 1, { type: 'act', id: 'stand' }, r());
    s = samhong.apply(s, 2, { type: 'act', id: 'swap', cards: ['AS'] }, r());
    expect(s.hands[2]).toContain('8C');
    expect(s.discard).toEqual(['AS']);
    expect(s.phase).toBe('showdown');
    // Seat 1 Tris menang ×3 dari dua pemain.
    expect(s.lastDeal).toEqual([-3, 6, -3]);
    expect(samhong.currentSeat(s)).toBeNull();
    s = samhong.advance(s, r());
    expect(s.over).toBe(true);
    expect(samhong.results(s)![0]).toMatchObject({ seat: 1, rank: 1, score: 6 });
  });
  it('tukar kartu yang tidak dimiliki ditolak', () => {
    expect(() => samhong.apply(rigged(), 0, { type: 'act', id: 'swap', cards: ['5C'] }, r())).toThrow(RuleError);
  });
  it('view tidak membocorkan kartu lawan maupun deck', () => {
    const s = rigged();
    expectNoLeak(samhong, s, 0, [s.hands[1], s.hands[2], s.deck]);
  });
  for (const n of [2, 3, 4, 5, 6]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(samhong, { players: n, seed, check: (s: SamhongState) => {
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(52);
        for (const h of s.hands) expect(h).toHaveLength(3);
      } });
    });
  }
});
