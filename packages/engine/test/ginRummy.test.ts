import { describe, expect, it } from 'vitest';
import { ginRummy, type GinRummyState } from '../src/games/ginRummy';
import { solveMelds, solveWithLayoffs, isValidMeld, handValue } from '../src/games/rummyCore';
import { seededRng, RuleError, shuffledDeck, type Card } from '../src';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(7);
const act = (id: string, cards?: Card[]) => ({ type: 'act' as const, id, cards });

/** Brute force independen: semua subset valid sebagai meld, lalu kombinasi disjoint. */
function bruteDeadwood(hand: Card[], aceHigh = false): number {
  const n = hand.length;
  const melds: number[] = [];
  for (let m = 1; m < (1 << n); m++) {
    const cs = hand.filter((_, i) => m & (1 << i));
    if (cs.length >= 3 && isValidMeld(cs, aceHigh)) melds.push(m);
  }
  const vals = hand.map(c => handValue([c]));
  let best = Infinity;
  const rec = (k: number, used: number) => {
    if (k === melds.length) {
      let dw = 0;
      for (let i = 0; i < n; i++) if (!(used & (1 << i))) dw += vals[i];
      best = Math.min(best, dw);
      return;
    }
    rec(k + 1, used);
    if (!(melds[k] & used)) rec(k + 1, used | melds[k]);
  };
  rec(0, 0);
  return best;
}

function rigged(): GinRummyState {
  const s = ginRummy.setup(seats(2), ginRummy.sanitizeOptions({}), r());
  s.dealer = 1;
  s.hands = [
    ['AS', '2S', '3S', '7H', '7D', '7C', 'KC', 'KD', 'KH', '9S'],
    ['2C', '3C', '4C', '5D', '6D', '8S', 'TS', 'JH', 'QD', '4H'],
  ];
  s.discard = ['9H'];
  s.stock = ['5S', 'QH', '6C', 'TD', 'TC', 'JC'];
  s.phase = 'discard'; s.turn = 0; s.upcardPasses = 0; s.stockOnly = false; s.takenDiscard = null;
  return s;
}

describe('Gin Rummy — solver meld', () => {
  it('memilih susunan terbaik ketika kartu tumpang tindih', () => {
    expect(solveMelds(['4S', '5S', '6S', '6H', '6D', '7S']).deadwood).toBe(12);
    expect(solveMelds(['AS', '2S', '3S', '3H', '3D', 'KC', 'KD', 'KH', '7C', '8C']).deadwood).toBe(18);
    expect(solveMelds(['3S', '4S', '5S', '5H', '5D', '5C', '6S', '7S', 'KD', 'KS']).deadwood).toBe(20);
    expect(solveMelds(['AS', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'TS']).deadwood).toBe(0);
  });
  it('As hanya rendah di Gin Rummy', () => {
    expect(isValidMeld(['QS', 'KS', 'AS'], false)).toBe(false);
    expect(isValidMeld(['AS', '2S', '3S'], false)).toBe(true);
    expect(isValidMeld(['KS', 'AS', '2S'], true)).toBe(false);
    expect(solveMelds(['QS', 'KS', 'AS']).deadwood).toBe(21);
    expect(solveMelds(['QS', 'KS', 'AS'], true).deadwood).toBe(0);
  });
  it('set 4 kartu dan set 3 dari 4 kartu', () => {
    // 5 empat kartu; 5S juga bisa jadi run 3-4-5S. Terbaik: run 3S4S5S + set 5H5D5C.
    expect(solveMelds(['3S', '4S', '5S', '5H', '5D', '5C']).deadwood).toBe(0);
    expect(solveMelds(['5S', '5H', '5D', '5C', '9D']).deadwood).toBe(9);
  });
  it('cocok dengan brute force pada 300 tangan acak (10 & 11 kartu)', () => {
    const rng = seededRng(99);
    for (let t = 0; t < 300; t++) {
      const hand = shuffledDeck(rng).slice(0, t % 2 ? 10 : 11);
      const sol = solveMelds(hand);
      expect(sol.deadwood).toBe(bruteDeadwood(hand));
      // Konsistensi susunan.
      for (const m of sol.melds) expect(isValidMeld(m)).toBe(true);
      expect(handValue(sol.dead)).toBe(sol.deadwood);
      expect([...sol.melds.flat(), ...sol.dead].sort()).toEqual(hand.slice().sort());
    }
  });
  it('cocok dengan brute force untuk tangan bertumpuk (banyak meld)', () => {
    const rng = seededRng(3);
    const pool: Card[] = ['AS', '2S', '3S', '4S', '5S', '6S', 'AH', '2H', '3H', '4H', '5H', 'AD', '2D', '3D', '4D', 'AC', '2C', '3C'];
    for (let t = 0; t < 120; t++) {
      const hand = pool.slice().sort(() => rng.float() - 0.5).slice(0, 10);
      expect(solveMelds(hand).deadwood).toBe(bruteDeadwood(hand));
      expect(solveMelds(hand, true).deadwood).toBe(bruteDeadwood(hand, true));
    }
  });
  it('tempel (lay off) ke meld pengetuk, termasuk berantai', () => {
    const sol = solveWithLayoffs(['6H', '5H', 'TH', 'KH', '2C', 'QD'], [['7H', '8H', '9H'], ['KS', 'KD', 'KC']]);
    // 6H,5H (berantai), TH, KH ditempel → sisa 2C + QD = 12.
    expect(sol.deadwood).toBe(12);
    expect(sol.laidOff.sort()).toEqual(['5H', '6H', 'KH', 'TH']);
  });
  it('lebih baik membentuk meld sendiri daripada menempel bila lebih untung', () => {
    // 6H bisa ditempel, tapi 6H6S6D sudah set sendiri — hasil sama 0 deadwood.
    const sol = solveWithLayoffs(['6H', '6S', '6D', '4C'], [['7H', '8H', '9H']]);
    expect(sol.deadwood).toBe(4);
  });
});

describe('Gin Rummy — aturan', () => {
  it('giliran pertama: non-dealer → dealer → non-dealer wajib ambil stok', () => {
    let s = ginRummy.setup(seats(2), ginRummy.sanitizeOptions({}), r());
    const nd = 1 - s.dealer;
    expect(s.turn).toBe(nd);
    expect(s.phase).toBe('upcard');
    expect(() => ginRummy.apply(s, nd, act('stock'), r())).toThrow(RuleError);
    s = ginRummy.apply(s, nd, act('pass'), r());
    expect(s.turn).toBe(s.dealer);
    s = ginRummy.apply(s, s.dealer, act('pass'), r());
    expect(s.turn).toBe(nd);
    expect(() => ginRummy.apply(s, nd, act('pickup'), r())).toThrow(RuleError);
    const top = s.stock[0];
    s = ginRummy.apply(s, nd, act('stock'), r());
    expect(s.hands[nd]).toContain(top);
    expect(s.hands[nd]).toHaveLength(11);
  });
  it('mengambil kartu buka lalu tidak boleh membuangnya', () => {
    let s = ginRummy.setup(seats(2), ginRummy.sanitizeOptions({}), r());
    const nd = 1 - s.dealer;
    const up = s.discard[0];
    s = ginRummy.apply(s, nd, act('take'), r());
    expect(s.phase).toBe('discard');
    expect(() => ginRummy.apply(s, nd, act('drop', [up]), r())).toThrow(RuleError);
    const other = s.hands[nd].find(c => c !== up)!;
    s = ginRummy.apply(s, nd, act('drop', [other]), r());
    expect(s.turn).toBe(s.dealer);
    expect(s.phase).toBe('draw');
  });
  it('knock ditolak bila deadwood > 10', () => {
    const s = rigged();
    s.hands[0] = ['AS', '2S', '3S', '7H', '7D', 'QC', 'KC', 'KD', 'KH', '9S', '8D'];
    expect(() => ginRummy.apply(s, 0, act('knock', ['9S']), r())).toThrow(RuleError);
  });
  it('knock biasa: selisih deadwood + tempel otomatis', () => {
    const s = rigged();
    // P0: A23♠ 777 KKK + 9S + 2H → buang 9S, deadwood 2.
    s.hands[0] = ['AS', '2S', '3S', '7H', '7D', '7C', 'KC', 'KD', 'KH', '9S', '2H'];
    // P1: 4S (tempel ke A23♠), 7S (tempel ke 777), KS (tempel), 2C3C4C run, sisanya deadwood.
    s.hands[1] = ['4S', '7S', 'KS', '2C', '3C', '4C', 'JH', 'QD', '5D', '9D'];
    const s2 = ginRummy.apply(s, 0, act('knock', ['9S']), r());
    expect(s2.last!.knockerDeadwood).toBe(2);
    expect(s2.last!.laidOff.sort()).toEqual(['4S', '7S', 'KS']);
    expect(s2.last!.defenderDeadwood).toBe(10 + 10 + 5 + 9);
    expect(s2.last!.winner).toBe(0);
    expect(s2.scores[0]).toBe(34 - 2);
    expect(s2.phase).toBe('show');
    expect(ginRummy.currentSeat(s2)).toBeNull();
    expect(ginRummy.autoDelay(s2)).toBeGreaterThan(0);
    // Melds pengetuk terlihat publik di view lawan.
    const v = ginRummy.view(s2, 1);
    expect(v.players[0].melds!.flat().sort()).toEqual(['2S', '3S', '7C', '7D', '7H', 'AS', 'KC', 'KD', 'KH'].sort());
    // Deal berikutnya.
    const s3 = ginRummy.advance(s2, r());
    expect(s3.phase).toBe('upcard');
    expect(s3.dealNo).toBe(s2.dealNo + 1);
    expect(s3.hands[0]).toHaveLength(10);
  });
  it('undercut: bertahan ≤ pengetuk mendapat selisih + 25', () => {
    const s = rigged();
    s.hands[0] = ['AS', '2S', '3S', '7H', '7D', '7C', 'KC', 'KD', 'KH', '9S', '8C']; // buang 9S → deadwood 8
    s.hands[1] = ['4H', '5H', '6H', 'TS', 'JS', 'QS', '9D', '9C', '9H', '5C']; // deadwood 5
    const s2 = ginRummy.apply(s, 0, act('knock', ['9S']), r());
    expect(s2.last!.undercut).toBe(true);
    expect(s2.last!.winner).toBe(1);
    expect(s2.scores[1]).toBe(8 - 5 + 25);
  });
  it('gin: bonus 25 dan lawan tidak boleh menempel', () => {
    const s = rigged();
    s.hands[0] = ['AS', '2S', '3S', '7H', '7D', '7C', 'KC', 'KD', 'KH', '4S', 'QH'];
    s.hands[1] = ['5S', '7S', 'KS', '2C', '3C', '4C', 'JH', 'QD', '5D', '9D'];
    const v = ginRummy.view(s, 0);
    expect(v.actions.find(a => a.id === 'knock')!.label).toBe('Gin!');
    const s2 = ginRummy.apply(s, 0, act('knock', ['QH']), r());
    expect(s2.last!.gin).toBe(true);
    expect(s2.last!.laidOff).toEqual([]);
    expect(s2.last!.defenderDeadwood).toBe(5 + 7 + 10 + 10 + 10 + 5 + 9);
    expect(s2.scores[0]).toBe(56 + 25);
    expect(s2.over).toBe(true); // ≥ 50
    expect(ginRummy.results(s2)![0]).toMatchObject({ seat: 0, rank: 1 });
  });
  it('stok tinggal 2 kartu → deal batal tanpa skor, dealer sama', () => {
    const s = rigged();
    s.stock = ['5S', 'QH'];
    s.hands[0] = ['AS', '2S', '4S', '7H', '9D', 'QC', 'KC', 'JD', 'KH', '9S', '8D'];
    const s2 = ginRummy.apply(s, 0, act('drop', ['KC']), r());
    expect(s2.last!.void).toBe(true);
    expect(s2.scores).toEqual([0, 0]);
    const s3 = ginRummy.advance(s2, r());
    expect(s3.dealer).toBe(s.dealer);
  });
  it('view tidak membocorkan kartu lawan atau stok', () => {
    const s = rigged();
    expectNoLeak(ginRummy, s, 0, [s.hands[1], s.stock]);
    expectNoLeak(ginRummy, s, 1, [s.hands[0], s.stock]);
  });
  it('opsi disanitasi (kunci asing diabaikan)', () => {
    expect(ginRummy.sanitizeOptions({ target: 999, round: 3, foo: 'x' })).toEqual({ turnSeconds: 25, passAndPlay: false, target: 50 });
    expect(ginRummy.sanitizeOptions({ target: '100', turnSeconds: 0 }).target).toBe(100);
  });
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`fuzz 2 pemain seed ${seed}`, () => {
      fuzzGeneric(ginRummy, { players: 2, seed, options: { target: seed % 2 ? 50 : 100 }, check: (s: GinRummyState) => {
        const all = [...s.hands.flat(), ...s.stock, ...s.discard];
        expect(all.length).toBe(52);
        expect(new Set(all).size).toBe(52);
      } });
    });
  }
});
