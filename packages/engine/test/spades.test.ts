import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { spades, scoreTeam, legalCards, type SpadesState } from '../src/games/spades';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(11);
const play = (s: SpadesState, seat: number, card: string) => spades.apply(s, seat, { type: 'act', id: 'play', cards: [card] }, r());

function fresh(opts: Record<string, unknown> = {}): SpadesState {
  const s = spades.setup(seats(4), spades.sanitizeOptions({ round: 2, previousWinner: 1, ...opts }), r());
  return s;
}

function rigged(hands: string[][], broken = false): SpadesState {
  const s = fresh();
  s.dealer = 3;
  s.phase = 'play';
  s.bids = [3, 3, 3, 3];
  s.hands = hands.map(h => h.slice());
  s.trickNo = 13 - hands[0].length;
  s.spadesBroken = broken;
  s.turn = 0;
  return s;
}

describe('Spades', () => {
  it('opsi disanitasi', () => {
    expect(spades.sanitizeOptions({ target: 300, maxDeals: 6, foo: 1 })).toEqual({ target: 300, maxDeals: 6, turnSeconds: 25, passAndPlay: false });
    expect(spades.sanitizeOptions({ target: 'x', maxDeals: 99 })).toMatchObject({ target: 200, maxDeals: 10 });
  });

  it('penawaran bergiliran mulai kiri dealer, lalu kiri dealer membuka', () => {
    let s = fresh();
    const first = (s.dealer + 1) % 4;
    expect(s.turn).toBe(first);
    expect(() => spades.apply(s, first, { type: 'act', id: 'bid', amount: 14 }, r())).toThrow(RuleError);
    expect(() => spades.apply(s, (first + 1) % 4, { type: 'act', id: 'bid', amount: 2 }, r())).toThrow(RuleError);
    for (let k = 0; k < 4; k++) {
      const seat = s.turn!;
      s = k === 1 ? spades.apply(s, seat, { type: 'act', id: 'nil' }, r()) : spades.apply(s, seat, { type: 'act', id: 'bid', amount: 3 }, r());
    }
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(first);
    expect(s.bids[(first + 1) % 4]).toBe(0);
  });

  it('wajib mengikuti suit; sekop boleh memotong bila kosong; sekop menang', () => {
    let s = rigged([['5H', 'KS'], ['AH', '2S'], ['3D', '4S'], ['9H', 'TC']], false);
    expect(() => play(s, 0, 'KS')).toThrow(RuleError); // sekop belum pecah
    s = play(s, 0, '5H');
    expect(() => play(s, 1, '2S')).toThrow(RuleError); // punya hati
    s = play(s, 1, 'AH');
    expect(legalCards(s, 2).sort()).toEqual(['3D', '4S']);
    s = play(s, 2, '4S');
    expect(s.spadesBroken).toBe(true);
    s = play(s, 3, '9H');
    expect(s.phase).toBe('trickDone');
    expect(s.trickWinnerSeat).toBe(2);
    expect(spades.currentSeat(s)).toBeNull();
    s = spades.advance(s, r());
    expect(s.turn).toBe(2);
    expect(s.tricksWon[2]).toBe(1);
  });

  it('sekop boleh dibuka bila tangan tinggal sekop', () => {
    const s = rigged([['KS', '3S'], ['AH', '2S'], ['3D', '4S'], ['9H', 'TC']], false);
    expect(legalCards(s, 0).sort()).toEqual(['3S', 'KS']);
  });

  it('skor kontrak, gagal, nil, bag', () => {
    expect(scoreTeam([4, 3], [4, 4], 0)).toEqual({ delta: 71, bags: 1, penalties: 0 });
    expect(scoreTeam([4, 3], [2, 4], 0)).toEqual({ delta: -70, bags: 0, penalties: 0 });
    expect(scoreTeam([0, 4], [0, 5], 0)).toEqual({ delta: 141, bags: 1, penalties: 0 });
    // nil gagal: −100, trik nil tidak membantu kontrak rekan (dihitung bag)
    expect(scoreTeam([0, 4], [2, 3], 0)).toEqual({ delta: -100 + 2 - 40, bags: 2, penalties: 0 });
    // 10 bag → −100
    expect(scoreTeam([3, 3], [5, 4], 7)).toEqual({ delta: 63 - 100, bags: 0, penalties: 1 });
    expect(scoreTeam([0, 0], [0, 0], 0)).toEqual({ delta: 200, bags: 0, penalties: 0 });
  });

  it('akhir deal: skor tim, target → selesai, rekan berbagi peringkat', () => {
    let s = rigged([['AS'], ['2H'], ['3H'], ['4H']], true);
    s.bids = [1, 2, 1, 2];
    s.tricksWon = [3, 4, 2, 3]; // + trik terakhir untuk seat 0 → A: 6 trik vs kontrak 2, B: 7 vs 4
    s.teamScores = [180, 100];
    s.bags = [5, 0];
    s = play(s, 0, 'AS'); s = play(s, 1, '2H'); s = play(s, 2, '3H'); s = play(s, 3, '4H');
    s = spades.advance(s, r());
    // A: 20 + 4 bag = 24, bag 9; B: 40 + 3 = 43
    expect(s.teamScores).toEqual([204, 143]);
    expect(s.bags).toEqual([9, 3]);
    expect(s.over).toBe(true);
    const res = spades.results(s)!;
    expect(res.filter(x => x.rank === 1).map(x => x.seat).sort()).toEqual([0, 2]);
    expect(res.filter(x => x.rank === 3).map(x => x.seat).sort()).toEqual([1, 3]);
  });

  it('skor seri di atas target → lanjut deal', () => {
    let s = rigged([['AS'], ['2H'], ['3H'], ['4H']], true);
    s.bids = [2, 2, 2, 2];
    s.tricksWon = [1, 3, 1, 3];
    s.teamScores = [190, 170];
    s = play(s, 0, 'AS'); s = play(s, 1, '2H'); s = play(s, 2, '3H'); s = play(s, 3, '4H');
    s = spades.advance(s, r());
    // A: 3 trik vs 4 → −40 → 150; B: 6 vs 4 → 42 → 212
    expect(s.teamScores).toEqual([150, 212]);
    expect(s.over).toBe(true);
    s = rigged([['AS'], ['2H'], ['3H'], ['4H']], true);
    s.bids = [2, 2, 2, 2]; s.tricksWon = [2, 2, 1, 3]; s.teamScores = [160, 159];
    s = play(s, 0, 'AS'); s = play(s, 1, '2H'); s = play(s, 2, '3H'); s = play(s, 3, '4H');
    s = spades.advance(s, r());
    expect(s.teamScores).toEqual([200, 200]);
    expect(s.over).toBe(false);
    expect(s.phase).toBe('dealEnd');
  });

  it('view tidak membocorkan kartu lawan', () => {
    const s = fresh();
    expectNoLeak(spades, s, 1, [s.hands[0], s.hands[2], s.hands[3]]);
    expectNoLeak(spades, s, null as unknown as number, s.hands);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz 4 pemain seed ${seed}`, () => {
      fuzzGeneric(spades, { players: 4, seed, options: { target: seed % 2 ? 200 : 300, maxDeals: seed % 2 ? 10 : 6 }, check: (s: SpadesState) => {
        expect(s.hands.flat().length + s.trick.length + s.taken.flat().length).toBe(52);
        if (!s.over && s.turn === null) expect(spades.autoDelay(s)).not.toBeNull();
      } });
    });
  }
});
