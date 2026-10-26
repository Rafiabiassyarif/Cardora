import { describe, expect, it } from 'vitest';
import { rummy, type RummyState } from '../src/games/rummy';
import { seededRng, RuleError, type Card } from '../src';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(11);
const act = (id: string, cards?: Card[]) => ({ type: 'act' as const, id, cards });

function rigged(n = 3): RummyState {
  const s = rummy.setup(seats(n), rummy.sanitizeOptions({}), r());
  s.dealer = n - 1;
  s.hands = [
    ['5H', '6H', '7H', 'QS', 'QD', 'QC', '2D'],
    ['AS', '2S', '9C', 'KD', 'KH', '4C', '8D'],
    ['3C', '3D', 'JH', 'TC', '9S', '6D', '5S'],
  ].slice(0, n);
  s.discard = ['4H'];
  s.stock = ['8H', 'AC', 'TS', 'TD', '2C', 'JD'];
  s.melds = [];
  s.phase = 'draw'; s.turn = 0; s.takenDiscard = null;
  return s;
}

describe('Classic Rummy', () => {
  it('membagi 10 kartu untuk 2 pemain, 7 untuk 3–4 pemain', () => {
    expect(rummy.setup(seats(2), rummy.sanitizeOptions({}), r()).hands[0]).toHaveLength(10);
    expect(rummy.setup(seats(3), rummy.sanitizeOptions({}), r()).hands[2]).toHaveLength(7);
    expect(rummy.setup(seats(4), rummy.sanitizeOptions({}), r()).hands[3]).toHaveLength(7);
  });
  it('wajib mengambil dulu sebelum menurunkan/membuang', () => {
    const s = rigged();
    expect(() => rummy.apply(s, 0, act('drop', ['2D']), r())).toThrow(RuleError);
    expect(() => rummy.apply(s, 0, act('meld', ['QS', 'QD', 'QC']), r())).toThrow(RuleError);
    expect(() => rummy.apply(s, 1, act('stock'), r())).toThrow(RuleError);
  });
  it('menurunkan set & run, menolak meld tidak sah', () => {
    let s = rummy.apply(rigged(), 0, act('pickup'), r());
    expect(s.takenDiscard).toBe('4H');
    expect(() => rummy.apply(s, 0, act('meld', ['QS', 'QD', '2D']), r())).toThrow(RuleError);
    s = rummy.apply(s, 0, act('meld', ['QS', 'QD', 'QC']), r());
    s = rummy.apply(s, 0, act('meld', ['4H', '5H', '6H', '7H']), r());
    expect(s.melds.map(m => m.cards)).toEqual([['QS', 'QD', 'QC'].sort((a, b) => 'SHDC'.indexOf(a[1]) - 'SHDC'.indexOf(b[1])), ['4H', '5H', '6H', '7H']]);
    expect(s.hands[0]).toEqual(['2D']);
    const v = rummy.view(s, 1);
    expect(v.players[0].melds).toHaveLength(2);
    // Satu kartu tersisa → buang → keluar.
    s = rummy.apply(s, 0, act('drop', ['2D']), r());
    expect(s.phase).toBe('show');
    // Lawan membayar nilai kartu: P1 = 1+2+9+10+10+4+8, P2 = 3+3+10+10+9+6+5
    expect(s.scores[0]).toBe(44 + 46);
  });
  it('tidak boleh membuang kartu yang baru diambil dari buangan', () => {
    const s = rummy.apply(rigged(), 0, act('pickup'), r());
    expect(() => rummy.apply(s, 0, act('drop', ['4H']), r())).toThrow(RuleError);
    const s2 = rummy.apply(s, 0, act('drop', ['2D']), r());
    expect(s2.turn).toBe(1);
    expect(s2.phase).toBe('draw');
  });
  it('As tinggi dan rendah sah, tapi tidak memutar', () => {
    const s = rigged(); s.phase = 'play';
    s.hands[0] = ['QS', 'KS', 'AS', 'AH', '2H', '3H', 'KD', 'AD', '2C', '9C'];
    let s2 = rummy.apply(s, 0, act('meld', ['QS', 'KS', 'AS']), r());
    s2 = rummy.apply(s2, 0, act('meld', ['AH', '2H', '3H']), r());
    expect(() => rummy.apply(s2, 0, act('meld', ['KD', 'AD', '2C']), r())).toThrow(RuleError);
    expect(s2.melds).toHaveLength(2);
  });
  it('menempel kartu ke meld lawan (deteksi otomatis)', () => {
    const s = rigged(); s.phase = 'play'; s.turn = 1;
    s.melds = [{ owner: 0, cards: ['5H', '6H', '7H'] }, { owner: 2, cards: ['KS', 'KC', 'KD'] }];
    s.hands[1] = ['8H', 'KH', '2C', '9C'];
    expect(() => rummy.apply(s, 1, act('layoff', ['2C']), r())).toThrow(RuleError);
    let s2 = rummy.apply(s, 1, act('layoff', ['8H']), r());
    expect(s2.melds[0].cards).toEqual(['5H', '6H', '7H', '8H']);
    s2 = rummy.apply(s2, 1, act('layoff', ['KH']), r());
    expect(s2.melds[1].cards).toHaveLength(4);
    expect(s2.melds[1].owner).toBe(2);
  });
  it('keluar dengan menempel kartu terakhir (tanpa buang)', () => {
    const s = rigged(); s.phase = 'play'; s.turn = 1;
    s.melds = [{ owner: 0, cards: ['5H', '6H', '7H'] }];
    s.hands[1] = ['8H'];
    const s2 = rummy.apply(s, 1, act('layoff', ['8H']), r());
    expect(s2.phase).toBe('show');
    expect(s2.scores[1]).toBeGreaterThan(0);
  });
  it('stok habis → buangan dikocok (kartu teratas tetap)', () => {
    const s = rigged();
    s.stock = []; s.discard = ['2C', '3S', '9H', 'JD'];
    const s2 = rummy.apply(s, 0, act('stock'), r());
    expect(s2.discard).toEqual(['JD']);
    expect(s2.stock).toHaveLength(2);
    expect(s2.hands[0]).toHaveLength(8);
  });
  it('deal buntu (kocok ulang berlebihan): nilai tangan terkecil mendapat selisih', () => {
    const s = rigged();
    s.reshuffles = 5; s.stock = []; s.discard = ['2C', '3S', '9H', 'JD'];
    s.hands = [['AS', '2D'], ['KD', 'KH'], ['5C', '5S']];
    const s2 = rummy.apply(s, 0, act('stock'), r());
    expect(s2.phase).toBe('show');
    // P0 kini memegang 3 kartu acak dari stok baru; hitung ulang secara independen.
    const v = [s2.hands[0], s2.hands[1], s2.hands[2]].map(h => h.reduce((t, c) => t + (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0])), 0));
    const low = Math.min(...v);
    const w = v.indexOf(low);
    expect(s2.scores[w]).toBe(v.reduce((t, x) => t + x - low, 0));
  });
  it('permainan berakhir setelah jumlah deal; peringkat berdasarkan poin', () => {
    let s = rigged(); s.options.deals = 1; s.phase = 'play';
    s.hands[0] = ['2D'];
    s = rummy.apply(s, 0, act('drop', ['2D']), r());
    expect(s.over).toBe(true);
    expect(rummy.results(s)![0]).toMatchObject({ seat: 0, rank: 1 });
  });
  it('view tidak membocorkan kartu lawan atau stok', () => {
    const s = rigged();
    expectNoLeak(rummy, s, 0, [s.hands[1], s.hands[2], s.stock]);
  });
  it('opsi disanitasi', () => {
    expect(rummy.sanitizeOptions({ deals: 77, targetRounds: 3 })).toEqual({ turnSeconds: 25, passAndPlay: false, deals: 3 });
    expect(rummy.sanitizeOptions({ deals: '5' }).deals).toBe(5);
  });
  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(rummy, { players: n, seed, check: (s: RummyState) => {
        const all = [...s.hands.flat(), ...s.melds.flatMap(m => m.cards), ...s.stock, ...s.discard];
        expect(all.length).toBe(52);
        expect(new Set(all).size).toBe(52);
      } });
    });
  }
});
