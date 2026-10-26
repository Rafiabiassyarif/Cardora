import { describe, expect, it } from 'vitest';
import { crazyEights, seededRng, RuleError, type CrazyEightsState } from '../src';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(5);

function rigged(): CrazyEightsState {
  const s = crazyEights.setup(seats(2), crazyEights.sanitizeOptions({}), r());
  s.hands = [['5H', '9S', '8D'], ['2C', '3C', 'AH']];
  s.discard = ['7H']; s.activeSuit = 'H'; s.turn = 0; s.deck = ['4C', 'QH'];
  return s;
}

describe('Crazy Eights', () => {
  it('hanya suit/angka sama atau 8 yang boleh', () => {
    const s = rigged();
    expect(() => crazyEights.apply(s, 0, { type: 'act', id: 'play', cards: ['9S'] }, r())).toThrow(RuleError);
    const s2 = crazyEights.apply(s, 0, { type: 'act', id: 'play', cards: ['5H'] }, r());
    expect(s2.turn).toBe(1);
    expect(s2.discard.at(-1)).toBe('5H');
  });
  it('8 meminta pilihan suit, lalu suit aktif berganti', () => {
    let s = crazyEights.apply(rigged(), 0, { type: 'act', id: 'play', cards: ['8D'] }, r());
    expect(s.choosingSuit).toBe(true);
    expect(s.turn).toBe(0);
    s = crazyEights.apply(s, 0, { type: 'act', id: 'suit:C' }, r());
    expect(s.activeSuit).toBe('C');
    expect(s.turn).toBe(1);
  });
  it('setelah ambil, hanya kartu yang diambil boleh dimainkan', () => {
    let s = rigged(); s.turn = 1; s.hands[1] = ['2C', '3S'];
    s = crazyEights.apply(s, 1, { type: 'act', id: 'draw' }, r());
    expect(s.hands[1]).toContain('4C');
    expect(() => crazyEights.apply(s, 1, { type: 'act', id: 'play', cards: ['4C'] }, r())).toThrow(RuleError);
    s = crazyEights.apply(s, 1, { type: 'act', id: 'pass' }, r());
    expect(s.turn).toBe(0);
  });
  it('kartu habis = menang', () => {
    const s = rigged(); s.hands[0] = ['5H'];
    const s2 = crazyEights.apply(s, 0, { type: 'act', id: 'play', cards: ['5H'] }, r());
    expect(s2.over).toBe(true);
    expect(crazyEights.results(s2)![0]).toMatchObject({ seat: 0, rank: 1 });
  });
  it('view tidak membocorkan kartu lawan', () => {
    const s = rigged();
    const v = JSON.stringify(crazyEights.view(s, 0));
    for (const c of s.hands[1]) expect(v).not.toContain(`"${c}"`);
  });
  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(crazyEights, { players: n, seed, check: (s: CrazyEightsState) => {
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(52);
      } });
    });
  }
});
