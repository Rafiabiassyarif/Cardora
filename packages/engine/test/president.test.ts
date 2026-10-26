import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { president, type PresidentState } from '../src/games/president';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(11);
const play = (cards: string[]) => ({ type: 'act' as const, id: 'play', cards });
const pass = { type: 'act' as const, id: 'pass' };

function rigged(): PresidentState {
  const s = president.setup(seats(3), president.sanitizeOptions({ deals: 2 }), r());
  s.hands = [['3C', '3D', '9H', 'KS'], ['4C', '4D', '2H', 'TS'], ['5C', '5S', 'AH']];
  s.turn = 0; s.trick = []; s.passed = [false, false, false]; s.lastPlayer = null; s.finished = []; s.phase = 'play';
  return s;
}

describe('President', () => {
  it('ronde 1 dibuka pemegang 3♣', () => {
    const s = president.setup(seats(4), president.sanitizeOptions({}), r());
    expect(s.hands[s.turn!]).toContain('3C');
    expect(s.hands.map(h => h.length)).toEqual([13, 13, 13, 13]);
  });
  it('wajib jumlah sama & angka lebih tinggi; 2 tertinggi', () => {
    let s = president.apply(rigged(), 0, play(['3C', '3D']), r());
    expect(() => president.apply(s, 1, play(['TS']), r())).toThrow(RuleError);
    expect(() => president.apply(s, 1, play(['4C', 'TS']), r())).toThrow(RuleError);
    s = president.apply(s, 1, play(['4C', '4D']), r());
    s = president.apply(s, 2, play(['5C', '5S']), r());
    expect(s.trick.at(-1)!.cards).toEqual(['5C', '5S']);
    // single 2 mengalahkan A
    let t = rigged(); t.turn = 2;
    t = president.apply(t, 2, play(['AH']), r());
    expect(() => president.apply(t, 0, play(['KS']), r())).toThrow(RuleError);
    t = president.apply(t, 0, pass, r());
    t = president.apply(t, 1, play(['2H']), r());
    expect(t.lastPlayer).toBe(1);
  });
  it('semua pass → meja bersih, pelempar terakhir membuka', () => {
    let s = president.apply(rigged(), 0, play(['KS']), r());
    s = president.apply(s, 1, pass, r());
    s = president.apply(s, 2, pass, r());
    expect(s.trick).toEqual([]);
    expect(s.turn).toBe(0);
  });
  it('akhir ronde memberi gelar & poin, lalu tukar kartu', () => {
    let s = rigged();
    s.hands = [['KS'], ['4C', '2H'], ['5C', '5S']];
    s = president.apply(s, 0, play(['KS']), r()); // P0 habis → Presiden
    expect(s.finished).toEqual([0]);
    s = president.apply(s, 1, play(['2H']), r());
    s = president.apply(s, 2, pass, r());
    expect(s.turn).toBe(1); // meja bersih, P1 buka
    s = president.apply(s, 1, play(['4C']), r()); // P1 habis → ronde selesai
    expect(s.phase).toBe('dealEnd');
    expect(s.points).toEqual([2, 1, 0]);
    expect(president.currentSeat(s)).toBeNull();
    expect(president.autoDelay(s)).not.toBeNull();
    s = president.advance(s, r());
    expect(s.phase).toBe('exchange');
    expect(s.turn).toBe(0);
    expect(s.hands[0]).toHaveLength(20);
    expect(s.hands[2]).toHaveLength(15);
    const give = s.hands[0].slice(0, 2);
    s = president.apply(s, 0, { type: 'act', id: 'give', cards: give }, r());
    expect(s.hands[2]).toEqual(expect.arrayContaining(give));
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(2); // Scum membuka
  });
  it('view tidak membocorkan kartu lawan', () => {
    const s = rigged();
    const v = JSON.stringify(president.view(s, 0));
    for (const c of [...s.hands[1], ...s.hands[2]]) expect(v).not.toContain(`"${c}"`);
  });
  for (const n of [3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const { state } = fuzzGeneric(president, { players: n, seed, check: (s: PresidentState) => {
        if (s.phase !== 'dealEnd') expect(s.hands.flat().length + s.trick.flat().length).toBeLessThanOrEqual(52);
        expect(new Set(s.hands.flat()).size).toBe(s.hands.flat().length);
      } });
      expect(state.deal).toBe(3);
    });
  }
});
