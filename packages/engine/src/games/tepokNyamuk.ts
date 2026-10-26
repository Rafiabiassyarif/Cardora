// games/tepokNyamuk.ts — Tepok Nyamuk (adu refleks khas Indonesia), 2–6 pemain.
//
// Aturan yang diterapkan:
//  1. Seluruh 52 kartu dibagi rata tertutup (sisa pembagian jatuh ke pemain pertama).
//     Pemain tidak melihat kartunya sendiri.
//  2. Bergiliran, pemain membuka kartu teratasnya ke tumpukan tengah sambil hitungan maju:
//     A, 2, 3, … 10, J, Q, K, lalu kembali ke A.
//  3. Jika angka kartu SAMA dengan hitungan yang disebut → jendela tepok (±2,5 detik) terbuka:
//     semua pemain yang masih bermain menekan "Tepok!". Yang paling lambat (atau tidak menepuk)
//     mengambil seluruh tumpukan ke bawah kartunya. Bila beberapa tidak menepuk, yang terdekat
//     dari pembuka kartu (urutan giliran) yang mengambil.
//  4. Tepok saat tidak cocok = salah tepok: penepuk mengambil seluruh tumpukan.
//  5. Setelah tumpukan diambil, hitungan kembali ke A dan pengambil membuka kartu berikutnya.
//  6. Pemain yang kartunya habis (dan lolos dari jendela tepok) selamat — peringkat sesuai
//     urutan selesai. Pemain terakhir yang masih memegang kartu kalah.
//  7. Pengaman: setelah batas kartu dibuka, sisa pemain diperingkat dari kartu paling sedikit.

import { type Card, rankOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction,
  rankLabel, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export type BotSpeed = 'santai' | 'normal' | 'cepat';
export interface TepokNyamukOptions { turnSeconds: number; passAndPlay: boolean; botSpeed: BotSpeed; maxFlips: number }

export interface SlapWindow {
  openedAt: number;
  until: number;
  flipper: number;
  /** Seat yang ikut (masih bermain saat jendela dibuka). */
  participants: number[];
  /** Tepukan tercatat (ms sejak jendela dibuka). */
  slaps: { seat: number; t: number }[];
  /** Waktu reaksi bot yang sudah diundi (ms), null = tidak menepuk / bukan bot. */
  botTimes: (number | null)[];
}

export interface TepokNyamukState {
  gameId: 'tepok-nyamuk';
  options: TepokNyamukOptions;
  names: string[];
  bots: boolean[];
  /** Index 0 = kartu teratas. */
  hands: Card[][];
  pile: Card[];
  /** Index hitungan berikutnya (0 = A, 1 = 2, … 12 = K). */
  count: number;
  /** Hitungan yang disebut untuk kartu terakhir (null = belum ada). */
  lastSpoken: number | null;
  turn: number | null;
  finished: number[];
  window: SlapWindow | null;
  flips: number;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'botSpeed', label: 'Kecepatan Bot', type: 'select', choices: [
    { value: 'santai', label: '🐢 Santai' }, { value: 'normal', label: '🙂 Normal' }, { value: 'cepat', label: '⚡ Cepat' }] },
  { key: 'maxFlips', label: 'Batas Kartu Dibuka', type: 'select', choices: [
    { value: 150, label: '150 (Singkat)' }, { value: 300, label: '300 (Standar)' }, { value: 500, label: '500 (Panjang)' }],
    help: 'Pengaman: setelah batas ini, pemain dengan kartu paling sedikit yang unggul' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: TepokNyamukOptions = { turnSeconds: 15, passAndPlay: false, botSpeed: 'normal', maxFlips: 300 };
export const SLAP_WINDOW_MS = 2500;
/** Urutan hitungan dalam kode rank (A = 14). */
const SPOKEN = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const SPEED: Record<BotSpeed, { min: number; max: number; miss: number }> = {
  santai: { min: 900, max: 2300, miss: 0.15 },
  normal: { min: 550, max: 1700, miss: 0.06 },
  cepat: { min: 300, max: 1100, miss: 0.02 },
};

const spokenLabel = (idx: number) => rankLabel(SPOKEN[idx]);
const isActive = (s: TepokNyamukState, i: number) => !s.finished.includes(i);

function actionsFor(s: TepokNyamukState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || seat < 0 || seat >= s.names.length || !isActive(s, seat)) return [];
  const acts: GActionSpec[] = [];
  if (s.window) {
    if (s.window.participants.includes(seat) && !s.window.slaps.some(x => x.seat === seat)) {
      acts.push({ id: 'slap', label: 'Tepok! 🖐', style: 'danger' });
    }
    return acts;
  }
  if (s.turn === seat && s.hands[seat].length) acts.push({ id: 'flip', label: 'Buka Kartu', style: 'primary' });
  if (s.pile.length) acts.push({ id: 'slap', label: 'Tepok! 🖐', style: 'danger', hint: 'Salah tepok = ambil semua tumpukan' });
  return acts;
}

function nextActive(s: TepokNyamukState, from: number): number | null {
  const n = s.names.length;
  for (let k = 1; k <= n; k++) {
    const p = (from + k) % n;
    if (isActive(s, p) && s.hands[p].length) return p;
  }
  return null;
}

function setTurn(s: TepokNyamukState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function finishGame(s: TepokNyamukState, reason: string) {
  s.over = true;
  s.window = null;
  setTurn(s, null);
  s.banner = reason;
  pushLog(s.log, { seat: null, text: reason });
}

/** Tandai pemain yang kartunya habis sebagai selesai; akhiri game bila tinggal ≤ 1 pemain. */
function settle(s: TepokNyamukState, order: number[]): boolean {
  for (const p of order) {
    if (isActive(s, p) && s.hands[p].length === 0) {
      s.finished.push(p);
      pushLog(s.log, { seat: p, text: `🎉 ${s.names[p]} kartunya habis — selamat! (#${s.finished.length})` });
    }
  }
  const active = s.names.map((_, i) => i).filter(i => isActive(s, i));
  if (active.length <= 1) {
    finishGame(s, active.length === 1 ? `Permainan selesai! ${s.names[active[0]]} masih memegang kartu dan kalah.` : 'Permainan selesai!');
    return true;
  }
  return false;
}

function takePile(s: TepokNyamukState, seat: number) {
  s.hands[seat].push(...s.pile);
  s.pile = [];
  s.count = 0;
  s.lastSpoken = null;
}

function orderFrom(s: TepokNyamukState, start: number): number[] {
  const n = s.names.length;
  return Array.from({ length: n }, (_, k) => (start + k) % n);
}

function resolveWindow(s: TepokNyamukState) {
  const w = s.window!;
  const time = (p: number) => {
    const rec = w.slaps.find(x => x.seat === p)?.t ?? Infinity;
    const bt = w.botTimes[p] ?? Infinity;
    return Math.min(rec, bt);
  };
  let loser = -1, worst = -Infinity;
  for (const p of orderFrom(s, w.flipper)) {
    if (!w.participants.includes(p)) continue;
    const t = time(p);
    if (t > worst) { worst = t; loser = p; }
  }
  const n = s.pile.length;
  takePile(s, loser);
  s.window = null;
  s.banner = worst === Infinity ? `${s.names[loser]} tidak menepuk — ambil ${n} kartu!` : `${s.names[loser]} paling lambat (${(worst / 1000).toFixed(2)} dtk) — ambil ${n} kartu!`;
  pushLog(s.log, { seat: loser, text: `🦟 ${s.banner}` });
  if (settle(s, orderFrom(s, w.flipper))) return;
  setTurn(s, loser);
}

export const tepokNyamuk: GameModule<TepokNyamukState, GenericAction, GenericView, TepokNyamukOptions> = {
  id: 'tepok-nyamuk',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const sp = r.botSpeed === 'santai' || r.botSpeed === 'cepat' ? r.botSpeed : 'normal';
    const mf = Number(r.maxFlips);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds, 15),
      passAndPlay: Boolean(r.passAndPlay),
      botSpeed: sp,
      maxFlips: mf === 150 || mf === 500 ? mf : 300,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Tepok Nyamuk butuh 2–6 pemain');
    const deck = shuffledDeck(rng);
    const first = rng.int(seats.length);
    const hands: Card[][] = seats.map(() => []);
    deck.forEach((c, i) => hands[(first + i) % seats.length].push(c));
    const s: TepokNyamukState = {
      gameId: 'tepok-nyamuk', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, pile: [], count: 0, lastSpoken: null, turn: first, finished: [], window: null, flips: 0,
      banner: null, over: false, log: [], turnDeadline: deadline(options.turnSeconds),
    };
    pushLog(s.log, { seat: null, text: `Kartu dibagi rata. ${s.names[first]} membuka kartu pertama — hitungan mulai dari A.` });
    return s;
  },

  currentSeat: s => (s.over || s.window ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];

    if (spec.id === 'flip') {
      const card = s.hands[seat].shift()!;
      s.pile.push(card);
      const spokenIdx = s.count;
      s.lastSpoken = spokenIdx;
      s.count = (s.count + 1) % 13;
      s.flips += 1;
      s.banner = null;
      pushLog(s.log, { seat, text: `${name}: "${spokenLabel(spokenIdx)}!" — ${cardLabel(card)}` });
      if (rankOf(card) === SPOKEN[spokenIdx]) {
        const participants = s.names.map((_, i) => i).filter(i => isActive(s, i));
        const sp = SPEED[s.options.botSpeed];
        const botTimes = s.names.map((_, i) => {
          if (!s.bots[i] || !participants.includes(i)) return null;
          if (rng.float() < sp.miss) return null;
          return sp.min + Math.floor(rng.float() * (sp.max - sp.min));
        });
        const now = Date.now();
        s.window = { openedAt: now, until: now + SLAP_WINDOW_MS, flipper: seat, participants, slaps: [], botTimes };
        setTurn(s, null);
        pushLog(s.log, { seat: null, text: `🖐 COCOK! ${cardLabel(card)} = "${spokenLabel(spokenIdx)}" — Tepok!` });
        return s;
      }
      if (s.flips >= s.options.maxFlips) { finishGame(s, 'Batas kartu dibuka tercapai — peringkat dari kartu paling sedikit.'); return s; }
      if (settle(s, [seat])) return s;
      setTurn(s, nextActive(s, seat));
      if (s.turn === null) finishGame(s, 'Permainan selesai!');
      return s;
    }

    // slap
    if (s.window) {
      const t = Math.max(0, Date.now() - s.window.openedAt);
      s.window.slaps.push({ seat, t });
      pushLog(s.log, { seat, text: `${name} menepuk! (${(t / 1000).toFixed(2)} dtk)` });
      const w = s.window;
      const allIn = w.participants.every(p => w.slaps.some(x => x.seat === p) || w.botTimes[p] !== null);
      if (allIn) {
        resolveWindow(s);
        if (!s.over && s.flips >= s.options.maxFlips) finishGame(s, 'Batas kartu dibuka tercapai — peringkat dari kartu paling sedikit.');
      }
      return s;
    }
    const n = s.pile.length;
    takePile(s, seat);
    s.banner = `${name} salah tepok — ambil ${n} kartu!`;
    pushLog(s.log, { seat, text: `❌ ${s.banner}` });
    setTurn(s, seat);
    return s;
  },

  autoDelay: s => (!s.over && s.window ? Math.max(0, s.window.until - Date.now()) : null),

  advance(state, _rng) {
    if (state.over || !state.window) return state;
    const s = clone(state);
    resolveWindow(s);
    if (!s.over && s.flips >= s.options.maxFlips) finishGame(s, 'Batas kartu dibuka tercapai — peringkat dari kartu paling sedikit.');
    return s;
  },

  timeoutAction: () => ({ type: 'act', id: 'flip' }),

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const w = s.window;
    const elapsed = w ? Date.now() - w.openedAt : 0;
    const slapped = (i: number) => !!w && (w.slaps.some(x => x.seat === i) || (w.botTimes[i] !== null && w.botTimes[i]! <= elapsed));
    const top = s.pile[s.pile.length - 1];
    const acts = actionsFor(s, me);
    return {
      gameId: 'tepok-nyamuk',
      generic: true,
      you: me,
      turn: s.over || w ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: tepokNyamuk.results(s),
      players: s.names.map((name, i) => {
        const fin = s.finished.indexOf(i);
        return {
          name, isBot: s.bots[i], count: s.hands[i].length,
          score: `${s.hands[i].length} kartu`,
          status: fin >= 0 ? `Selamat #${fin + 1}` : w && slapped(i) ? 'Tepok! 🖐' : undefined,
          out: fin >= 0,
        };
      }),
      hand: [],
      piles: [
        { id: 'center', label: 'Tumpukan', cards: top ? [top] : [], count: s.pile.length, highlight: !!w,
          caption: s.lastSpoken !== null && top ? `Disebut: ${spokenLabel(s.lastSpoken)}` : undefined },
        ...(me !== null ? [{ id: 'mine', label: 'Kartumu', cards: s.hands[me].length ? [null] : [], count: s.hands[me].length }] : []),
      ],
      actions: acts,
      playable: [],
      prompt: s.over ? 'Permainan selesai'
        : w ? (acts.length ? '🖐 COCOK! Tepok sekarang!' : 'Menunggu semua menepuk…')
        : me !== null && s.finished.includes(me) ? 'Kartumu habis — kamu selamat!'
        : s.turn === me ? `Buka kartu dan sebut "${spokenLabel(s.count)}"`
        : `${s.names[s.turn ?? 0]} akan menyebut "${spokenLabel(s.count)}" — siap-siap tepok!`,
      badges: [`Hitungan: ${spokenLabel(s.count)}`, `Tumpukan: ${s.pile.length}`, `Dibuka ${s.flips}/${s.options.maxFlips}`],
      banner: s.banner,
    };
  },

  bot(v, _difficulty: Difficulty, _rng) {
    const ids = v.actions.map(a => a.id);
    const windowOpen = v.piles.find(p => p.id === 'center')?.highlight === true;
    if (windowOpen && ids.includes('slap')) return { type: 'act', id: 'slap' };
    if (ids.includes('flip')) return { type: 'act', id: 'flip' };
    return { type: 'act', id: ids[0] ?? 'flip' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const out: SeatResult[] = s.finished.map((seat, k) => ({ seat, rank: k + 1, score: 0 }));
    const rest = s.names.map((_, i) => i).filter(i => !s.finished.includes(i))
      .sort((a, b) => s.hands[a].length - s.hands[b].length);
    let rank = 0, prev: number | null = null;
    rest.forEach((seat, k) => {
      const c = s.hands[seat].length;
      if (c !== prev) { rank = s.finished.length + k + 1; prev = c; }
      out.push({ seat, rank, score: c });
    });
    return out;
  },
};
