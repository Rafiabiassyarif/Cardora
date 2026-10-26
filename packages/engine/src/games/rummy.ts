// games/rummy.ts — Classic Rummy, 2–4 pemain.
//
// Aturan:
//  1. Deck 52. 2 pemain: 10 kartu; 3–4 pemain: 7 kartu. Satu kartu dibuka sebagai buangan.
//  2. Giliran: ambil 1 kartu dari stok ATAU kartu teratas buangan.
//  3. Lalu (opsional, berulang): turunkan meld — Set (3–4 rank sama) atau Run (3+ selambang
//     berurutan; As boleh rendah A-2-3 atau tinggi Q-K-A, tidak memutar) — dan/atau tempel
//     1 kartu ke meld mana pun di meja (meld tujuan dideteksi otomatis).
//  4. Akhiri giliran dengan membuang 1 kartu. Kartu yang baru diambil dari buangan tidak boleh
//     langsung dibuang (kecuali itu kartu terakhir). Jika tangan habis setelah menurunkan/
//     menempel, pemain langsung keluar tanpa membuang.
//  5. Pemain pertama yang kartunya habis memenangkan deal dan mendapat poin dari sisa kartu
//     lawan (As = 1, 2–10 = nominal, J/Q/K = 10).
//  6. Stok habis → buangan (kecuali kartu teratas) dikocok jadi stok baru. Pengaman: setelah
//     5 kali kocok ulang atau 300 giliran, deal berakhir buntu: pemain dengan nilai tangan
//     terkecil (tunggal) mendapat selisih nilai dari tiap lawan; jika seri, tanpa skor.
//  7. Dimainkan beberapa deal (opsi); dealer bergilir. Peringkat berdasarkan total poin.

import { type Card, shuffledDeck, shuffle, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { deadwoodValue, handValue, isValidMeld, solveMelds, sortHand, sortMeld } from './rummyCore';

export interface RummyOptions { turnSeconds: number; passAndPlay: boolean; deals: number }

export interface RummyMeld { owner: number; cards: Card[] }

export interface RummyState {
  gameId: 'rummy';
  options: RummyOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  /** Meld di meja (urutan diturunkan). */
  melds: RummyMeld[];
  stock: Card[];
  discard: Card[];
  dealer: number;
  turn: number | null;
  /** draw = wajib ambil; play = turunkan/tempel/buang; show = jeda akhir deal. */
  phase: 'draw' | 'play' | 'show';
  takenDiscard: Card | null;
  scores: number[];
  dealNo: number;
  turnsThisDeal: number;
  reshuffles: number;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const ACE_HIGH = true;
const MAX_TURNS = 300;
const MAX_RESHUFFLES = 5;

const OPTIONS: OptionSpec[] = [
  { key: 'deals', label: 'Jumlah Deal', type: 'select', choices: [
    { value: 1, label: '1 Deal (Kilat)' }, { value: 3, label: '3 Deal (Standar)' }, { value: 5, label: '5 Deal (Panjang)' },
  ] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: RummyOptions = { turnSeconds: 25, passAndPlay: false, deals: 3 };

/** Meld di meja yang bisa menerima kartu `c` (indeks pertama), atau -1. */
export function layoffTarget(melds: Card[][], c: Card): number {
  return melds.findIndex(m => isValidMeld([...m, c], ACE_HIGH));
}

function discardable(s: RummyState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (hand.length === 1) return hand.slice();
  return hand.filter(c => c !== s.takenDiscard);
}

function layable(s: RummyState, seat: number): Card[] {
  const tm = s.melds.map(m => m.cards);
  return s.hands[seat].filter(c => layoffTarget(tm, c) >= 0);
}

function actionsFor(s: RummyState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase === 'show') return [];
  if (s.phase === 'draw') {
    const acts: GActionSpec[] = [];
    if (s.stock.length > 0 || s.discard.length > 1) acts.push({ id: 'stock', label: 'Ambil dari Stok', style: 'primary' });
    if (s.discard.length) acts.push({ id: 'pickup', label: 'Ambil Buangan' });
    return acts;
  }
  const hand = s.hands[seat];
  const acts: GActionSpec[] = [];
  if (hand.length >= 3 && solveMelds(hand, ACE_HIGH).melds.length) {
    acts.push({ id: 'meld', label: 'Turunkan', style: 'primary', cards: { min: 3, max: Math.min(13, hand.length) }, hint: 'Pilih kartu Set atau Run' });
  }
  if (layable(s, seat).length) acts.push({ id: 'layoff', label: 'Tempel', cards: { min: 1, max: 1 }, hint: 'Tempel 1 kartu ke meld di meja' });
  acts.push({ id: 'drop', label: 'Buang', cards: { min: 1, max: 1 } });
  return acts;
}

function setTurn(s: RummyState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function deal(s: RummyState, rng: Rng) {
  const n = s.names.length;
  const size = n === 2 ? 10 : 7;
  const deck = shuffledDeck(rng);
  s.hands = s.names.map(() => sortHand(deck.splice(0, size)));
  s.discard = [deck.shift()!];
  s.stock = deck;
  s.melds = [];
  s.phase = 'draw';
  s.takenDiscard = null;
  s.turnsThisDeal = 0;
  s.reshuffles = 0;
  s.banner = null;
  s.dealNo += 1;
  setTurn(s, (s.dealer + 1) % n);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}/${s.options.deals}: ${s.names[s.dealer]} membagi ${size} kartu. Buangan: ${cardLabel(s.discard[0])}.` });
}

function endDeal(s: RummyState, winner: number | null) {
  setTurn(s, null);
  s.takenDiscard = null;
  if (winner === null) {
    // Buntu: nilai tangan terkecil (tunggal) menang & mendapat selisih dari tiap lawan.
    const vals = s.hands.map(handValue);
    const low = Math.min(...vals);
    const lows = vals.filter(v => v === low).length;
    if (lows === 1) {
      const w = vals.indexOf(low);
      const pts = vals.reduce((t, v) => t + (v - low), 0);
      s.scores[w] += pts;
      s.banner = `Deal buntu — ${s.names[w]} nilai tangan terkecil (${low}), +${pts} poin`;
    } else {
      s.banner = 'Deal buntu — nilai tangan terkecil seri, tanpa skor.';
    }
  } else {
    const pts = s.hands.reduce((t, h, i) => (i === winner ? t : t + handValue(h)), 0);
    s.scores[winner] += pts;
    s.banner = `${s.names[winner]} menghabiskan kartu! +${pts} poin`;
  }
  pushLog(s.log, { seat: winner, text: s.banner });
  s.phase = 'show';
  s.dealer = (s.dealer + 1) % s.names.length;
  if (s.dealNo >= s.options.deals) {
    s.over = true;
    const top = Math.max(...s.scores);
    const ws = s.scores.map((x, i) => (x === top ? s.names[i] : null)).filter(Boolean);
    pushLog(s.log, { seat: null, text: `🏆 Juara: ${ws.join(', ')} (${top} poin)` });
  }
}

function nextTurn(s: RummyState) {
  s.turnsThisDeal += 1;
  if (s.turnsThisDeal >= MAX_TURNS) { endDeal(s, null); return; }
  s.phase = 'draw';
  s.takenDiscard = null;
  setTurn(s, ((s.turn ?? 0) + 1) % s.names.length);
}

export const rummy: GameModule<RummyState, GenericAction, GenericView, RummyOptions> = {
  id: 'rummy',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const d = Number(r.deals);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      deals: d === 1 || d === 5 ? d : 3,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Rummy butuh 2–4 pemain');
    const s: RummyState = {
      gameId: 'rummy', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], melds: [], stock: [], discard: [], dealer: rng.int(seats.length), turn: null,
      phase: 'draw', takenDiscard: null, scores: seats.map(() => 0), dealNo: 0, turnsThisDeal: 0, reshuffles: 0,
      banner: null, over: false, log: [], turnDeadline: null,
    };
    deal(s, rng);
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

    if (spec.id === 'stock') {
      if (s.stock.length === 0) {
        const keep = s.discard.pop()!;
        s.stock = shuffle(s.discard, rng);
        s.discard = [keep];
        s.reshuffles += 1;
        pushLog(s.log, { seat: null, text: 'Stok habis — buangan dikocok menjadi stok baru.' });
        if (s.reshuffles > MAX_RESHUFFLES) { endDeal(s, null); return s; }
      }
      const c = s.stock.shift()!;
      hand.push(c);
      s.hands[seat] = sortHand(hand);
      s.phase = 'play';
      s.takenDiscard = null;
      s.turnDeadline = deadline(s.options.turnSeconds);
      pushLog(s.log, { seat, text: `${name} mengambil dari stok` });
      return s;
    }
    if (spec.id === 'pickup') {
      const c = s.discard.pop()!;
      hand.push(c);
      s.hands[seat] = sortHand(hand);
      s.phase = 'play';
      s.takenDiscard = c;
      s.turnDeadline = deadline(s.options.turnSeconds);
      pushLog(s.log, { seat, text: `${name} mengambil ${cardLabel(c)} dari buangan` });
      return s;
    }
    if (spec.id === 'meld') {
      const cards = takeCards(hand, a.cards, 3, 13);
      if (!isValidMeld(cards, ACE_HIGH)) throw new RuleError('Bukan Set (3–4 rank sama) atau Run (3+ selambang berurutan)');
      removeCards(hand, cards);
      const m = sortMeld(cards, ACE_HIGH);
      s.melds.push({ owner: seat, cards: m });
      pushLog(s.log, { seat, text: `${name} menurunkan ${m.map(cardLabel).join(' ')}` });
      if (hand.length === 0) endDeal(s, seat);
      return s;
    }
    if (spec.id === 'layoff') {
      const [c] = takeCards(hand, a.cards, 1, 1);
      const idx = layoffTarget(s.melds.map(m => m.cards), c);
      if (idx < 0) throw new RuleError('Kartu itu tidak cocok dengan meld mana pun di meja');
      removeCards(hand, [c]);
      const m = s.melds[idx];
      m.cards = sortMeld([...m.cards, c], ACE_HIGH);
      pushLog(s.log, { seat, text: `${name} menempel ${cardLabel(c)} ke meld ${s.names[m.owner]}` });
      if (hand.length === 0) endDeal(s, seat);
      return s;
    }
    // drop
    const [c] = takeCards(hand, a.cards, 1, 1);
    if (!discardable(s, seat).includes(c)) throw new RuleError('Kartu yang baru diambil dari buangan tidak boleh langsung dibuang');
    removeCards(hand, [c]);
    s.discard.push(c);
    pushLog(s.log, { seat, text: `${name} membuang ${cardLabel(c)}` });
    if (hand.length === 0) { endDeal(s, seat); return s; }
    nextTurn(s);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'show' ? 5000 : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'show') return state;
    const s = clone(state);
    deal(s, rng);
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'draw') return { type: 'act', id: actionsFor(s, seat)[0].id };
    const d = discardable(s, seat).slice().sort((a, b) => deadwoodValue(b) - deadwoodValue(a));
    return { type: 'act', id: 'drop', cards: [d[0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const acts = actionsFor(s, me);
    const showHands = s.phase === 'show' || s.over;
    let prompt: string;
    if (s.over) prompt = 'Permainan selesai';
    else if (s.phase === 'show') prompt = 'Deal berikutnya segera dimulai…';
    else if (s.turn !== me) prompt = `Menunggu ${s.names[s.turn ?? 0]}…`;
    else if (s.phase === 'draw') prompt = 'Ambil kartu dari stok atau buangan';
    else prompt = 'Turunkan meld / tempel kartu (opsional), lalu buang 1 kartu';
    return {
      gameId: 'rummy',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: rummy.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        tag: s.dealer === i ? 'D' : undefined,
        status: showHands && s.hands[i].length ? `Sisa ${handValue(s.hands[i])} pt` : showHands ? 'Keluar! 🏆' : undefined,
        melds: s.melds.filter(m => m.owner === i).map(m => m.cards.slice()),
        faceUp: showHands ? s.hands[i].slice() : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'stock', label: 'Stok', cards: s.stock.length ? [null] : [], count: s.stock.length },
        { id: 'discard', label: 'Buangan', cards: s.discard.length ? [s.discard[s.discard.length - 1]] : [], count: s.discard.length,
          highlight: s.phase === 'draw' },
      ],
      actions: acts,
      playable: me !== null && s.turn === me && s.phase === 'play' ? discardable(s, me) : [],
      prompt,
      badges: [`Deal ${s.dealNo}/${s.options.deals}`, ...(me !== null && s.phase !== 'show' && !s.over ? [`Nilai tanganmu: ${handValue(s.hands[me])}`] : [])],
      banner: showHands ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const hand = v.hand;
    const table = v.players.flatMap(p => p.melds ?? []);
    if (ids.includes('pickup') || ids.includes('stock')) {
      const top = v.piles.find(p => p.id === 'discard')?.cards[0] ?? null;
      if (top && ids.includes('pickup')) {
        const useful = solveMelds([...hand, top], ACE_HIGH).deadwood <= solveMelds(hand, ACE_HIGH).deadwood || layoffTarget(table, top) >= 0;
        if ((useful && (difficulty !== 'easy' || rng.float() < 0.5)) || !ids.includes('stock')) return { type: 'act', id: 'pickup' };
      }
      return { type: 'act', id: 'stock' };
    }
    if (ids.includes('meld') && (difficulty !== 'easy' || rng.float() < 0.7)) {
      const sol = solveMelds(hand, ACE_HIGH);
      if (sol.melds.length) return { type: 'act', id: 'meld', cards: sol.melds[0] };
    }
    if (ids.includes('layoff') && (difficulty !== 'easy' || rng.float() < 0.7)) {
      const c = hand.find(x => layoffTarget(table, x) >= 0);
      if (c) return { type: 'act', id: 'layoff', cards: [c] };
    }
    const allowed = v.playable && v.playable.length ? v.playable : hand;
    if (difficulty === 'easy') return { type: 'act', id: 'drop', cards: [allowed[rng.int(allowed.length)]] };
    // Buang kartu yang paling mengurangi deadwood sisa; seri → nilai tertinggi.
    // Kartu yang punya "pasangan hidup" (rank sama / selambang berdekatan, dan kartu pelengkapnya
    // belum terlihat di tangan/meja) lebih layak disimpan.
    const seen = new Set<Card>([...hand, ...table.flat()]);
    const R = 'A23456789TJQKA';
    const at = (pos: number, suit: string): Card | null => (pos >= 0 && pos <= 13 ? R[pos] + suit : null);
    const isLive = (c: Card | null) => c !== null && !seen.has(c);
    const posOf = (c: Card) => (c[0] === 'A' ? [0, 13] : [R.indexOf(c[0])]);
    const linked = (c: Card, x: Card): boolean => {
      if (x[0] === c[0]) return 'SHDC'.split('').some(su => isLive(c[0] + su));
      if (x[1] !== c[1]) return false;
      for (const a of posOf(c)) for (const b of posOf(x)) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (hi - lo === 1 && (isLive(at(lo - 1, c[1])) || isLive(at(hi + 1, c[1])))) return true;
        if (hi - lo === 2 && isLive(at(lo + 1, c[1]))) return true;
      }
      return false;
    };
    const links = (c: Card) => hand.filter(x => x !== c && linked(c, x)).length;
    // Sesekali abaikan "pasangan" agar kartu beredar (mencegah semua pemain saling menahan).
    const w = rng.float() < 0.25 ? 0 : difficulty === 'hard' ? 4 : 2;
    const keepScore = (c: Card) => deadwoodValue(c) - w * links(c);
    let best = allowed[0];
    let bestDw = Infinity;
    for (const c of allowed) {
      const dw = solveMelds(hand.filter(x => x !== c), ACE_HIGH).deadwood - keepScore(c);
      if (dw < bestDw) { best = c; bestDw = dw; }
    }
    return { type: 'act', id: 'drop', cards: [best] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
