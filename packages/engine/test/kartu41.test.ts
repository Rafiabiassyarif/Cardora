import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { kartu41, handValue41, type Kartu41State } from '../src/games/kartu41';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(7);

function rigged(n = 2): Kartu41State {
  const s = kartu41.setup(seats(n), kartu41.sanitizeOptions({ deals: 1 }), r());
  s.hands = [['AS', 'KS', 'QS', '2H'], ['3C', '4D', '5H', '6S']];
  if (n > 2) s.hands.push(['7C', '8C', '9C', 'TD']);
  s.deck = ['JS', '2C', '3D', '4C', '5C', '6C', '7D', '8D'];
  s.discard = ['9H'];
  s.availableDiscard = '9H';
  s.turn = 0; s.phase = 'draw'; s.turnsThisDeal = 0; s.dealNo = 1;
  s.phase = 'draw'; s.revealed = false; s.lastDeal = null; s.scores = s.hands.map(() => 0);
  return s;
}

describe('Kartu 41', () => {
  it('menghitung nilai tangan: suit terbaik dikurangi lainnya', () => {
    expect(handValue41(['AS', 'KS', 'QS', 'JS']).value).toBe(41);
    expect(handValue41(['AS', 'KS', 'QS', '2H']).value).toBe(29);
    expect(handValue41(['2C', '3D', '4H', '5S']).value).toBe(5 - 9);
    expect(handValue41(['9H', '8H', 'AC', '2D']).value).toBe(17 - 13);
  });

  it('41 setelah membuang = menang seketika dengan 4 kartu satu lambang', () => {
    let s = kartu41.apply(rigged(), 0, { type: 'act', id: 'deck' }, r());
    expect(s.hands[0]).toContain('JS');
    expect(s.hands[0].length).toBe(5);
    s = kartu41.apply(s, 0, { type: 'act', id: 'discard', cards: ['2H'] }, r());
    expect(s.hands[0].length).toBe(4);
    expect(s.phase).toBe('dealEnd');
    expect(s.scores[0]).toBe(41);
    s = kartu41.advance(s, r());
    expect(s.over).toBe(true);
    expect(kartu41.results(s)![0]).toMatchObject({ seat: 0, rank: 1 });
  });

  it('kartu buangan yang diambil tidak boleh langsung dibuang', () => {
    const s = kartu41.apply(rigged(), 0, { type: 'act', id: 'take' }, r());
    expect(() => kartu41.apply(s, 0, { type: 'act', id: 'discard', cards: ['9H'] }, r())).toThrow(RuleError);
  });

  it('kartu buangan hanya bisa diambil oleh 1 orang sebelum dia; bila pemain mencangkul, buangan hangus untuk pemain berikutnya', () => {
    let s = rigged(3);
    s.hands[0] = ['AS', 'KS', '9S', '2H']; // Hindari 41 seketika
    // Seat 0 mencangkul kartu dari deck, membuang '2H'
    s = kartu41.apply(s, 0, { type: 'act', id: 'deck' }, r());
    s = kartu41.apply(s, 0, { type: 'act', id: 'discard', cards: ['2H'] }, r());
    expect(s.turn).toBe(1);
    expect(s.availableDiscard).toBe('2H');

    // Seat 1 memilih mencangkul dari deck (tidak mengambil 2H)
    s = kartu41.apply(s, 1, { type: 'act', id: 'deck' }, r());
    // Saat mencangkul, 2H hangus
    expect(s.availableDiscard).toBeNull();
    // Seat 1 membuang 3C
    s = kartu41.apply(s, 1, { type: 'act', id: 'discard', cards: ['3C'] }, r());

    // Giliran Seat 2: buangan yang tersedia HANYA 3C (milik Seat 1, orang persis sebelumnya)
    expect(s.turn).toBe(2);
    expect(s.availableDiscard).toBe('3C');
    const view2 = kartu41.view(s, 2);
    expect(view2.actions.some(a => a.id === 'take')).toBe(true);

    // Seat 2 mengambil buangan 3C
    s = kartu41.apply(s, 2, { type: 'act', id: 'take' }, r());
    expect(s.hands[2]).toContain('3C');
    expect(s.availableDiscard).toBeNull();
  });

  it('deck / cangkulan habis mengakhiri deal dan pemegang poin tertinggi menang', () => {
    let s = rigged();
    s.deck = ['2D'];
    s = kartu41.apply(s, 0, { type: 'act', id: 'deck' }, r());
    s = kartu41.apply(s, 0, { type: 'act', id: 'discard', cards: ['2D'] }, r());
    expect(s.phase).toBe('dealEnd');
    expect(kartu41.currentSeat(s)).toBeNull();
    expect(kartu41.autoDelay(s)).not.toBeNull();
    // Seat 0: AS, KS, QS, 2H (29 poin), Seat 1: 3C, 4D, 5H, 6S (-6 poin)
    expect(s.scores[0]).toBe(29);
    expect(s.scores[1]).toBe(-6);
  });

  it('view tidak membocorkan kartu lawan maupun deck', () => {
    const s = rigged();
    expectNoLeak(kartu41, s, 0, [s.hands[1], s.deck]);
  });

  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(kartu41, { players: n, seed, check: (s: Kartu41State) => {
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(52);
      } });
    });
  }
});
