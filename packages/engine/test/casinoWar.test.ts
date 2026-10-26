import { describe, expect, it } from 'vitest';
import { casinoWar, type CasinoWarState } from '../src/games/casinoWar';
import { seededRng, RuleError, type Card } from '../src';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(31);
const bet = (amount: number) => ({ type: 'act' as const, id: 'bet', amount });
const act = (id: string) => ({ type: 'act' as const, id });

/** State dengan kedua taruhan terpasang dan shoe diatur. */
function afterBets(b0: number, b1: number, top: Card[]): CasinoWarState {
  let s = casinoWar.setup(seats(2), casinoWar.sanitizeOptions({}), r());
  s.starter = 0; s.turn = 0;
  s.shoe = [...top, ...s.shoe];
  s = casinoWar.apply(s, 0, bet(b0), r());
  s = casinoWar.apply(s, 1, bet(b1), r());
  return s;
}

describe('Casino War', () => {
  it('taruhan tertutup: lawan tidak melihat jumlahnya sebelum keduanya bertaruh', () => {
    let s = casinoWar.setup(seats(2), casinoWar.sanitizeOptions({}), r());
    s.starter = 0; s.turn = 0;
    s = casinoWar.apply(s, 0, bet(70), r());
    const v = casinoWar.view(s, 1);
    expect(JSON.stringify(v)).not.toMatch(/\b70\b/);
    expect(v.players[0].status).toBe('Sudah bertaruh');
    expect(casinoWar.view(s, 0).players[0].status).toBe('Taruhan 70');
  });
  it('validasi taruhan', () => {
    const s = casinoWar.setup(seats(2), casinoWar.sanitizeOptions({}), r());
    const t = s.turn!;
    expect(() => casinoWar.apply(s, t, bet(5), r())).toThrow(RuleError);
    expect(() => casinoWar.apply(s, t, bet(110), r())).toThrow(RuleError);
    expect(() => casinoWar.apply(s, t, bet(25), r())).toThrow(RuleError);
    expect(() => casinoWar.apply(s, 1 - t, bet(10), r())).toThrow(RuleError);
    const s2 = clone(s); s2.chips[t] = 30;
    expect(() => casinoWar.apply(s2, t, bet(40), r())).toThrow(RuleError);
    expect(casinoWar.view(s2, t).actions[0].amount!.max).toBe(30);
  });
  it('kartu tertinggi (As tinggi) mengambil pot', () => {
    let s = afterBets(50, 30, ['AS', 'KD']);
    expect(s.phase).toBe('reveal');
    expect(casinoWar.currentSeat(s)).toBeNull();
    expect(casinoWar.autoDelay(s)).toBeGreaterThan(0);
    s = casinoWar.advance(s, r());
    expect(s.cards).toEqual(['AS', 'KD']);
    expect(s.phase).toBe('result');
    expect(s.chips).toEqual([500 + 30, 500 - 30]);
  });
  it('seri → keduanya Perang: taruhan ditambah, 3 dibakar, pemenang ambil semua', () => {
    let s = afterBets(50, 30, ['9S', '9D', '2C', '3C', '4C', '5H', 'JH']);
    s = casinoWar.advance(s, r());
    expect(s.phase).toBe('war');
    expect(s.turn).toBe(0);
    s = casinoWar.apply(s, 0, act('war'), r());
    // Pilihan tertutup.
    expect(casinoWar.view(s, 1).players[0].status).toBe('Sudah memilih');
    s = casinoWar.apply(s, 1, act('war'), r());
    expect(s.phase).toBe('warDeal');
    expect(s.chips).toEqual([400, 440]);
    s = casinoWar.advance(s, r());
    expect(s.table).toEqual(['9S', '9D', '2C', '3C', '4C']);
    expect(s.cards).toEqual(['5H', 'JH']);
    expect(s.chips).toEqual([400, 440 + 160]);
  });
  it('seri → satu menyerah: kehilangan separuh setoran ke lawan', () => {
    let s = afterBets(50, 30, ['9S', '9D']);
    s = casinoWar.advance(s, r());
    s = casinoWar.apply(s, 0, act('surrender'), r());
    s = casinoWar.apply(s, 1, act('war'), r());
    expect(s.phase).toBe('result');
    expect(s.chips).toEqual([450 + 25, 470 + 30 + 25]);
  });
  it('seri → keduanya menyerah', () => {
    let s = afterBets(50, 30, ['9S', '9D']);
    s = casinoWar.advance(s, r());
    s = casinoWar.apply(s, 0, act('surrender'), r());
    s = casinoWar.apply(s, 1, act('surrender'), r());
    expect(s.chips).toEqual([450 + 25 + 15, 470 + 15 + 25]);
  });
  it('Perang tidak tersedia bila chip kurang', () => {
    let s = afterBets(100, 30, ['9S', '9D']);
    s.chips[0] = 50;
    s = casinoWar.advance(s, r());
    const ids = casinoWar.view(s, 0).actions.map(a => a.id);
    expect(ids).toEqual(['surrender']);
    expect(() => casinoWar.apply(s, 0, act('war'), r())).toThrow(RuleError);
    expect(casinoWar.timeoutAction(s, 0)).toEqual(act('surrender'));
  });
  it('perang seri beruntun lalu dimenangkan', () => {
    let s = afterBets(10, 10, ['9S', '9D', '2C', '3C', '4C', '7H', '7S', '2D', '3D', '4D', 'KH', 'QH']);
    s = casinoWar.advance(s, r());
    s = casinoWar.apply(casinoWar.apply(s, 0, act('war'), r()), 1, act('war'), r());
    s = casinoWar.advance(s, r());
    expect(s.phase).toBe('war');
    s = casinoWar.apply(casinoWar.apply(s, 0, act('war'), r()), 1, act('war'), r());
    s = casinoWar.advance(s, r());
    expect(s.chips).toEqual([470 + 60, 470]);
  });
  it('selesai bila jumlah ronde tercapai atau chip habis', () => {
    let s = afterBets(10, 10, ['AS', 'KD']);
    s.chips[1] = 5;
    s = casinoWar.advance(s, r());
    expect(s.over).toBe(true);
    expect(casinoWar.results(s)![0]).toMatchObject({ seat: 0, rank: 1 });
    let t = casinoWar.setup(seats(2), casinoWar.sanitizeOptions({ rounds: 5 }), r());
    let guard = 0;
    while (!t.over && guard++ < 500) {
      const seat = casinoWar.currentSeat(t);
      t = seat === null ? casinoWar.advance(t, r()) : casinoWar.apply(t, seat, casinoWar.timeoutAction(t, seat), r());
    }
    expect(t.over).toBe(true);
    expect(t.round).toBe(5);
  });
  it('view tidak membocorkan shoe', () => {
    const s = casinoWar.setup(seats(2), casinoWar.sanitizeOptions({}), r());
    const v = JSON.stringify(casinoWar.view(s, 0));
    for (const c of new Set(s.shoe.slice(0, 10))) expect(v).not.toContain(`"${c}"`);
  });
  it('opsi disanitasi', () => {
    expect(casinoWar.sanitizeOptions({ chips: 'x', rounds: 99, previousWinner: 1 })).toEqual({ turnSeconds: 25, passAndPlay: false, chips: 500, rounds: 10 });
  });
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`fuzz 2 pemain seed ${seed}`, () => {
      fuzzGeneric(casinoWar, { players: 2, seed, check: (s: CasinoWarState) => {
        expect(s.shoe.length + s.used.length + s.table.length + s.cards.filter(Boolean).length).toBe(312);
        expect(s.chips[0] + s.chips[1] + s.stake[0] + s.stake[1]).toBe(2 * s.options.chips);
      } });
    });
  }
});

function clone<T>(v: T): T { return structuredClone(v); }
