import { describe, expect, it } from 'vitest';
import {
  holdem, omaha, shortDeck, legalFor, getGame, seededRng, RuleError, estimateEquity,
  bestShortDeckHand, evaluate5ShortDeck, bestOmahaHand, compareScores, HandCategory, shortDeckCards,
  evaluateVariant, type HoldemAction, type HoldemModule, type HoldemState, type Rng, type Difficulty,
} from '../src';
import { seats } from './helpers';

const rng = () => seededRng(42);

/** Susun tangan: deck = burn, flop(3), burn, turn, burn, river, sisa. */
function rig(s: HoldemState, holes: string[][], board: string[]) {
  holes.forEach((h, i) => { s.seats[i].hole = h; });
  const used = new Set([...holes.flat(), ...board]);
  const filler = shortDeckCards().filter(c => !used.has(c));
  s.deck = [filler[0], board[0], board[1], board[2], filler[1], board[3], filler[2], board[4], ...filler.slice(3)];
}

function act(g: HoldemModule, s: HoldemState, seat: number, a: HoldemAction, r: Rng = rng()): HoldemState {
  let x = g.apply(s, seat, a, r);
  while (x.toAct === null && x.street !== 'handOver' && x.street !== 'gameOver') x = g.advance(x, r);
  return x;
}

/** Heads-up: limp lalu check sampai showdown. */
function checkDown(g: HoldemModule, s: HoldemState): HoldemState {
  s = act(g, s, s.toAct!, { type: 'call' });
  while (s.street !== 'handOver') s = act(g, s, s.toAct!, { type: 'check' });
  return s;
}

const sd = (cards: string) => bestShortDeckHand(cards.split(' '));
const sdCmp = (a: string, b: string) => compareScores(sd(a).score, sd(b).score);

describe('registry & setup varian', () => {
  it('registry memakai modul varian baru', () => {
    expect(getGame('omaha')).toBe(omaha);
    expect(getGame('short-deck')).toBe(shortDeck);
    expect(getGame('holdem')).toBe(holdem);
    expect(omaha.id).toBe('omaha');
    expect(shortDeck.id).toBe('short-deck');
    expect(omaha.minPlayers).toBe(2);
    expect(omaha.maxPlayers).toBe(9);
  });

  it('Omaha: 4 kartu tangan, deck 52, gameId = omaha', () => {
    const s = omaha.setup(seats(9), omaha.defaultOptions, rng());
    expect(s.gameId).toBe('omaha');
    for (const x of s.seats) expect(x.hole).toHaveLength(4);
    const all = [...s.deck, ...s.seats.flatMap(x => x.hole)];
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
    const v = omaha.view(s, 0);
    expect(v.gameId).toBe('omaha');
    expect(v.seats[1].hole).toEqual([null, null, null, null]);
    expect(v.legal).toBeNull();
    expect(omaha.view(s, s.toAct).legal!.potLimit).toBe(true);
  });

  it('Short Deck: deck 36 kartu (6..A), 2 kartu tangan', () => {
    const d = shortDeckCards();
    expect(d).toHaveLength(36);
    expect(new Set(d).size).toBe(36);
    expect(d.some(c => '2345'.includes(c[0]))).toBe(false);
    const s = shortDeck.setup(seats(9), shortDeck.defaultOptions, rng());
    expect(s.gameId).toBe('short-deck');
    for (const x of s.seats) expect(x.hole).toHaveLength(2);
    const all = [...s.deck, ...s.seats.flatMap(x => x.hole)];
    expect(all).toHaveLength(36);
    expect(new Set(all).size).toBe(36);
    expect(all.some(c => '2345'.includes(c[0]))).toBe(false);
  });

  it("Hold'em tetap No-Limit dan 2 kartu", () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const l = legalFor(s, s.toAct!)!;
    expect(l.maxTo).toBe(1000);
    expect(l.potLimit).toBeUndefined();
    expect(s.gameId).toBe('holdem');
  });

  it('jumlah pemain divalidasi', () => {
    expect(() => omaha.setup(seats(10), omaha.defaultOptions, rng())).toThrow(RuleError);
    expect(() => shortDeck.setup(seats(1), shortDeck.defaultOptions, rng())).toThrow(RuleError);
  });
});

describe('Omaha — wajib tepat 2 kartu tangan + 3 board', () => {
  it('satu kartu flush di tangan tidak membentuk flush', () => {
    const v = bestOmahaHand(['TS', '3C', '4D', '5H'], ['AS', 'KS', 'QS', 'JS', '2D']);
    expect(v.category).toBe(HandCategory.HighCard);
  });

  it('showdown: pair kecil mengalahkan "royal flush" yang hanya pakai 1 kartu tangan', () => {
    let s = omaha.setup(seats(2), omaha.defaultOptions, rng());
    rig(s, [['TS', '3C', '4D', '5H'], ['2C', '7H', '8H', '9C']], ['AS', 'KS', 'QS', 'JS', '2D']);
    s = checkDown(omaha, s);
    expect(s.lastHand!.winners).toEqual([{ seat: 1, amount: 40, hand: 'One Pair' }]);
    expect(s.seats[1].stack).toBe(1020);
  });

  it('showdown: straight di board tidak bisa dipakai dengan 1 kartu tangan', () => {
    let s = omaha.setup(seats(2), omaha.defaultOptions, rng());
    // Di Hold'em seat0 punya straight A-high; di Omaha hanya pair 2.
    rig(s, [['AH', '2C', '2D', '2S'], ['9H', '8C', '4D', '5D']], ['TS', 'JD', 'QH', 'KC', '3S']);
    s = checkDown(omaha, s);
    expect(s.lastHand!.winners).toEqual([{ seat: 1, amount: 40, hand: 'Straight' }]);
    expect(evaluateVariant('omaha', ['AH', '2C', '2D', '2S'], ['TS', 'JD', 'QH', 'KC', '3S']).category).toBe(HandCategory.OnePair);
    expect(evaluateVariant('holdem', ['AH', '2C'], ['TS', 'JD', 'QH', 'KC', '3S']).category).toBe(HandCategory.Straight);
  });

  it('split pot ketika kedua tangan sama kuat', () => {
    let s = omaha.setup(seats(2), omaha.defaultOptions, rng());
    rig(s, [['AH', 'KD', '3C', '4C'], ['AD', 'KH', '3D', '4D']], ['AS', 'KS', '7H', '8C', '9D']);
    s = checkDown(omaha, s);
    expect(s.lastHand!.winners).toHaveLength(2);
    expect(s.seats[0].stack).toBe(1000);
    expect(s.seats[1].stack).toBe(1000);
  });
});

describe('Omaha — Pot-Limit', () => {
  it('pre-flop: UTG raise maksimum = 70 (BB 20, pot 30 + call 20)', () => {
    const s = omaha.setup(seats(3), omaha.defaultOptions, rng());
    const l = legalFor(s, s.toAct!)!;
    expect(l.callAmount).toBe(20);
    expect(l.minRaiseTo).toBe(40);
    expect(l.maxTo).toBe(70);
    expect(l.canAllIn).toBe(false);
    expect(() => omaha.apply(s, s.toAct!, { type: 'raise', amount: 71 }, rng())).toThrow(/Pot-Limit/);
    expect(() => omaha.apply(s, s.toAct!, { type: 'allin' }, rng())).toThrow(/Pot-Limit/);
    const s2 = omaha.apply(s, s.toAct!, { type: 'raise', amount: 70 }, rng());
    expect(s2.currentBet).toBe(70);
  });

  it('re-raise: batas = currentBet + pot + call', () => {
    let s = omaha.setup(seats(3), omaha.defaultOptions, rng());
    s = act(omaha, s, s.toAct!, { type: 'raise', amount: 70 }); // pot = 10 + 20 + 70 = 100
    const seat = s.toAct!;
    const l = legalFor(s, seat)!;
    const toCall = 70 - s.seats[seat].bet;
    expect(l.callAmount).toBe(toCall);
    expect(l.maxTo).toBe(70 + 100 + toCall);
    expect(l.minRaiseTo).toBe(120);
  });

  it('post-flop: bet maksimum = pot', () => {
    let s = omaha.setup(seats(3), omaha.defaultOptions, rng());
    while (s.street === 'preflop') {
      const l = legalFor(s, s.toAct!)!;
      s = act(omaha, s, s.toAct!, l.canCheck ? { type: 'check' } : { type: 'call' });
    }
    expect(s.street).toBe('flop');
    const l = legalFor(s, s.toAct!)!;
    expect(l.minBet).toBe(20);
    expect(l.maxTo).toBe(60);
    expect(l.canAllIn).toBe(false);
    expect(() => omaha.apply(s, s.toAct!, { type: 'bet', amount: 61 }, rng())).toThrow(/Pot-Limit/);
    s = act(omaha, s, s.toAct!, { type: 'bet', amount: 60 });
    // Pot 120, call 60 → raise maksimum 60 + 120 + 60 = 240.
    expect(legalFor(s, s.toAct!)!.maxTo).toBe(240);
  });

  it('all-in diperbolehkan bila stack masih dalam batas pot, atau sebagai call', () => {
    const s = omaha.setup(seats(3), omaha.defaultOptions, rng());
    const utg = s.toAct!;
    const short = structuredClone(s);
    short.seats[utg].stack = 50;
    const l = legalFor(short, utg)!;
    expect(l.canAllIn).toBe(true);
    expect(l.maxTo).toBe(50);
    const after = omaha.apply(short, utg, { type: 'allin' }, rng());
    expect(after.seats[utg].allIn).toBe(true);
    expect(after.currentBet).toBe(50);

    const tiny = structuredClone(s);
    tiny.seats[utg].stack = 15;
    const lt = legalFor(tiny, utg)!;
    expect(lt.canAllIn).toBe(true);
    expect(lt.minRaiseTo).toBeNull();
    expect(lt.callAmount).toBe(15);
  });

  it('bot Omaha selalu memilih aksi legal (termasuk batas pot)', () => {
    for (let seed = 1; seed <= 16; seed++) {
      const r = seededRng(seed);
      let s = omaha.setup(seats(4).map(p => ({ ...p, isBot: true })), omaha.sanitizeOptions({ maxHands: 3 }), r);
      for (let step = 0; step < 400 && !omaha.isOver(s); step++) {
        const seat = omaha.currentSeat(s);
        if (seat === null) { s = omaha.advance(s, r); continue; }
        const a = omaha.bot(omaha.view(s, seat), seed % 2 ? 'hard' : 'normal', r);
        const l = legalFor(s, seat)!;
        if (a.type === 'bet' || a.type === 'raise') expect(a.amount).toBeLessThanOrEqual(l.maxTo);
        s = omaha.apply(s, seat, a, r);
      }
    }
  });
});

describe('Short Deck — evaluator (aturan Triton)', () => {
  it('A-6-7-8-9 adalah straight dengan high card 9', () => {
    const v = evaluate5ShortDeck('AS 6H 7D 8C 9S'.split(' '));
    expect(v.category).toBe(HandCategory.Straight);
    expect(v.name).toBe('Straight');
    expect(v.score.slice(1)).toEqual([9]);
    // Kalah dari 6-7-8-9-T, menang dari high card.
    expect(sdCmp('AS 6H 7D 8C 9S', '6S 7H 8D 9C TS')).toBeLessThan(0);
    expect(sdCmp('AS 6H 7D 8C 9S', 'AH KD QC 9H 7C')).toBeGreaterThan(0);
  });

  it('A-6-7-8-9 suited adalah straight flush', () => {
    const v = evaluate5ShortDeck('AH 6H 7H 8H 9H'.split(' '));
    expect(v.category).toBe(HandCategory.StraightFlush);
    expect(v.score.slice(1)).toEqual([9]);
  });

  it('wheel A-2-3-4-5 tidak mungkin: bukan straight, dan kartu 2–5 tidak ada di deck', () => {
    expect(evaluate5ShortDeck('AS 2H 3D 4C 5S'.split(' ')).category).toBe(HandCategory.HighCard);
    const deck = shortDeckCards();
    for (const c of ['2S', '3H', '4D', '5C']) expect(deck).not.toContain(c);
  });

  it('Flush mengalahkan Full House', () => {
    expect(sd('AS JS 9S 7S 6S').name).toBe('Flush');
    expect(sd('KH KD KC 6D 6C').name).toBe('Full House');
    expect(sdCmp('AS JS 9S 7S 6S', 'KH KD KC 6D 6C')).toBeGreaterThan(0);
    expect(sdCmp('7S 8S 9S JS QS', 'AH AD AC KD KC')).toBeGreaterThan(0);
  });

  it('Three of a Kind mengalahkan Straight', () => {
    expect(sdCmp('6H 6D 6C 9S QH', 'TS JH QD KC AS')).toBeGreaterThan(0);
  });

  it('urutan lain tetap: quads > flush, straight > two pair, straight flush > quads', () => {
    expect(sdCmp('9H 9D 9C 9S 6H', 'AS JS 9S 7S 6S')).toBeGreaterThan(0);
    expect(sdCmp('6S 7H 8D 9C TS', 'AH AD KC KD QH')).toBeGreaterThan(0);
    expect(sdCmp('6S 7S 8S 9S TS', 'AH AD AC AS KH')).toBeGreaterThan(0);
    expect(sd('TH JH QH KH AH').name).toBe('Royal Flush');
  });

  it('best of 7 memilih flush daripada full house', () => {
    const v = sd('AH AD AC KH KD 7H 9H');
    // Hanya 4 hati (AH KH 7H 9H) → tidak flush; full house.
    expect(v.name).toBe('Full House');
    // Lima hati + two pair: flush dipilih.
    const f = sd('AH 6H AC KH KD 7H 9H');
    expect(f.name).toBe('Flush');
  });

  it('showdown Short Deck: flush menang atas full house', () => {
    let s = shortDeck.setup(seats(2), shortDeck.defaultOptions, rng());
    rig(s, [['AH', 'JH'], ['KS', 'KD']], ['KH', '6H', '6S', '9H', 'TC']);
    s = checkDown(shortDeck, s);
    expect(s.lastHand!.winners).toEqual([{ seat: 0, amount: 40, hand: 'Flush' }]);
  });

  it('showdown Short Deck: trips menang atas straight', () => {
    let s = shortDeck.setup(seats(2), shortDeck.defaultOptions, rng());
    rig(s, [['QC', 'QD'], ['JS', 'TH']], ['QS', '9D', '8C', '6H', '7S']);
    s = checkDown(shortDeck, s);
    expect(s.lastHand!.winners).toEqual([{ seat: 0, amount: 40, hand: 'Three of a Kind' }]);
  });
});

describe('equity varian', () => {
  it('Omaha (4 kartu) & Short Deck menghasilkan nilai 0..1; jumlah kartu salah → 0', () => {
    const r = seededRng(3);
    const eo = estimateEquity(['AS', 'AH', 'KS', 'KH'], [], 3, 40, r, 'omaha');
    expect(eo).toBeGreaterThan(0.2);
    expect(eo).toBeLessThanOrEqual(1);
    expect(estimateEquity(['AS', 'AH', 'KS', 'KH'], [], 3, 40, r, 'holdem')).toBe(0);
    expect(estimateEquity(['AS', 'AH'], [], 1, 40, r, 'omaha')).toBe(0);
    const es = estimateEquity(['AS', 'AH'], ['AD', 'AC', '6H'], 2, 60, r, 'short-deck');
    expect(es).toBeGreaterThan(0.9);
    // 9 pemain Short Deck: deck tidak boleh habis.
    expect(() => estimateEquity(['7S', '8H'], [], 8, 20, r, 'short-deck')).not.toThrow();
  });
});

/* ------------------------------- fuzz -------------------------------- */

function randomAction(s: HoldemState, seat: number, r: Rng): HoldemAction {
  const l = legalFor(s, seat)!;
  const opts: HoldemAction[] = [{ type: 'fold' }];
  if (l.canCheck) opts.push({ type: 'check' }, { type: 'check' });
  if (l.callAmount > 0) opts.push({ type: 'call' }, { type: 'call' });
  if (l.minBet !== null) opts.push({ type: 'bet', amount: l.minBet + r.int(l.maxTo - l.minBet + 1) });
  if (l.minRaiseTo !== null) opts.push({ type: 'raise', amount: l.minRaiseTo + r.int(l.maxTo - l.minRaiseTo + 1) });
  if (l.canAllIn) opts.push({ type: 'allin' });
  return opts[r.int(opts.length)];
}

function runGame(
  g: HoldemModule, n: number, seed: number, opts: Record<string, unknown>,
  pick: (s: HoldemState, seat: number, r: Rng) => HoldemAction,
) {
  const r = seededRng(seed);
  const o = g.sanitizeOptions(opts);
  let s = g.setup(seats(n).map(p => ({ ...p, isBot: true })), o, r);
  const total = n * o.startingStack;
  const deckSize = g.id === 'short-deck' ? 36 : 52;
  for (let step = 0; step < 6000 && !g.isOver(s); step++) {
    const seat = g.currentSeat(s);
    s = seat === null ? g.advance(s, r) : g.apply(s, seat, pick(s, seat, r), r);
    const settled = s.street === 'handOver' || s.street === 'gameOver';
    const sum = s.seats.reduce((t, x) => t + x.stack + (settled ? 0 : x.contributed), 0);
    if (sum !== total) throw new Error(`${g.id} seed ${seed}: chip ${sum} != ${total} di ${s.street}`);
    const cards = [...s.deck, ...s.board, ...s.seats.flatMap(x => x.hole)];
    if (new Set(cards).size !== cards.length) throw new Error(`${g.id} seed ${seed}: kartu duplikat`);
    if (cards.length > deckSize) throw new Error(`${g.id} seed ${seed}: kartu berlebih`);
    if (s.seats.some(x => x.stack < 0)) throw new Error(`${g.id} seed ${seed}: stack negatif`);
  }
  return s;
}

describe.each([omaha, shortDeck])('fuzz $id', (g) => {
  it('120 permainan aksi acak: tidak ada aksi ilegal, chip terjaga, kartu unik', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const n = 2 + (seed % 8);
      const s = runGame(g, n, seed, { startingStack: 200 + (seed % 7) * 100, bigBlind: 20, maxHands: 30 }, randomAction);
      expect(g.isOver(s)).toBe(true);
    }
  });

  it('bot vs bot (berbagai seed, jumlah pemain & tingkat kesulitan): chip terjaga', () => {
    const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
    for (const [k, n] of [2, 3, 5, 9].entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const diff = diffs[(seed + k) % 3];
        const s = runGame(g, n, seed * 31 + n, { startingStack: 400, bigBlind: 20, maxHands: 6 },
          (st, seat, r) => g.bot(g.view(st, seat), diff, r));
        expect(g.isOver(s)).toBe(true);
        expect(s.seats.reduce((t, x) => t + x.stack, 0)).toBe(n * 400);
        expect(g.results(s)![0].rank).toBe(1);
      }
    }
  });
});
