import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { goFish, type GoFishState } from '../src/games/goFish';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(7);
const ask = (card: string, target: number) => ({ type: 'act' as const, id: 'ask', cards: [card], target });

function rigged(): GoFishState {
  const s = goFish.setup(seats(3), goFish.sanitizeOptions({}), r());
  s.hands = [['7H', '7S', '9C'], ['7D', '2C'], ['3H', '4S']];
  s.pond = ['9D', 'KH', '5C'];
  s.books = [[], [], []];
  s.turn = 0;
  s.lastAsk = [null, null, null];
  return s;
}

describe('Go Fish', () => {
  it('kartu awal 7 untuk 2–3 pemain, 5 untuk 4+', () => {
    expect(goFish.setup(seats(3), goFish.sanitizeOptions({}), r()).hands.flat().length
      + goFish.setup(seats(3), goFish.sanitizeOptions({}), r()).books.flat().flat().length).toBe(21);
    const s4 = goFish.setup(seats(4), goFish.sanitizeOptions({}), r());
    expect(s4.hands.flat().length + s4.books.flat().flat().length).toBe(20);
  });
  it('lawan menyerahkan semua kartu angka itu; jalan lagi', () => {
    const s = goFish.apply(rigged(), 0, ask('7H', 1), r());
    expect(s.hands[1]).toEqual(['2C']);
    expect(s.hands[0].filter(c => c[0] === '7')).toHaveLength(3);
    expect(s.turn).toBe(0);
  });
  it('Go Fish: ambil dari kolam; giliran pindah bila bukan angka yang diminta', () => {
    const s = goFish.apply(rigged(), 0, ask('7H', 2), r());
    expect(s.hands[0]).toContain('9D');
    // 9D cocok dengan 9C tapi bukan angka yang diminta (7) → giliran pindah
    expect(s.turn).toBe(1);
  });
  it('mancing angka yang diminta → jalan lagi', () => {
    const s0 = rigged(); s0.pond = ['7C', 'KH'];
    const s = goFish.apply(s0, 0, ask('7H', 2), r());
    expect(s.turn).toBe(0);
  });
  it('buku 4 kartu otomatis diturunkan', () => {
    const s0 = rigged(); s0.hands[0] = ['7H', '7S', '7C', '9C'];
    const s = goFish.apply(s0, 0, ask('7H', 1), r());
    expect(s.books[0]).toHaveLength(1);
    expect(s.hands[0]).toEqual(['9C']);
  });
  it('harus memegang angka yang diminta & lawan valid', () => {
    expect(() => goFish.apply(rigged(), 0, ask('2C', 1), r())).toThrow(RuleError);
    expect(() => goFish.apply(rigged(), 0, ask('7H', 0), r())).toThrow(RuleError);
    expect(() => goFish.apply(rigged(), 0, { type: 'act', id: 'ask', cards: ['7H'] }, r())).toThrow(RuleError);
  });
  it('view tidak membocorkan kartu lawan/kolam', () => {
    const s = rigged();
    const v = JSON.stringify(goFish.view(s, 0));
    for (const c of [...s.hands[1], ...s.hands[2], ...s.pond]) expect(v).not.toContain(`"${c}"`);
  });
  for (const n of [2, 3, 4, 5, 6]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const { state } = fuzzGeneric(goFish, { players: n, seed, check: (s: GoFishState) => {
        expect(s.hands.flat().length + s.pond.length + s.books.flat().flat().length).toBe(52);
      } });
      expect(state.books.flat().length).toBe(13);
    });
  }
});
