// games/durak.ts — Durak (Podkidnoy sederhana), 2–4 pemain.
//
// Aturan:
//  1. Deck 36 (6..A). Tiap pemain 6 kartu. Kartu paling bawah stok dibuka: suit-nya menjadi truf,
//     dan kartu itu adalah kartu terakhir yang akan diambil.
//  2. Penyerang pertama: pemegang truf terendah (bila tak ada, acak). Bertahan: pemain berikutnya.
//  3. Penyerang melempar 1 kartu; bertahan wajib menangkisnya dengan kartu suit sama yang lebih tinggi,
//     atau truf (bila serangan bukan truf; truf hanya ditangkis truf lebih tinggi) — atau "Ambil".
//  4. Setelah tiap tangkisan, penyerang utama boleh menambah kartu yang angkanya sudah ada di meja,
//     maksimal min(6, jumlah kartu bertahan di awal bout) kartu serangan, dan selama bertahan masih
//     punya kartu. Atau menyatakan "Bito": semua kartu meja dibuang dan bertahan menjadi penyerang.
//  5. "Ambil": bertahan mengambil semua kartu meja, dan pemain setelahnya menjadi penyerang.
//     (Tambahan kartu setelah "Ambil" tidak dipakai.)
//  6. Setelah bout, tangan diisi lagi sampai 6 dari stok: penyerang dulu, bertahan terakhir.
//     Pemain yang kartunya habis saat stok kosong keluar dengan selamat (urutan = peringkat).
//     Pemain terakhir yang masih memegang kartu adalah Durak (kalah). Bila dua pemain terakhir habis
//     bersamaan, tidak ada Durak (seri).
//  7. Pengaman: batas 1.500 aksi — Durak = pemain dengan kartu terbanyak.

import { type Card, rankOf, suitOf, shuffle, standardDeck, cardLabel, SUITS } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  SUIT_NAME, SUIT_SYMBOL, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface DurakOptions { turnSeconds: number; passAndPlay: boolean; handSize: number }

export interface DurakState {
  gameId: 'durak';
  options: DurakOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  /** Stok; elemen terakhir = kartu truf yang terbuka (diambil paling akhir). */
  stock: Card[];
  trumpCard: Card;
  trumpSuit: string;
  discard: Card[];
  attacker: number;
  defender: number;
  table: { a: Card; d: Card | null }[];
  boutLimit: number;
  turn: number | null;
  /** Kelompok pemain yang selamat, berurutan (satu kelompok = keluar bersamaan). */
  finished: number[][];
  durak: number | null;
  steps: number;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_STEPS = 1500;

const OPTIONS: OptionSpec[] = [
  { key: 'handSize', label: 'Kartu di Tangan', type: 'select', choices: [
    { value: 6, label: '6 Kartu (Standar)' }, { value: 5, label: '5 Kartu (Cepat)' },
  ] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: DurakOptions = { turnSeconds: 25, passAndPlay: false, handSize: 6 };

export function beats(def: Card, atk: Card, trump: string): boolean {
  if (suitOf(def) === suitOf(atk)) return rankOf(def) > rankOf(atk);
  return suitOf(def) === trump && suitOf(atk) !== trump;
}

const sortHand = (h: Card[], trump: string) =>
  h.sort((a, b) => (Number(suitOf(a) === trump) - Number(suitOf(b) === trump)) || rankOf(a) - rankOf(b) || a.localeCompare(b));

const isActive = (s: DurakState, i: number) => !s.finished.flat().includes(i) && s.durak !== i;
const undefended = (s: DurakState) => s.table.find(p => p.d === null) ?? null;

function nextActive(s: DurakState, from: number, skip: number[] = []): number {
  const n = s.names.length;
  for (let k = 1; k <= n; k++) {
    const p = (from + k) % n;
    if (isActive(s, p) && !skip.includes(p)) return p;
  }
  return from;
}

function attackCards(s: DurakState): Card[] {
  const hand = s.hands[s.attacker];
  if (!s.table.length) return hand.slice();
  if (s.table.length >= s.boutLimit || s.hands[s.defender].length === 0) return [];
  const ranks = new Set(s.table.flatMap(p => (p.d ? [p.a, p.d] : [p.a])).map(rankOf));
  return hand.filter(c => ranks.has(rankOf(c)));
}

function defenseCards(s: DurakState): Card[] {
  const u = undefended(s);
  if (!u) return [];
  return s.hands[s.defender].filter(c => beats(c, u.a, s.trumpSuit));
}

function actionsFor(s: DurakState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  const u = undefended(s);
  if (u) {
    if (seat !== s.defender) return [];
    const acts: GActionSpec[] = [];
    if (defenseCards(s).length) acts.push({ id: 'defend', label: `Tangkis ${cardLabel(u.a)}`, style: 'primary', cards: { min: 1, max: 1 } });
    acts.push({ id: 'take', label: 'Ambil', style: 'danger', hint: 'Ambil semua kartu di meja' });
    return acts;
  }
  if (seat !== s.attacker) return [];
  const acts: GActionSpec[] = [];
  if (attackCards(s).length) acts.push({ id: 'attack', label: s.table.length ? 'Tambah' : 'Serang', style: 'primary', cards: { min: 1, max: 1 } });
  if (s.table.length) acts.push({ id: 'bito', label: 'Bito (Selesai)', hint: 'Akhiri serangan; kartu meja dibuang' });
  return acts;
}

function setTurn(s: DurakState, seat: number) {
  s.turn = seat;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function refill(s: DurakState) {
  const n = s.names.length;
  const order: number[] = [s.attacker];
  for (let k = 1; k < n; k++) {
    const p = (s.attacker + k) % n;
    if (p !== s.defender) order.push(p);
  }
  if (s.defender !== s.attacker) order.push(s.defender);
  for (const p of order) {
    if (!isActive(s, p)) continue;
    while (s.hands[p].length < s.options.handSize && s.stock.length) s.hands[p].push(s.stock.shift()!);
    sortHand(s.hands[p], s.trumpSuit);
  }
}

function finishGame(s: DurakState, durak: number | null, why: string) {
  s.over = true;
  s.durak = durak;
  s.turn = null;
  s.turnDeadline = null;
  pushLog(s.log, { seat: durak, text: why });
}

/** Akhiri bout; `took` = bertahan mengambil kartu. */
function endBout(s: DurakState, took: boolean) {
  const cards = s.table.flatMap(p => (p.d ? [p.a, p.d] : [p.a]));
  s.table = [];
  if (took) s.hands[s.defender].push(...cards);
  else s.discard.push(...cards);
  refill(s);
  // Pemain yang habis kartu setelah stok kosong keluar (selamat).
  if (!s.stock.length) {
    const out = s.names.map((_, i) => i).filter(i => isActive(s, i) && s.hands[i].length === 0);
    if (out.length) {
      s.finished.push(out);
      for (const i of out) pushLog(s.log, { seat: i, text: `✅ ${s.names[i]} kartunya habis — selamat!` });
    }
  }
  const left = s.names.map((_, i) => i).filter(i => isActive(s, i));
  if (left.length <= 1) {
    if (left.length === 1) finishGame(s, left[0], `🤡 ${s.names[left[0]]} menjadi Durak!`);
    else finishGame(s, null, 'Semua pemain habis bersamaan — tidak ada Durak!');
    return;
  }
  let att: number;
  if (took) att = nextActive(s, s.defender);
  else att = isActive(s, s.defender) ? s.defender : nextActive(s, s.defender);
  s.attacker = att;
  s.defender = nextActive(s, att);
  s.boutLimit = Math.min(6, s.hands[s.defender].length);
  setTurn(s, s.attacker);
}

export const durak: GameModule<DurakState, GenericAction, GenericView, DurakOptions> = {
  id: 'durak',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      handSize: Number(r.handSize) === 5 ? 5 : 6,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Durak butuh 2–4 pemain');
    const deck = shuffle(standardDeck().filter(c => rankOf(c) >= 6), rng);
    const hands = seats.map(() => deck.splice(0, options.handSize));
    const trumpCard = deck[deck.length - 1];
    const trumpSuit = suitOf(trumpCard);
    hands.forEach(h => sortHand(h, trumpSuit));
    let attacker = -1, low = 99;
    hands.forEach((h, i) => h.forEach(c => { if (suitOf(c) === trumpSuit && rankOf(c) < low) { low = rankOf(c); attacker = i; } }));
    if (attacker < 0) attacker = rng.int(seats.length);
    const n = seats.length;
    const s: DurakState = {
      gameId: 'durak', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, stock: deck, trumpCard, trumpSuit, discard: [],
      attacker, defender: (attacker + 1) % n, table: [], boutLimit: 0,
      turn: null, finished: [], durak: null, steps: 0, over: false, log: [], turnDeadline: null,
    };
    s.boutLimit = Math.min(6, s.hands[s.defender].length);
    pushLog(s.log, { seat: null, text: `Truf: ${SUIT_NAME[trumpSuit]} (${cardLabel(trumpCard)}). ${s.names[attacker]} menyerang duluan.` });
    setTurn(s, attacker);
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
    s.steps += 1;
    if (s.steps >= MAX_STEPS) {
      let worst = 0;
      s.names.forEach((_, i) => { if (isActive(s, i) && (!isActive(s, worst) || s.hands[i].length > s.hands[worst].length)) worst = i; });
      const rest = s.names.map((_, i) => i).filter(i => isActive(s, i) && i !== worst);
      if (rest.length) s.finished.push(rest);
      finishGame(s, worst, `Batas langkah tercapai — ${s.names[worst]} (kartu terbanyak) menjadi Durak.`);
      return s;
    }

    if (spec.id === 'attack') {
      const [card] = takeCards(s.hands[seat], a.cards, 1, 1);
      if (!attackCards(s).includes(card)) throw new RuleError('Hanya kartu berangka sama dengan kartu di meja yang boleh ditambahkan');
      removeCards(s.hands[seat], [card]);
      s.table.push({ a: card, d: null });
      pushLog(s.log, { seat, text: `${name} ${s.table.length > 1 ? 'menambah' : 'menyerang dengan'} ${cardLabel(card)}` });
      setTurn(s, s.defender);
      return s;
    }
    if (spec.id === 'defend') {
      const [card] = takeCards(s.hands[seat], a.cards, 1, 1);
      const u = undefended(s)!;
      if (!beats(card, u.a, s.trumpSuit)) throw new RuleError(`Kartu itu tidak bisa menangkis ${cardLabel(u.a)}`);
      removeCards(s.hands[seat], [card]);
      u.d = card;
      pushLog(s.log, { seat, text: `${name} menangkis ${cardLabel(u.a)} dengan ${cardLabel(card)}` });
      setTurn(s, s.attacker);
      return s;
    }
    if (spec.id === 'take') {
      pushLog(s.log, { seat, text: `${name} mengambil ${s.table.reduce((t, p) => t + (p.d ? 2 : 1), 0)} kartu dari meja` });
      endBout(s, true);
      return s;
    }
    // bito
    pushLog(s.log, { seat, text: `${name}: Bito! Serangan berhasil ditangkis.` });
    endBout(s, false);
    return s;
  },

  autoDelay: () => null,
  advance: s => s,

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    if (acts.some(x => x.id === 'take')) return { type: 'act', id: 'take' };
    if (acts.some(x => x.id === 'bito')) return { type: 'act', id: 'bito' };
    return { type: 'act', id: 'attack', cards: [attackCards(s)[0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.names.length ? seat : null;
    const myTurn = me !== null && s.turn === me && !s.over;
    const u = undefended(s);
    const place = (i: number) => s.finished.findIndex(g => g.includes(i));
    const tablePiles: GPile[] = s.table.map((p, k) => ({
      id: `atk${k}`, label: `Serangan ${k + 1}`, cards: p.d ? [p.a, p.d] : [p.a], spread: true,
      highlight: p.d === null, caption: p.d ? 'Ditangkis' : 'Belum ditangkis',
    }));
    return {
      gameId: 'durak',
      generic: true,
      you: me,
      turn: s.over ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: durak.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        status: s.durak === i ? 'Durak 🤡' : place(i) >= 0 ? `Selamat #${place(i) + 1}` : undefined,
        tag: s.over || !isActive(s, i) ? undefined : i === s.attacker ? 'Serang' : i === s.defender ? 'Tangkis' : undefined,
        out: place(i) >= 0,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'stock', label: 'Stok', cards: s.stock.length > 1 ? [null] : [], count: Math.max(0, s.stock.length - 1) },
        { id: 'trump', label: 'Truf', cards: s.stock.length ? [s.trumpCard] : [], caption: SUIT_NAME[s.trumpSuit] },
        ...tablePiles,
        { id: 'bito', label: 'Bito', cards: s.discard.length ? [null] : [], count: s.discard.length },
      ],
      actions: actionsFor(s, me),
      playable: !myTurn ? [] : u ? defenseCards(s) : attackCards(s),
      prompt: s.over ? 'Permainan selesai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : u ? `Tangkis ${cardLabel(u.a)} dengan kartu lebih tinggi / truf, atau Ambil`
        : s.table.length ? 'Tambah kartu berangka sama, atau Bito'
        : `Serang ${s.names[s.defender]} dengan 1 kartu`,
      badges: [`Truf ${SUIT_SYMBOL[s.trumpSuit]}`, `Stok ${s.stock.length}`, ...(s.table.length ? [`Meja ${s.table.length}/${s.boutLimit}`] : [])],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const trumpBadge = v.badges.find(b => b.startsWith('Truf '))?.slice(5) ?? '';
    const trump = SUITS.find(x => SUIT_SYMBOL[x] === trumpBadge) ?? 'S';
    const stockLeft = Number(v.badges.find(b => b.startsWith('Stok '))?.slice(5) ?? 0);
    const playable = v.playable ?? [];
    const cost = (c: Card) => rankOf(c) + (suitOf(c) === trump ? 20 : 0);
    const cheapest = (cs: Card[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];

    if (ids.includes('take')) {
      if (!ids.includes('defend') || !playable.length) return { type: 'act', id: 'take' };
      if (difficulty === 'easy') return { type: 'act', id: 'defend', cards: [playable[rng.int(playable.length)]] };
      const c = cheapest(playable);
      // Jangan buang truf besar terlalu awal hanya untuk menangkis satu kartu kecil.
      if (suitOf(c) === trump && rankOf(c) >= 13 && stockLeft >= 10 && difficulty === 'hard') return { type: 'act', id: 'take' };
      return { type: 'act', id: 'defend', cards: [c] };
    }
    if (ids.includes('attack') && playable.length) {
      const tableEmpty = !ids.includes('bito');
      if (difficulty === 'easy') {
        if (!tableEmpty && rng.float() < 0.4) return { type: 'act', id: 'bito' };
        return { type: 'act', id: 'attack', cards: [playable[rng.int(playable.length)]] };
      }
      if (tableEmpty) return { type: 'act', id: 'attack', cards: [cheapest(playable)] };
      const ok = playable.filter(c => suitOf(c) !== trump && (rankOf(c) <= 11 || stockLeft === 0));
      if (ok.length) return { type: 'act', id: 'attack', cards: [cheapest(ok)] };
      if (stockLeft === 0 && difficulty === 'hard') return { type: 'act', id: 'attack', cards: [cheapest(playable)] };
    }
    if (ids.includes('bito')) return { type: 'act', id: 'bito' };
    return { type: 'act', id: 'attack', cards: [cheapest(playable.length ? playable : v.hand)] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const n = s.names.length;
    const out: SeatResult[] = [];
    let rank = 1;
    for (const g of s.finished) {
      for (const seat of g) out.push({ seat, rank, score: n - rank });
      rank += g.length;
    }
    for (let i = 0; i < n; i++) {
      if (!out.some(r => r.seat === i)) out.push({ seat: i, rank: n, score: 0 });
    }
    return out;
  },
};
