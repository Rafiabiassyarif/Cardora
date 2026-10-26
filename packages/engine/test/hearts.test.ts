import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { hearts, legalCards, type HeartsState } from '../src/games/hearts';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(7);
const play = (s: HeartsState, seat: number, card: string) => hearts.apply(s, seat, { type: 'act', id: 'play', cards: [card] }, r());

function fresh(): HeartsState {
  return hearts.setup(seats(4), hearts.sanitizeOptions({ junk: 1, round: 3 }), r());
}

/** Deal tanpa oper, tangan dirancang. */
function rigged(hands: string[][], trickNo = 0, broken = false): HeartsState {
  const s = fresh();
  s.phase = 'play'; s.passDir = 3; s.passed = [null, null, null, null];
  s.hands = hands.map(h => h.slice());
  s.trickNo = trickNo; s.heartsBroken = broken;
  s.turn = trickNo === 0 ? s.hands.findIndex(h => h.includes('2C')) : 0;
  return s;
}

describe('Hearts', () => {
  it('opsi disanitasi', () => {
    expect(hearts.sanitizeOptions({ target: 100, turnSeconds: 999, x: 'y' })).toEqual({ target: 100, turnSeconds: 60, passAndPlay: false });
    expect(hearts.sanitizeOptions(null).target).toBe(50);
  });

  it('fase oper: berurutan, tertutup, ditukar setelah semua memilih (ke kiri)', () => {
    let s = fresh();
    expect(s.phase).toBe('pass');
    expect(s.passDir).toBe(0);
    const before = s.hands.map(h => h.slice());
    const chosen: string[][] = [];
    for (let k = 0; k < 4; k++) {
      const seat = s.turn!;
      const c = s.hands[seat].slice(0, 3);
      chosen[seat] = c;
      s = hearts.apply(s, seat, { type: 'act', id: 'pass', cards: c }, r());
      if (k < 3) {
        expect(s.phase).toBe('pass');
        // pemain lain tidak melihat pilihan seat ini
        const other = (seat + 1) % 4;
        expectNoLeak(hearts, s, other, [c]);
      }
    }
    expect(s.phase).toBe('play');
    for (let i = 0; i < 4; i++) {
      const from = (i + 3) % 4;
      for (const c of chosen[from]) expect(s.hands[i]).toContain(c);
      for (const c of chosen[i]) expect(s.hands[i]).not.toContain(c);
      expect(s.hands[i]).toHaveLength(13);
    }
    expect(before.flat().sort()).toEqual(s.hands.flat().sort());
    expect(s.hands[s.turn!]).toContain('2C');
  });

  it('2♣ wajib membuka; wajib mengikuti suit', () => {
    let s = rigged([['2C', '5C', 'AH'], ['3C', 'KD', '4H'], ['9D', '7S', '8H'], ['QS', 'TD', '2H']]);
    expect(s.turn).toBe(0);
    expect(() => play(s, 0, '5C')).toThrow(RuleError);
    s = play(s, 0, '2C');
    expect(() => play(s, 1, 'KD')).toThrow(RuleError);
    s = play(s, 1, '3C');
    expect(s.turn).toBe(2);
  });

  it('trik pertama: Hati/Q♠ dilarang kecuali tidak ada pilihan', () => {
    let s = rigged([['2C', '5C', 'AH'], ['3C', 'KD', '4H'], ['9D', '7S', '8H'], ['QS', '2H', '3H']]);
    s = play(s, 0, '2C');
    s = play(s, 1, '3C');
    // seat 2 kosong keriting: tidak boleh 8H, harus 9D/7S
    expect(() => play(s, 2, '8H')).toThrow(RuleError);
    expect(legalCards(s, 2).sort()).toEqual(['7S', '9D']);
    s = play(s, 2, '9D');
    // seat 3 hanya punya kartu poin → semuanya boleh
    expect(legalCards(s, 3).sort()).toEqual(['2H', '3H', 'QS']);
    s = play(s, 3, 'QS');
    expect(s.phase).toBe('trickDone');
    expect(s.turn).toBeNull();
    expect(hearts.autoDelay(s)).toBeGreaterThan(0);
    expect(s.trickWinnerSeat).toBe(1);
    s = hearts.advance(s, r());
    expect(s.turn).toBe(1);
    expect(s.taken[1]).toContain('QS');
  });

  it('Hati tidak boleh dibuka sebelum pecah, kecuali tinggal Hati', () => {
    let s = rigged([['5C', 'AH'], ['3C', '4H'], ['9C', '8H'], ['TC', '2H']], 5, false);
    expect(() => play(s, 0, 'AH')).toThrow(RuleError);
    s = rigged([['AH', '3H'], ['3C', '4H'], ['9C', '8H'], ['TC', '2H']], 5, false);
    expect(legalCards(s, 0).sort()).toEqual(['3H', 'AH']);
    s = rigged([['5C', 'AH'], ['3S', '4H'], ['9C', '8H'], ['TC', '2H']], 5, false);
    s = play(s, 0, '5C');
    s = play(s, 1, '4H'); // kosong keriting, buang hati
    expect(s.heartsBroken).toBe(true);
  });

  it('skor & shoot the moon', () => {
    // seat 0 mengambil semua kartu poin
    let s = rigged([['AH'], ['2C'], ['3C'], ['4C']], 12, true);
    s.taken = [
      ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'QS'],
      [], [], [],
    ];
    s.scores = [10, 10, 10, 10];
    s = play(s, 0, 'AH');
    s = play(s, 1, '2C'); s = play(s, 2, '3C'); s = play(s, 3, '4C');
    s = hearts.advance(s, r());
    expect(s.scores).toEqual([10, 36, 36, 36]);
    expect(s.over).toBe(false);
    expect(s.phase).toBe('dealEnd');
    expect(hearts.autoDelay(s)).toBeGreaterThan(0);

    // skor biasa + akhir permainan
    s = rigged([['AH'], ['2C'], ['3C'], ['QS']], 12, true);
    s.taken = [['2H', '3H'], ['4H'], [], []];
    s.scores = [0, 45, 0, 0];
    s = play(s, 0, 'AH');
    s = play(s, 1, '2C'); s = play(s, 2, '3C'); s = play(s, 3, 'QS');
    s = hearts.advance(s, r());
    expect(s.scores).toEqual([16, 46, 0, 0]); // 2H+3H+AH+QS
    expect(s.over).toBe(false);
    s = rigged([['AH'], ['2C'], ['3C'], ['QS']], 12, true);
    s.scores = [40, 10, 5, 5];
    s = play(s, 0, 'AH');
    s = play(s, 1, '2C'); s = play(s, 2, '3C'); s = play(s, 3, 'QS');
    s = hearts.advance(s, r());
    expect(s.scores).toEqual([54, 10, 5, 5]);
    expect(s.over).toBe(true);
    const res = hearts.results(s)!;
    expect(res.filter(x => x.rank === 1).map(x => x.seat).sort()).toEqual([2, 3]);
    expect(res.find(x => x.seat === 0)!.rank).toBe(4);
  });

  it('arah oper berputar: kiri, kanan, seberang, tanpa oper', () => {
    let s = fresh();
    const dirs: number[] = [];
    for (let d = 0; d < 4; d++) {
      dirs.push(s.passDir);
      s.phase = 'dealEnd'; s.turn = null;
      s = hearts.advance(s, r());
    }
    expect(dirs).toEqual([0, 1, 2, 3]);
    expect(s.passDir).toBe(0);
  });

  it('view tidak membocorkan kartu lawan', () => {
    const s = fresh();
    expectNoLeak(hearts, s, 0, [s.hands[1], s.hands[2], s.hands[3]]);
    expectNoLeak(hearts, s, null as unknown as number, s.hands);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz 4 pemain seed ${seed}`, () => {
      fuzzGeneric(hearts, { players: 4, seed, options: { target: seed % 2 ? 50 : 100 }, check: (s: HeartsState) => {
        const n = s.hands.flat().length + s.passed.reduce((x, p) => x + (p ? p.length : 0), 0) + s.trick.length + s.taken.flat().length;
        expect(n).toBe(52);
        if (!s.over && s.turn === null) expect(hearts.autoDelay(s)).not.toBeNull();
      } });
    });
  }
});
