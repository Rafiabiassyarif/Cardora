import { describe, expect, it } from 'vitest';
import { baccarat, bankerDraws, playerDraws, baccaratTotal, cardPoint, payout, type BaccaratState } from '../src/games/baccarat';
import { seededRng, RuleError, type Card } from '../src';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(21);
const bet = (side: string, amount: number) => ({ type: 'act' as const, id: `bet:${side}`, amount });

// Tabel resmi Banker: baris = total Banker 0..7, kolom = kartu ke-3 Player 0..9. D = tarik, S = berhenti.
const TABLEAU: Record<number, string> = {
  0: 'DDDDDDDDDD', 1: 'DDDDDDDDDD', 2: 'DDDDDDDDDD',
  3: 'DDDDDDDDSD',
  4: 'SSDDDDDDSS',
  5: 'SSSSDDDDSS',
  6: 'SSSSSSDDSS',
  7: 'SSSSSSSSSS',
};

/** Jalankan satu ronde penuh dengan shoe yang diatur. */
function playRound(shoe: Card[], bets: [string, number][]): BaccaratState {
  let s = baccarat.setup(seats(bets.length), baccarat.sanitizeOptions({}), r());
  s.shoe = [...shoe, ...s.shoe];
  bets.forEach(([side, amt], i) => { s = baccarat.apply(s, i, bet(side, amt), r()); });
  for (let k = 0; k < 6 && s.phase !== 'result'; k++) s = baccarat.advance(s, r());
  return s;
}

describe('Baccarat — aturan kartu ke-3', () => {
  it('nilai kartu & total', () => {
    expect(['AS', '2H', '9D', 'TC', 'JD', 'QS', 'KH'].map(cardPoint)).toEqual([1, 2, 9, 0, 0, 0, 0]);
    expect(baccaratTotal(['7S', '8D'])).toBe(5);
    expect(baccaratTotal(['KS', '9D'])).toBe(9);
    expect(baccaratTotal(['5S', '5D', 'TC'])).toBe(0);
  });
  it('Player menarik pada 0–5, berhenti 6–7', () => {
    for (let t = 0; t <= 7; t++) expect(playerDraws(t)).toBe(t <= 5);
  });
  it('Banker bila Player berhenti: tarik 0–5, berhenti 6–7', () => {
    for (let t = 0; t <= 7; t++) expect(bankerDraws(t, null)).toBe(t <= 5);
  });
  it('tabel Banker lengkap (8 × 10) sesuai tableau standar', () => {
    for (let t = 0; t <= 7; t++) for (let x = 0; x <= 9; x++) {
      expect(bankerDraws(t, x), `banker ${t}, kartu ke-3 player ${x}`).toBe(TABLEAU[t][x] === 'D');
    }
  });
  it('natural menghentikan kedua pihak', () => {
    // Urutan bagi: P, B, P, B. Player 2+7=9 natural, Banker 2+1=3.
    const s = playRound(['2S', '2D', '7H', 'AC', '5S', '5D'], [['P', 100]]);
    expect(s.playerCards).toHaveLength(2);
    expect(s.bankerCards).toHaveLength(2);
    expect(s.chips[0]).toBe(1000 + 100);
  });
  it('natural Banker juga menghentikan Player meski Player 0–5', () => {
    const s = playRound(['2S', '4D', 'AH', '4C', '5S', '5D'], [['P', 100]]);
    expect(s.playerCards).toHaveLength(2);
    expect(s.bankerCards).toHaveLength(2);
    expect(s.chips[0]).toBe(900);
  });
  it('Player 5 menarik; Banker 3 berhenti bila kartu ke-3 Player = 8', () => {
    // P: 2,3 (5) · B: K,3 (3) · P tarik 8 → 3 · Banker berhenti → Seri 3–3.
    const s = playRound(['2S', 'KD', '3H', '3C', '8S', '9D'], [['B', 100], ['T', 10]]);
    expect(s.playerCards).toEqual(['2S', '3H', '8S']);
    expect(s.bankerCards).toEqual(['KD', '3C']);
    expect(s.chips[0]).toBe(1000); // push
    expect(s.chips[1]).toBe(1000 + 80);
  });
  it('Player 6 berhenti; Banker 5 menarik', () => {
    // P: 3,3 (6) · B: 2,3 (5) → banker tarik 4 → 9 → Banker menang.
    const s = playRound(['3S', '2D', '3H', '3C', '4S'], [['B', 100], ['P', 50]]);
    expect(s.playerCards).toHaveLength(2);
    expect(s.bankerCards).toEqual(['2D', '3C', '4S']);
    expect(s.chips[0]).toBe(1000 + 95);
    expect(s.chips[1]).toBe(950);
  });
  it('pembayaran: Banker 0,95 dibulatkan ke bawah, Seri 8:1, push saat seri', () => {
    expect(payout('B', 10, 'B').returned).toBe(19);
    expect(payout('B', 30, 'B').returned).toBe(58);
    expect(payout('P', 30, 'P').returned).toBe(60);
    expect(payout('T', 20, 'T').returned).toBe(180);
    expect(payout('P', 20, 'T').returned).toBe(20);
    expect(payout('B', 20, 'T').returned).toBe(20);
    expect(payout('T', 20, 'B').returned).toBe(0);
    expect(payout('P', 20, 'B').returned).toBe(0);
  });
});

describe('Baccarat — alur', () => {
  it('validasi taruhan: minimal, kelipatan, chip, giliran', () => {
    const s = baccarat.setup(seats(2), baccarat.sanitizeOptions({}), r());
    expect(() => baccarat.apply(s, 0, bet('P', 5), r())).toThrow(RuleError);
    expect(() => baccarat.apply(s, 0, bet('P', 15), r())).toThrow(RuleError);
    expect(() => baccarat.apply(s, 0, bet('P', 2000), r())).toThrow(RuleError);
    expect(() => baccarat.apply(s, 0, { type: 'act', id: 'bet:P' }, r())).toThrow(RuleError);
    expect(() => baccarat.apply(s, 0, bet('X', 10), r())).toThrow(RuleError);
    expect(() => baccarat.apply(s, 1, bet('P', 10), r())).toThrow(RuleError);
    const s2 = baccarat.apply(s, 0, bet('P', 10), r());
    expect(s2.turn).toBe(1);
    expect(s2.chips[0]).toBe(990);
  });
  it('pemain bangkrut dilewati dan permainan berakhir bila semua bangkrut', () => {
    let s = baccarat.setup(seats(2), baccarat.sanitizeOptions({}), r());
    s.chips = [10, 5]; s.out = [false, true];
    s.turn = 0;
    s.shoe = ['2S', '4D', 'AH', '4C', ...s.shoe]; // Banker natural 8
    s = baccarat.apply(s, 0, bet('P', 10), r());
    expect(s.phase).toBe('deal');
    while (s.phase !== 'result') s = baccarat.advance(s, r());
    expect(s.out[0]).toBe(true);
    expect(s.over).toBe(true);
  });
  it('berakhir setelah jumlah ronde; peringkat dari chip', () => {
    let s = baccarat.setup(seats(1), baccarat.sanitizeOptions({ rounds: 5 }), r());
    let guard = 0;
    while (!s.over && guard++ < 200) {
      if (baccarat.currentSeat(s) === 0) s = baccarat.apply(s, 0, baccarat.timeoutAction(s, 0), r());
      else s = baccarat.advance(s, r());
    }
    expect(s.round).toBe(5);
    expect(baccarat.results(s)).toEqual([{ seat: 0, rank: 1, score: s.chips[0] }]);
  });
  it('view tidak membocorkan urutan shoe', () => {
    const s = baccarat.setup(seats(2), baccarat.sanitizeOptions({}), r());
    const v = JSON.stringify(baccarat.view(s, 0));
    for (const c of s.shoe.slice(0, 10)) expect(v).not.toContain(`"${c}"`);
  });
  it('opsi disanitasi', () => {
    expect(baccarat.sanitizeOptions({ chips: 1e9, rounds: -3, round: 2 })).toEqual({ turnSeconds: 25, passAndPlay: false, chips: 1000, rounds: 10 });
  });
  for (const n of [1, 2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(baccarat, { players: n, seed, check: (s: BaccaratState) => {
        expect(s.shoe.length + s.used.length + s.playerCards.length + s.bankerCards.length).toBe(312);
        for (const c of s.chips) expect(c).toBeGreaterThanOrEqual(0);
      } });
    });
  }
});
