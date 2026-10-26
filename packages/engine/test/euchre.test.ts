import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { euchre, legalCards, euchreTrickWinner, effSuit, type EuchreState } from '../src/games/euchre';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(3);
const act = (s: EuchreState, seat: number, id: string, cards?: string[]) => euchre.apply(s, seat, { type: 'act', id, cards }, r());

function fresh(): EuchreState {
  const s = euchre.setup(seats(4), euchre.sanitizeOptions({ targetRounds: 4, junk: 'x' }), r());
  return s;
}

/** Fase play dengan tangan rancangan; dealer 3, seat 0 membuka. */
function rigged(hands: string[][], trump: string, maker = 0): EuchreState {
  const s = fresh();
  s.dealer = 3; s.phase = 'play'; s.trump = trump; s.maker = maker; s.upcard = null;
  s.hands = hands.map(h => h.slice());
  s.trickNo = 5 - hands[0].length;
  s.turn = 0;
  return s;
}

describe('Euchre', () => {
  it('opsi disanitasi', () => {
    expect(euchre.sanitizeOptions({ target: 10, turnSeconds: 0 })).toEqual({ target: 10, turnSeconds: 0, passAndPlay: false });
    expect(euchre.sanitizeOptions({ target: 99 }).target).toBe(5);
  });

  it('deal: 24 kartu, 5 per pemain, 1 terbuka', () => {
    const s = fresh();
    expect(s.hands.every(h => h.length === 5)).toBe(true);
    expect(s.upcard).not.toBeNull();
    const all = [...s.hands.flat(), s.upcard!, ...s.kitty];
    expect(new Set(all).size).toBe(24);
    expect(all.every(c => '9TJQKA'.includes(c[0]))).toBe(true);
    expect(s.turn).toBe((s.dealer + 1) % 4);
  });

  it('urutan bower: Right > Left > A truf; Left dianggap truf', () => {
    // truf hati: JH right, JD left
    expect(effSuit('JD', 'H')).toBe('H');
    expect(effSuit('JC', 'H')).toBe('C');
    expect(euchreTrickWinner([{ seat: 0, card: 'AH' }, { seat: 1, card: 'JD' }, { seat: 2, card: 'KH' }, { seat: 3, card: 'JH' }], 'H')).toBe(3);
    expect(euchreTrickWinner([{ seat: 0, card: 'AH' }, { seat: 1, card: 'JD' }, { seat: 2, card: 'KH' }, { seat: 3, card: '9H' }], 'H')).toBe(1);
    // Left bower memotong suit wajik yang dibuka (karena dianggap truf)
    expect(euchreTrickWinner([{ seat: 0, card: 'AD' }, { seat: 1, card: 'JD' }, { seat: 2, card: 'KD' }, { seat: 3, card: '9C' }], 'H')).toBe(1);
    // tanpa truf dimainkan: tertinggi suit pembuka
    expect(euchreTrickWinner([{ seat: 0, card: '9S' }, { seat: 1, card: 'AC' }, { seat: 2, card: 'KS' }, { seat: 3, card: 'JC' }], 'H')).toBe(2);
  });

  it('wajib mengikuti suit efektif (Left Bower mengikuti truf)', () => {
    let s = rigged([['9H', 'TS'], ['JD', 'AD'], ['QS', 'KS'], ['9C', 'TC']], 'H');
    s = act(s, 0, 'play', ['9H']); // buka truf
    // seat 1 hanya punya Left Bower sebagai truf → wajib JD, AD tidak boleh
    expect(legalCards(s, 1)).toEqual(['JD']);
    expect(() => act(s, 1, 'play', ['AD'])).toThrow(RuleError);
    s = act(s, 1, 'play', ['JD']);
    s = act(s, 2, 'play', ['QS']);
    s = act(s, 3, 'play', ['9C']);
    expect(s.trickWinnerSeat).toBe(1);
    // buka wajik: JD (left) tidak dihitung wajik
    let t = rigged([['AD', 'TS'], ['JD', '9S'], ['QS', 'KS'], ['9C', 'TC']], 'H');
    t = act(t, 0, 'play', ['AD']);
    expect(legalCards(t, 1).sort()).toEqual(['9S', 'JD']);
  });

  it('ronde 1: dipesan → dealer ambil kartu & buang 1', () => {
    let s = fresh();
    const dealer = s.dealer;
    const up = s.upcard!;
    const first = (dealer + 1) % 4;
    s = act(s, first, 'pass');
    s = act(s, (first + 1) % 4, 'order');
    expect(s.trump).toBe(up[1]);
    expect(s.maker).toBe((first + 1) % 4);
    expect(s.phase).toBe('discard');
    expect(s.turn).toBe(dealer);
    expect(s.hands[dealer]).toHaveLength(6);
    expect(s.hands[dealer]).toContain(up);
    const drop = s.hands[dealer].find(c => c !== up)!;
    s = act(s, dealer, 'discard', [drop]);
    expect(s.hands[dealer]).toHaveLength(5);
    expect(s.kitty).toContain(drop);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(first);
  });

  it('ronde 2: suit ditolak tak bisa dipilih; dealer wajib memilih (stick the dealer)', () => {
    let s = fresh();
    const dealer = s.dealer;
    const upSuit = s.upSuit;
    for (let k = 1; k <= 4; k++) s = act(s, (dealer + k) % 4, 'pass');
    expect(s.phase).toBe('bid2');
    expect(s.upcard).toBeNull();
    expect(() => act(s, (dealer + 1) % 4, `suit:${upSuit}`)).toThrow(RuleError);
    for (let k = 1; k <= 3; k++) s = act(s, (dealer + k) % 4, 'pass');
    expect(s.turn).toBe(dealer);
    expect(() => act(s, dealer, 'pass')).toThrow(RuleError);
    const other = ['S', 'H', 'D', 'C'].find(x => x !== upSuit)!;
    s = act(s, dealer, `suit:${other}`);
    expect(s.trump).toBe(other);
    expect(s.phase).toBe('play');
  });

  function scoreHand(tricks: number[], maker: number, scores = [0, 0]) {
    let s = rigged([['AS'], ['9S'], ['TS'], ['QS']], 'H', maker);
    s.tricksWon = tricks.slice();
    s.teamScores = scores.slice();
    s = act(s, 0, 'play', ['AS']); s = act(s, 1, 'play', ['9S']); s = act(s, 2, 'play', ['TS']); s = act(s, 3, 'play', ['QS']);
    return euchre.advance(s, r()); // seat 0 menang trik terakhir
  }

  it('skor: 3–4 trik = 1, march = 2, euchre = 2 untuk bertahan', () => {
    expect(scoreHand([1, 1, 1, 1], 0).teamScores).toEqual([1, 0]); // A 3 trik
    expect(scoreHand([2, 0, 2, 0], 2).teamScores).toEqual([2, 0]); // A march
    expect(scoreHand([0, 2, 1, 1], 1).teamScores).toEqual([0, 1]); // B 3 trik
    expect(scoreHand([1, 1, 0, 2], 0).teamScores).toEqual([0, 2]); // A 2 trik → euchred
  });

  it('target tercapai → selesai, rekan berbagi peringkat', () => {
    const s = scoreHand([1, 1, 1, 1], 0, [4, 3]);
    expect(s.over).toBe(true);
    const res = euchre.results(s)!;
    expect(res.filter(x => x.rank === 1).map(x => x.seat).sort()).toEqual([0, 2]);
    const n = scoreHand([1, 1, 1, 1], 0, [2, 3]);
    expect(n.over).toBe(false);
    expect(n.phase).toBe('handEnd');
    const next = euchre.advance(n, r());
    expect(next.dealer).toBe(0);
    expect(next.phase).toBe('bid1');
  });

  it('view tidak membocorkan kartu lawan maupun kartu tertutup', () => {
    const s = fresh();
    expectNoLeak(euchre, s, 0, [s.hands[1], s.hands[2], s.hands[3], s.kitty]);
  });

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`fuzz 4 pemain seed ${seed}`, () => {
      fuzzGeneric(euchre, { players: 4, seed, options: { target: seed % 2 ? 5 : 10 }, check: (s: EuchreState) => {
        expect(s.hands.flat().length + s.kitty.length + (s.upcard ? 1 : 0) + s.trick.length + s.taken.flat().length).toBe(24);
        if (!s.over && s.turn === null) expect(euchre.autoDelay(s)).not.toBeNull();
      } });
    });
  }
});
