import { describe, expect, it } from 'vitest';
import { seededRng, RuleError, standardDeck, type Card } from '../src';
import { sevenCardStud, findBringIn, bestShowing, showingScore, type SevenCardStudState } from '../src/games/sevenCardStud';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(11);
const act = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'act' as const, id, ...extra });
const ids = (s: SevenCardStudState, seat: number) => sevenCardStud.view(s, seat).actions.map(a => a.id);

/** Third street dengan kartu terbuka tertentu; dealer 0; ante sudah dibayar (smallBet 20 → ante 4). */
function rig(ups: Card[]): SevenCardStudState {
  const s = sevenCardStud.setup(seats(ups.length), sevenCardStud.sanitizeOptions({}), r());
  s.dealer = 0;
  const rest = standardDeck().filter(c => !ups.includes(c));
  s.seats.forEach((x, i) => { x.up = [ups[i]]; x.down = rest.splice(0, 2); });
  s.deck = rest;
  s.bringIn = findBringIn(s);
  s.round.toAct = s.bringIn;
  return s;
}

describe('Seven Card Stud — bring-in & urutan aksi', () => {
  it('bring-in = kartu terbuka terendah, seri dipecah suit (♣ terendah)', () => {
    expect(findBringIn(rig(['9S', '2D', 'KH', '2C']))).toBe(3);
    expect(findBringIn(rig(['AS', '3H', '3S']))).toBe(1);
    expect(findBringIn(rig(['AC', 'KS']))).toBe(1); // As tinggi
  });

  it('setup memilih bring-in yang benar', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sevenCardStud.setup(seats(5), sevenCardStud.sanitizeOptions({}), seededRng(seed));
      const vals = s.seats.map(x => (['C', 'D', 'H', 'S'].indexOf(x.up[0][1])) + 4 * '23456789TJQKA'.indexOf(x.up[0][0]));
      expect(s.round.toAct).toBe(vals.indexOf(Math.min(...vals)));
      expect(s.bringIn).toBe(s.round.toAct);
      expect(s.seats.every(x => x.down.length === 2 && x.up.length === 1)).toBe(true);
    }
  });

  it('bring-in: bayar bring-in atau lengkapi; call semua → street selesai tanpa opsi bring-in', () => {
    let s = rig(['9S', '2D', 'KH']);
    expect(ids(s, 1)).toEqual(['bringin', 'bet']);
    expect(() => sevenCardStud.apply(s, 1, act('fold'), r())).toThrow(RuleError);
    s = sevenCardStud.apply(s, 1, act('bringin'), r());
    expect(s.seats[1].bet).toBe(10);
    const v = sevenCardStud.view(s, 2);
    expect(v.actions.map(a => a.label)).toEqual(['Fold', 'Call 10', 'Lengkapi 20']);
    s = sevenCardStud.apply(s, 2, act('call'), r());
    s = sevenCardStud.apply(s, 0, act('call'), r());
    expect(s.phase).toBe('deal');
    expect(s.seats.reduce((t, x) => t + x.contributed, 0)).toBe(12 + 30);
  });

  it('lengkapi membuka ulang aksi bring-in; fixed-limit maks 1 bet + 3 raise', () => {
    let s = rig(['9S', '2D', 'KH']);
    s = sevenCardStud.apply(s, 1, act('bringin'), r());
    s = sevenCardStud.apply(s, 2, act('bet'), r()); // lengkapi ke 20
    expect(s.round.currentBet).toBe(20);
    s = sevenCardStud.apply(s, 0, act('raise'), r()); // 40
    expect(s.round.currentBet).toBe(40);
    expect(ids(s, 1)).toEqual(['fold', 'call', 'raise']);
    s = sevenCardStud.apply(s, 1, act('raise'), r()); // 60
    s = sevenCardStud.apply(s, 2, act('raise'), r()); // 80 = cap (bet + 3 raise)
    expect(s.round.currentBet).toBe(80);
    expect(ids(s, 0)).toEqual(['fold', 'call']);
    expect(() => sevenCardStud.apply(s, 0, act('raise'), r())).toThrow(RuleError);
  });

  it('mulai fourth street: kartu terbuka terbaik beraksi pertama; big bet di fifth street', () => {
    let s = rig(['9S', '2D', 'KH']);
    for (const [seat, id] of [[1, 'bringin'], [2, 'call'], [0, 'call']] as const) s = sevenCardStud.apply(s, seat, act(id), r());
    expect(s.phase).toBe('deal');
    // Deck diatur: kartu 4th street dibagikan mulai kiri dealer (seat 1, 2, 0).
    const top = ['3C', '4C', '2S'];
    s.deck = [...top, ...s.deck.filter(c => !top.includes(c))];
    s = sevenCardStud.advance(s, r());
    // Seat 1: 2D 3C, seat 2: KH 4C, seat 0: 9S 2S → K tinggi beraksi pertama.
    expect(s.street).toBe(4);
    expect(s.round.toAct).toBe(2);
    expect(s.round.unit).toBe(20);
    for (const seat of [2, 0, 1]) s = sevenCardStud.apply(s, seat, act('check'), r());
    const top5 = ['2H', 'QD', '5S'];
    s.deck = [...top5, ...s.deck.filter(c => !top5.includes(c))];
    s = sevenCardStud.advance(s, r());
    // Seat 1 kini punya pair 2 terbuka → beraksi pertama.
    expect(s.street).toBe(5);
    expect(s.round.toAct).toBe(1);
    expect(sevenCardStud.view(s, 1).actions.find(a => a.id === 'bet')!.label).toBe('Bet 40');
  });

  it('showingScore: pair mengalahkan kartu tinggi; seri → terdekat di kiri dealer', () => {
    expect(showingScore(['2D', '2S'])[0]).toBe(1);
    expect(showingScore(['AD', 'KS'])[0]).toBe(0);
    const s = rig(['9S', '9D', 'KH']);
    s.seats[0].up = ['9S', '5C']; s.seats[1].up = ['9D', '5H']; s.seats[2].up = ['KH', '2C'];
    s.dealer = 1;
    expect(bestShowing(s)).toBe(2);
    s.seats[2].up = ['8H', '5D'];
    expect(bestShowing(s)).toBe(0); // 9-5 seri antara seat 0 dan 1; seat 0 lebih dulu dari kiri dealer (1)
  });
});

describe('Seven Card Stud — showdown & informasi', () => {
  it('showdown memakai 5 kartu terbaik dari 7; pemain yang fold kehilangan ante', () => {
    let s = rig(['9S', '2D', 'KH']);
    s.seats[0].down = ['9C', '9H']; s.seats[0].up = ['9S', '4D', '5D', '6H'];
    s.seats[1].down = ['AS', 'AD']; s.seats[1].up = ['2D', 'KC', 'QC', 'JC'];
    s.seats[2].down = ['3S', '3D']; s.seats[2].up = ['KH', '7C', '8C', 'TD'];
    const used = new Set(s.seats.flatMap(x => [...x.down, ...x.up]));
    s.deck = standardDeck().filter(c => !used.has(c));
    s.deck = ['2C', '9D', 'TS', ...s.deck.filter(c => !['9D', '2C', 'TS'].includes(c))];
    s.street = 6; s.phase = 'deal'; s.bringIn = null; s.round.toAct = null;
    s.seats[2].folded = true;
    s = sevenCardStud.advance(s, r()); // 7th street (mulai kiri dealer): seat 1 dapat 2C, seat 0 dapat 9D (quads)
    expect(s.street).toBe(7);
    while (s.phase === 'bet') s = sevenCardStud.apply(s, s.round.toAct!, act('check'), r());
    expect(s.phase).toBe('handOver');
    expect(s.seats[0].stack).toBe(996 + 12);
    expect(s.lastHand).toContain('Four of a Kind');
    // Kartu tertutup pemain yang fold tidak pernah dibuka.
    const v = JSON.stringify(sevenCardStud.view(s, 0));
    expect(v).not.toContain('"3S"');
    expect(v).toContain('"AS"'); // showdown seat 1 terbuka
  });

  it('deck kurang di seventh street → satu kartu komunitas', () => {
    const s0 = sevenCardStud.setup(seats(8), sevenCardStud.sanitizeOptions({}), r());
    let s = s0;
    s.dealer = 0;
    const deck = standardDeck();
    s.seats.forEach(x => { x.down = deck.splice(0, 2); x.up = deck.splice(0, 4); });
    s.deck = deck; // 4 kartu tersisa
    s.street = 6; s.phase = 'deal'; s.bringIn = null; s.round.toAct = null;
    s = sevenCardStud.advance(s, r());
    expect(s.community).not.toBeNull();
    expect(s.deck).toHaveLength(3);
    expect(s.seats.every(x => x.down.length === 2)).toBe(true);
    expect(sevenCardStud.view(s, 3).piles.find(p => p.id === 'community')!.cards).toEqual([s.community]);
    while (s.phase === 'bet') s = sevenCardStud.apply(s, s.round.toAct!, act('check'), r());
    expect(s.seats.reduce((t, x) => t + x.stack, 0)).toBe(8000);
  });

  it('view tidak membocorkan kartu tertutup lawan maupun deck', () => {
    const s = sevenCardStud.setup(seats(4), sevenCardStud.sanitizeOptions({}), r());
    const v = sevenCardStud.view(s, 0);
    const json = JSON.stringify(v);
    for (const x of s.seats.slice(1)) for (const c of x.down) expect(json).not.toContain(`"${c}"`);
    for (const c of s.deck) expect(json).not.toContain(`"${c}"`);
    expect(v.hand).toEqual([...s.seats[0].down, ...s.seats[0].up]);
    expect(v.players[2].faceUp).toEqual(s.seats[2].up);
    const spect = JSON.stringify(sevenCardStud.view(s, null));
    for (const c of s.seats[0].down) expect(spect).not.toContain(`"${c}"`);
  });

  it('sanitizeOptions menerima kunci asing & membatasi nilai', () => {
    const o = sevenCardStud.sanitizeOptions({ targetRounds: 4, maxHands: -5, smallBet: 33, startingChips: 2000 });
    expect(o).toEqual({ turnSeconds: 25, passAndPlay: false, startingChips: 2000, smallBet: 20, maxHands: 3 });
  });
});

describe('Seven Card Stud — fuzz', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const total = n * (seed === 4 ? 500 : 1000);
      const { results } = fuzzGeneric(sevenCardStud, {
        players: n, seed, options: seed === 4 ? { startingChips: 500, smallBet: 50 } : {},
        check: (s: SevenCardStudState) => {
          expect(s.seats.reduce((t, x) => t + x.stack + x.contributed, 0)).toBe(total);
          const cards = [...s.seats.flatMap(x => [...x.down, ...x.up]), ...s.deck, ...(s.community ? [s.community] : [])];
          expect(cards.length).toBe(52);
          expect(new Set(cards).size).toBe(52);
          expect(s.round.fullRaiseCount).toBeLessThanOrEqual(4);
        },
      });
      expect(results.reduce((t, x) => t + x.score, 0)).toBe(total);
    });
  }
});
