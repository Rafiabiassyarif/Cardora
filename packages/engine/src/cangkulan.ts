// cangkulan.ts — Cangkulan (permainan kartu Indonesia), 2–6 pemain.
//
// VARIASI YANG DIIMPLEMENTASIKAN ("Standar Cardora" — aturan umum yang paling
// sering dimainkan; variasi lain bisa ditambahkan sebagai opsi):
//  1. Deck 52 kartu tanpa joker. Tiap pemain mendapat `handSize` kartu (default 7).
//     Sisa kartu = tumpukan cangkulan (tertutup).
//  2. Trik pertama dibuka dengan kartu teratas tumpukan (jika opsi `openWithDeck`),
//     pemain di kiri dealer mengeluarkan kartu pertama. Jika tidak, pemain di kiri
//     dealer memimpin trik pertama dengan kartu bebas.
//  3. Setiap pemain WAJIB mengeluarkan kartu dengan jenis (suit) yang sama dengan
//     kartu pembuka trik.
//  4. Jika tidak punya, pemain harus "nyangkul": mengambil kartu dari tumpukan satu
//     per satu sampai mendapat jenis yang sesuai, lalu mengeluarkannya.
//     Jika tumpukan habis dan tetap tidak punya, pemain "lewat" (pass).
//  5. Kartu dengan nilai tertinggi dari jenis pembuka memenangkan trik; pemenangnya
//     memimpin trik berikutnya dengan kartu bebas. Kartu trik dibuang.
//     Urutan nilai: As tertinggi (opsi `aceHigh`), atau As terendah.
//  6. Pemain yang kartunya habis lebih dulu menang (urutan selesai = peringkat).
//     Pemain terakhir yang masih memegang kartu kalah.

import { type Card, draw, rankOf, shuffledDeck, suitOf, cardLabel, type Suit } from './cards';
import type { Rng } from './rng';
import {
  type BaseView, type Difficulty, type GameModule, type LogEntry, type OptionSpec,
  type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog,
} from './types';

export type CangkulanAction =
  | { type: 'play'; card: Card }
  | { type: 'draw' }
  | { type: 'pass' };

export interface CangkulanOptions {
  handSize: number;
  aceHigh: boolean;
  openWithDeck: boolean;
  turnSeconds?: number;
  passAndPlay?: boolean;
  autoDrawAll?: boolean;
  scoringPenalty?: 'card_count' | 'card_value';
}

interface TrickPlay { seat: number | null; card: Card }

export interface CangkulanState {
  gameId: 'cangkulan';
  options: CangkulanOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  dealer: number;
  trick: TrickPlay[];
  leadSuit: Suit | null;
  /** Seat yang memimpin trik ini (kartu bebas). */
  leader: number;
  /** Seat yang sudah beraksi (play/pass) di trik ini. */
  acted: number[];
  toAct: number | null;
  finished: number[];
  log: LogEntry[];
  lastTrick: { plays: TrickPlay[]; winner: number | null } | null;
  /** Trik selesai, menunggu dibersihkan (jeda animasi). */
  trickDone: boolean;
  over: boolean;
}

export interface CangkulanView extends BaseView {
  gameId: 'cangkulan';
  names: string[];
  bots: boolean[];
  handCounts: number[];
  hand: Card[];
  deckCount: number;
  trick: TrickPlay[];
  leadSuit: Suit | null;
  finished: number[];
  legal: { playable: Card[]; canDraw: boolean; canPass: boolean } | null;
  lastTrick: { plays: TrickPlay[]; winner: number | null } | null;
  aceHigh: boolean;
}

const DEFAULTS: CangkulanOptions = {
  handSize: 7,
  aceHigh: true,
  openWithDeck: true,
  turnSeconds: 15,
  passAndPlay: false,
  autoDrawAll: false,
  scoringPenalty: 'card_count',
};

const OPTIONS: OptionSpec[] = [
  { key: 'passAndPlay', label: 'Mode Operan HP (Multiplayer Lokal)', type: 'boolean', help: 'Tampilkan layar privasi serahkan HP sebelum giliran berikutnya' },
  {
    key: 'handSize',
    label: 'Jumlah Kartu Awal per Pemain',
    type: 'select',
    choices: [
      { value: 5, label: '5 Kartu (Permainan Cepat & Dinamis)' },
      { value: 7, label: '7 Kartu (Standar Tradisional Cangkulan)' },
    ],
    help: 'Berapa lembar kartu yang dibagikan ke masing-masing pemain di awal permainan'
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
    help: 'Waktu berpikir sebelum sistem otomatis jalan atau nyangkul'
  },
  {
    key: 'aceHigh',
    label: 'Kekuatan Kartu As',
    type: 'select',
    choices: [
      { value: 1, label: 'As Kartu Tertinggi (K < As)' },
      { value: 0, label: 'As Kartu Terendah (As = 1 < 2)' },
    ],
    help: 'Menentukan apakah As memenangkan kartu Raja (K) atau menjadi kartu terkecil'
  },
  {
    key: 'openWithDeck',
    label: 'Trik Pertama Dibuka dari Tumpukan',
    type: 'boolean',
    help: 'Buka 1 kartu teratas tumpukan untuk menentukan jenis kembang trik pertama'
  },
  {
    key: 'autoDrawAll',
    label: 'Mode Nyangkul Cepat',
    type: 'boolean',
    help: 'Otomatis ambil kartu dari tumpukan cangkulan sekaligus sampai memperoleh jenis yang cocok'
  },
  {
    key: 'scoringPenalty',
    label: 'Sistem Penalti Poin Kalah',
    type: 'select',
    choices: [
      { value: 'card_count', label: 'Hitung Lembar Kartu Sisa (1 Poin/Kartu)' },
      { value: 'card_value', label: 'Hitung Nilai Angka Kartu (Gambar J/Q/K = 10 Poin)' },
    ],
    help: 'Metode penilaian skor penalti bagi pemain yang kartunya belum habis'
  },
];

const value = (s: CangkulanState, c: Card) => {
  const r = rankOf(c);
  return r === 14 && !s.options.aceHigh ? 1 : r;
};
const active = (s: CangkulanState, seat: number) => s.hands[seat].length > 0 && !s.finished.includes(seat);
const log = (s: CangkulanState, seat: number | null, text: string) => pushLog(s.log, { seat, text });

function nextActive(s: CangkulanState, from: number): number | null {
  const n = s.hands.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (active(s, i)) return i;
  }
  return null;
}

/** Pemain berikutnya di trik ini yang belum beraksi. */
function nextInTrick(s: CangkulanState, from: number): number | null {
  const n = s.hands.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (active(s, i) && !s.acted.includes(i)) return i;
  }
  return null;
}

function markFinished(s: CangkulanState, seat: number) {
  if (s.hands[seat].length === 0 && !s.finished.includes(seat)) {
    s.finished.push(seat);
    log(s, seat, `${s.names[seat]} kartunya habis — selesai urutan ke-${s.finished.length}!`);
  }
}

function checkOver(s: CangkulanState) {
  const remaining = s.hands.map((_, i) => i).filter(i => !s.finished.includes(i));
  if (remaining.length <= 1) {
    if (remaining.length === 1) log(s, remaining[0], `${s.names[remaining[0]]} masih memegang kartu — kalah`);
    s.over = true;
    s.toAct = null;
    return true;
  }
  return false;
}

export function legalCangkulan(s: CangkulanState, seat: number) {
  if (s.toAct !== seat || s.over) return null;
  const hand = s.hands[seat];
  if (s.leadSuit === null) return { playable: hand.slice(), canDraw: false, canPass: false };
  const follow = hand.filter(c => suitOf(c) === s.leadSuit);
  return {
    playable: follow,
    canDraw: follow.length === 0 && s.deck.length > 0,
    canPass: follow.length === 0 && s.deck.length === 0,
  };
}

function resolveTrick(s: CangkulanState) {
  const plays = s.trick.filter(p => p.seat !== null && suitOf(p.card) === s.leadSuit);
  let winner: number | null = null;
  let best = -1;
  for (const p of plays) {
    const v = value(s, p.card);
    if (v > best) { best = v; winner = p.seat; }
  }
  s.lastTrick = { plays: s.trick.slice(), winner };
  if (winner !== null) log(s, winner, `${s.names[winner]} memenangkan trik`);
  s.trickDone = true;
  s.toAct = null;
}

function startTrick(s: CangkulanState, leader: number) {
  s.trick = [];
  s.leadSuit = null;
  s.acted = [];
  s.leader = leader;
  s.trickDone = false;
  s.toAct = leader;
}

export const cangkulan: GameModule<CangkulanState, CangkulanAction, CangkulanView, CangkulanOptions> = {
  id: 'cangkulan',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Partial<CangkulanOptions>;
    return {
      handSize: clampInt(r.handSize, 5, 7, 7),
      aceHigh: r.aceHigh === undefined ? true : Boolean(Number(r.aceHigh) || r.aceHigh),
      openWithDeck: r.openWithDeck === undefined ? true : !!r.openWithDeck,
      turnSeconds: typeof r.turnSeconds === 'number' ? clampInt(r.turnSeconds, 5, 60, 15) : 15,
      passAndPlay: Boolean(r.passAndPlay),
      autoDrawAll: Boolean(r.autoDrawAll),
      scoringPenalty: r.scoringPenalty === 'card_value' ? 'card_value' : 'card_count',
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Cangkulan butuh 2–6 pemain');
    const deck = shuffledDeck(rng);
    const hands = seats.map(() => [] as Card[]);
    for (let r = 0; r < options.handSize; r++) for (const h of hands) h.push(...draw(deck, 1));
    const dealer = rng.int(seats.length);
    const s: CangkulanState = {
      gameId: 'cangkulan', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, deck, dealer, trick: [], leadSuit: null, leader: 0, acted: [], toAct: null,
      finished: [], log: [], lastTrick: null, trickDone: false, over: false,
    };
    log(s, null, `Dealer: ${s.names[dealer]}. Masing-masing ${options.handSize} kartu.`);
    const first = (dealer + 1) % seats.length;
    startTrick(s, first);
    if (options.openWithDeck) {
      const open = draw(s.deck, 1)[0];
      s.trick.push({ seat: null, card: open });
      s.leadSuit = suitOf(open);
      log(s, null, `Kartu pembuka dari tumpukan: ${cardLabel(open)}`);
    }
    return s;
  },

  currentSeat: s => s.toAct,

  apply(state, seat, action) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.toAct !== seat) throw new RuleError('Bukan giliranmu');
    const legal = legalCangkulan(state, seat)!;
    const s = clone(state);
    switch (action?.type) {
      case 'play': {
        const card = (action as { card: Card }).card;
        if (!legal.playable.includes(card)) {
          throw new RuleError(s.leadSuit ? 'Kartu harus berjenis sama dengan kartu pembuka' : 'Kartu tidak ada di tanganmu');
        }
        s.hands[seat] = s.hands[seat].filter(c => c !== card);
        s.trick.push({ seat, card });
        if (s.leadSuit === null) s.leadSuit = suitOf(card);
        s.acted.push(seat);
        log(s, seat, `${s.names[seat]} mengeluarkan ${cardLabel(card)}`);
        break;
      }
      case 'draw': {
        if (!legal.canDraw) throw new RuleError(legal.playable.length ? 'Kamu masih punya kartu yang bisa dikeluarkan' : 'Tumpukan sudah habis');
        const [c] = draw(s.deck, 1);
        s.hands[seat].push(c);
        log(s, seat, `${s.names[seat]} nyangkul 1 kartu`);
        return s; // tetap giliran pemain yang sama
      }
      case 'pass': {
        if (!legal.canPass) throw new RuleError('Tidak boleh lewat — keluarkan kartu atau nyangkul');
        s.acted.push(seat);
        log(s, seat, `${s.names[seat]} lewat (tumpukan habis)`);
        break;
      }
      default:
        throw new RuleError('Aksi tidak dikenal');
    }
    const next = nextInTrick(s, seat);
    if (next === null) resolveTrick(s);
    else s.toAct = next;
    return s;
  },

  autoDelay: s => (s.trickDone && !s.over ? 1200 : null),

  advance(state) {
    const s = clone(state);
    if (!s.trickDone) return s;
    // Tandai pemain yang kartunya habis setelah trik selesai (urut giliran).
    for (const p of s.lastTrick?.plays ?? []) if (p.seat !== null) markFinished(s, p.seat);
    if (checkOver(s)) { s.trick = []; s.trickDone = false; return s; }
    const winner = s.lastTrick?.winner ?? s.leader;
    const leader = active(s, winner) ? winner : nextActive(s, winner);
    startTrick(s, leader!);
    return s;
  },

  timeoutAction(s, seat) {
    const l = legalCangkulan(s, seat)!;
    if (l.playable.length) {
      // Kartu terendah yang sah.
      return { type: 'play', card: l.playable.slice().sort((a, b) => value(s, a) - value(s, b))[0] };
    }
    return l.canDraw ? { type: 'draw' } : { type: 'pass' };
  },

  view(s, seat) {
    return {
      gameId: 'cangkulan',
      you: seat,
      turn: s.toAct,
      over: s.over,
      log: s.log.slice(-30),
      results: cangkulan.results(s),
      names: s.names,
      bots: s.bots,
      handCounts: s.hands.map(h => h.length),
      hand: seat === null ? [] : s.hands[seat].slice(),
      deckCount: s.deck.length,
      trick: s.trick.slice(),
      leadSuit: s.leadSuit,
      finished: s.finished.slice(),
      legal: seat === null ? null : legalCangkulan(s, seat),
      lastTrick: s.lastTrick,
      aceHigh: s.options.aceHigh,
    };
  },

  bot(v, difficulty, rng) {
    const l = v.legal;
    if (!l) return { type: 'pass' };
    if (!l.playable.length) return l.canDraw ? { type: 'draw' } : { type: 'pass' };
    const val = (c: Card) => (rankOf(c) === 14 && !v.aceHigh ? 1 : rankOf(c));
    const sorted = l.playable.slice().sort((a, b) => val(a) - val(b));
    if (difficulty === 'easy') return { type: 'play', card: sorted[rng.int(sorted.length)] };
    if (v.leadSuit === null) {
      // Memimpin: keluarkan jenis yang paling banyak dipegang (lawan lebih mungkin nyangkul),
      // dengan kartu tertinggi agar besar peluang tetap memimpin.
      const bySuit = new Map<string, Card[]>();
      for (const c of v.hand) bySuit.set(c[1], [...(bySuit.get(c[1]) ?? []), c]);
      const longest = [...bySuit.values()].sort((a, b) => b.length - a.length)[0];
      const pick = longest.sort((a, b) => val(b) - val(a))[difficulty === 'hard' ? 0 : longest.length - 1];
      return { type: 'play', card: pick };
    }
    // Mengikuti: menang dengan kartu tertinggi jika bisa mengalahkan; jika tidak, buang yang terendah.
    const top = Math.max(-1, ...v.trick.filter(p => p.seat !== null && p.card[1] === v.leadSuit).map(p => val(p.card)));
    const winners = sorted.filter(c => val(c) > top);
    if (winners.length && difficulty === 'hard') return { type: 'play', card: winners[winners.length - 1] };
    if (winners.length) return { type: 'play', card: winners[0] };
    return { type: 'play', card: sorted[0] };
  },

  isOver: s => s.over,

  results(s) {
    if (!s.over) return null;
    const order = [...s.finished, ...s.hands.map((_, i) => i).filter(i => !s.finished.includes(i))];
    return order.map((seat, k) => ({ seat, rank: k + 1, score: s.hands.length - k } satisfies SeatResult));
  },
};
