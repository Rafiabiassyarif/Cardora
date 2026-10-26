import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { mauMau, type MauMauState } from '../src/games/mauMau';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(5);
const act = (id: string, cards?: string[]) => ({ type: 'act' as const, id, ...(cards ? { cards } : {}) });

function rigged(n = 3): MauMauState {
  const s = mauMau.setup(seats(n), mauMau.sanitizeOptions({}), r());
  s.hands = [['5H', '9S', 'JD', '7H', '8H'], ['2C', '3C', '7C'], ['AH', 'KD', '4S']].slice(0, n);
  s.discard = ['6H']; s.activeSuit = 'H'; s.turn = 0; s.deck = ['4C', 'QH', 'TS', '2D', '3D', '5D'];
  s.pendingDraw = 0; s.drewThisTurn = false; s.choosingSuit = false;
  return s;
}

describe('Mau-Mau', () => {
  it('suit/angka sama; J tidak boleh di atas J', () => {
    const s = rigged();
    expect(() => mauMau.apply(s, 0, act('play', ['9S']), r())).toThrow(RuleError);
    const s2 = mauMau.apply(s, 0, act('play', ['5H']), r());
    expect(s2.turn).toBe(1);
    const s3 = rigged(); s3.discard = ['JC']; s3.activeSuit = 'H';
    expect(() => mauMau.apply(s3, 0, act('play', ['JD']), r())).toThrow(RuleError);
    expect(mauMau.apply(s3, 0, act('play', ['5H']), r()).discard.at(-1)).toBe('5H');
  });
  it('J liar: pilih suit', () => {
    let s = mauMau.apply(rigged(), 0, act('play', ['JD']), r());
    expect(s.choosingSuit).toBe(true);
    s = mauMau.apply(s, 0, act('suit:C'), r());
    expect(s.activeSuit).toBe('C');
    expect(s.turn).toBe(1);
  });
  it('7 menumpuk hukuman, lalu ambil semua', () => {
    let s = mauMau.apply(rigged(), 0, act('play', ['7H']), r());
    expect(s.pendingDraw).toBe(2);
    expect(() => mauMau.apply(s, 1, act('play', ['2C']), r())).toThrow(RuleError);
    s = mauMau.apply(s, 1, act('play', ['7C']), r());
    expect(s.pendingDraw).toBe(4);
    expect(s.turn).toBe(2);
    s = mauMau.apply(s, 2, act('penalty'), r());
    expect(s.hands[2]).toHaveLength(7);
    expect(s.pendingDraw).toBe(0);
    expect(s.turn).toBe(0);
  });
  it('8 melewati pemain berikutnya', () => {
    const s = mauMau.apply(rigged(), 0, act('play', ['8H']), r());
    expect(s.turn).toBe(2);
  });
  it('ambil lalu hanya kartu baru yang boleh dimainkan', () => {
    let s = rigged(); s.turn = 1; s.discard = ['6S']; s.activeSuit = 'S'; s.hands[1] = ['2C', '3D'];
    s = mauMau.apply(s, 1, act('draw'), r());
    expect(s.hands[1]).toContain('4C');
    expect(() => mauMau.apply(s, 1, act('play', ['4C']), r())).toThrow(RuleError);
    s = mauMau.apply(s, 1, act('pass'), r());
    expect(s.turn).toBe(2);
  });
  it('kartu habis = menang', () => {
    const s = rigged(); s.hands[0] = ['5H'];
    const s2 = mauMau.apply(s, 0, act('play', ['5H']), r());
    expect(s2.over).toBe(true);
    expect(mauMau.results(s2)!.find(x => x.seat === 0)!.rank).toBe(1);
  });
  it('view tidak membocorkan kartu lawan', () => {
    const s = rigged();
    const v = JSON.stringify(mauMau.view(s, 0));
    for (const c of [...s.hands[1], ...s.hands[2], ...s.deck]) expect(v).not.toContain(`"${c}"`);
  });
  it('opsi sampah diterima', () => {
    const o = mauMau.sanitizeOptions({ deckSize: '32', handSize: 99, round: 3, foo: 'x' });
    expect(o).toMatchObject({ deckSize: 32, handSize: 5 });
  });
  for (const deckSize of [52, 32]) for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz deck ${deckSize} ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(mauMau, { players: n, seed, options: { deckSize, handSize: seed % 2 ? 5 : 7 }, check: (s: MauMauState) => {
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(deckSize);
      } });
    });
  }
});
