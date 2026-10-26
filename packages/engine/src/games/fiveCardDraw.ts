// games/fiveCardDraw.ts — Five Card Draw (poker tukar kartu), 2–6 pemain.
//
// Aturan yang diimplementasikan:
//  1. Deck 52. Tiap tangan semua pemain yang masih punya chip membayar ante, lalu menerima
//     5 kartu tertutup satu per satu mulai kiri dealer. Dealer bergeser tiap tangan.
//  2. Ronde taruhan pertama (no-limit, atau pot-limit lewat opsi) mulai kiri dealer.
//     Bet minimum = 2× ante. Raise minimum = sebesar bet/raise penuh sebelumnya; all-in yang
//     kurang dari raise penuh tidak membuka ulang aksi; taruhan yang tidak di-call dikembalikan.
//  3. Fase tukar: setiap pemain yang belum fold (termasuk yang all-in), mulai kiri dealer,
//     membuang 0–3 kartu — atau 4 kartu bila kartu yang DISIMPAN adalah As — dan menerima
//     pengganti dari deck. Bila deck kurang, kartu buangan (muck) dikocok menjadi deck
//     (buangan pemain yang sedang menukar tidak ikut dikocok).
//  4. Ronde taruhan kedua mulai kiri dealer, lalu showdown: 5 kartu terbaik menang
//     (main pot & side pot; seri dibagi, odd chip ke pemenang pertama di kiri dealer).
//     Bila semua lawan fold, pemain tersisa menang tanpa membuka kartu.
//  5. Permainan berlanjut tangan demi tangan sampai tersisa satu pemain bermodal atau
//     batas jumlah tangan tercapai. Peringkat akhir = jumlah chip.

import { type Card, rankOf, suitOf, shuffledDeck, shuffle } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { evaluate5, bestHand, compareScores } from '../poker/evaluator';
import {
  type BetRound, type BetStructure, type PSeat, newSeat, inHand, potTotal, nextSeatWhere, put, resetForHand,
  startRound, endRound, legalFor, betActionSpecs, applyBet, progressAfter, settlePots, botBetDecision,
} from './pokerBetting';

export interface FiveCardDrawOptions {
  turnSeconds: number;
  passAndPlay: boolean;
  startingChips: number;
  ante: number;
  structure: BetStructure;
  maxHands: number;
}

export interface DrawSeat extends PSeat {
  name: string;
  isBot: boolean;
  hand: Card[];
  /** Jumlah kartu yang ditukar pada tangan ini (null = belum menukar). */
  drawn: number | null;
  /** Kartu dibuka di showdown. */
  shown: boolean;
}

export type DrawPhase = 'bet1' | 'draw' | 'bet2' | 'handOver' | 'gameOver';

export interface FiveCardDrawState {
  gameId: 'five-card-draw';
  options: FiveCardDrawOptions;
  seats: DrawSeat[];
  handNo: number;
  dealer: number;
  phase: DrawPhase;
  /** round.toAct juga dipakai sebagai giliran pada fase tukar. */
  round: BetRound;
  deck: Card[];
  muck: Card[];
  log: LogEntry[];
  turnDeadline: number | null;
  lastHand: string | null;
}

/** Info tambahan di view (publik) untuk bot & UI. */
export interface DrawPokerInfo { pot: number; toCall: number; currentBet: number; unit: number; opponents: number; raiseLevel: number; preDraw: boolean }

const OPTIONS: OptionSpec[] = [
  {
    key: 'startingChips', label: 'Modal Chip Awal', type: 'select',
    choices: [{ value: 500, label: '500 Chip' }, { value: 1000, label: '1.000 Chip' }, { value: 2000, label: '2.000 Chip' }],
  },
  {
    key: 'ante', label: 'Ante', type: 'select',
    choices: [{ value: 5, label: '5 (Bet min 10)' }, { value: 10, label: '10 (Bet min 20)' }, { value: 25, label: '25 (Bet min 50)' }],
    help: 'Taruhan wajib tiap tangan; bet minimum = 2× ante',
  },
  {
    key: 'structure', label: 'Struktur Taruhan', type: 'select',
    choices: [{ value: 'nl', label: 'No-Limit' }, { value: 'pl', label: 'Pot-Limit' }],
  },
  { key: 'maxHands', label: 'Jumlah Tangan', type: 'number', min: 3, max: 30, step: 1, help: 'Permainan berakhir setelah sekian tangan (atau saat tersisa satu pemain)' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: FiveCardDrawOptions = { turnSeconds: 25, passAndPlay: false, startingChips: 1000, ante: 10, structure: 'nl', maxHands: 10 };

const minBet = (s: FiveCardDrawState) => s.options.ante * 2;
const log = (s: FiveCardDrawState, seat: number | null, text: string) => pushLog(s.log, { seat, text });
const hasAce = (cards: Card[]) => cards.some(c => rankOf(c) === 14);

/* ------------------------------ hand flow ------------------------------ */

function startHand(s: FiveCardDrawState, rng: Rng, first: boolean) {
  resetForHand(s.seats);
  for (const x of s.seats) { x.hand = []; x.drawn = null; x.shown = false; }
  s.handNo += 1;
  s.lastHand = null;
  if (!first || s.seats[s.dealer].out) s.dealer = nextSeatWhere(s.seats, s.dealer, x => !x.out);
  s.deck = shuffledDeck(rng);
  s.muck = [];
  log(s, null, `Tangan #${s.handNo} — dealer: ${s.seats[s.dealer].name}`);
  for (const x of s.seats) if (!x.out) put(x, s.options.ante, false);
  log(s, null, `Semua pemain membayar ante ${s.options.ante}`);
  const active = s.seats.filter(x => !x.out).length;
  for (let k = 0; k < 5; k++) {
    let i = s.dealer;
    for (let j = 0; j < active; j++) {
      i = nextSeatWhere(s.seats, i, x => !x.out);
      s.seats[i].hand.push(s.deck.shift()!);
    }
  }
  s.phase = 'bet1';
  startRound(s.seats, s.round, minBet(s), s.dealer + 1);
  if (s.round.toAct === null) startDraw(s);
}

function nextDrawer(s: FiveCardDrawState, from: number): number | null {
  const i = nextSeatWhere(s.seats, from, x => inHand(x) && x.drawn === null, true);
  return i < 0 ? null : i;
}

function startDraw(s: FiveCardDrawState) {
  endRound(s.seats, s.round);
  s.phase = 'draw';
  log(s, null, 'Fase tukar kartu');
  s.round.toAct = nextDrawer(s, s.dealer + 1);
  if (s.round.toAct === null) startBet2(s);
}

function startBet2(s: FiveCardDrawState) {
  s.phase = 'bet2';
  startRound(s.seats, s.round, minBet(s), s.dealer + 1);
  if (s.round.toAct === null) showdown(s);
}

function showdown(s: FiveCardDrawState) {
  endRound(s.seats, s.round);
  const scores = new Map<number, number[]>();
  const names = new Map<number, string>();
  s.seats.forEach((x, i) => {
    if (!inHand(x)) return;
    const v = evaluate5(x.hand);
    scores.set(i, v.score); names.set(i, v.name); x.shown = true;
  });
  finishHand(s, scores, names);
}

function finishHand(s: FiveCardDrawState, scores: Map<number, number[]> | null, names: Map<number, string> | null) {
  s.round.toAct = null;
  const res = settlePots(s.seats, scores, s.dealer);
  for (const rf of res.refunds) if (rf.amount > 0) log(s, rf.seat, `${s.seats[rf.seat].name} menerima kembali ${rf.amount} (taruhan tidak di-call)`);
  const parts: string[] = [];
  for (const [seat, amt] of res.won) {
    const h = names?.get(seat);
    const t = `${s.seats[seat].name} menang ${amt}${h ? ` dengan ${h}` : ''}`;
    log(s, seat, t); parts.push(t);
  }
  s.lastHand = parts.join(' · ') || null;
  const alive = s.seats.filter(x => x.stack > 0).length;
  s.phase = alive <= 1 || s.handNo >= s.options.maxHands ? 'gameOver' : 'handOver';
  if (s.phase === 'gameOver') log(s, null, 'Permainan selesai');
}

function afterBet(s: FiveCardDrawState, seat: number) {
  const r = progressAfter(s.seats, s.round, seat);
  if (r === 'won') { endRound(s.seats, s.round); finishHand(s, null, null); return; }
  if (r === 'done') {
    if (s.phase === 'bet1') startDraw(s);
    else showdown(s);
  }
}

/* ------------------------------ actions -------------------------------- */

function maxDiscard(hand: Card[]) { return hasAce(hand) ? 4 : 3; }

function actionsFor(s: FiveCardDrawState, seat: number | null): GActionSpec[] {
  if (seat === null || s.round.toAct !== seat) return [];
  if (s.phase === 'bet1' || s.phase === 'bet2') return betActionSpecs(s.seats, s.round, seat);
  if (s.phase === 'draw') {
    const max = maxDiscard(s.seats[seat].hand);
    return [
      { id: 'draw', label: 'Tukar', style: 'primary', cards: { min: 1, max }, hint: max === 4 ? 'Maks 4 kartu bila menyimpan As' : 'Maks 3 kartu' },
      { id: 'pat', label: 'Tidak Tukar' },
    ];
  }
  return [];
}

function info(s: FiveCardDrawState, seat: number | null): DrawPokerInfo {
  const L = seat === null ? null : legalFor(s.seats, s.round, seat);
  return {
    pot: potTotal(s.seats), toCall: L?.callAmount ?? 0, currentBet: s.round.currentBet, unit: minBet(s),
    opponents: s.seats.filter((x, i) => i !== seat && inHand(x)).length,
    raiseLevel: s.round.fullRaiseCount,
    preDraw: s.phase === 'bet1',
  };
}

const PHASE_LABEL: Record<DrawPhase, string> = {
  bet1: 'Taruhan 1', draw: 'Tukar Kartu', bet2: 'Taruhan 2', handOver: 'Tangan selesai', gameOver: 'Selesai',
};

/* ------------------------------ module --------------------------------- */

export const fiveCardDraw: GameModule<FiveCardDrawState, GenericAction, GenericView, FiveCardDrawOptions> = {
  id: 'five-card-draw',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const chips = Number(r.startingChips);
    const ante = Number(r.ante);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      startingChips: [500, 1000, 2000].includes(chips) ? chips : DEFAULTS.startingChips,
      ante: [5, 10, 25].includes(ante) ? ante : DEFAULTS.ante,
      structure: r.structure === 'pl' ? 'pl' : 'nl',
      maxHands: clampInt(r.maxHands, 3, 30, DEFAULTS.maxHands),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Five Card Draw butuh 2–6 pemain');
    const s: FiveCardDrawState = {
      gameId: 'five-card-draw', options,
      seats: seats.map(p => ({ ...newSeat(options.startingChips), name: p.name, isBot: !!p.isBot, hand: [], drawn: null, shown: false })),
      handNo: 0, dealer: rng.int(seats.length), phase: 'bet1',
      round: { structure: options.structure, unit: options.ante * 2, currentBet: 0, minRaise: options.ante * 2, fullRaiseCount: 0, cap: 0, toAct: null },
      deck: [], muck: [], log: [], turnDeadline: null, lastHand: null,
    };
    startHand(s, rng, true);
    s.turnDeadline = s.round.toAct === null ? null : deadline(options.turnSeconds);
    return s;
  },

  currentSeat: s => (s.phase === 'handOver' || s.phase === 'gameOver' ? null : s.round.toAct),

  apply(state, seat, raw, rng) {
    if (state.phase === 'handOver' || state.phase === 'gameOver') throw new RuleError('Tangan sudah selesai');
    if (state.round.toAct !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const x = s.seats[seat];

    if (s.phase === 'draw') {
      let discards: Card[] = [];
      if (spec.id === 'draw') {
        discards = takeCards(x.hand, a.cards, 1, 4);
        if (discards.length === 4) {
          const kept = x.hand.filter(c => !discards.includes(c));
          if (!hasAce(kept)) throw new RuleError('Tukar 4 kartu hanya boleh bila kartu yang disimpan adalah As');
        }
      }
      removeCards(x.hand, discards);
      if (s.deck.length < discards.length) {
        s.deck = s.deck.concat(shuffle(s.muck, rng));
        s.muck = [];
        log(s, null, 'Deck habis — kartu buangan dikocok ulang');
      }
      x.hand.push(...s.deck.splice(0, discards.length));
      s.muck.push(...discards);
      x.drawn = discards.length;
      log(s, seat, discards.length ? `${x.name} menukar ${discards.length} kartu` : `${x.name} tidak menukar kartu`);
      s.round.toAct = nextDrawer(s, seat + 1);
      if (s.round.toAct === null) startBet2(s);
    } else {
      const text = applyBet(s.seats, s.round, seat, a, x.name);
      log(s, seat, text);
      if (x.folded) { s.muck.push(...x.hand); x.hand = []; }
      afterBet(s, seat);
    }
    s.turnDeadline = s.round.toAct === null ? null : deadline(s.options.turnSeconds);
    return s;
  },

  autoDelay(s) {
    if (s.phase === 'handOver') return 3500;
    return null;
  },

  advance(state, rng) {
    if (state.phase !== 'handOver') return state;
    const s = clone(state);
    startHand(s, rng, false);
    s.turnDeadline = s.round.toAct === null ? null : deadline(s.options.turnSeconds);
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'draw') return { type: 'act', id: 'pat' };
    const acts = actionsFor(s, seat);
    return { type: 'act', id: acts.some(x => x.id === 'check') ? 'check' : 'fold' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.seats.length ? seat : null;
    const over = s.phase === 'gameOver';
    const ended = s.phase === 'handOver' || over;
    const pot = potTotal(s.seats);
    const turn = ended ? null : s.round.toAct;
    const acts = ended ? [] : actionsFor(s, me);
    const inf = info(s, me);
    let prompt: string;
    if (over) prompt = 'Permainan selesai';
    else if (s.phase === 'handOver') prompt = 'Tangan berikutnya segera dimulai…';
    else if (turn !== me || me === null) prompt = `Menunggu ${s.seats[turn ?? 0].name}…`;
    else if (s.phase === 'draw') prompt = `Pilih kartu yang dibuang (maks ${maxDiscard(s.seats[me].hand)}), atau tidak tukar`;
    else prompt = inf.toCall > 0 ? `Call ${inf.toCall}, raise, atau fold` : 'Check atau bet';
    const v: GenericView & { poker: DrawPokerInfo } = {
      gameId: 'five-card-draw',
      generic: true,
      you: me,
      turn,
      over,
      log: s.log.slice(-30),
      results: fiveCardDraw.results(s),
      players: s.seats.map((x, i) => {
        const st: string[] = [];
        if (x.out) st.push('Habis');
        else if (x.folded) st.push('Fold');
        else {
          if (x.bet > 0) st.push(`Bet ${x.bet}`);
          if (x.allIn) st.push('All-in');
          if (x.drawn !== null) st.push(x.drawn === 0 ? 'Tidak tukar' : `Tukar ${x.drawn}`);
        }
        return {
          name: x.name, isBot: x.isBot, count: x.hand.length, score: `${x.stack} chip`,
          status: st.join(' · ') || undefined,
          tag: i === s.dealer ? 'D' : undefined,
          out: x.out || x.folded,
          faceUp: x.shown ? x.hand.slice() : undefined,
        };
      }),
      hand: me !== null ? s.seats[me].hand.slice() : [],
      piles: [{ id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length }],
      actions: acts,
      prompt,
      badges: [`Tangan ${s.handNo}/${s.options.maxHands}`, PHASE_LABEL[s.phase], `Pot ${pot}`, `Ante ${s.options.ante}`],
      banner: ended ? s.lastHand : null,
      poker: inf,
    };
    return v;
  },

  bot(v, difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.includes('pat')) {
      const d = chooseDiscards(v.hand, difficulty, rng);
      return d.length ? { type: 'act', id: 'draw', cards: d } : { type: 'act', id: 'pat' };
    }
    const inf = (v as GenericView & { poker?: DrawPokerInfo }).poker
      ?? { pot: 0, toCall: 0, currentBet: 0, unit: 1, opponents: 1, raiseLevel: 0, preDraw: false };
    const preDraw = inf.preDraw;
    const iters = Math.round((difficulty === 'hard' ? 160 : difficulty === 'normal' ? 100 : 40) / Math.max(1, Math.sqrt(inf.opponents)));
    const equity = drawEquity(v.hand, preDraw ? chooseDiscards(v.hand, 'hard', rng) : [], Math.max(1, inf.opponents), iters, rng, preDraw);
    return botBetDecision(v.actions, inf, equity, difficulty, rng);
  },

  isOver: s => s.phase === 'gameOver',

  results(s): SeatResult[] | null {
    if (s.phase !== 'gameOver') return null;
    return rankByScore(s.seats.map(x => x.stack));
  },
};

/* --------------------------------- bot --------------------------------- */

/** Strategi tukar kartu sederhana namun masuk akal. Selalu sah (≤3, atau 4 dengan menyimpan As). */
export function chooseDiscards(hand: Card[], difficulty: Difficulty, rng: Rng): Card[] {
  if (hand.length !== 5) return [];
  const v = evaluate5(hand);
  if (v.category >= 4) return []; // straight ke atas: tidak tukar
  const byRank = new Map<number, Card[]>();
  for (const c of hand) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const groups = [...byRank.values()].filter(g => g.length >= 2);
  const sorted = hand.slice().sort((a, b) => rankOf(b) - rankOf(a));
  if (difficulty === 'easy' && rng.float() < 0.3) {
    return sorted.slice(5 - rng.int(4)); // buang 0–3 kartu terendah secara acak
  }
  if (groups.length) {
    const keep = new Set(groups.flat());
    return hand.filter(c => !keep.has(c)).slice(0, 3);
  }
  // Draw ke flush: 4 kartu satu suit.
  for (const suit of ['S', 'H', 'D', 'C']) {
    const same = hand.filter(c => suitOf(c) === suit);
    if (same.length === 4) return hand.filter(c => suitOf(c) !== suit);
  }
  // Draw ke straight open-ended: 4 rank berurutan.
  for (const out of hand) {
    const rest = hand.filter(c => c !== out).map(rankOf).sort((a, b) => a - b);
    if (rest[3] - rest[0] === 3 && new Set(rest).size === 4 && rest[3] < 14) return [out];
  }
  if (rankOf(sorted[0]) === 14 && difficulty === 'hard') return sorted.slice(1); // simpan As, tukar 4
  return sorted.slice(2); // simpan 2 kartu tertinggi
}

/** Monte Carlo: tangan sendiri (setelah rencana tukar) vs lawan dengan 5 kartu acak. */
export function drawEquity(hand: Card[], discards: Card[], opponents: number, iters: number, rng: Rng, preDraw = false): number {
  if (hand.length !== 5) return 0;
  const known = new Set(hand);
  const pool = shuffledDeck(rng).filter(c => !known.has(c));
  const kept = hand.filter(c => !discards.includes(c));
  const opp = Math.min(opponents, 5);
  const need = discards.length + opp * (preDraw ? 6 : 5);
  if (need > pool.length) return 0.5;
  let score = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const mine = evaluate5([...kept, ...pool.slice(0, discards.length)]).score;
    let k = discards.length, lost = false, ties = 1;
    for (let o = 0; o < opp && !lost; o++) {
      // Sebelum tukar, lawan juga akan menukar: dekati dengan 5 terbaik dari 6 kartu acak.
      const oppScore = preDraw ? bestHand(pool.slice(k, k + 6)).score : evaluate5(pool.slice(k, k + 5)).score;
      const c = compareScores(mine, oppScore);
      k += preDraw ? 6 : 5;
      if (c < 0) lost = true; else if (c === 0) ties++;
    }
    if (!lost) score += 1 / ties;
  }
  return score / iters;
}
