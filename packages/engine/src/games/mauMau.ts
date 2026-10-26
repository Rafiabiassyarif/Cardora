// games/mauMau.ts — Mau-Mau, 2–4 pemain.
//
// Aturan:
//  1. Deck 52 (atau 32 kartu 7..A sesuai opsi). Tiap pemain 5 kartu (opsi 7). Satu kartu dibuka
//     sebagai tumpukan buangan; kartu pembuka tidak boleh kartu aksi (7, 8, J) — dikubur & dibuka ulang.
//  2. Giliran: mainkan 1 kartu yang SAMA suit (suit aktif) atau SAMA angka dengan kartu teratas.
//  3. Kartu aksi:
//     - 7: pemain berikutnya wajib ambil 2 kartu, KECUALI ia membalas dengan 7 juga (menumpuk +2).
//       Pemain yang menerima hukuman mengambil semua kartunya lalu gilirannya selesai.
//     - 8: pemain berikutnya dilewati (skip).
//     - J: kartu liar — boleh di atas kartu apa pun kecuali J; pemain lalu memilih suit baru.
//  4. Jika tidak bisa/tidak mau main: ambil 1 kartu. Kartu itu boleh langsung dimainkan bila sah;
//     jika tidak, giliran berlalu ("Lewat"). Deck habis → buangan (kecuali kartu teratas) dikocok ulang.
//  5. Pemain pertama yang kartunya habis menang. Yang lain diperingkat dari penalti kartu tersisa
//     (J = 20, A = 11, 10 = 10, K = 4, Q = 3, angka lain = nominal) — makin kecil makin baik.
//  6. Pengaman: buntu (semua lewat dengan deck kosong) atau batas 600 giliran → selesai dihitung dari penalti.

import { type Card, rankOf, suitOf, shuffle, standardDeck, cardLabel, SUITS } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, SUIT_NAME, SUIT_SYMBOL, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION, rankLabel,
} from '../generic';

export interface MauMauOptions { turnSeconds: number; passAndPlay: boolean; handSize: number; deckSize: number }

export interface MauMauState {
  gameId: 'mau-mau';
  options: MauMauOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  /** Suit yang berlaku (bisa berbeda dari kartu teratas setelah J). */
  activeSuit: string;
  turn: number | null;
  /** Hukuman ambil kartu yang menumpuk dari 7 (0 = tidak ada). */
  pendingDraw: number;
  drewThisTurn: boolean;
  choosingSuit: boolean;
  passes: number;
  turns: number;
  winner: number | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_TURNS = 600;

const OPTIONS: OptionSpec[] = [
  { key: 'deckSize', label: 'Jenis Deck', type: 'select', choices: [{ value: 52, label: '52 Kartu' }, { value: 32, label: '32 Kartu (7–A, Klasik)' }] },
  { key: 'handSize', label: 'Kartu Awal', type: 'select', choices: [{ value: 5, label: '5 Kartu (Standar)' }, { value: 7, label: '7 Kartu' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: MauMauOptions = { turnSeconds: 25, passAndPlay: false, handSize: 5, deckSize: 52 };

export const mauMauPenalty = (c: Card) => {
  const r = rankOf(c);
  return r === 11 ? 20 : r === 14 ? 11 : r === 13 ? 4 : r === 12 ? 3 : r;
};

const isAction = (c: Card) => [7, 8, 11].includes(rankOf(c));
const top = (s: MauMauState) => s.discard[s.discard.length - 1];
const deckSizeOf = (s: MauMauState) => (s.options.deckSize === 32 ? 32 : 52);

function canPlay(s: MauMauState, c: Card): boolean {
  const t = top(s);
  if (s.pendingDraw > 0) return rankOf(c) === 7;
  if (rankOf(c) === 11) return rankOf(t) !== 11;
  if (rankOf(t) === 11) return suitOf(c) === s.activeSuit;
  return suitOf(c) === s.activeSuit || rankOf(c) === rankOf(t);
}

function playableCards(s: MauMauState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.drewThisTurn) return [hand[hand.length - 1]].filter(c => c !== undefined && canPlay(s, c));
  return hand.filter(c => canPlay(s, c));
}

const canDraw = (s: MauMauState) => s.deck.length > 0 || s.discard.length > 1;

function refillDeck(s: MauMauState, rng: Rng) {
  if (s.deck.length > 0 || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.deck = shuffle(s.discard, rng);
  s.discard = [keep];
  pushLog(s.log, { seat: null, text: 'Tumpukan buangan dikocok menjadi deck baru.' });
}

function actionsFor(s: MauMauState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.choosingSuit) {
    return SUITS.map(x => ({ id: `suit:${x}`, label: `Pilih ${SUIT_NAME[x]}`, style: 'primary' as const }));
  }
  const acts: GActionSpec[] = [];
  if (playableCards(s, seat).length) acts.push({ id: 'play', label: 'Mainkan', style: 'primary', cards: { min: 1, max: 1 } });
  if (s.pendingDraw > 0) {
    acts.push({ id: 'penalty', label: `Ambil ${s.pendingDraw}`, style: 'danger', hint: 'Terima hukuman dari kartu 7' });
    return acts;
  }
  if (!s.drewThisTurn && canDraw(s)) acts.push({ id: 'draw', label: 'Ambil Kartu' });
  if (s.drewThisTurn || !canDraw(s)) acts.push({ id: 'pass', label: 'Lewat' });
  return acts;
}

function finish(s: MauMauState, winner: number | null, why?: string) {
  s.over = true;
  s.winner = winner;
  s.turn = null;
  s.turnDeadline = null;
  s.choosingSuit = false;
  pushLog(s.log, { seat: winner, text: winner !== null ? `🏆 ${s.names[winner]} menghabiskan kartu — Mau-Mau!` : (why ?? 'Permainan buntu — dihitung dari penalti kartu.') });
}

/** Pindah giliran; skip = lewati 1 pemain. */
function nextTurn(s: MauMauState, skip = false) {
  const n = s.names.length;
  let t = ((s.turn ?? 0) + 1) % n;
  if (skip) {
    pushLog(s.log, { seat: t, text: `${s.names[t]} dilewati (kartu 8)` });
    t = (t + 1) % n;
  }
  s.turn = t;
  s.drewThisTurn = false;
  s.turns += 1;
  s.turnDeadline = deadline(s.options.turnSeconds);
  if (s.turns >= MAX_TURNS) finish(s, null, 'Batas giliran tercapai — dihitung dari penalti kartu.');
}

export const mauMau: GameModule<MauMauState, GenericAction, GenericView, MauMauOptions> = {
  id: 'mau-mau',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      handSize: Number(r.handSize) === 7 ? 7 : 5,
      deckSize: Number(r.deckSize) === 32 ? 32 : 52,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Mau-Mau butuh 2–4 pemain');
    const base = options.deckSize === 32 ? standardDeck().filter(c => rankOf(c) >= 7) : standardDeck();
    const deck = shuffle(base, rng);
    // Kartu pembuka diambil lebih dulu (kartu aksi dilewati) agar selalu ada.
    const i = deck.findIndex(c => !isAction(c));
    const first = deck.splice(i, 1)[0];
    const hands = seats.map(() => deck.splice(0, options.handSize));
    const s: MauMauState = {
      gameId: 'mau-mau', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, deck, discard: [first], activeSuit: suitOf(first),
      turn: rng.int(seats.length), pendingDraw: 0, drewThisTurn: false, choosingSuit: false, passes: 0, turns: 0,
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
      pushLog(s.log, { seat, text: `${name} meminta ${SUIT_NAME[s.activeSuit]}` });
      nextTurn(s);
      return s;
    }
    if (spec.id === 'penalty') {
      let got = 0;
      for (let k = 0; k < s.pendingDraw; k++) {
        refillDeck(s, rng);
        if (!s.deck.length) break;
        hand.push(s.deck.shift()!);
        got++;
      }
      pushLog(s.log, { seat, text: `${name} kena hukuman, mengambil ${got} kartu` });
      s.pendingDraw = 0;
      s.passes = 0;
      nextTurn(s);
      return s;
    }
    if (spec.id === 'draw') {
      refillDeck(s, rng);
      hand.push(s.deck.shift()!);
      s.drewThisTurn = true;
      s.passes = 0;
      pushLog(s.log, { seat, text: `${name} mengambil 1 kartu` });
      return s;
    }
    if (spec.id === 'pass') {
      s.passes += 1;
      pushLog(s.log, { seat, text: `${name} lewat` });
      if (s.passes >= s.names.length && !canDraw(s)) { finish(s, null); return s; }
      nextTurn(s);
      return s;
    }
    // play
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!playableCards(s, seat).includes(card)) {
      throw new RuleError(s.pendingDraw > 0 ? 'Hanya kartu 7 yang bisa membalas hukuman'
        : s.drewThisTurn ? 'Setelah mengambil, hanya kartu yang baru diambil yang boleh dimainkan'
        : rankOf(card) === 11 ? 'J tidak boleh di atas J'
        : `Kartu harus ${SUIT_SYMBOL[s.activeSuit]} atau angka ${rankLabel(rankOf(top(s)))}`);
    }
    removeCards(hand, [card]);
    s.discard.push(card);
    s.passes = 0;
    pushLog(s.log, { seat, text: `${name} memainkan ${cardLabel(card)}` });
    if (hand.length === 0) { finish(s, seat); return s; }
    const r = rankOf(card);
    if (r === 11) { s.choosingSuit = true; s.drewThisTurn = false; s.activeSuit = suitOf(card); return s; }
    s.activeSuit = suitOf(card);
    if (r === 7) {
      s.pendingDraw += 2;
      nextTurn(s);
      return s;
    }
    nextTurn(s, r === 8);
    return s;
  },

  autoDelay: () => null,
  advance: s => s,

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    if (s.choosingSuit) return { type: 'act', id: acts[0].id };
    const p = playableCards(s, seat);
    if (p.length) return { type: 'act', id: 'play', cards: [p[0]] };
    if (acts.some(x => x.id === 'penalty')) return { type: 'act', id: 'penalty' };
    if (acts.some(x => x.id === 'draw')) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const pen = s.hands.map(h => h.reduce((t, c) => t + mauMauPenalty(c), 0));
    const t = top(s);
    const myTurn = me !== null && s.turn === me && !s.over;
    return {
      gameId: 'mau-mau',
      generic: true,
      you: me,
      turn: s.over ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: mauMau.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: s.over ? `${pen[i]} penalti` : undefined,
        status: s.winner === i ? 'Mau-Mau! 🏆' : s.hands[i].length === 1 && !s.over ? 'Mau!' : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length },
        { id: 'discard', label: 'Buangan', cards: [t], count: s.discard.length, highlight: true,
          caption: s.activeSuit !== suitOf(t) ? `Diminta: ${SUIT_NAME[s.activeSuit]}` : undefined },
      ],
      actions: actionsFor(s, me),
      playable: myTurn && !s.choosingSuit ? playableCards(s, me!) : [],
      prompt: s.over ? 'Permainan selesai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.choosingSuit ? 'Pilih lambang (suit) yang diminta'
        : s.pendingDraw > 0 ? `Balas dengan 7 atau ambil ${s.pendingDraw} kartu`
        : s.drewThisTurn ? 'Mainkan kartu yang baru diambil, atau lewat'
        : `Mainkan ${SUIT_SYMBOL[s.activeSuit]} atau angka ${rankLabel(rankOf(t))} — J bebas`,
      badges: [
        `Suit aktif: ${SUIT_SYMBOL[s.activeSuit]}`,
        ...(s.pendingDraw > 0 ? [`Hukuman +${s.pendingDraw}`] : []),
        `Deck ${deckSizeOf(s)}`,
      ],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.some(i => i.startsWith('suit:'))) {
      const counts = new Map<string, number>();
      for (const c of v.hand) if (rankOf(c) !== 11) counts.set(suitOf(c), (counts.get(suitOf(c)) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SUITS[rng.int(4)];
      return { type: 'act', id: `suit:${best}` };
    }
    const playable = v.playable ?? [];
    if (playable.length && ids.includes('play')) {
      if (difficulty === 'easy') return { type: 'act', id: 'play', cards: [playable[rng.int(playable.length)]] };
      // Simpan J sebagai cadangan; utamakan 7/8 (menyerang) lalu kartu berpenalti tinggi.
      const nonJ = playable.filter(c => rankOf(c) !== 11);
      const pool = nonJ.length ? nonJ : playable;
      const nextCount = v.players[((v.you ?? 0) + 1) % v.players.length]?.count ?? 9;
      const score = (c: Card) => mauMauPenalty(c) + (rankOf(c) === 7 || rankOf(c) === 8 ? (nextCount <= 2 ? 40 : difficulty === 'hard' ? 8 : 0) : 0);
      const pick = pool.slice().sort((a, b) => score(b) - score(a))[0];
      return { type: 'act', id: 'play', cards: [pick] };
    }
    if (ids.includes('penalty')) return { type: 'act', id: 'penalty' };
    if (ids.includes('draw')) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const pen = s.hands.map(h => h.reduce((t, c) => t + mauMauPenalty(c), 0));
    if (s.winner !== null) pen[s.winner] = -1;
    return rankByScore(pen, false).map(r => ({ ...r, score: Math.max(0, r.score) }));
  },
};
