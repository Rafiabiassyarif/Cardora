import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { durak, beats, type DurakState } from '../src/games/durak';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(13);
const act = (id: string, cards?: string[]) => ({ type: 'act' as const, id, ...(cards ? { cards } : {}) });

function rigged(n = 2): DurakState {
  const s = durak.setup(seats(n), durak.sanitizeOptions({}), r());
  s.trumpSuit = 'H'; s.trumpCard = '6H';
  s.hands = [['7S', '7D', '9C', 'TH', 'KS', 'AD'], ['8S', 'QS', '6H', '9D', 'JC', 'AC'], ['6S', '6C', '6D', '8D', '8C', 'JD']].slice(0, n);
  s.stock = ['7C', 'KC', 'QD', 'TS', '8H'];
  s.trumpCard = '8H';
  s.attacker = 0; s.defender = 1; s.table = []; s.boutLimit = 6; s.turn = 0; s.discard = []; s.finished = []; s.durak = null;
  return s;
}

describe('Durak', () => {
  it('deck 36, truf = kartu terbawah stok, penyerang = truf terendah', () => {
    const s = durak.setup(seats(3), durak.sanitizeOptions({}), r());
    expect(s.hands.flat().length + s.stock.length).toBe(36);
    expect(s.trumpCard).toBe(s.stock.at(-1));
    const trumps = s.hands.flatMap((h, i) => h.filter(c => c[1] === s.trumpSuit).map(c => ({ i, c })));
    if (trumps.length) {
      const order = '6789TJQKA';
      trumps.sort((a, b) => order.indexOf(a.c[0]) - order.indexOf(b.c[0]));
      expect(s.attacker).toBe(trumps[0].i);
    }
  });
  it('aturan menangkis', () => {
    expect(beats('8S', '7S', 'H')).toBe(true);
    expect(beats('6S', '7S', 'H')).toBe(false);
    expect(beats('6H', 'AS', 'H')).toBe(true);
    expect(beats('AS', '6H', 'H')).toBe(false);
    expect(beats('9D', '7S', 'H')).toBe(false);
  });
  it('serang → tangkis → tambah angka sama → Bito; bertahan jadi penyerang', () => {
    let s = durak.apply(rigged(), 0, act('attack', ['7S']), r());
    expect(s.turn).toBe(1);
    expect(() => durak.apply(s, 1, act('defend', ['9D']), r())).toThrow(RuleError);
    s = durak.apply(s, 1, act('defend', ['8S']), r());
    expect(s.turn).toBe(0);
    expect(() => durak.apply(s, 0, act('attack', ['9C']), r())).toThrow(RuleError);
    s = durak.apply(s, 0, act('attack', ['7D']), r());
    s = durak.apply(s, 1, act('defend', ['6H']), r());
    s = durak.apply(s, 0, act('bito'), r());
    expect(s.discard).toHaveLength(4);
    expect(s.attacker).toBe(1);
    expect(s.defender).toBe(0);
    expect(s.hands[0]).toHaveLength(6);
    expect(s.hands[1]).toHaveLength(6);
  });
  it('Ambil: bertahan mengambil semua; pemain setelahnya menyerang', () => {
    let s = durak.apply(rigged(3), 0, act('attack', ['7S']), r());
    s = durak.apply(s, 1, act('take'), r());
    expect(s.hands[1]).toContain('7S');
    expect(s.hands[1]).toHaveLength(7);
    expect(s.attacker).toBe(2);
    expect(s.defender).toBe(0);
  });
  it('batas serangan = kartu bertahan di awal bout', () => {
    let s = rigged(); s.hands[1] = ['8S']; s.boutLimit = 1; s.stock = [];
    s.hands[0] = ['7S', '7D'];
    s = durak.apply(s, 0, act('attack', ['7S']), r());
    s = durak.apply(s, 1, act('defend', ['8S']), r());
    expect(durak.view(s, 0).actions.map(a => a.id)).toEqual(['bito']);
    s = durak.apply(s, 0, act('bito'), r());
    // Stok kosong: P1 habis → selamat; P0 jadi Durak.
    expect(s.over).toBe(true);
    expect(s.durak).toBe(0);
    expect(durak.results(s)!.find(x => x.seat === 1)!.rank).toBe(1);
  });
  it('view tidak membocorkan kartu lawan atau stok', () => {
    const s = rigged();
    const v = JSON.stringify(durak.view(s, 0));
    for (const c of [...s.hands[1], ...s.stock.slice(0, -1)]) expect(v).not.toContain(`"${c}"`);
    expect(v).toContain(`"${s.trumpCard}"`);
  });
  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(durak, { players: n, seed, check: (s: DurakState) => {
        expect(s.hands.flat().length + s.stock.length + s.discard.length + s.table.reduce((t, p) => t + (p.d ? 2 : 1), 0)).toBe(36);
      } });
    });
  }
});
