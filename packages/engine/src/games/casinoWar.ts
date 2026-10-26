// games/casinoWar.ts — Casino War, duel 2 pemain.
//
// Aturan:
//  1. Shoe 6 deck. Urutan kartu: 2 terendah … As tertinggi (lambang tidak berpengaruh).
//  2. Tiap ronde kedua pemain bergiliran memasang taruhan tertutup (10–100 chip, kelipatan 10,
//     tidak melebihi chip). Kedua taruhan masuk ke pot.
//  3. Masing-masing dibuka 1 kartu; kartu lebih tinggi memenangkan seluruh pot.
//  4. Jika seri, kedua pemain memilih (tertutup) "Perang!" atau "Menyerah":
//     - Keduanya Perang: masing-masing menambah taruhan awalnya lagi, 3 kartu dibakar, lalu
//       1 kartu baru tiap pemain; tertinggi mengambil seluruh pot. Seri lagi → pilih lagi.
//     - Ada yang Menyerah: yang menyerah kehilangan separuh setorannya ke lawan; lawan menerima
//       kembali setorannya + separuh tersebut. Jika keduanya menyerah, masing-masing kehilangan
//       separuh setoran ke lawan.
//     Perang hanya bisa dipilih bila chip cukup untuk menambah taruhan. Pengaman: setelah 5 kali
//     perang beruntun, pot dikembalikan.
//  5. Selesai setelah jumlah ronde (opsi) atau salah satu pemain chipnya < 10. Peringkat dari chip.

import { type Card, rankOf, shuffledDeck, shuffle, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface CasinoWarOptions { turnSeconds: number; passAndPlay: boolean; chips: number; rounds: number }

export interface CasinoWarState {
  gameId: 'war';
  options: CasinoWarOptions;
  names: string[];
  bots: boolean[];
  chips: number[];
  /** Taruhan awal ronde ini (rahasia sampai keduanya bertaruh). */
  bets: (number | null)[];
  /** Total setoran tiap pemain ke pot ronde ini. */
  stake: number[];
  /** Pilihan saat seri (rahasia sampai keduanya memilih). */
  choices: ('war' | 'surrender' | null)[];
  /** Kartu duel yang sedang terbuka. */
  cards: (Card | null)[];
  /** Kartu lain di meja ronde ini (kartu duel sebelumnya + bakaran). */
  table: Card[];
  shoe: Card[];
  used: Card[];
  /** bet = taruhan; reveal = buka kartu (otomatis); war = pilih perang/menyerah; warDeal = bakar & buka (otomatis); result = jeda hasil. */
  phase: 'bet' | 'reveal' | 'war' | 'warDeal' | 'result';
  starter: number;
  round: number;
  wars: number;
  turn: number | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MIN_BET = 10;
const MAX_BET = 100;
const MAX_WARS = 5;

const OPTIONS: OptionSpec[] = [
  { key: 'chips', label: 'Chip Awal', type: 'select', choices: [
    { value: 300, label: '300 Chip' }, { value: 500, label: '500 Chip' }, { value: 1000, label: '1.000 Chip' },
  ] },
  { key: 'rounds', label: 'Jumlah Ronde', type: 'select', choices: [
    { value: 5, label: '5 Ronde (Cepat)' }, { value: 10, label: '10 Ronde (Standar)' }, { value: 20, label: '20 Ronde (Panjang)' },
  ] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: CasinoWarOptions = { turnSeconds: 25, passAndPlay: false, chips: 500, rounds: 10 };

const other = (seat: number) => 1 - seat;
const maxBet = (chips: number) => Math.min(MAX_BET, Math.floor(chips / MIN_BET) * MIN_BET);
const pot = (s: CasinoWarState) => s.stake[0] + s.stake[1];

function canWar(s: CasinoWarState, seat: number) {
  return s.chips[seat] >= (s.bets[seat] ?? Infinity);
}

function actionsFor(s: CasinoWarState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'bet') {
    const max = maxBet(s.chips[seat]);
    return [{ id: 'bet', label: 'Pasang', style: 'primary', amount: { min: MIN_BET, max, step: MIN_BET, default: Math.min(max, 50) } }];
  }
  if (s.phase === 'war') {
    const acts: GActionSpec[] = [];
    if (canWar(s, seat)) acts.push({ id: 'war', label: 'Perang!', style: 'danger', hint: `Tambah ${s.bets[seat]} chip, bakar 3, buka 1 kartu lagi` });
    acts.push({ id: 'surrender', label: 'Menyerah', hint: 'Kehilangan separuh setoran' });
    return acts;
  }
  return [];
}

function setTurn(s: CasinoWarState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function deal1(s: CasinoWarState, rng: Rng): Card {
  if (!s.shoe.length) { s.shoe = shuffle(s.used, rng); s.used = []; }
  return s.shoe.shift()!;
}

function startRound(s: CasinoWarState, rng: Rng) {
  s.used.push(...s.table, ...(s.cards.filter(Boolean) as Card[]));
  s.table = [];
  s.cards = [null, null];
  if (s.shoe.length < 40) {
    s.shoe = shuffle([...s.shoe, ...s.used], rng);
    s.used = [];
  }
  s.round += 1;
  s.bets = [null, null];
  s.stake = [0, 0];
  s.choices = [null, null];
  s.wars = 0;
  s.banner = null;
  s.phase = 'bet';
  s.starter = s.round === 1 ? s.starter : other(s.starter);
  setTurn(s, s.starter);
}

/** Akhiri ronde dengan pengembalian chip `back[i]` ke tiap pemain. */
function settle(s: CasinoWarState, back: number[], text: string) {
  s.chips[0] += back[0];
  s.chips[1] += back[1];
  s.stake = [0, 0];
  s.banner = text;
  pushLog(s.log, { seat: null, text });
  s.phase = 'result';
  setTurn(s, null);
  if (s.round >= s.options.rounds || s.chips.some(c => c < MIN_BET)) {
    s.over = true;
    const w = s.chips[0] === s.chips[1] ? null : s.chips[0] > s.chips[1] ? 0 : 1;
    pushLog(s.log, { seat: w, text: w === null ? 'Permainan selesai seri!' : `🏆 ${s.names[w]} menang dengan ${s.chips[w]} chip!` });
  }
}

/** Bandingkan kartu duel; menang → settle, seri → fase pilih. */
function compare(s: CasinoWarState) {
  const [a, b] = s.cards as Card[];
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== rb) {
    const w = ra > rb ? 0 : 1;
    const p = pot(s);
    const back = [0, 0];
    back[w] = p;
    settle(s, back, `${s.names[w]} menang dengan ${cardLabel(s.cards[w]!)} vs ${cardLabel(s.cards[other(w)]!)} · +${p - s.stake[w]} chip`);
    return;
  }
  if (s.wars >= MAX_WARS) {
    settle(s, s.stake.slice(), 'Seri beruntun — pot dikembalikan.');
    return;
  }
  s.phase = 'war';
  s.choices = [null, null];
  s.banner = `Seri ${cardLabel(a)} vs ${cardLabel(b)}! Perang atau menyerah?`;
  pushLog(s.log, { seat: null, text: s.banner });
  setTurn(s, s.starter);
}

export const casinoWar: GameModule<CasinoWarState, GenericAction, GenericView, CasinoWarOptions> = {
  id: 'war',
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const c = Number(r.chips);
    const n = Number(r.rounds);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      chips: c === 300 || c === 1000 ? c : 500,
      rounds: n === 5 || n === 20 ? n : 10,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length !== 2) throw new RuleError('Casino War butuh tepat 2 pemain');
    const s: CasinoWarState = {
      gameId: 'war', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      chips: [options.chips, options.chips], bets: [null, null], stake: [0, 0], choices: [null, null],
      cards: [null, null], table: [], shoe: shuffledDeck(rng, 6), used: [],
      phase: 'bet', starter: rng.int(2), round: 0, wars: 0, turn: null,
      banner: null, over: false, log: [], turnDeadline: null,
    };
    startRound(s, rng);
    pushLog(s.log, { seat: null, text: `Ronde 1/${options.rounds}: pasang taruhan tertutup!` });
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];

    if (spec.id === 'bet') {
      const amt = a.amount;
      if (amt === undefined || amt < MIN_BET || amt > MAX_BET) throw new RuleError(`Taruhan ${MIN_BET}–${MAX_BET} chip`);
      if (amt % MIN_BET !== 0) throw new RuleError(`Taruhan harus kelipatan ${MIN_BET}`);
      if (amt > s.chips[seat]) throw new RuleError('Chip tidak cukup');
      s.bets[seat] = amt;
      s.chips[seat] -= amt;
      s.stake[seat] += amt;
      pushLog(s.log, { seat, text: `${name} sudah memasang taruhan` });
      if (s.bets[other(seat)] === null) setTurn(s, other(seat));
      else {
        s.phase = 'reveal';
        setTurn(s, null);
        pushLog(s.log, { seat: null, text: `Taruhan: ${s.names[0]} ${s.bets[0]} · ${s.names[1]} ${s.bets[1]}` });
      }
      return s;
    }
    // war / surrender
    s.choices[seat] = spec.id as 'war' | 'surrender';
    pushLog(s.log, { seat, text: `${name} sudah memilih` });
    if (s.choices[other(seat)] === null) { setTurn(s, other(seat)); return s; }
    const [c0, c1] = s.choices;
    pushLog(s.log, { seat: null, text: `${s.names[0]}: ${c0 === 'war' ? 'Perang!' : 'Menyerah'} · ${s.names[1]}: ${c1 === 'war' ? 'Perang!' : 'Menyerah'}` });
    if (c0 === 'war' && c1 === 'war') {
      for (const i of [0, 1]) { s.chips[i] -= s.bets[i]!; s.stake[i] += s.bets[i]!; }
      s.phase = 'warDeal';
      setTurn(s, null);
      return s;
    }
    const half = s.stake.map(x => Math.floor(x / 2));
    const back = [0, 1].map(i => {
      const own = s.choices[i] === 'surrender' ? s.stake[i] - half[i] : s.stake[i];
      const o = other(i);
      const gain = s.choices[o] === 'surrender' ? half[o] : 0;
      return own + gain;
    });
    const text = c0 === 'surrender' && c1 === 'surrender'
      ? 'Keduanya menyerah — separuh setoran berpindah tangan.'
      : `${s.names[c0 === 'surrender' ? 0 : 1]} menyerah — kehilangan ${half[c0 === 'surrender' ? 0 : 1]} chip.`;
    settle(s, back, text);
    return s;
  },

  autoDelay(s) {
    if (s.over) return null;
    if (s.phase === 'reveal') return 700;
    if (s.phase === 'warDeal') return 1200;
    if (s.phase === 'result') return 3000;
    return null;
  },

  advance(state, rng) {
    if (state.over) return state;
    const s = clone(state);
    if (s.phase === 'reveal') {
      s.cards = [deal1(s, rng), deal1(s, rng)];
      compare(s);
      return s;
    }
    if (s.phase === 'warDeal') {
      s.wars += 1;
      s.table.push(...(s.cards.filter(Boolean) as Card[]));
      for (let k = 0; k < 3; k++) s.table.push(deal1(s, rng));
      s.cards = [deal1(s, rng), deal1(s, rng)];
      pushLog(s.log, { seat: null, text: `Perang! 3 kartu dibakar. ${cardLabel(s.cards[0]!)} vs ${cardLabel(s.cards[1]!)}` });
      compare(s);
      return s;
    }
    if (s.phase === 'result') {
      startRound(s, rng);
      pushLog(s.log, { seat: null, text: `Ronde ${s.round}/${s.options.rounds}: pasang taruhan.` });
      return s;
    }
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'bet') return { type: 'act', id: 'bet', amount: MIN_BET };
    return { type: 'act', id: canWar(s, seat) ? 'war' : 'surrender' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < 2 ? seat : null;
    const betsPublic = s.phase !== 'bet';
    const choicesPublic = s.phase !== 'war';
    let prompt: string;
    if (s.over) prompt = 'Permainan selesai';
    else if (s.phase === 'bet') prompt = s.turn === me ? 'Pasang taruhan (tertutup)' : `Menunggu taruhan ${s.names[s.turn ?? 0]}…`;
    else if (s.phase === 'war') prompt = s.turn === me ? 'Seri! Perang (gandakan taruhan) atau Menyerah (rugi separuh)?' : `Menunggu pilihan ${s.names[s.turn ?? 0]}…`;
    else if (s.phase === 'result') prompt = 'Ronde berikutnya segera dimulai…';
    else prompt = 'Kartu dibuka…';
    return {
      gameId: 'war',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: casinoWar.results(s),
      players: s.names.map((name, i) => {
        let status: string | undefined;
        const bet = s.bets[i];
        if (s.phase === 'bet') status = bet === null ? (s.turn === i ? 'Memilih…' : 'Belum bertaruh') : i === me ? `Taruhan ${bet}` : 'Sudah bertaruh';
        else if (s.phase === 'war') {
          const c = s.choices[i];
          status = c === null ? 'Memilih…' : i === me || choicesPublic ? (c === 'war' ? 'Perang!' : 'Menyerah') : 'Sudah memilih';
        } else if (bet !== null && betsPublic && s.phase !== 'result') status = `Taruhan ${s.stake[i] || bet}`;
        return {
          name, isBot: s.bots[i], count: 0, score: `${s.chips[i]} chip`, status,
          faceUp: s.cards[i] ? [s.cards[i]] : undefined,
        };
      }),
      hand: [],
      piles: [
        { id: 'shoe', label: 'Shoe', cards: s.shoe.length ? [null] : [], count: s.shoe.length },
        ...(s.table.length ? [{ id: 'table', label: 'Kartu Perang', cards: s.table.map(() => null), count: s.table.length }] : []),
      ],
      actions: actionsFor(s, me),
      prompt,
      badges: [
        `Ronde ${s.round}/${s.options.rounds}`,
        ...(betsPublic && pot(s) > 0 ? [`Pot ${pot(s)}`] : []),
        ...(s.wars ? [`Perang ×${s.wars}`] : []),
      ],
      banner: s.phase === 'result' || s.phase === 'war' || s.over ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.includes('bet')) {
      const spec = v.actions.find(a => a.id === 'bet')!.amount!;
      const steps = Math.floor((spec.max - spec.min) / spec.step);
      if (difficulty === 'easy') return { type: 'act', id: 'bet', amount: spec.min + spec.step * rng.int(steps + 1) };
      // Normal/hard: taruhan moderat; hard menyesuaikan dengan posisi chip.
      const me = v.you ?? 0;
      const mine = parseInt(v.players[me].score ?? '0', 10);
      const theirs = parseInt(v.players[1 - me].score ?? '0', 10);
      let frac = 0.2 + rng.float() * 0.3;
      if (difficulty === 'hard') frac = mine > theirs ? 0.1 + rng.float() * 0.2 : 0.4 + rng.float() * 0.5;
      const k = Math.min(steps, Math.round(frac * steps));
      return { type: 'act', id: 'bet', amount: spec.min + spec.step * k };
    }
    // Perang tidak pernah lebih buruk dari menyerah secara rata-rata.
    if (ids.includes('war') && (difficulty !== 'easy' || rng.float() < 0.6)) return { type: 'act', id: 'war' };
    return { type: 'act', id: 'surrender' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.chips, true);
  },
};
