import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { tepokNyamuk, type TepokNyamukState } from '../src/games/tepokNyamuk';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(13);

function rigged(n = 3, bots = false): TepokNyamukState {
  const s = tepokNyamuk.setup(seats(n).map((p, i) => ({ ...p, isBot: bots && i > 0 })), tepokNyamuk.sanitizeOptions({ junk: 1, round: 2 }), r());
  s.hands = [['5S', 'AS', '9D'], ['2H', 'KD', '7C'], ['3C', '4D', '6H']].slice(0, n);
  s.pile = []; s.count = 0; s.turn = 0; s.flips = 0;
  return s;
}

const act = (id: string) => ({ type: 'act' as const, id });

describe('Tepok Nyamuk', () => {
  it('hitungan maju A,2,3…; kartu tidak cocok → giliran berikut', () => {
    let s = tepokNyamuk.apply(rigged(), 0, act('flip'), r());
    expect(s.pile).toEqual(['5S']);
    expect(s.count).toBe(1);
    expect(s.window).toBeNull();
    expect(s.turn).toBe(1);
    expect(() => tepokNyamuk.apply(s, 0, act('flip'), r())).toThrow(RuleError);
  });
  it('kartu cocok membuka jendela tepok; yang tidak menepuk mengambil tumpukan', () => {
    let s = rigged();
    s = tepokNyamuk.apply(s, 0, act('flip'), r()); // A: 5S
    s = tepokNyamuk.apply(s, 1, act('flip'), r()); // 2: 2H cocok!
    expect(s.window).not.toBeNull();
    expect(tepokNyamuk.currentSeat(s)).toBeNull();
    expect(tepokNyamuk.autoDelay(s)).toBeGreaterThan(0);
    expect(() => tepokNyamuk.apply(s, 0, act('flip'), r())).toThrow(RuleError);
    s = tepokNyamuk.apply(s, 2, act('slap'), r());
    expect(() => tepokNyamuk.apply(s, 2, act('slap'), r())).toThrow(RuleError);
    s = tepokNyamuk.apply(s, 1, act('slap'), r());
    expect(s.window).not.toBeNull();
    s = tepokNyamuk.advance(s, r());
    // Seat 0 tidak menepuk → ambil 2 kartu ke bawah.
    expect(s.window).toBeNull();
    expect(s.hands[0]).toEqual(['AS', '9D', '5S', '2H']);
    expect(s.pile).toEqual([]);
    expect(s.count).toBe(0);
    expect(s.turn).toBe(0);
  });
  it('semua menepuk → yang paling lambat mengambil (bot memakai waktu reaksi yang sudah diundi)', () => {
    let s = rigged(3, true);
    s = tepokNyamuk.apply(s, 0, act('flip'), r());
    s = tepokNyamuk.apply(s, 1, act('flip'), r());
    expect(s.window).not.toBeNull();
    s.window!.botTimes = [null, 400, 900];
    s = tepokNyamuk.apply(s, 0, act('slap'), r());
    // Semua sudah punya waktu → langsung diselesaikan; manusia menepuk ~0 ms, bot 2 paling lambat.
    expect(s.window).toBeNull();
    expect(s.hands[2]).toHaveLength(5);
  });
  it('salah tepok = ambil tumpukan', () => {
    let s = tepokNyamuk.apply(rigged(), 0, act('flip'), r());
    s = tepokNyamuk.apply(s, 2, act('slap'), r());
    expect(s.hands[2]).toEqual(['3C', '4D', '6H', '5S']);
    expect(s.turn).toBe(2);
    expect(s.count).toBe(0);
  });
  it('kartu habis = selamat; pemain terakhir kalah', () => {
    let s = rigged(2);
    s.hands = [['5S'], ['KD', '7C']];
    s = tepokNyamuk.apply(s, 0, act('flip'), r());
    expect(s.over).toBe(true);
    expect(tepokNyamuk.results(s)).toEqual([{ seat: 0, rank: 1, score: 0 }, { seat: 1, rank: 2, score: 2 }]);
  });
  it('kartu terakhir yang cocok: harus lolos jendela tepok dulu', () => {
    let s = rigged(2);
    s.hands = [['AS'], ['KD', '7C']];
    s = tepokNyamuk.apply(s, 0, act('flip'), r());
    expect(s.over).toBe(false);
    s = tepokNyamuk.advance(s, r()); // tidak ada yang menepuk → yang terdekat dari pembuka (seat 0) mengambil
    expect(s.hands[0]).toEqual(['AS']);
    expect(s.over).toBe(false);
  });
  it('batas kartu dibuka mengakhiri permainan', () => {
    let s = rigged();
    s.flips = s.options.maxFlips - 1;
    s = tepokNyamuk.apply(s, 0, act('flip'), r());
    expect(s.over).toBe(true);
    const res = tepokNyamuk.results(s)!;
    expect(res[0].rank).toBe(1);
    expect(res).toHaveLength(3);
  });
  it('view tidak membocorkan kartu tertutup siapa pun', () => {
    const s = rigged();
    expectNoLeak(tepokNyamuk, s, 0, s.hands);
  });
  for (const n of [2, 3, 4, 5, 6]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const { state } = fuzzGeneric(tepokNyamuk, { players: n, seed, check: (s: TepokNyamukState) => {
        expect(s.hands.flat().length + s.pile.length).toBe(52);
        if (!s.over) expect(s.window !== null || tepokNyamuk.currentSeat(s) !== null).toBe(true);
      } });
      expect(state.over).toBe(true);
    });
  }
});
