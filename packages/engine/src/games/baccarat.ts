// games/baccarat.ts — Baccarat (Punto Banco), 1–4 pemain melawan bandar.
//
// Aturan:
//  1. Shoe 6 deck. Nilai kartu: As = 1, 2–9 = nominal, 10/J/Q/K = 0. Total = digit satuan.
//  2. Tiap ronde, setiap pemain (bergiliran) wajib memasang 1 taruhan: Player, Banker, atau Seri,
//     minimal 10 chip, kelipatan 10, maksimal seluruh chip. Pemain dengan chip < 10 tersingkir.
//  3. Pembagian otomatis: Player–Banker–Player–Banker. Natural (8/9 dari 2 kartu) → keduanya berhenti.
//  4. Player menarik kartu ke-3 pada total 0–5, berhenti 6–7. Jika Player berhenti, Banker menarik
//     pada 0–5. Jika Player menarik kartu ke-3 (nilai x), Banker: 0–2 tarik; 3 tarik kecuali x = 8;
//     4 tarik bila x 2–7; 5 tarik bila x 4–7; 6 tarik bila x 6–7; 7 berhenti.
//  5. Pembayaran: Player 1:1, Banker 0,95:1 (dibulatkan ke bawah), Seri 8:1. Jika hasil Seri,
//     taruhan Player/Banker dikembalikan (push).
//  6. Selesai setelah jumlah ronde (opsi) atau semua pemain bangkrut. Peringkat dari chip akhir.

import { type Card, rankOf, shuffledDeck, shuffle, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export type BaccaratSide = 'P' | 'B' | 'T';

export interface BaccaratOptions { turnSeconds: number; passAndPlay: boolean; chips: number; rounds: number }

export interface BaccaratState {
  gameId: 'baccarat';
  options: BaccaratOptions;
  names: string[];
  bots: boolean[];
  chips: number[];
  bets: ({ side: BaccaratSide; amount: number } | null)[];
  out: boolean[];
  shoe: Card[];
  used: Card[];
  playerCards: Card[];
  bankerCards: Card[];
  /** bet = pemain bertaruh; deal/player/banker/settle = pembagian otomatis; result = jeda hasil. */
  phase: 'bet' | 'deal' | 'player' | 'banker' | 'settle' | 'result';
  round: number;
  turn: number | null;
  history: BaccaratSide[];
  /** Perubahan chip ronde terakhir per pemain (untuk status). */
  lastDelta: (number | null)[];
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MIN_BET = 10;
const SIDE_NAME: Record<BaccaratSide, string> = { P: 'Player', B: 'Banker', T: 'Seri' };

const OPTIONS: OptionSpec[] = [
  { key: 'chips', label: 'Chip Awal', type: 'select', choices: [
    { value: 500, label: '500 Chip' }, { value: 1000, label: '1.000 Chip' }, { value: 2000, label: '2.000 Chip' },
  ] },
  { key: 'rounds', label: 'Jumlah Ronde', type: 'select', choices: [
    { value: 5, label: '5 Ronde (Cepat)' }, { value: 10, label: '10 Ronde (Standar)' }, { value: 20, label: '20 Ronde (Panjang)' },
  ] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: BaccaratOptions = { turnSeconds: 25, passAndPlay: false, chips: 1000, rounds: 10 };

/** Nilai satu kartu baccarat. */
export const cardPoint = (c: Card): number => {
  const r = rankOf(c);
  return r === 14 ? 1 : r >= 10 ? 0 : r;
};

/** Total baccarat (digit satuan). */
export const baccaratTotal = (cards: Card[]): number => cards.reduce((t, c) => t + cardPoint(c), 0) % 10;

/** Player menarik kartu ke-3? (Dipanggil hanya bila tidak ada natural.) */
export const playerDraws = (playerTotal: number): boolean => playerTotal <= 5;

/** Banker menarik kartu ke-3? `playerThird` = nilai kartu ke-3 Player, atau null bila Player berhenti. */
export function bankerDraws(bankerTotal: number, playerThird: number | null): boolean {
  if (playerThird === null) return bankerTotal <= 5;
  const x = playerThird;
  switch (bankerTotal) {
    case 0: case 1: case 2: return true;
    case 3: return x !== 8;
    case 4: return x >= 2 && x <= 7;
    case 5: return x >= 4 && x <= 7;
    case 6: return x === 6 || x === 7;
    default: return false;
  }
}

/** Pembayaran bersih (tanpa modal) untuk taruhan `side` sebesar `amount` jika hasil `winner`. -1 = kalah (modal hilang), 0 = push. */
export function payout(side: BaccaratSide, amount: number, winner: BaccaratSide): { returned: number } {
  if (winner === 'T') {
    if (side === 'T') return { returned: amount + amount * 8 };
    return { returned: amount }; // push
  }
  if (side !== winner) return { returned: 0 };
  return { returned: side === 'P' ? amount * 2 : amount + Math.floor(amount * 0.95) };
}

const maxBet = (chips: number) => Math.floor(chips / MIN_BET) * MIN_BET;

function actionsFor(s: BaccaratState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase !== 'bet') return [];
  const max = maxBet(s.chips[seat]);
  if (max < MIN_BET) return [];
  const amount = { min: MIN_BET, max, step: MIN_BET, default: Math.min(max, 50) };
  return [
    { id: 'bet:P', label: 'Player (1:1)', style: 'primary', amount },
    { id: 'bet:B', label: 'Banker (0,95:1)', style: 'primary', amount },
    { id: 'bet:T', label: 'Seri (8:1)', amount },
  ];
}

function nextBettor(s: BaccaratState, from: number): number | null {
  for (let i = from; i < s.names.length; i++) if (!s.out[i] && !s.bets[i]) return i;
  return null;
}

function setTurn(s: BaccaratState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function startRound(s: BaccaratState, rng: Rng) {
  s.used.push(...s.playerCards, ...s.bankerCards);
  s.playerCards = [];
  s.bankerCards = [];
  if (s.shoe.length < 30) {
    s.shoe = shuffle([...s.shoe, ...s.used], rng);
    s.used = [];
    pushLog(s.log, { seat: null, text: 'Shoe dikocok ulang.' });
  }
  s.round += 1;
  s.bets = s.names.map(() => null);
  s.banner = null;
  s.phase = 'bet';
  setTurn(s, nextBettor(s, 0));
}

function draw(s: BaccaratState, to: 'P' | 'B') {
  const c = s.shoe.shift()!;
  (to === 'P' ? s.playerCards : s.bankerCards).push(c);
  return c;
}

export const baccarat: GameModule<BaccaratState, GenericAction, GenericView, BaccaratOptions> = {
  id: 'baccarat',
  minPlayers: 1,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const c = Number(r.chips);
    const n = Number(r.rounds);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      chips: c === 500 || c === 2000 ? c : 1000,
      rounds: n === 5 || n === 20 ? n : 10,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 1 || seats.length > 4) throw new RuleError('Baccarat untuk 1–4 pemain');
    const s: BaccaratState = {
      gameId: 'baccarat', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      chips: seats.map(() => options.chips), bets: seats.map(() => null), out: seats.map(() => false),
      shoe: shuffledDeck(rng, 6), used: [], playerCards: [], bankerCards: [],
      phase: 'bet', round: 0, turn: null, history: [], lastDelta: seats.map(() => null),
      banner: null, over: false, log: [], turnDeadline: null,
    };
    startRound(s, rng);
    pushLog(s.log, { seat: null, text: `Ronde 1/${options.rounds}: pasang taruhanmu!` });
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const amt = a.amount;
    if (amt === undefined || amt < MIN_BET) throw new RuleError(`Taruhan minimal ${MIN_BET} chip`);
    if (amt % MIN_BET !== 0) throw new RuleError(`Taruhan harus kelipatan ${MIN_BET}`);
    if (amt > state.chips[seat]) throw new RuleError('Chip tidak cukup');
    const s = clone(state);
    const side = spec.id.slice(4) as BaccaratSide;
    s.chips[seat] -= amt;
    s.bets[seat] = { side, amount: amt };
    pushLog(s.log, { seat, text: `${s.names[seat]} bertaruh ${amt} di ${SIDE_NAME[side]}` });
    const nx = nextBettor(s, seat + 1);
    if (nx !== null) setTurn(s, nx);
    else { s.phase = 'deal'; setTurn(s, null); }
    return s;
  },

  autoDelay(s) {
    if (s.over) return null;
    switch (s.phase) {
      case 'deal': return 800;
      case 'player': case 'banker': return 1300;
      case 'settle': return 1200;
      case 'result': return 3500;
      default: return null;
    }
  },

  advance(state, rng) {
    if (state.over || state.phase === 'bet') return state;
    const s = clone(state);
    const pt = () => baccaratTotal(s.playerCards);
    const bt = () => baccaratTotal(s.bankerCards);
    if (s.phase === 'deal') {
      draw(s, 'P'); draw(s, 'B'); draw(s, 'P'); draw(s, 'B');
      const natural = pt() >= 8 || bt() >= 8;
      pushLog(s.log, { seat: null, text: `Player ${pt()} · Banker ${bt()}${natural ? ' — Natural!' : ''}` });
      s.phase = natural ? 'settle' : 'player';
      return s;
    }
    if (s.phase === 'player') {
      s.phase = 'banker';
      if (playerDraws(pt())) {
        const c = draw(s, 'P');
        pushLog(s.log, { seat: null, text: `Player menarik ${cardLabel(c)} → ${pt()}` });
        return s;
      }
      pushLog(s.log, { seat: null, text: `Player berhenti di ${pt()}` });
    }
    if (s.phase === 'banker') {
      s.phase = 'settle';
      const third = s.playerCards.length === 3 ? cardPoint(s.playerCards[2]) : null;
      if (bankerDraws(bt(), third)) {
        const c = draw(s, 'B');
        pushLog(s.log, { seat: null, text: `Banker menarik ${cardLabel(c)} → ${bt()}` });
        return s;
      }
      pushLog(s.log, { seat: null, text: `Banker berhenti di ${bt()}` });
    }
    if (s.phase === 'settle') {
      const p = pt(), b = bt();
      const w: BaccaratSide = p > b ? 'P' : b > p ? 'B' : 'T';
      s.history.push(w);
      if (s.history.length > 12) s.history.shift();
      const parts: string[] = [];
      s.lastDelta = s.names.map(() => null);
      s.bets.forEach((bet, i) => {
        if (!bet) return;
        const back = payout(bet.side, bet.amount, w).returned;
        s.chips[i] += back;
        const delta = back - bet.amount;
        s.lastDelta[i] = delta;
        parts.push(`${s.names[i]} ${delta > 0 ? '+' : ''}${delta}`);
        if (s.chips[i] < MIN_BET) {
          s.out[i] = true;
          pushLog(s.log, { seat: i, text: `${s.names[i]} kehabisan chip.` });
        }
      });
      s.banner = `${w === 'T' ? 'SERI' : `${SIDE_NAME[w]} menang`} (${p}–${b}) · ${parts.join(', ')}`;
      pushLog(s.log, { seat: null, text: s.banner });
      s.phase = 'result';
      if (s.round >= s.options.rounds || s.out.every(Boolean)) {
        s.over = true;
        const top = Math.max(...s.chips);
        pushLog(s.log, { seat: null, text: `🏆 Selesai! Chip terbanyak: ${s.names.filter((_, i) => s.chips[i] === top).join(', ')} (${top})` });
      }
      return s;
    }
    // result → ronde berikutnya
    startRound(s, rng);
    pushLog(s.log, { seat: null, text: `Ronde ${s.round}/${s.options.rounds}: pasang taruhan.` });
    return s;
  },

  timeoutAction(s, seat) {
    return { type: 'act', id: 'bet:B', amount: MIN_BET };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.names.length ? seat : null;
    const showCards = s.phase !== 'bet' || s.over;
    const pt = baccaratTotal(s.playerCards), bt = baccaratTotal(s.bankerCards);
    const winSide = s.phase === 'result' || s.over ? s.history[s.history.length - 1] : null;
    let prompt: string;
    if (s.over) prompt = 'Permainan selesai';
    else if (s.phase === 'bet') prompt = s.turn === me ? 'Pilih kubu & jumlah taruhan' : `Menunggu taruhan ${s.names[s.turn ?? 0]}…`;
    else if (s.phase === 'result') prompt = 'Ronde berikutnya segera dimulai…';
    else prompt = 'Kartu dibagikan…';
    return {
      gameId: 'baccarat',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: baccarat.results(s),
      players: s.names.map((name, i) => {
        const bet = s.bets[i];
        const d = s.lastDelta[i];
        let status: string | undefined;
        if (s.out[i]) status = 'Bangkrut';
        else if ((s.phase === 'result' || s.over) && bet && d !== null) status = `${SIDE_NAME[bet.side]} ${bet.amount} → ${d > 0 ? '+' : ''}${d}`;
        else if (bet) status = `${SIDE_NAME[bet.side]} ${bet.amount}`;
        else if (s.phase === 'bet') status = s.turn === i ? 'Memilih…' : 'Belum bertaruh';
        return { name, isBot: s.bots[i], count: 0, score: `${s.chips[i]} chip`, status, out: s.out[i] };
      }),
      hand: [],
      piles: [
        { id: 'player', label: 'Player', cards: showCards ? s.playerCards.slice() : [], spread: true,
          caption: s.playerCards.length ? `Nilai ${pt}` : undefined, highlight: winSide === 'P' },
        { id: 'banker', label: 'Banker', cards: showCards ? s.bankerCards.slice() : [], spread: true,
          caption: s.bankerCards.length ? `Nilai ${bt}` : undefined, highlight: winSide === 'B' },
        { id: 'shoe', label: 'Shoe', cards: s.shoe.length ? [null] : [], count: s.shoe.length },
      ],
      actions: actionsFor(s, me),
      prompt,
      badges: [
        `Ronde ${Math.min(s.round, s.options.rounds)}/${s.options.rounds}`,
        ...(s.history.length ? [`Riwayat: ${s.history.slice(-8).map(h => (h === 'P' ? 'P' : h === 'B' ? 'B' : 'S')).join(' ')}`] : []),
      ],
      banner: s.phase === 'result' || s.over ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const spec = v.actions[0]?.amount;
    const max = spec?.max ?? MIN_BET;
    const pick = (frac: number) => Math.max(MIN_BET, Math.min(max, Math.round((max * frac) / MIN_BET) * MIN_BET));
    if (difficulty === 'easy') {
      const sides: BaccaratSide[] = ['P', 'B', 'B', 'P', 'T'];
      return { type: 'act', id: `bet:${sides[rng.int(sides.length)]}`, amount: pick(0.05 + rng.float() * 0.3) };
    }
    if (difficulty === 'normal') {
      const side: BaccaratSide = rng.float() < 0.6 ? 'B' : rng.float() < 0.95 ? 'P' : 'T';
      return { type: 'act', id: `bet:${side}`, amount: side === 'T' ? MIN_BET : pick(0.08 + rng.float() * 0.07) };
    }
    // hard: Banker (house edge terkecil), taruhan ~5–10% chip.
    return { type: 'act', id: 'bet:B', amount: pick(0.05 + rng.float() * 0.05) };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.chips, true);
  },
};
