import { describe, expect, it } from 'vitest';
import { cangkulan, blackjack, handTotal, isBlackjack, seededRng, RuleError, type CangkulanState, type BlackjackState } from '../src';
import { simulate, seats } from './helpers';

const r = () => seededRng(9);

describe('Cangkulan', () => {
  it('pembagian: 7 kartu tiap pemain, tumpukan sisanya, kartu pembuka', () => {
    const s = cangkulan.setup(seats(4), cangkulan.defaultOptions, r());
    for (const h of s.hands) expect(h).toHaveLength(7);
    expect(s.trick).toHaveLength(1);
    expect(s.deck).toHaveLength(52 - 28 - 1);
    expect(s.leadSuit).toBe(s.trick[0].card[1]);
  });

  function rigged(): CangkulanState {
    const s = cangkulan.setup(seats(2), { handSize: 3, aceHigh: true, openWithDeck: true }, r());
    s.hands = [['5H', '9S', 'KD'], ['2C', '3C', 'AH']];
    s.trick = [{ seat: null, card: '7H' }];
    s.leadSuit = 'H';
    s.deck = ['4C', 'QH', '8D'];
    s.toAct = 0; s.leader = 0; s.acted = [];
    return s;
  }

  it('wajib mengikuti jenis kartu pembuka', () => {
    const s = rigged();
    expect(() => cangkulan.apply(s, 0, { type: 'play', card: '9S' }, r())).toThrow(RuleError);
    expect(() => cangkulan.apply(s, 0, { type: 'draw' }, r())).toThrow(/masih punya/);
    const s2 = cangkulan.apply(s, 0, { type: 'play', card: '5H' }, r());
    expect(s2.toAct).toBe(1);
  });

  it('nyangkul sampai dapat jenis yang sesuai', () => {
    let s = rigged();
    s.hands[1] = ['2C', '3C'];
    s = cangkulan.apply(s, 0, { type: 'play', card: '5H' }, r());
    expect(() => cangkulan.apply(s, 1, { type: 'pass' }, r())).toThrow(/lewat/);
    s = cangkulan.apply(s, 1, { type: 'draw' }, r()); // 4C — belum hati
    expect(s.toAct).toBe(1);
    expect(cangkulan.view(s, 1).legal!.playable).toEqual([]);
    s = cangkulan.apply(s, 1, { type: 'draw' }, r()); // QH
    expect(cangkulan.view(s, 1).legal!.playable).toEqual(['QH']);
    s = cangkulan.apply(s, 1, { type: 'play', card: 'QH' }, r());
    expect(s.trickDone).toBe(true);
    expect(s.lastTrick!.winner).toBe(1); // Q > 7 > 5
  });

  it('lewat jika tumpukan habis dan tidak punya jenis', () => {
    let s = rigged();
    s.hands[1] = ['2C'];
    s.deck = [];
    s = cangkulan.apply(s, 0, { type: 'play', card: '5H' }, r());
    expect(cangkulan.view(s, 1).legal).toEqual({ playable: [], canDraw: false, canPass: true });
    s = cangkulan.apply(s, 1, { type: 'pass' }, r());
    expect(s.lastTrick!.winner).toBe(0);
  });

  it('pemenang trik memimpin dengan kartu bebas', () => {
    let s = rigged();
    s = cangkulan.apply(s, 0, { type: 'play', card: '5H' }, r());
    s = cangkulan.apply(s, 1, { type: 'play', card: 'AH' }, r());
    s = cangkulan.advance(s, r());
    expect(s.toAct).toBe(1);
    expect(s.leadSuit).toBeNull();
    expect(cangkulan.view(s, 1).legal!.playable.sort()).toEqual(['2C', '3C']);
  });

  it('As rendah jika opsi aceHigh mati', () => {
    let s = rigged();
    s.options.aceHigh = false;
    s = cangkulan.apply(s, 0, { type: 'play', card: '5H' }, r());
    s = cangkulan.apply(s, 1, { type: 'play', card: 'AH' }, r());
    expect(s.lastTrick!.winner).toBe(0);
  });

  it('kartu tangan lawan tidak bocor di view', () => {
    const s = cangkulan.setup(seats(3), cangkulan.defaultOptions, r());
    const v = cangkulan.view(s, 0);
    const json = JSON.stringify(v);
    for (const c of [...s.hands[1], ...s.hands[2], ...s.deck]) expect(json).not.toContain(`"${c}"`);
    expect(v.handCounts).toEqual([7, 7, 7]);
  });

  it.each([2, 3, 4, 6])('%i bot bermain sampai selesai; peringkat lengkap & kartu terjaga', (n) => {
    const s = simulate(cangkulan, n, n * 7) as CangkulanState;
    expect(s.over).toBe(true);
    const res = cangkulan.results(s)!;
    expect(res.map(x => x.seat).sort()).toEqual([...Array(n).keys()]);
    const allCards = [...s.deck, ...s.hands.flat()];
    expect(new Set(allCards).size).toBe(allCards.length);
  });
});

describe('Blackjack', () => {
  it('nilai tangan & soft ace', () => {
    expect(handTotal(['AS', 'KD'])).toEqual({ total: 21, soft: true });
    expect(handTotal(['AS', 'AD', '9C'])).toEqual({ total: 21, soft: true });
    expect(handTotal(['AS', '9D', 'KC'])).toEqual({ total: 20, soft: false });
    expect(handTotal(['KS', 'QD', '5C']).total).toBe(25);
    expect(isBlackjack(['AS', 'TD'])).toBe(true);
    expect(isBlackjack(['AS', '5D', '5C'])).toBe(false);
  });

  function afterBet(): BlackjackState {
    let s = blackjack.setup(seats(1), blackjack.defaultOptions, r());
    s = blackjack.apply(s, 0, { type: 'bet', amount: 100 }, r());
    return s;
  }

  it('taruhan divalidasi', () => {
    const s = blackjack.setup(seats(1), blackjack.defaultOptions, r());
    expect(() => blackjack.apply(s, 0, { type: 'bet', amount: 5 }, r())).toThrow(/minimum/);
    expect(() => blackjack.apply(s, 0, { type: 'bet', amount: 5000 }, r())).toThrow(/Chip/);
    expect(() => blackjack.apply(s, 0, { type: 'hit' }, r())).toThrow(RuleError);
  });

  it('kartu tertutup dealer tersembunyi sampai dibuka', () => {
    const s = afterBet();
    if (s.phase !== 'playing') return; // natural blackjack: tidak ada fase main
    const v = blackjack.view(s, 0);
    expect(v.dealer[1]).toBeNull();
    expect(JSON.stringify(v)).not.toContain(`"${s.dealer[1]}"`);
  });

  it('bust kalah, dealer stand ≥17, payout benar', () => {
    let s = blackjack.setup(seats(1), blackjack.defaultOptions, r());
    s = blackjack.apply(s, 0, { type: 'bet', amount: 100 }, r());
    // Rig ulang tangan untuk hasil pasti.
    s.phase = 'playing'; s.toAct = 0;
    s.seats[0].hand = ['TS', '6D']; s.seats[0].done = false;
    s.dealer = ['9H', '8C'];
    s.deck = ['KD', '2C', '3C'];
    s = blackjack.apply(s, 0, { type: 'hit' }, r()); // 26 → bust
    expect(s.seats[0].done).toBe(true);
    s = blackjack.advance(s, r());
    expect(s.seats[0].outcome).toBe('lose');
    expect(s.seats[0].chips).toBe(900);
    expect(handTotal(s.dealer).total).toBe(17);
  });

  it('double: taruhan dua kali, tepat satu kartu', () => {
    let s = afterBet();
    s.phase = 'playing'; s.toAct = 0;
    s.seats[0].hand = ['5S', '6D']; s.seats[0].done = false;
    s.dealer = ['TH', '7C'];
    s.deck = ['TD', '2C'];
    s = blackjack.apply(s, 0, { type: 'double' }, r());
    expect(s.seats[0].bet).toBe(200);
    expect(s.seats[0].hand).toHaveLength(3);
    s = blackjack.advance(s, r());
    expect(s.seats[0].outcome).toBe('win'); // 21 vs 17
    expect(s.seats[0].chips).toBe(1200);
  });

  it('blackjack dibayar 3:2', () => {
    let s = afterBet();
    s.phase = 'dealer'; s.toAct = null;
    s.seats[0].hand = ['AS', 'KD']; s.seats[0].done = true;
    s.dealer = ['9H', '8C'];
    s = blackjack.advance(s, r());
    expect(s.seats[0].outcome).toBe('blackjack');
    expect(s.seats[0].chips).toBe(1150);
  });

  it.each([1, 2, 4])('%i bot bermain sampai selesai', (n) => {
    const s = simulate(blackjack, n, 3 + n) as BlackjackState;
    expect(s.phase).toBe('gameOver');
    expect(blackjack.results(s)).toHaveLength(n);
  });

  it('100 simulasi blackjack dengan autoDelay dan 10 ronde', () => {
    for (let i = 0; i < 100; i++) {
      const rng = seededRng(i * 137 + 1);
      let s = blackjack.setup(seats(4).map(p => ({ ...p, isBot: true })), blackjack.sanitizeOptions({ rounds: 10 }), rng);
      let steps = 0;
      while (!blackjack.isOver(s) && steps < 5000) {
        steps++;
        const delay = blackjack.autoDelay(s);
        if (delay !== null) {
          s = blackjack.advance(s, rng);
          continue;
        }
        const seat = blackjack.currentSeat(s);
        if (seat === null) {
          throw new Error(`Meja macet di round ${s.round}, phase: ${s.phase}`);
        }
        const v = blackjack.view(s, seat);
        const action = blackjack.bot(v, 'hard', rng);
        s = blackjack.apply(s, seat, action, rng);
      }
      expect(blackjack.isOver(s)).toBe(true);
      expect(steps).toBeLessThan(5000);
    }
  });
});
