// blackjack.ts — Blackjack, 1–4 pemain melawan dealer (bandar otomatis).
//
// Aturan: 6 deck dikocok ulang setiap ronde (single-deck opsional), blackjack membayar 3:2,
// dealer stand di soft 17 (opsi H17), double down hanya pada dua kartu awal,
// dealer mengintip blackjack bila kartu terbukanya As/10 (US hole card).
// Belum ada: split, insurance, surrender (tidak ditampilkan sebagai tombol).

import { type Card, draw, rankOf, shuffledDeck, cardLabel } from './cards';
import type { Rng } from './rng';
import {
  type BaseView, type Difficulty, type GameModule, type LogEntry, type OptionSpec,
  type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog,
} from './types';

export type BlackjackAction =
  | { type: 'bet'; amount: number }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' };

export interface BlackjackOptions {
  startingChips: number;
  minBet: number;
  rounds: number;
  decks: number;
  dealerHitsSoft17: boolean;
  blackjackPayout?: '3:2' | '6:5';
  allowDoubleAnyTwo?: boolean;
  turnSeconds?: number;
  passAndPlay?: boolean;
}

type Phase = 'betting' | 'playing' | 'dealer' | 'roundOver' | 'gameOver';

interface BjSeat {
  name: string;
  isBot: boolean;
  chips: number;
  bet: number;
  hand: Card[];
  done: boolean;
  doubled: boolean;
  outcome: 'win' | 'lose' | 'push' | 'blackjack' | null;
  /** Tidak ikut (chip < taruhan minimum). */
  out: boolean;
}

export interface BlackjackState {
  gameId: 'blackjack';
  options: BlackjackOptions;
  seats: BjSeat[];
  dealer: Card[];
  dealerRevealed: boolean;
  deck: Card[];
  phase: Phase;
  round: number;
  toAct: number | null;
  log: LogEntry[];
}

export interface BlackjackView extends BaseView {
  gameId: 'blackjack';
  seats: { name: string; isBot: boolean; chips: number; bet: number; hand: Card[]; total: number; soft: boolean; outcome: BjSeat['outcome']; out: boolean; done: boolean }[];
  dealer: (Card | null)[];
  dealerTotal: number | null;
  phase: Phase;
  round: number;
  rounds: number;
  minBet: number;
  legal: { canBet: boolean; minBet: number; maxBet: number; canHit: boolean; canStand: boolean; canDouble: boolean } | null;
}

const DEFAULTS: BlackjackOptions = {
  startingChips: 1000,
  minBet: 10,
  rounds: 10,
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPayout: '3:2',
  allowDoubleAnyTwo: true,
  turnSeconds: 15,
  passAndPlay: false,
};

const OPTIONS: OptionSpec[] = [
  {
    key: 'startingChips',
    label: 'Chip Awal',
    type: 'select',
    choices: [
      { value: 500, label: '500 Chip (Santai)' },
      { value: 1000, label: '1.000 Chip (Standar)' },
      { value: 5000, label: '5.000 Chip (High Roller)' },
      { value: 10000, label: '10.000 Chip (VIP)' },
    ],
    help: 'Jumlah modal chip awal setiap pemain'
  },
  {
    key: 'minBet',
    label: 'Taruhan Minimum',
    type: 'select',
    choices: [
      { value: 5, label: '5 Chip' },
      { value: 10, label: '10 Chip' },
      { value: 25, label: '25 Chip' },
      { value: 50, label: '50 Chip' },
      { value: 100, label: '100 Chip' },
    ],
    help: 'Batas taruhan terendah per tangan ronde'
  },
  {
    key: 'decks',
    label: 'Jumlah Deck Kartu (Shoe)',
    type: 'select',
    choices: [
      { value: 1, label: '1 Deck (Single Deck - Klasik)' },
      { value: 2, label: '2 Decks (Double Deck)' },
      { value: 4, label: '4 Decks (Mid Shoe)' },
      { value: 6, label: '6 Decks (Standar Kasino Vegas)' },
      { value: 8, label: '8 Decks (Shoe Besar)' },
    ],
    help: 'Semakin banyak deck, peluang kartu keluar semakin seimbang dan menantang'
  },
  {
    key: 'blackjackPayout',
    label: 'Rasio Pembayaran Blackjack Alami',
    type: 'select',
    choices: [
      { value: '3:2', label: '3:2 (Rekomendasi - Untung Pemain)' },
      { value: '6:5', label: '6:5 (Kasino Modern)' },
    ],
    help: 'Besar keuntungan saat mendapatkan kombinasi As + 10 pada 2 kartu pertama'
  },
  {
    key: 'dealerHitsSoft17',
    label: 'Aturan Dealer pada Soft 17',
    type: 'select',
    choices: [
      { value: 0, label: 'Dealer Stand pada Soft 17 (S17 - Rekomendasi)' },
      { value: 1, label: 'Dealer Wajib Hit pada Soft 17 (H17)' },
    ],
    help: 'Soft 17 adalah kartu bandar berjumlah 17 dengan As yang bernilai 11'
  },
  {
    key: 'allowDoubleAnyTwo',
    label: 'Bebas Double Down pada 2 Kartu Pertama',
    type: 'boolean',
    help: 'Izinkan menggandakan nilai taruhan untuk tepat 1 kartu tambahan di kombinasi angka berapapun'
  },
  {
    key: 'turnSeconds',
    label: 'Batas Waktu Giliran',
    type: 'select',
    choices: [
      { value: 10, label: '10 Detik (Kilat)' },
      { value: 15, label: '15 Detik (Standar)' },
      { value: 25, label: '25 Detik (Santai)' },
    ],
    help: 'Waktu berpikir sebelum otomatis Stand'
  },
  { key: 'rounds', label: 'Jumlah Ronde Pertandingan', type: 'number', min: 1, max: 100, step: 5, help: 'Total putaran kartu sebelum game berakhir' },
  { key: 'passAndPlay', label: 'Mode Operan HP (Multiplayer Lokal)', type: 'boolean', help: 'Tampilkan layar privasi saat berganti giliran antar pemain fisik' },
];

/** Total terbaik ≤ 21 jika mungkin; soft = ada As yang dihitung 11. */
export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 14) { aces++; total += 11; } else total += Math.min(r, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards: Card[]) => cards.length === 2 && handTotal(cards).total === 21;

const log = (s: BlackjackState, seat: number | null, text: string) => pushLog(s.log, { seat, text });

function nextSeat(s: BlackjackState, from: number, pred: (x: BjSeat) => boolean): number | null {
  for (let i = from + 1; i < s.seats.length; i++) if (pred(s.seats[i])) return i;
  return null;
}

function startRound(s: BlackjackState, rng: Rng) {
  s.round += 1;
  s.deck = shuffledDeck(rng, s.options.decks);
  s.dealer = [];
  s.dealerRevealed = false;
  for (const x of s.seats) {
    Object.assign(x, { bet: 0, hand: [], done: false, doubled: false, outcome: null, out: x.chips < s.options.minBet });
  }
  s.phase = 'betting';
  s.toAct = nextSeat(s, -1, x => !x.out);
  if (s.toAct === null) {
    s.phase = 'gameOver';
    log(s, null, 'Permainan selesai');
    return;
  }
  log(s, null, `Ronde ${s.round} — pasang taruhan`);
}

function deal(s: BlackjackState) {
  const players = s.seats.filter(x => !x.out);
  for (let r = 0; r < 2; r++) {
    for (const x of players) x.hand.push(...draw(s.deck, 1));
    s.dealer.push(...draw(s.deck, 1));
  }
  // Dealer mengintip blackjack jika kartu terbuka As atau bernilai 10.
  const up = rankOf(s.dealer[0]);
  if ((up === 14 || up >= 10) && isBlackjack(s.dealer)) {
    log(s, null, 'Dealer blackjack!');
    for (const x of players) x.done = true;
    s.toAct = null;
    s.phase = 'dealer';
    return;
  }
  for (const x of players) if (isBlackjack(x.hand)) { x.done = true; log(s, null, `${x.name} BLACKJACK!`); }
  s.phase = 'playing';
  s.toAct = nextSeat(s, -1, x => !x.out && !x.done);
  if (s.toAct === null) s.phase = 'dealer';
}

function dealerPlayAndSettle(s: BlackjackState) {
  s.dealerRevealed = true;
  const live = s.seats.filter(x => !x.out && handTotal(x.hand).total <= 21 && !isBlackjack(x.hand));
  const dealerBj = isBlackjack(s.dealer);
  if (live.length && !dealerBj) {
    for (;;) {
      const { total, soft } = handTotal(s.dealer);
      if (total < 17 || (total === 17 && soft && s.options.dealerHitsSoft17)) s.dealer.push(...draw(s.deck, 1));
      else break;
    }
  }
  const d = handTotal(s.dealer).total;
  log(s, null, `Dealer: ${s.dealer.map(cardLabel).join(' ')} = ${d}${d > 21 ? ' (bust)' : ''}`);
  for (const x of s.seats) {
    if (x.out) continue;
    const p = handTotal(x.hand).total;
    let delta = 0;
    if (isBlackjack(x.hand) && !dealerBj) { x.outcome = 'blackjack'; delta = Math.floor(x.bet * 1.5); }
    else if (p > 21) { x.outcome = 'lose'; delta = -x.bet; }
    else if (dealerBj && !isBlackjack(x.hand)) { x.outcome = 'lose'; delta = -x.bet; }
    else if (dealerBj && isBlackjack(x.hand)) { x.outcome = 'push'; }
    else if (d > 21 || p > d) { x.outcome = 'win'; delta = x.bet; }
    else if (p < d) { x.outcome = 'lose'; delta = -x.bet; }
    else x.outcome = 'push';
    // Taruhan sudah dipotong saat bet/double; kembalikan modal + kemenangan.
    if (x.outcome !== 'lose') x.chips += x.bet + delta;
    log(s, null, `${x.name}: ${x.outcome === 'push' ? 'seri' : x.outcome === 'lose' ? `kalah ${x.bet}` : `menang ${delta}`}`);
  }
  s.toAct = null;
  const anyone = s.seats.some(x => x.chips >= s.options.minBet);
  s.phase = s.round >= s.options.rounds || !anyone ? 'gameOver' : 'roundOver';
  if (s.phase === 'gameOver') log(s, null, 'Permainan selesai');
}

function afterPlayerMove(s: BlackjackState, seat: number) {
  const x = s.seats[seat];
  const t = handTotal(x.hand).total;
  if (t > 21) { x.done = true; log(s, seat, `${x.name} bust (${t})`); }
  else if (t === 21) x.done = true;
  if (x.done) {
    s.toAct = nextSeat(s, seat, y => !y.out && !y.done);
    if (s.toAct === null) s.phase = 'dealer';
  }
}

export function legalBlackjack(s: BlackjackState, seat: number): BlackjackView['legal'] {
  if (s.toAct !== seat) return null;
  const x = s.seats[seat];
  if (s.phase === 'betting') {
    return { canBet: true, minBet: s.options.minBet, maxBet: x.chips, canHit: false, canStand: false, canDouble: false };
  }
  if (s.phase === 'playing') {
    return {
      canBet: false, minBet: s.options.minBet, maxBet: x.chips,
      canHit: true, canStand: true, canDouble: x.hand.length === 2 && x.chips >= x.bet,
    };
  }
  return null;
}

export const blackjack: GameModule<BlackjackState, BlackjackAction, BlackjackView, BlackjackOptions> = {
  id: 'blackjack',
  minPlayers: 1,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Partial<BlackjackOptions>;
    const minBet = clampInt(r.minBet, 1, 1000, DEFAULTS.minBet);
    const d = Number(r.decks);
    const validDecks = [1, 2, 4, 6, 8].includes(d) ? d : 6;
    return {
      startingChips: clampInt(r.startingChips, Math.max(100, minBet * 5), 100000, DEFAULTS.startingChips),
      minBet,
      rounds: clampInt(r.rounds, 1, 100, DEFAULTS.rounds),
      decks: validDecks,
      dealerHitsSoft17: Boolean(Number(r.dealerHitsSoft17)) || r.dealerHitsSoft17 === true,
      blackjackPayout: r.blackjackPayout === '6:5' ? '6:5' : '3:2',
      allowDoubleAnyTwo: r.allowDoubleAnyTwo !== undefined ? Boolean(r.allowDoubleAnyTwo) : true,
      turnSeconds: typeof r.turnSeconds === 'number' ? clampInt(r.turnSeconds, 5, 60, 15) : 15,
      passAndPlay: Boolean(r.passAndPlay),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 1 || seats.length > 4) throw new RuleError('Blackjack untuk 1–4 pemain');
    const s: BlackjackState = {
      gameId: 'blackjack', options,
      seats: seats.map(p => ({ name: p.name, isBot: !!p.isBot, chips: options.startingChips, bet: 0, hand: [], done: false, doubled: false, outcome: null, out: false })),
      dealer: [], dealerRevealed: false, deck: [], phase: 'betting', round: 0, toAct: null, log: [],
    };
    startRound(s, rng);
    return s;
  },

  currentSeat: s => s.toAct,

  apply(state, seat, action) {
    if (state.toAct !== seat) throw new RuleError('Bukan giliranmu');
    const legal = legalBlackjack(state, seat);
    if (!legal) throw new RuleError('Tidak ada aksi saat ini');
    const s = clone(state);
    const x = s.seats[seat];
    switch (action?.type) {
      case 'bet': {
        if (!legal.canBet) throw new RuleError('Bukan saatnya bertaruh');
        const amt = Math.floor(Number((action as { amount: number }).amount));
        if (!Number.isFinite(amt) || amt < legal.minBet) throw new RuleError(`Taruhan minimum ${legal.minBet}`);
        if (amt > x.chips) throw new RuleError('Chip tidak cukup');
        x.bet = amt;
        x.chips -= amt;
        log(s, seat, `${x.name} bertaruh ${amt}`);
        s.toAct = nextSeat(s, seat, y => !y.out);
        if (s.toAct === null) deal(s);
        break;
      }
      case 'hit':
        if (!legal.canHit) throw new RuleError('Tidak bisa hit');
        x.hand.push(...draw(s.deck, 1));
        log(s, seat, `${x.name} hit: ${cardLabel(x.hand[x.hand.length - 1])}`);
        afterPlayerMove(s, seat);
        break;
      case 'stand':
        if (!legal.canStand) throw new RuleError('Tidak bisa stand');
        x.done = true;
        log(s, seat, `${x.name} stand di ${handTotal(x.hand).total}`);
        afterPlayerMove(s, seat);
        break;
      case 'double':
        if (!legal.canDouble) throw new RuleError('Double hanya pada dua kartu awal dan chip harus cukup');
        x.chips -= x.bet;
        x.bet *= 2;
        x.doubled = true;
        x.hand.push(...draw(s.deck, 1));
        x.done = true;
        log(s, seat, `${x.name} double: ${cardLabel(x.hand[2])} (${handTotal(x.hand).total})`);
        afterPlayerMove(s, seat);
        break;
      default:
        throw new RuleError('Aksi tidak dikenal');
    }
    return s;
  },

  autoDelay(s) {
    if (s.phase === 'dealer') return 900;
    if (s.phase === 'roundOver') return 3000;
    return null;
  },

  advance(state, rng) {
    const s = clone(state);
    if (s.phase === 'dealer') dealerPlayAndSettle(s);
    else if (s.phase === 'roundOver') startRound(s, rng);
    return s;
  },

  timeoutAction(s) {
    return s.phase === 'betting' ? { type: 'bet', amount: s.options.minBet } : { type: 'stand' };
  },

  view(s, seat) {
    const showHole = s.dealerRevealed;
    return {
      gameId: 'blackjack',
      you: seat,
      turn: s.toAct,
      over: s.phase === 'gameOver',
      log: s.log.slice(-30),
      results: blackjack.results(s),
      // Kartu pemain di blackjack terbuka untuk semua (aturan kasino); kartu tertutup dealer disembunyikan.
      seats: s.seats.map(x => ({ name: x.name, isBot: x.isBot, chips: x.chips, bet: x.bet, hand: x.hand.slice(), ...handTotal(x.hand), outcome: x.outcome, out: x.out, done: x.done })),
      dealer: s.dealer.map((c, i) => (i === 1 && !showHole ? null : c)),
      dealerTotal: showHole ? handTotal(s.dealer).total : s.dealer.length ? handTotal([s.dealer[0]]).total : null,
      phase: s.phase,
      round: s.round,
      rounds: s.options.rounds,
      minBet: s.options.minBet,
      legal: seat === null ? null : legalBlackjack(s, seat),
    };
  },

  bot(v, difficulty, rng) {
    const l = v.legal;
    if (!l) return { type: 'stand' };
    const me = v.seats[v.you!];
    if (l.canBet) return { type: 'bet', amount: Math.min(l.maxBet, Math.max(l.minBet, difficulty === 'easy' ? l.minBet * (1 + rng.int(3)) : l.minBet * 2)) };
    const up = v.dealer[0] ? Math.min(rankOf(v.dealer[0]) === 14 ? 11 : rankOf(v.dealer[0]), 11) : 10;
    const upVal = up >= 10 && up !== 11 ? 10 : up;
    if (difficulty === 'easy') return me.total < 15 ? { type: 'hit' } : { type: 'stand' };
    // Basic strategy (tanpa split) untuk hard/soft total.
    if (me.soft) {
      if (l.canDouble && me.total >= 15 && me.total <= 18 && upVal >= 4 && upVal <= 6) return { type: 'double' };
      if (me.total >= 19) return { type: 'stand' };
      if (me.total === 18) return upVal >= 9 ? { type: 'hit' } : { type: 'stand' };
      return { type: 'hit' };
    }
    if (l.canDouble && (me.total === 11 || (me.total === 10 && upVal <= 9) || (me.total === 9 && upVal >= 3 && upVal <= 6))) return { type: 'double' };
    if (me.total >= 17) return { type: 'stand' };
    if (me.total >= 13) return upVal <= 6 ? { type: 'stand' } : { type: 'hit' };
    if (me.total === 12) return upVal >= 4 && upVal <= 6 ? { type: 'stand' } : { type: 'hit' };
    return { type: 'hit' };
  },

  isOver: s => s.phase === 'gameOver',

  results(s) {
    if (s.phase !== 'gameOver') return null;
    const order = s.seats.map((x, i) => ({ seat: i, score: x.chips })).sort((a, b) => b.score - a.score);
    let rank = 0, prev = -1;
    return order.map((o, k) => { if (o.score !== prev) { rank = k + 1; prev = o.score; } return { ...o, rank }; });
  },
};
