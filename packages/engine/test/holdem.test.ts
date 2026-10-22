import { describe, expect, it } from 'vitest';
import { holdem, legalFor, type HoldemState, seededRng, RuleError, getGame, type Rng } from '../src';
import { seats, simulate } from './helpers';

const rng = () => seededRng(42);

/** Susun tangan dengan kartu tertentu (deck & hole dikontrol) untuk test showdown. */
function rig(s: HoldemState, holes: string[][], board: string[]) {
  holes.forEach((h, i) => { s.seats[i].hole = h; });
  const used = new Set([...holes.flat(), ...board]);
  // Deck: burn, flop(3), burn, turn, burn, river.
  const filler = ['2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '2D', '3D', '4D']
    .filter(c => !used.has(c));
  s.deck = [filler[0], board[0], board[1], board[2], filler[1], board[3], filler[2], board[4], ...filler.slice(3)];
}

/** Mainkan aksi; jalankan langkah otomatis sampai ada giliran atau tangan selesai. */
function act(s: HoldemState, seat: number, a: any, r: Rng = rng()): HoldemState {
  let x = holdem.apply(s, seat, a, r);
  while (x.toAct === null && x.street !== 'handOver' && x.street !== 'gameOver') x = holdem.advance(x, r);
  return x;
}

describe("Texas Hold'em — setup", () => {
  it('2 kartu tiap pemain, blind terpasang, 52 kartu total', () => {
    const s = holdem.setup(seats(4), holdem.defaultOptions, rng());
    for (const x of s.seats) expect(x.hole).toHaveLength(2);
    expect(s.seats[s.sbSeat].contributed).toBe(10);
    expect(s.seats[s.bbSeat].contributed).toBe(20);
    const all = [...s.deck, ...s.seats.flatMap(x => x.hole)];
    expect(new Set(all).size).toBe(52);
  });
  it('pre-flop: aksi pertama = kiri big blind (UTG)', () => {
    const s = holdem.setup(seats(4), holdem.defaultOptions, rng());
    expect(s.toAct).toBe((s.bbSeat + 1) % 4);
  });
  it('heads-up: button = small blind dan beraksi pertama pre-flop', () => {
    const s = holdem.setup(seats(2), holdem.defaultOptions, rng());
    expect(s.sbSeat).toBe(s.button);
    expect(s.toAct).toBe(s.button);
  });
  it('dealer button & blind bergeser tiap tangan', () => {
    let s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const b0 = s.button;
    s = act(s, s.toAct!, { type: 'fold' });
    s = act(s, s.toAct!, { type: 'fold' });
    expect(s.street).toBe('handOver');
    s = holdem.advance(s, rng());
    expect(s.button).toBe((b0 + 1) % 3);
    expect(s.sbSeat).toBe((b0 + 2) % 3);
  });
});

describe("Texas Hold'em — validasi aksi", () => {
  it('menolak aksi di luar giliran', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const other = (s.toAct! + 1) % 3;
    expect(() => holdem.apply(s, other, { type: 'fold' }, rng())).toThrow(RuleError);
  });
  it('tidak bisa check saat ada taruhan', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    expect(() => holdem.apply(s, s.toAct!, { type: 'check' }, rng())).toThrow(/check/);
  });
  it('raise minimum = currentBet + raise terakhir', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    expect(legalFor(s, s.toAct!)!.minRaiseTo).toBe(40);
    expect(() => holdem.apply(s, s.toAct!, { type: 'raise', amount: 30 }, rng())).toThrow(/minimum/);
    const s2 = holdem.apply(s, s.toAct!, { type: 'raise', amount: 100 }, rng());
    expect(legalFor(s2, s2.toAct!)!.minRaiseTo).toBe(180);
  });
  it('tidak bisa bertaruh melebihi chip', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    expect(() => holdem.apply(s, s.toAct!, { type: 'raise', amount: 5000 }, rng())).toThrow(/Chip/);
  });
  it('apply tidak memutasi state lama', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const snap = JSON.stringify(s);
    holdem.apply(s, s.toAct!, { type: 'call' }, rng());
    expect(JSON.stringify(s)).toBe(snap);
  });
  it('big blind mendapat opsi check/raise ketika semua limp', () => {
    let s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    s = act(s, s.toAct!, { type: 'call' });
    s = act(s, s.toAct!, { type: 'call' });
    expect(s.toAct).toBe(s.bbSeat);
    expect(legalFor(s, s.bbSeat)!.canCheck).toBe(true);
    s = act(s, s.bbSeat, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
  });
  it('post-flop dimulai dari pemain aktif pertama di kiri button', () => {
    let s = holdem.setup(seats(4), holdem.defaultOptions, rng());
    while (s.street === 'preflop') s = act(s, s.toAct!, legalFor(s, s.toAct!)!.canCheck ? { type: 'check' } : { type: 'call' });
    expect(s.toAct).toBe((s.button + 1) % 4);
  });
});

describe("Texas Hold'em — showdown & pot", () => {
  it('semua fold → pemain tersisa menang tanpa showdown', () => {
    let s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const bb = s.bbSeat;
    s = act(s, s.toAct!, { type: 'fold' });
    s = act(s, s.toAct!, { type: 'fold' });
    expect(s.street).toBe('handOver');
    expect(s.seats[bb].stack).toBe(1010);
    expect(s.lastHand!.showdown).toBe(false);
  });

  it('kicker menentukan pemenang', () => {
    let s = holdem.setup(seats(2), holdem.defaultOptions, rng());
    rig(s, [['AS', 'KD'], ['AH', 'QC']], ['AD', '7S', '4H', '9C', '2S']);
    s = act(s, s.toAct!, { type: 'call' });
    while (s.street !== 'handOver') s = act(s, s.toAct!, { type: 'check' });
    expect(s.lastHand!.winners).toEqual([{ seat: 0, amount: 40, hand: 'One Pair' }]);
    expect(s.seats[0].stack).toBe(1020);
  });

  it('split pot ketika board bermain', () => {
    let s = holdem.setup(seats(2), holdem.defaultOptions, rng());
    rig(s, [['2H', '3D'], ['4C', '5S']], ['AS', 'KS', 'QS', 'JS', 'TS']);
    s = act(s, s.toAct!, { type: 'call' });
    while (s.street !== 'handOver') s = act(s, s.toAct!, { type: 'check' });
    expect(s.seats[0].stack).toBe(1000);
    expect(s.seats[1].stack).toBe(1000);
    expect(s.lastHand!.winners).toHaveLength(2);
  });

  it('side pot: short stack all-in hanya menang main pot', () => {
    let s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    // Stack total: seat0 = 100 (short), seat1 & seat2 = 1000 (blind sudah terpasang).
    s.seats.forEach((x, i) => { x.stack = (i === 0 ? 100 : 1000) - x.contributed; });
    // Seat0 punya tangan terbaik (AA), seat1 kedua (KK), seat2 terburuk.
    rig(s, [['AS', 'AH'], ['KS', 'KH'], ['7D', '2C']], ['3S', '8H', '9D', 'JC', '4S']);
    const total = s.seats.reduce((t, x) => t + x.stack + x.contributed, 0);
    // Semua all-in / call sampai showdown.
    while (s.street !== 'handOver') {
      const l = legalFor(s, s.toAct!)!;
      s = act(s, s.toAct!, l.canAllIn ? { type: 'allin' } : l.callAmount ? { type: 'call' } : { type: 'check' });
    }
    expect(s.seats.reduce((t, x) => t + x.stack, 0)).toBe(total); // chip terjaga
    expect(s.seats[0].stack).toBe(300);  // main pot: 100 × 3
    expect(s.seats[1].stack).toBe(1800); // side pot: 900 × 2
    expect(s.seats[2].stack).toBe(0);
  });

  it('all-in kecil (incomplete raise) tidak membuka ulang aksi', () => {
    let s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    const order = [s.toAct!, (s.toAct! + 1) % 3, (s.toAct! + 2) % 3];
    // UTG raise ke 100.
    s = act(s, order[0], { type: 'raise', amount: 100 });
    // Pemain berikutnya punya hanya 130 total → all-in ke 130 (raise +30 < min raise 80).
    s.seats[order[1]].stack = 130 - s.seats[order[1]].bet;
    s = act(s, order[1], { type: 'allin' });
    expect(s.currentBet).toBe(130);
    // Big blind call.
    s = act(s, order[2], { type: 'call' });
    // UTG hanya boleh call/fold, tidak raise.
    expect(s.toAct).toBe(order[0]);
    const l = legalFor(s, order[0])!;
    expect(l.minRaiseTo).toBeNull();
    expect(l.callAmount).toBe(30);
  });
});

describe("Texas Hold'em — informasi tersembunyi", () => {
  it('view tidak memuat kartu lawan sebelum showdown', () => {
    const s = holdem.setup(seats(4), holdem.defaultOptions, rng());
    const v = holdem.view(s, 1);
    expect(v.seats[1].hole.every(c => c !== null)).toBe(true);
    for (const i of [0, 2, 3]) expect(v.seats[i].hole).toEqual([null, null]);
    const json = JSON.stringify(v);
    for (const i of [0, 2, 3]) for (const c of s.seats[i].hole) expect(json).not.toContain(`"${c}"`);
    expect(json).not.toContain('deck');
  });
  it('penonton tidak melihat kartu siapa pun', () => {
    const s = holdem.setup(seats(3), holdem.defaultOptions, rng());
    expect(holdem.view(s, null).seats.every(x => x.hole.every(c => c === null))).toBe(true);
  });
});

describe("Texas Hold'em — simulasi bot", () => {
  it.each([2, 3, 4, 6])('%i bot bermain sampai selesai tanpa aksi ilegal, chip terjaga', (n) => {
    const g = getGame('holdem')!;
    const s = simulate(g, n, n * 101) as HoldemState;
    expect(g.isOver(s)).toBe(true);
    expect(s.seats.reduce((t, x) => t + x.stack, 0)).toBe(n * 1000);
    const res = g.results(s)!;
    expect(res[0].rank).toBe(1);
  });
});

