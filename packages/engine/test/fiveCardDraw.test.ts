import { describe, expect, it } from 'vitest';
import { seededRng, RuleError, standardDeck } from '../src';
import { fiveCardDraw, chooseDiscards, type FiveCardDrawState } from '../src/games/fiveCardDraw';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(7);
const act = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'act' as const, id, ...extra });

/** 3 pemain, dealer 0, giliran seat 1, ante 10 sudah dibayar (stack 990). */
function rigged(n = 3, opts: Record<string, unknown> = {}): FiveCardDrawState {
  const s = fiveCardDraw.setup(seats(n), fiveCardDraw.sanitizeOptions(opts), r());
  s.dealer = 0;
  s.round.toAct = 1 % n;
  const hands = [
    ['AS', 'AD', '7C', '4H', '2S'],
    ['KS', 'KD', 'QC', 'QH', '3S'],
    ['9S', '9D', '8C', '6H', '5S'],
    ['TS', 'TD', '2C', '3H', '4S'],
  ];
  const used = new Set(hands.slice(0, n).flat());
  s.seats.forEach((x, i) => { x.hand = hands[i].slice(); });
  s.deck = standardDeck().filter(c => !used.has(c));
  s.muck = [];
  return s;
}
const ids = (s: FiveCardDrawState, seat: number) => fiveCardDraw.view(s, seat).actions.map(a => a.id);

describe('Five Card Draw — taruhan', () => {
  it('bet minimum 2× ante dan raise minimum = besar raise sebelumnya', () => {
    let s = rigged();
    const bet = fiveCardDraw.view(s, 1).actions.find(a => a.id === 'bet')!;
    expect(bet.amount!.min).toBe(20);
    expect(() => fiveCardDraw.apply(s, 1, act('bet', { amount: 19 }), r())).toThrow(RuleError);
    s = fiveCardDraw.apply(s, 1, act('bet', { amount: 50 }), r());
    const raise = fiveCardDraw.view(s, 2).actions.find(a => a.id === 'raise')!;
    expect(raise.amount!.min).toBe(100);
    expect(() => fiveCardDraw.apply(s, 2, act('raise', { amount: 99 }), r())).toThrow(RuleError);
    s = fiveCardDraw.apply(s, 2, act('raise', { amount: 160 }), r());
    expect(fiveCardDraw.view(s, 0).actions.find(a => a.id === 'raise')!.amount!.min).toBe(270);
    expect(() => fiveCardDraw.apply(s, 1, act('fold'), r())).toThrow(RuleError); // bukan giliran
  });

  it('all-in incomplete raise tidak membuka ulang aksi', () => {
    let s = rigged();
    s.seats[2].stack = 140; // maks total 140
    s = fiveCardDraw.apply(s, 1, act('bet', { amount: 100 }), r());
    s = fiveCardDraw.apply(s, 2, act('allin'), r()); // ke 140: increment 40 < 100
    expect(s.round.currentBet).toBe(140);
    s = fiveCardDraw.apply(s, 0, act('call'), r());
    expect(s.round.toAct).toBe(1);
    expect(ids(s, 1).sort()).toEqual(['call', 'fold']);
    s = fiveCardDraw.apply(s, 1, act('call'), r());
    expect(s.phase).toBe('draw');
  });

  it('raise penuh membuka ulang aksi', () => {
    let s = rigged();
    s = fiveCardDraw.apply(s, 1, act('bet', { amount: 40 }), r());
    s = fiveCardDraw.apply(s, 2, act('raise', { amount: 80 }), r());
    s = fiveCardDraw.apply(s, 0, act('call'), r());
    expect(ids(s, 1)).toContain('raise');
  });

  it('taruhan tidak di-call dikembalikan & side pot benar', () => {
    let s = rigged(2);
    s.seats[0].stack = 290; // kontribusi 10 + 290
    [s.seats[0].hand, s.seats[1].hand] = [s.seats[1].hand, s.seats[0].hand]; // seat 0: KKQQ, seat 1: AA
    s.round.toAct = 1;
    s = fiveCardDraw.apply(s, 1, act('allin'), r());
    expect(s.seats[1].allIn).toBe(true);
    // Lawan all-in: seat 0 hanya bisa call/fold (tidak bisa raise).
    expect(ids(s, 0).sort()).toEqual(['call', 'fold']);
    s = fiveCardDraw.apply(s, 0, act('call'), r());
    expect(s.seats[0].allIn).toBe(true);
    // Tidak ada aksi taruhan lagi; fase tukar tetap berjalan (seat 1 dulu, kiri dealer).
    expect(s.phase).toBe('draw');
    expect(s.round.toAct).toBe(1);
    s = fiveCardDraw.apply(s, 1, act('pat'), r());
    s = fiveCardDraw.apply(s, 0, act('pat'), r());
    // KKQQ (seat 0) menang pot 600; seat 1 menerima kembali 700 yang tidak di-call.
    expect(s.phase).toBe('handOver');
    expect(s.seats[0].stack).toBe(600);
    expect(s.seats[1].stack).toBe(700);
    expect(fiveCardDraw.view(s, 1).players[0].faceUp).toEqual(['KS', 'KD', 'QC', 'QH', '3S']);
  });

  it('semua lawan fold → menang tanpa showdown, kartu tetap tertutup', () => {
    let s = rigged();
    s = fiveCardDraw.apply(s, 1, act('bet', { amount: 20 }), r());
    s = fiveCardDraw.apply(s, 2, act('fold'), r());
    s = fiveCardDraw.apply(s, 0, act('fold'), r());
    expect(s.phase).toBe('handOver');
    expect(s.seats[1].stack).toBe(1020); // 990 + pot ante 30 (bet 20 dikembalikan)
    expect(s.seats.reduce((t, x) => t + x.stack, 0)).toBe(3000);
    expect(fiveCardDraw.view(s, 0).players[1].faceUp).toBeUndefined();
  });

  it('pot-limit membatasi raise maksimum', () => {
    let s = rigged(3, { structure: 'pl' });
    // Pot = 30 (ante): bet maks 30.
    expect(fiveCardDraw.view(s, 1).actions.find(a => a.id === 'bet')!.amount!.max).toBe(30);
    expect(ids(s, 1)).not.toContain('allin');
    s = fiveCardDraw.apply(s, 1, act('bet', { amount: 30 }), r());
    // Raise maks = 30 + (60 + 30) = 120.
    expect(fiveCardDraw.view(s, 2).actions.find(a => a.id === 'raise')!.amount!.max).toBe(120);
    expect(() => fiveCardDraw.apply(s, 2, act('raise', { amount: 121 }), r())).toThrow(RuleError);
  });
});

describe('Five Card Draw — tukar kartu & showdown', () => {
  function toDraw(): FiveCardDrawState {
    let s = rigged();
    s = fiveCardDraw.apply(s, 1, act('check'), r());
    s = fiveCardDraw.apply(s, 2, act('check'), r());
    s = fiveCardDraw.apply(s, 0, act('check'), r());
    expect(s.phase).toBe('draw');
    expect(s.round.toAct).toBe(1);
    return s;
  }
  it('maksimal 3 kartu, 4 hanya bila menyimpan As', () => {
    let s = toDraw();
    expect(fiveCardDraw.view(s, 1).actions.find(a => a.id === 'draw')!.cards!.max).toBe(3);
    expect(() => fiveCardDraw.apply(s, 1, act('draw', { cards: ['KS', 'KD', 'QC', 'QH'] }), r())).toThrow(RuleError);
    s = fiveCardDraw.apply(s, 1, act('draw', { cards: ['3S'] }), r());
    expect(s.seats[1].hand).toHaveLength(5);
    expect(s.seats[1].hand).not.toContain('3S');
    expect(s.muck).toEqual(['3S']);
    s = fiveCardDraw.apply(s, 2, act('pat'), r());
    // Seat 0 punya As: boleh 4 kartu asal As disimpan.
    expect(fiveCardDraw.view(s, 0).actions.find(a => a.id === 'draw')!.cards!.max).toBe(4);
    expect(() => fiveCardDraw.apply(s, 0, act('draw', { cards: ['AS', 'AD', '7C', '4H'] }), r())).toThrow(/As/);
    s = fiveCardDraw.apply(s, 0, act('draw', { cards: ['AD', '7C', '4H', '2S'] }), r());
    expect(s.seats[0].hand).toContain('AS');
    expect(s.seats[0].drawn).toBe(4);
    expect(s.phase).toBe('bet2');
    expect(fiveCardDraw.view(s, 2).players[0].status).toContain('Tukar 4');
  });

  it('deck habis → buangan dikocok ulang', () => {
    let s = toDraw();
    s.muck = s.deck.splice(0, s.deck.length - 1); // sisa 1 kartu di deck
    const total = () => s.seats.reduce((t, x) => t + x.hand.length, 0) + s.deck.length + s.muck.length;
    expect(total()).toBe(52);
    s = fiveCardDraw.apply(s, 1, act('draw', { cards: ['3S', 'QC'] }), r());
    expect(total()).toBe(52);
    expect(s.seats[1].hand).toHaveLength(5);
    expect(s.muck).toEqual(['3S', 'QC']); // buangan sendiri tidak ikut dikocok
  });

  it('showdown: tangan terbaik menang, seri dibagi', () => {
    let s = toDraw();
    s.seats[2].hand = ['KH', 'KC', 'QS', 'QD', '3D']; // seri dengan seat 1 (KKQQ3)
    s.deck = s.deck.filter(c => !['KH', 'KC', 'QS', 'QD', '3D'].includes(c));
    for (const seat of [1, 2, 0]) s = fiveCardDraw.apply(s, seat, act('pat'), r());
    for (const seat of [1, 2, 0]) s = fiveCardDraw.apply(s, seat, act('check'), r());
    expect(s.phase).toBe('handOver');
    // Pot 30 dibagi seat 1 & 2 (15 masing-masing).
    expect(s.seats.map(x => x.stack)).toEqual([990, 1005, 1005]);
  });

  it('view tidak membocorkan kartu lawan maupun deck', () => {
    const s = rigged();
    const v = JSON.stringify(fiveCardDraw.view(s, 0));
    for (const c of [...s.seats[1].hand, ...s.seats[2].hand, ...s.deck]) expect(v).not.toContain(`"${c}"`);
    const spect = JSON.stringify(fiveCardDraw.view(s, null));
    for (const c of s.seats[0].hand) expect(spect).not.toContain(`"${c}"`);
  });

  it('strategi tukar bot selalu sah', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 300; i++) {
      const hand = standardDeck().sort(() => rng.float() - 0.5).slice(0, 5);
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const disc = chooseDiscards(hand, d, rng);
        expect(disc.length).toBeLessThanOrEqual(4);
        if (disc.length === 4) expect(hand.filter(c => !disc.includes(c))[0][0]).toBe('A');
      }
    }
  });

  it('sanitizeOptions menerima kunci asing & membatasi nilai', () => {
    const o = fiveCardDraw.sanitizeOptions({ round: 3, previousWinner: 1, maxHands: 999, ante: 7, structure: 'x', turnSeconds: 0 });
    expect(o).toEqual({ turnSeconds: 0, passAndPlay: false, startingChips: 1000, ante: 10, structure: 'nl', maxHands: 30 });
  });
});

describe('Five Card Draw — fuzz', () => {
  for (const n of [2, 3, 4, 5, 6]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const total = n * (seed === 4 ? 500 : 1000);
      const { results } = fuzzGeneric(fiveCardDraw, {
        players: n, seed, options: seed === 4 ? { startingChips: 500, ante: 25 } : seed % 2 ? { structure: 'pl' } : {},
        check: (s: FiveCardDrawState) => {
          expect(s.seats.reduce((t, x) => t + x.stack + x.contributed, 0)).toBe(total);
          expect(s.seats.every(x => x.stack >= 0)).toBe(true);
          expect(s.seats.reduce((t, x) => t + x.hand.length, 0) + s.deck.length + s.muck.length).toBe(52);
          expect(new Set([...s.seats.flatMap(x => x.hand), ...s.deck, ...s.muck]).size).toBe(52);
        },
      });
      expect(results.reduce((t, x) => t + x.score, 0)).toBe(total);
    });
  }
});
