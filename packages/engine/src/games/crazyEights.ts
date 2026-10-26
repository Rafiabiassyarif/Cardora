// games/crazyEights.ts — Crazy Eights, 2–4 pemain. (Game referensi untuk protokol GenericView.)
//
// Aturan:
//  1. Deck 52. Tiap pemain 7 kartu (5 bila 2 pemain? — Cardora: selalu 7). Satu kartu dibuka
//     sebagai tumpukan buangan; jika kartu pembuka adalah 8, dikubur & dibuka ulang.
//  2. Giliran: mainkan 1 kartu yang SAMA suit atau SAMA angka dengan kartu teratas
//     (atau suit yang sedang diminta setelah 8).
//  3. Kartu 8 bisa dimainkan kapan saja; pemain lalu memilih suit baru.
//  4. Jika tidak bisa/tidak mau main: ambil 1 kartu dari deck. Kartu yang diambil boleh
//     langsung dimainkan bila cocok; jika tidak, giliran berlalu ("Lewat").
//     Jika deck habis, tumpukan buangan (kecuali kartu teratas) dikocok jadi deck baru;
//     jika tetap kosong, pemain boleh lewat.
//  5. Pemain pertama yang kartunya habis menang. Pemain lain diperingkat berdasarkan
//     penalti kartu tersisa (8 = 50, gambar = 10, As = 1, angka = nominal) — makin kecil makin baik.
//  6. Jika semua pemain lewat berturut-turut dengan deck kosong (buntu), permainan selesai
//     dan peringkat dihitung dari penalti.

import { type Card, rankOf, suitOf, shuffledDeck, shuffle, cardLabel, SUITS } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, SUIT_NAME, SUIT_SYMBOL, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface CrazyEightsOptions { turnSeconds: number; passAndPlay: boolean; handSize: number }

export interface CrazyEightsState {
  gameId: 'crazy-eights';
  options: CrazyEightsOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  /** Suit yang berlaku (berbeda dari kartu teratas setelah 8 dimainkan). */
  activeSuit: string;
  turn: number | null;
  /** Pemain sudah mengambil kartu di giliran ini (boleh main kartu itu atau lewat). */
  drewThisTurn: boolean;
  /** Pemain baru memainkan 8 dan harus memilih suit. */
  choosingSuit: boolean;
  /** Jumlah lewat berturut-turut (deteksi buntu). */
  passes: number;
  winner: number | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'handSize', label: 'Kartu Awal', type: 'select', choices: [{ value: 5, label: '5 Kartu (Cepat)' }, { value: 7, label: '7 Kartu (Standar)' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: CrazyEightsOptions = { turnSeconds: 25, passAndPlay: false, handSize: 7 };

export const penaltyOf = (c: Card) => {
  const r = rankOf(c);
  return r === 8 ? 50 : r === 14 ? 1 : r >= 10 ? 10 : r;
};

const top = (s: CrazyEightsState) => s.discard[s.discard.length - 1];
const canPlay = (s: CrazyEightsState, c: Card) => rankOf(c) === 8 || suitOf(c) === s.activeSuit || rankOf(c) === rankOf(top(s));

function refillDeck(s: CrazyEightsState, rng: Rng) {
  if (s.deck.length > 0 || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.deck = shuffle(s.discard, rng);
  s.discard = [keep];
  pushLog(s.log, { seat: null, text: 'Tumpukan buangan dikocok menjadi deck baru.' });
}

function actionsFor(s: CrazyEightsState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.choosingSuit) {
    return SUITS.map(x => ({ id: `suit:${x}`, label: `Pilih ${SUIT_NAME[x]}`, style: 'primary' as const }));
  }
  const acts: GActionSpec[] = [];
  const hand = s.hands[seat];
  const playable = s.drewThisTurn ? [hand[hand.length - 1]].filter(c => canPlay(s, c)) : hand.filter(c => canPlay(s, c));
  if (playable.length) acts.push({ id: 'play', label: 'Mainkan', style: 'primary', cards: { min: 1, max: 1 } });
  if (!s.drewThisTurn && (s.deck.length > 0 || s.discard.length > 1)) acts.push({ id: 'draw', label: 'Ambil Kartu' });
  if (s.drewThisTurn || (s.deck.length === 0 && s.discard.length <= 1)) acts.push({ id: 'pass', label: 'Lewat' });
  return acts;
}

function playableCards(s: CrazyEightsState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.drewThisTurn) return [hand[hand.length - 1]].filter(c => canPlay(s, c));
  return hand.filter(c => canPlay(s, c));
}

function nextTurn(s: CrazyEightsState) {
  s.turn = ((s.turn ?? 0) + 1) % s.names.length;
  s.drewThisTurn = false;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function finish(s: CrazyEightsState, winner: number | null) {
  s.over = true;
  s.winner = winner;
  s.turn = null;
  s.turnDeadline = null;
  pushLog(s.log, { seat: winner, text: winner !== null ? `🏆 ${s.names[winner]} menghabiskan kartu!` : 'Permainan buntu — dihitung dari penalti kartu.' });
}

export const crazyEights: GameModule<CrazyEightsState, GenericAction, GenericView, CrazyEightsOptions> = {
  id: 'crazy-eights',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      handSize: Number(r.handSize) === 5 ? 5 : 7,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Crazy Eights butuh 2–4 pemain');
    const deck = shuffledDeck(rng);
    const hands = seats.map(() => deck.splice(0, options.handSize));
    // Kartu pembuka tidak boleh 8.
    const i = deck.findIndex(c => rankOf(c) !== 8);
    const first = deck.splice(i, 1)[0];
    const s: CrazyEightsState = {
      gameId: 'crazy-eights', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, deck, discard: [first], activeSuit: suitOf(first),
      turn: rng.int(seats.length), drewThisTurn: false, choosingSuit: false, passes: 0,
      winner: null, over: false, log: [], turnDeadline: deadline(options.turnSeconds),
    };
    pushLog(s.log, { seat: null, text: `Kartu pembuka: ${cardLabel(first)}. ${s.names[s.turn!]} jalan duluan.` });
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (spec.id.startsWith('suit:')) {
      s.activeSuit = spec.id.slice(5);
      s.choosingSuit = false;
      pushLog(s.log, { seat, text: `${name} memilih ${SUIT_NAME[s.activeSuit]}` });
      nextTurn(s);
      return s;
    }
    if (spec.id === 'draw') {
      refillDeck(s, rng);
      const c = s.deck.shift()!;
      hand.push(c);
      s.drewThisTurn = true;
      s.passes = 0;
      pushLog(s.log, { seat, text: `${name} mengambil 1 kartu` });
      return s;
    }
    if (spec.id === 'pass') {
      s.passes += 1;
      pushLog(s.log, { seat, text: `${name} lewat` });
      if (s.passes >= s.names.length && s.deck.length === 0 && s.discard.length <= 1) { finish(s, null); return s; }
      nextTurn(s);
      return s;
    }
    // play
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!playableCards(s, seat).includes(card)) {
      throw new RuleError(s.drewThisTurn ? 'Setelah mengambil, hanya kartu yang baru diambil yang boleh dimainkan' : `Kartu harus ${SUIT_SYMBOL[s.activeSuit]} atau angka yang sama (atau 8)`);
    }
    removeCards(hand, [card]);
    s.discard.push(card);
    s.passes = 0;
    pushLog(s.log, { seat, text: `${name} memainkan ${cardLabel(card)}` });
    if (hand.length === 0) { finish(s, seat); return s; }
    if (rankOf(card) === 8) {
      s.choosingSuit = true;
      s.drewThisTurn = false;
      return s;
    }
    s.activeSuit = suitOf(card);
    nextTurn(s);
    return s;
  },

  autoDelay: () => null,
  advance: s => s,

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    if (s.choosingSuit) return { type: 'act', id: acts[0].id };
    const p = playableCards(s, seat);
    if (p.length) return { type: 'act', id: 'play', cards: [p[0]] };
    if (acts.some(x => x.id === 'draw')) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const penalties = s.hands.map(h => h.reduce((t, c) => t + penaltyOf(c), 0));
    return {
      gameId: 'crazy-eights',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: crazyEights.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: s.over ? `${penalties[i]} penalti` : undefined,
        status: s.winner === i ? 'Habis! 🏆' : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length },
        { id: 'discard', label: 'Buangan', cards: [top(s)], count: s.discard.length, highlight: true,
          caption: s.activeSuit !== suitOf(top(s)) ? `Diminta: ${SUIT_NAME[s.activeSuit]}` : undefined },
      ],
      actions: actionsFor(s, me),
      playable: me !== null && s.turn === me && !s.choosingSuit ? playableCards(s, me) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.turn !== me ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.choosingSuit ? 'Pilih lambang (suit) baru'
        : s.drewThisTurn ? 'Mainkan kartu yang baru diambil, atau lewat'
        : `Mainkan kartu ${SUIT_SYMBOL[s.activeSuit]} atau angka ${cardLabel(top(s)).slice(0, -1)} — 8 bebas`,
      badges: [`Suit aktif: ${SUIT_SYMBOL[s.activeSuit]}`],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.some(i => i.startsWith('suit:'))) {
      // Pilih suit yang paling banyak di tangan.
      const counts = new Map<string, number>();
      for (const c of v.hand) if (rankOf(c) !== 8) counts.set(suitOf(c), (counts.get(suitOf(c)) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SUITS[rng.int(4)];
      return { type: 'act', id: `suit:${best}` };
    }
    const playable = v.playable ?? [];
    if (playable.length) {
      // Simpan 8 sebagai cadangan; buang kartu bernilai penalti tertinggi dulu.
      const non8 = playable.filter(c => rankOf(c) !== 8);
      const pool = non8.length && difficulty !== 'easy' ? non8 : playable;
      const pick = difficulty === 'easy' ? pool[rng.int(pool.length)] : pool.slice().sort((a, b) => penaltyOf(b) - penaltyOf(a))[0];
      return { type: 'act', id: 'play', cards: [pick] };
    }
    if (ids.includes('draw')) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const pen = s.hands.map(h => h.reduce((t, c) => t + penaltyOf(c), 0));
    if (s.winner !== null) pen[s.winner] = -1; // pemenang selalu juara 1
    return rankByScore(pen, false).map(r => ({ ...r, score: Math.max(0, r.score) }));
  },
};
