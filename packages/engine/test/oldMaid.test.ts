import { describe, expect, it } from 'vitest';
import { seededRng, RuleError, rankOf } from '../src';
import { oldMaid, type OldMaidState } from '../src/games/oldMaid';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(3);
const draw = (amount: number) => ({ type: 'act' as const, id: 'draw', amount });

function rigged(): OldMaidState {
  const s = oldMaid.setup(seats(3), oldMaid.sanitizeOptions({}), r());
  s.hands = [['5H', 'QS'], ['5D'], ['9C', 'KH']];
  s.discards = []; s.lastPair = [null, null, null]; s.finished = []; s.turn = 0; s.loser = null; s.over = false;
  return s;
}

describe('Old Maid', () => {
  it('setup: 51 kartu, tak ada pasangan tersisa di tangan', () => {
    const s = oldMaid.setup(seats(4), oldMaid.sanitizeOptions({}), r());
    expect(s.hands.flat().length + s.discards.flat().length).toBe(51);
    for (const h of s.hands) expect(new Set(h.map(c => c[0])).size).toBe(h.length);
  });
  it('aturan warna: pasangan harus sama warna', () => {
    const s = oldMaid.setup(seats(2), oldMaid.sanitizeOptions({ pairRule: 'color' }), r());
    for (const p of s.discards) {
      const red = (c: string) => c[1] === 'H' || c[1] === 'D';
      expect(red(p[0])).toBe(red(p[1]));
    }
  });
  it('ambil dari pemain berikutnya, pasangan dibuang, pemain kosong selamat', () => {
    const s = oldMaid.apply(rigged(), 0, draw(1), r());
    expect(s.hands[1]).toEqual([]);
    expect(s.hands[0]).toEqual(['QS']);
    expect(s.discards).toHaveLength(1);
    expect(s.finished).toEqual([1]);
    expect(s.turn).toBe(2); // seat 1 sudah selamat, dilewati
  });
  it('posisi di luar rentang ditolak', () => {
    expect(() => oldMaid.apply(rigged(), 0, draw(2), r())).toThrow(RuleError);
    expect(() => oldMaid.apply(rigged(), 0, draw(0), r())).toThrow(RuleError);
    expect(() => oldMaid.apply(rigged(), 1, draw(1), r())).toThrow(RuleError);
  });
  it('pemegang Old Maid terakhir kalah', () => {
    const s0 = rigged(); s0.hands = [['QS'], [], ['5C']]; s0.finished = [1]; s0.turn = 2;
    const s = oldMaid.apply(s0, 2, draw(1), r());
    expect(s.over).toBe(true);
    expect(s.loser).toBe(2);
    const res = oldMaid.results(s)!;
    expect(res.find(x => x.seat === 2)!.rank).toBe(3);
    expect(res.find(x => x.seat === 1)!.rank).toBe(1);
  });
  it('view tidak membocorkan kartu lawan', () => {
    const s = rigged();
    const v = JSON.stringify(oldMaid.view(s, 0));
    for (const c of [...s.hands[1], ...s.hands[2]]) expect(v).not.toContain(`"${c}"`);
  });
  for (const pairRule of ['rank', 'color']) for (const n of [2, 3, 4, 5, 6]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${pairRule} ${n} pemain seed ${seed}`, () => {
      const { state } = fuzzGeneric(oldMaid, { players: n, seed, options: { pairRule }, check: (s: OldMaidState) => {
        expect(s.hands.flat().length + s.discards.flat().length).toBe(51);
      } });
      if (state.loser !== null) expect(state.hands[state.loser].map(rankOf)).toEqual([12]);
    });
  }
});
