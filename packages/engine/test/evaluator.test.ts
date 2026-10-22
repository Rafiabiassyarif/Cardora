import { describe, expect, it } from 'vitest';
import {
  bestHand, bestOmahaHand, compareScores, evaluate5, HandCategory,
  buildPots, splitPot, standardDeck, shuffle, seededRng, cryptoRng,
} from '../src';

const cat = (cards: string) => bestHand(cards.split(' ')).category;
const cmp = (a: string, b: string) => compareScores(bestHand(a.split(' ')).score, bestHand(b.split(' ')).score);

describe('deck & shuffle', () => {
  it('52 kartu unik, tanpa joker', () => {
    const d = standardDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });
  it('shuffle adalah permutasi', () => {
    const d = shuffle(standardDeck(), cryptoRng());
    expect(d.slice().sort()).toEqual(standardDeck().sort());
  });
  it('seeded shuffle deterministik', () => {
    expect(shuffle(standardDeck(), seededRng(7))).toEqual(shuffle(standardDeck(), seededRng(7)));
  });
  it('cryptoRng.int seragam kasar & dalam batas', () => {
    const r = cryptoRng(); const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[r.int(3)]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });
});

describe('kategori tangan', () => {
  it.each([
    ['AS KS QS JS TS 2D 3C', HandCategory.RoyalFlush],
    ['9H 8H 7H 6H 5H AD KC', HandCategory.StraightFlush],
    ['5D 4D 3D 2D AD KS KC', HandCategory.StraightFlush], // steel wheel
    ['QS QH QD QC 2S 3H 4D', HandCategory.FourOfAKind],
    ['KS KH KD 2C 2S 3H 4D', HandCategory.FullHouse],
    ['AH JH 8H 4H 2H KS QD', HandCategory.Flush],
    ['TS 9H 8D 7C 6S 2H 2D', HandCategory.Straight],
    ['AS 2H 3D 4C 5S 9H KD', HandCategory.Straight], // wheel
    ['7S 7H 7D KC 2S 4H 9D', HandCategory.ThreeOfAKind],
    ['JS JH 4D 4C 2S 9H KD', HandCategory.TwoPair],
    ['TS TH 4D 7C 2S 9H KD', HandCategory.OnePair],
    ['AS JH 8D 6C 2S 4H 9D', HandCategory.HighCard],
  ])('%s', (cards, expected) => expect(cat(cards)).toBe(expected));
});

describe('perbandingan & kicker', () => {
  it('urutan kategori', () => {
    expect(cmp('AS KS QS JS TS 2D 3C', '9H 8H 7H 6H 5H AD KC')).toBe(1);
    expect(cmp('QS QH QD QC 2S 3H 4D', 'KS KH KD 2C 2S 3H 4D')).toBe(1);
  });
  it('wheel kalah dari 6-high straight', () => {
    expect(cmp('AS 2H 3D 4C 5S 9H KD', '2S 3H 4D 5C 6S 9H KD')).toBe(-1);
  });
  it('wheel high card = 5, bukan As', () => {
    expect(evaluate5('AS 2H 3D 4C 5S'.split(' ')).score).toEqual([HandCategory.Straight, 5]);
  });
  it('kicker one pair', () => {
    expect(cmp('AS AH KD 7C 4S 3H 2D', 'AD AC QD 7S 4H 3C 2S')).toBe(1);
  });
  it('kicker kedua two pair', () => {
    expect(cmp('KS KH 9D 9C AS 2H 3D', 'KD KC 9S 9H QS 2C 3H')).toBe(1);
  });
  it('flush dibandingkan kartu demi kartu', () => {
    expect(cmp('AH KH 8H 4H 2H', 'AS KS 8S 4S 3S')).toBe(-1);
  });
  it('full house: trips dulu, baru pair', () => {
    expect(cmp('3S 3H 3D AC AS', '2S 2H 2D KC KS')).toBe(1);
    expect(cmp('3S 3H 3D AC AS', '3C 3H 3D KC KS')).toBe(1);
  });
  it('suit TIDAK memecah seri', () => {
    expect(cmp('AS KH QD JC 9S', 'AH KS QC JD 9H')).toBe(0);
  });
  it('board bermain → seri', () => {
    const board = 'AS KS QS JS TS'.split(' ');
    expect(compareScores(bestHand(['2H', '3D', ...board]).score, bestHand(['4C', '5C', ...board]).score)).toBe(0);
  });
  it('kicker keenam/ketujuh tidak dihitung (hanya 5 kartu)', () => {
    // Board AAKKQ; hole 2/3 vs 4/5 → keduanya AAKKQ → seri.
    expect(cmp('AS AH KD KC QS 2H 3D', 'AS AH KD KC QS 4H 5D')).toBe(0);
  });
  it('bestHand memilih straight lebih tinggi', () => {
    expect(bestHand('9S 8H 7D 6C 5S 4H TD'.split(' ')).score).toEqual([HandCategory.Straight, 10]);
  });
  it('Omaha wajib pakai tepat 2 kartu tangan', () => {
    // Board flush 4 hati, tangan cuma 1 hati → bukan flush di Omaha.
    const v = bestOmahaHand(['AH', 'KS', 'QD', 'JC'], ['2H', '5H', '8H', '9H', 'TC']);
    expect(v.category).not.toBe(HandCategory.Flush);
  });
});

describe('pot', () => {
  it('main pot + side pot dengan tiga stack berbeda', () => {
    // A all-in 100, B all-in 300, C 300.
    const r = buildPots([100, 300, 300], [false, false, false]);
    expect(r.pots).toEqual([{ amount: 300, eligible: [0, 1, 2] }, { amount: 400, eligible: [1, 2] }]);
    expect(r.refunds).toEqual([]);
  });
  it('taruhan tidak di-call dikembalikan', () => {
    const r = buildPots([500, 200], [false, false]);
    expect(r.pots).toEqual([{ amount: 400, eligible: [0, 1] }]);
    expect(r.refunds).toEqual([{ seat: 0, amount: 300 }]);
  });
  it('chip pemain fold tetap di pot tapi tidak berhak', () => {
    const r = buildPots([50, 200, 200], [true, false, false]);
    expect(r.pots).toEqual([{ amount: 450, eligible: [1, 2] }]);
  });
  it('total chip terjaga', () => {
    const contrib = [37, 400, 120, 400, 5];
    const r = buildPots(contrib, [false, false, true, false, true]);
    const sum = r.pots.reduce((t, p) => t + p.amount, 0) + r.refunds.reduce((t, x) => t + x.amount, 0);
    expect(sum).toBe(contrib.reduce((a, b) => a + b, 0));
  });
  it('split pot: odd chip ke pemenang pertama kiri button', () => {
    const m = splitPot(101, [0, 2], 0, 3);
    expect(m.get(2)).toBe(51); // urutan dari kiri button(0): 1, 2, 0 → seat 2 duluan
    expect(m.get(0)).toBe(50);
    const m2 = splitPot(101, [1, 2], 0, 3);
    expect(m2.get(1)).toBe(51);
    expect(m2.get(2)).toBe(50);
  });
});
