import { describe, expect, it } from 'vitest';
import { holdem, legalFor, seededRng, type HoldemAction, type HoldemState, type Rng } from '../src';
import { seats } from './helpers';

/** Pilih aksi legal acak — sengaja agresif agar sering all-in & side pot. */
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

describe("Texas Hold'em — fuzz", () => {
  it('300 permainan acak: tidak ada aksi ilegal, chip selalu terjaga, kartu unik', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = seededRng(seed);
      const n = 2 + (seed % 5);
      const stacks = holdem.sanitizeOptions({ startingStack: 200 + (seed % 7) * 100, bigBlind: 20, maxHands: 40 });
      let s = holdem.setup(seats(n), stacks, r);
      const total = n * stacks.startingStack;
      for (let step = 0; step < 5000 && !holdem.isOver(s); step++) {
        const seat = holdem.currentSeat(s);
        s = seat === null ? holdem.advance(s, r) : holdem.apply(s, seat, randomAction(s, seat, r), r);
        const sum = s.seats.reduce((t, x) => t + x.stack + (s.street === 'handOver' || s.street === 'gameOver' ? 0 : x.contributed), 0);
        if (sum !== total) throw new Error(`seed ${seed}: chip ${sum} != ${total} di ${s.street}`);
        const cards = [...s.deck, ...s.board, ...s.seats.flatMap(x => x.hole)];
        if (new Set(cards).size !== cards.length) throw new Error(`seed ${seed}: kartu duplikat`);
        expect(s.seats.every(x => x.stack >= 0)).toBe(true);
      }
      expect(holdem.isOver(s)).toBe(true);
    }
  });
});
