// games/samhong.ts — Samhong (adu 3 kartu khas Indonesia, mirip Samgong), 2–6 pemain.
//
// Aturan yang diterapkan:
//  1. Deck 52 dikocok ulang tiap deal. Tiap pemain 3 kartu tertutup.
//  2. Nilai kartu: As = 1, 2–9 sesuai nominal, 10/J/Q/K = 0. Poin = jumlah nilai mod 10 (0–9).
//  3. Urutan kekuatan: Tris (tiga kartu angka sama) > Samhong (tiga kartu gambar J/Q/K)
//     > 9 poin > 8 … > 0 poin. Seri dipecah dengan kartu tertinggi (urut A, K, Q, … 2,
//     lalu kartu kedua, ketiga); bila tetap sama → menang bersama.
//  4. Sekali per deal, sesuai urutan giliran, tiap pemain memilih "Tukar" (buang 1 kartu
//     terbuka + ambil 1 dari deck) atau "Tahan". Setelah semua memilih → kartu dibuka.
//  5. Skor (gaya chip, zero-sum): tiap pemain kalah membayar ke tiap pemenang sebesar
//     pengali tangan pemenang (Tris ×3, Samhong ×2, biasa ×1).
//  6. Beberapa deal (opsi); peringkat akhir berdasarkan total poin.

import { type Card, rankOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog, clampInt } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface SamhongOptions { turnSeconds: number; passAndPlay: boolean; deals: number }

export interface SamhongState {
  gameId: 'samhong';
  options: SamhongOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  phase: 'swap' | 'showdown';
  turn: number | null;
  /** Pilihan tiap pemain di deal ini: null = belum, 'swap' / 'stand'. */
  choices: ('swap' | 'stand' | null)[];
  dealNo: number;
  dealer: number;
  scores: number[];
  lastDeal: number[] | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'deals', label: 'Jumlah Deal', type: 'select', choices: [
    { value: 3, label: '3 Deal (Kilat)' }, { value: 5, label: '5 Deal (Standar)' }, { value: 8, label: '8 Deal (Panjang)' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: SamhongOptions = { turnSeconds: 25, passAndPlay: false, deals: 5 };
const SHOWDOWN_DELAY = 4000;

export const samhongValue = (c: Card) => {
  const r = rankOf(c);
  return r === 14 ? 1 : r >= 10 ? 0 : r;
};

export interface SamhongHand {
  /** 2 = Tris, 1 = Samhong, 0 = poin biasa. */
  cat: number;
  points: number;
  /** [cat, poin, rank tertinggi, kedua, ketiga] — dibandingkan leksikografis. */
  key: number[];
  name: string;
}

export function evalSamhong(hand: Card[]): SamhongHand {
  const ranks = hand.map(rankOf).sort((a, b) => b - a);
  const points = hand.reduce((t, c) => t + samhongValue(c), 0) % 10;
  const tris = ranks.every(r => r === ranks[0]);
  const pics = !tris && ranks.every(r => r >= 11 && r <= 13);
  const cat = tris ? 2 : pics ? 1 : 0;
  return {
    cat, points,
    key: [cat, cat === 0 ? points : 0, ...ranks],
    name: tris ? 'Tris' : pics ? 'Samhong' : `${points} poin`,
  };
}

export function compareSamhong(a: Card[], b: Card[]): number {
  const ka = evalSamhong(a).key, kb = evalSamhong(b).key;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i] ? 1 : -1;
  return 0;
}

const multiplier = (h: SamhongHand) => (h.cat === 2 ? 3 : h.cat === 1 ? 2 : 1);

/** Nilai kasar kekuatan tangan untuk heuristik bot (0..~32). */
const strength = (hand: Card[]) => {
  const e = evalSamhong(hand);
  return e.cat === 2 ? 30 : e.cat === 1 ? 20 : e.points + Math.max(...hand.map(rankOf)) / 20;
};

function actionsFor(s: SamhongState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase !== 'swap') return [];
  return [
    { id: 'stand', label: 'Tahan', style: 'primary', hint: 'Pertahankan ketiga kartu' },
    { id: 'swap', label: 'Tukar 1', cards: { min: 1, max: 1 }, hint: 'Buang 1 kartu, ambil 1 dari deck' },
  ];
}

function startDeal(s: SamhongState, rng: Rng) {
  const n = s.names.length;
  s.deck = shuffledDeck(rng);
  s.hands = s.names.map(() => s.deck.splice(0, 3));
  s.discard = [];
  s.choices = s.names.map(() => null);
  s.phase = 'swap';
  s.lastDeal = null;
  s.banner = null;
  s.turn = (s.dealer + 1) % n;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}/${s.options.deals} dimulai. ${s.names[s.turn]} memilih duluan.` });
}

function showdown(s: SamhongState) {
  const n = s.names.length;
  let winners: number[] = [0];
  for (let i = 1; i < n; i++) {
    const c = compareSamhong(s.hands[i], s.hands[winners[0]]);
    if (c > 0) winners = [i];
    else if (c === 0) winners.push(i);
  }
  const m = multiplier(evalSamhong(s.hands[winners[0]]));
  const pts = s.names.map((_, i) => (winners.includes(i) ? m * (n - winners.length) : -m * winners.length));
  for (let i = 0; i < n; i++) s.scores[i] += pts[i];
  s.lastDeal = pts;
  s.phase = 'showdown';
  s.turn = null;
  s.turnDeadline = null;
  const e = evalSamhong(s.hands[winners[0]]);
  s.banner = winners.length === n
    ? `Semua seri (${e.name}) — tidak ada poin berpindah.`
    : `${winners.map(w => s.names[w]).join(' & ')} menang dengan ${e.name}${m > 1 ? ` (×${m})` : ''}!`;
  pushLog(s.log, { seat: winners.length === 1 ? winners[0] : null, text: s.banner });
  for (let i = 0; i < n; i++) pushLog(s.log, { seat: i, text: `${s.names[i]}: ${s.hands[i].map(cardLabel).join(' ')} — ${evalSamhong(s.hands[i]).name}` });
}

export const samhong: GameModule<SamhongState, GenericAction, GenericView, SamhongOptions> = {
  id: 'samhong',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      deals: clampInt(r.deals, 1, 10, 5),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Samhong butuh 2–6 pemain');
    const s: SamhongState = {
      gameId: 'samhong', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], deck: [], discard: [], phase: 'swap', turn: null, choices: [],
      dealNo: 1, dealer: rng.int(seats.length), scores: seats.map(() => 0), lastDeal: null, banner: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase !== 'swap' ? null : s.turn),

  apply(state, seat, raw, _rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.phase !== 'swap') throw new RuleError('Kartu sedang dibuka');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    if (spec.id === 'swap') {
      const [card] = takeCards(s.hands[seat], a.cards, 1, 1);
      removeCards(s.hands[seat], [card]);
      s.discard.push(card);
      s.hands[seat].push(s.deck.shift()!);
      s.choices[seat] = 'swap';
      pushLog(s.log, { seat, text: `${name} menukar ${cardLabel(card)}` });
    } else {
      s.choices[seat] = 'stand';
      pushLog(s.log, { seat, text: `${name} tahan` });
    }
    const n = s.names.length;
    const next = (seat + 1) % n;
    if (s.choices[next] !== null) { showdown(s); return s; }
    s.turn = next;
    s.turnDeadline = deadline(s.options.turnSeconds);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'showdown' ? SHOWDOWN_DELAY : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'showdown') return state;
    const s = clone(state);
    if (s.dealNo >= s.options.deals) {
      s.over = true;
      const best = Math.max(...s.scores);
      pushLog(s.log, { seat: null, text: `🏆 Permainan selesai! Juara: ${s.names.filter((_, i) => s.scores[i] === best).join(', ')} (${best} poin)` });
      return s;
    }
    s.dealNo += 1;
    s.dealer = (s.dealer + 1) % s.names.length;
    startDeal(s, rng);
    return s;
  },

  timeoutAction: () => ({ type: 'act', id: 'stand' }),

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const revealed = s.phase === 'showdown' || s.over;
    const mine = me !== null && s.hands[me].length === 3 ? evalSamhong(s.hands[me]) : null;
    return {
      gameId: 'samhong',
      generic: true,
      you: me,
      turn: s.over || s.phase !== 'swap' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: samhong.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        status: revealed ? `${evalSamhong(s.hands[i]).name}${s.lastDeal ? ` · ${s.lastDeal[i] > 0 ? '+' : ''}${s.lastDeal[i]}` : ''}`
          : s.choices[i] === 'swap' ? 'Tukar 1' : s.choices[i] === 'stand' ? 'Tahan' : undefined,
        tag: i === s.dealer ? 'D' : undefined,
        faceUp: revealed ? s.hands[i].slice() : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length },
        { id: 'discard', label: 'Kartu Ditukar', cards: s.discard.slice(), spread: true },
      ],
      actions: actionsFor(s, me),
      playable: me !== null && s.turn === me && s.phase === 'swap' ? s.hands[me].slice() : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'showdown' ? 'Kartu dibuka!'
        : s.turn !== me ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : 'Tahan, atau pilih 1 kartu untuk ditukar',
      badges: [`Deal ${s.dealNo}/${s.options.deals}`, ...(mine && !revealed ? [`Tanganmu: ${mine.name}`] : [])],
      banner: revealed ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const hand = v.hand;
    if (!v.actions.some(a => a.id === 'swap') || hand.length !== 3) return { type: 'act', id: 'stand' };
    if (difficulty === 'easy') {
      if (evalSamhong(hand).cat === 0 && evalSamhong(hand).points < 5 && rng.float() < 0.6) {
        return { type: 'act', id: 'swap', cards: [hand[rng.int(3)]] };
      }
      return { type: 'act', id: 'stand' };
    }
    // Hitung nilai harapan untuk tiap kemungkinan tukar dari kartu yang belum terlihat.
    const seen = new Set<Card>([...hand, ...v.piles.flatMap(p => p.cards.filter((c): c is Card => c !== null))]);
    const unseen: Card[] = [];
    for (const s of ['S', 'H', 'D', 'C']) for (const r of '23456789TJQKA') if (!seen.has(r + s)) unseen.push(r + s);
    const cur = strength(hand);
    let best: { card: Card; ev: number } | null = null;
    for (const c of hand) {
      const rest = hand.filter(x => x !== c);
      let tot = 0;
      for (const u of unseen) tot += strength([...rest, u]);
      const ev = tot / unseen.length;
      if (!best || ev > best.ev) best = { card: c, ev };
    }
    const margin = difficulty === 'hard' ? 0.3 : 0.8;
    if (best && best.ev > cur + margin) return { type: 'act', id: 'swap', cards: [best.card] };
    return { type: 'act', id: 'stand' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
