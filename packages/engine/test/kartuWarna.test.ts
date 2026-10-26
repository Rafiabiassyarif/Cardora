import { describe, expect, it } from 'vitest';
import { kartuWarna, type KartuWarnaState } from '../src/games/kartuWarna';
import { seededRng, RuleError } from '../src';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(7);
const act = (id: string, cards?: string[]) => ({ type: 'act' as const, id, ...(cards ? { cards } : {}) });

/** State rekayasa: hand/deck/buangan diatur manual. Total kartu tidak harus 108. */
function rigged(players = 3, opts: Record<string, unknown> = {}): KartuWarnaState {
  const s = kartuWarna.setup(seats(players), kartuWarna.sanitizeOptions(opts), r());
  s.hands = s.names.map(() => ['u:Y9a', 'u:Y8a', 'u:Y7a']);
  s.hands[0] = ['u:R5a', 'u:B5a', 'u:G2a', 'u:WWa'];
  s.discard = ['u:R3a'];
  s.activeColor = 'R';
  s.deck = ['u:G1a', 'u:G1b', 'u:G3a', 'u:G3b', 'u:G4a', 'u:G4b'];
  s.turn = 0; s.direction = 1; s.phase = 'play'; s.pendingDraw = 0; s.drewThisTurn = false; s.turns = 0;
  return s;
}

describe('Kartu Warna', () => {
  it('cocok warna atau angka; selain itu ditolak', () => {
    const s = rigged();
    s.discard = ['u:R5b'];
    expect(() => kartuWarna.apply(s, 0, act('play', ['u:G2a']), r())).toThrow(RuleError);
    const a = kartuWarna.apply(s, 0, act('play', ['u:B5a']), r());
    expect(a.activeColor).toBe('B');
    expect(a.turn).toBe(1);
    const b = kartuWarna.apply(s, 0, act('play', ['u:R5a']), r());
    expect(b.activeColor).toBe('R');
  });

  it('Wild → pilih warna, lalu giliran berpindah', () => {
    let s = kartuWarna.apply(rigged(), 0, act('play', ['u:WWa']), r());
    expect(s.phase).toBe('color');
    expect(s.turn).toBe(0);
    expect(kartuWarna.view(s, 0).actions.map(x => x.id)).toEqual(['color:R', 'color:Y', 'color:G', 'color:B']);
    s = kartuWarna.apply(s, 0, act('color:G'), r());
    expect(s.activeColor).toBe('G');
    expect(s.turn).toBe(1);
    // Setelah Wild, angka kartu teratas tidak berlaku — hanya warna.
    s.hands[1] = ['u:G9a', 'u:R9a', 'u:B1a'];
    expect(kartuWarna.view(s, 1).playable).toEqual(['u:G9a']);
  });

  it('Wild +4 hanya sah jika tidak punya warna aktif; korban ambil 4 & dilewati', () => {
    const s = rigged();
    s.hands[0] = ['u:R5a', 'u:W4a', 'u:B1a'];
    expect(() => kartuWarna.apply(s, 0, act('play', ['u:W4a']), r())).toThrow(/Wild \+4/);
    s.hands[0] = ['u:B5a', 'u:W4a', 'u:B1a'];
    let t = kartuWarna.apply(s, 0, act('play', ['u:W4a']), r());
    t = kartuWarna.apply(t, 0, act('color:B'), r());
    expect(t.hands[1]).toHaveLength(7);
    expect(t.turn).toBe(2);
    expect(t.activeColor).toBe('B');
  });

  it('Lewati, Balik, +2', () => {
    const s = rigged(4);
    s.hands[0] = ['u:RSa', 'u:RRa', 'u:RDa', 'u:B1a'];
    const sk = kartuWarna.apply(s, 0, act('play', ['u:RSa']), r());
    expect(sk.turn).toBe(2);
    const rv = kartuWarna.apply(s, 0, act('play', ['u:RRa']), r());
    expect(rv.direction).toBe(-1);
    expect(rv.turn).toBe(3);
    const d2 = kartuWarna.apply(s, 0, act('play', ['u:RDa']), r());
    expect(d2.hands[1]).toHaveLength(5);
    expect(d2.turn).toBe(2);
  });

  it('Balik dengan 2 pemain = Lewati', () => {
    const s = rigged(2);
    s.hands[0] = ['u:RRa', 'u:B1a', 'u:B2a'];
    const t = kartuWarna.apply(s, 0, act('play', ['u:RRa']), r());
    expect(t.turn).toBe(0);
  });

  it('opsi tumpuk: +2 di atas +2, lalu ambil semua', () => {
    const s = rigged(3, { stacking: true });
    s.hands[0] = ['u:RDa', 'u:B1a', 'u:B2a'];
    s.hands[1] = ['u:GDa', 'u:Y1a', 'u:Y2a'];
    s.hands[2] = ['u:Y3a', 'u:Y4a', 'u:Y5a'];
    let t = kartuWarna.apply(s, 0, act('play', ['u:RDa']), r());
    expect(t.pendingDraw).toBe(2);
    expect(t.turn).toBe(1);
    expect(kartuWarna.view(t, 1).playable).toEqual(['u:GDa']);
    t = kartuWarna.apply(t, 1, act('play', ['u:GDa']), r());
    expect(t.pendingDraw).toBe(4);
    expect(t.turn).toBe(2);
    expect(kartuWarna.view(t, 2).actions.map(x => x.id)).toEqual(['take']);
    t = kartuWarna.apply(t, 2, act('take'), r());
    expect(t.hands[2]).toHaveLength(7);
    expect(t.pendingDraw).toBe(0);
    expect(t.turn).toBe(0);
  });

  it('tanpa tumpuk, +2 langsung berlaku', () => {
    const s = rigged(3);
    s.hands[0] = ['u:RDa', 'u:B1a', 'u:B2a'];
    const t = kartuWarna.apply(s, 0, act('play', ['u:RDa']), r());
    expect(t.pendingDraw).toBe(0);
    expect(t.hands[1]).toHaveLength(5);
  });

  it('ambil lalu mainkan kartu yang diambil; kartu tak cocok → otomatis lewat', () => {
    let s = rigged();
    s.hands[0] = ['u:B9a', 'u:B8a', 'u:B7a'];
    s.deck = ['u:R1a', 'u:G6a'];
    s = kartuWarna.apply(s, 0, act('draw'), r());
    expect(s.drewThisTurn).toBe(true);
    expect(kartuWarna.view(s, 0).playable).toEqual(['u:R1a']);
    expect(() => kartuWarna.apply(s, 0, act('play', ['u:B9a']), r())).toThrow(RuleError);
    s = kartuWarna.apply(s, 0, act('play', ['u:R1a']), r());
    expect(s.turn).toBe(1);
    // Kartu yang diambil tidak cocok → giliran lewat otomatis.
    s.hands[1] = ['u:B9b', 'u:B8b'];
    const t = kartuWarna.apply(s, 1, act('draw'), r());
    expect(t.hands[1]).toContain('u:G6a');
    expect(t.turn).toBe(2);
  });

  it('lupa "Satu Kartu!" → penalti 2 kartu; dengan panggilan tidak', () => {
    const s = rigged();
    s.hands[0] = ['u:R5a', 'u:B1a'];
    expect(kartuWarna.view(s, 0).actions.map(x => x.id)).toContain('playOne');
    const forgot = kartuWarna.apply(s, 0, act('play', ['u:R5a']), r());
    expect(forgot.hands[0]).toHaveLength(3);
    const called = kartuWarna.apply(s, 0, act('playOne', ['u:R5a']), r());
    expect(called.hands[0]).toEqual(['u:B1a']);
    expect(kartuWarna.view(called, 1).players[0].status).toContain('Satu Kartu');
  });

  it('deck habis → buangan dikocok ulang (kecuali kartu teratas)', () => {
    let s = rigged();
    s.hands[0] = ['u:B9a', 'u:B8a'];
    s.deck = [];
    s.discard = ['u:G1a', 'u:G2a', 'u:R3a'];
    s = kartuWarna.apply(s, 0, act('draw'), r());
    expect(s.discard).toEqual(['u:R3a']);
    expect(s.deck.length + s.hands[0].length).toBe(4);
  });

  it('skor: pemenang dapat poin kartu lawan; lawan diperingkat dari penalti', () => {
    const s = rigged(3);
    s.hands[0] = ['u:R5a'];
    s.hands[1] = ['u:WWa', 'u:BSa', 'u:B7a']; // 50 + 20 + 7 = 77
    s.hands[2] = ['u:G2a']; // 2
    const t = kartuWarna.apply(s, 0, act('play', ['u:R5a']), r());
    expect(t.over).toBe(true);
    expect(t.scores).toEqual([79, 0, 0]);
    expect(kartuWarna.results(t)).toEqual([
      { seat: 0, rank: 1, score: 79 }, { seat: 2, rank: 2, score: 0 }, { seat: 1, rank: 3, score: 0 },
    ]);
  });

  it('kartu terakhir +2 tetap membuat korban ambil kartu (dihitung ke poin)', () => {
    const s = rigged(2);
    s.hands[0] = ['u:RDa'];
    s.hands[1] = ['u:Y1a'];
    s.deck = ['u:G9a', 'u:G8a'];
    const t = kartuWarna.apply(s, 0, act('play', ['u:RDa']), r());
    expect(t.scores[0]).toBe(1 + 9 + 8);
  });

  it('beberapa deal: jeda antar deal lalu deal baru', () => {
    const s = rigged(2, { deals: 3 });
    s.hands[0] = ['u:R5a'];
    let t = kartuWarna.apply(s, 0, act('play', ['u:R5a']), r());
    expect(t.over).toBe(false);
    expect(kartuWarna.currentSeat(t)).toBeNull();
    expect(kartuWarna.autoDelay(t)).not.toBeNull();
    t = kartuWarna.advance(t, r());
    expect(t.dealNo).toBe(2);
    expect(t.hands.every(h => h.length >= 7)).toBe(true);
    expect(kartuWarna.currentSeat(t)).not.toBeNull();
  });

  it('opsi disanitasi & kunci asing diabaikan', () => {
    expect(kartuWarna.sanitizeOptions({ deals: 99, target: 7, stacking: 'x', round: 3, turnSeconds: 'a' }))
      .toEqual({ turnSeconds: 25, passAndPlay: false, deals: 1, target: 0, stacking: false });
  });

  it('view tidak membocorkan kartu lawan & urutan deck', () => {
    const s = kartuWarna.setup(seats(4), kartuWarna.sanitizeOptions({}), seededRng(3));
    const top = s.discard[s.discard.length - 1];
    expectNoLeak(kartuWarna, s, 0, [...s.hands.slice(1), s.deck].map(h => h.filter(c => c !== top)));
  });

  for (const n of [2, 3, 4, 6, 8]) for (const seed of [1, 2, 3, 4]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const options = seed === 3 ? { stacking: true } : seed === 4 ? { deals: 3 } : {};
      fuzzGeneric(kartuWarna, { players: n, seed, options, check: (s: KartuWarnaState) => {
        const all = [...s.hands.flat(), ...s.deck, ...s.discard];
        expect(all.length).toBe(108);
        expect(new Set(all).size).toBe(108);
      } });
    });
  }
});
