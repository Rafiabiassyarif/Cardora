// games/president.ts — President / Daifugo, 3–4 pemain, beberapa ronde (deal).
//
// Aturan:
//  1. Deck 52 dibagikan habis. Urutan kekuatan: 3 terendah … K, A, lalu 2 tertinggi (suit tidak berpengaruh).
//  2. Pembuka trik boleh melempar single, pair, triple, atau 4 kartu berangka sama. Pemain berikutnya
//     wajib melempar JUMLAH kartu yang sama dengan angka lebih tinggi, atau "Pass".
//     Pemain yang pass tidak ikut lagi di trik itu. Bila semua pemain lain pass, meja dibersihkan dan
//     pelempar terakhir membuka trik baru (bila ia sudah habis, pemain aktif berikutnya yang membuka).
//  3. Ronde 1 dibuka oleh pemegang 3♣; ronde berikutnya dibuka oleh Scum.
//  4. Urutan habis kartu memberi gelar: Presiden, Wakil Presiden, (Wakil Scum), Scum — 3 pemain:
//     Presiden, Rakyat, Scum. Poin per ronde: 3/2/1/0 (4 pemain) atau 2/1/0 (3 pemain).
//  5. Mulai ronde 2: Scum otomatis menyerahkan 2 kartu terbaiknya ke Presiden, lalu Presiden memilih
//     2 kartu apa pun untuk dikembalikan. Dengan 4 pemain, Wakil Scum menyerahkan 1 kartu terbaik ke
//     Wakil Presiden yang lalu mengembalikan 1 kartu pilihan.
//  6. Setelah jumlah ronde (opsi, default 3) selesai, peringkat akhir berdasarkan total poin.

import { type Card, rankOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clampInt, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION, rankLabel,
} from '../generic';

export interface PresidentOptions { turnSeconds: number; passAndPlay: boolean; deals: number }

interface PendingGive { giver: number; receiver: number; count: number }

export interface PresidentState {
  gameId: 'president';
  options: PresidentOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  phase: 'exchange' | 'play' | 'dealEnd';
  deal: number;
  /** Urutan habis kartu di ronde ini. */
  finished: number[];
  /** Urutan akhir ronde sebelumnya (dasar gelar & tukar kartu). */
  lastOrder: number[] | null;
  points: number[];
  /** Lemparan di trik berjalan; yang terakhir adalah yang harus dikalahkan. */
  trick: { seat: number; cards: Card[] }[];
  passed: boolean[];
  lastPlayer: number | null;
  pending: PendingGive[];
  turn: number | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'deals', label: 'Jumlah Ronde', type: 'select', choices: [
    { value: 1, label: '1 Ronde (Kilat)' }, { value: 3, label: '3 Ronde (Standar)' }, { value: 5, label: '5 Ronde' },
  ] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: PresidentOptions = { turnSeconds: 25, passAndPlay: false, deals: 3 };

/** Kekuatan kartu: 3..14 (A), 2 = 15. */
export const power = (c: Card) => (rankOf(c) === 2 ? 15 : rankOf(c));
const sortHand = (h: Card[]) => h.sort((a, b) => power(a) - power(b) || a.localeCompare(b));
const powerLabel = (p: number) => rankLabel(p === 15 ? 2 : p);

export function titlesFor(n: number): string[] {
  return n >= 4 ? ['Presiden', 'Wakil Presiden', 'Wakil Scum', 'Scum'] : ['Presiden', 'Rakyat', 'Scum'];
}

const top = (s: PresidentState) => s.trick[s.trick.length - 1] ?? null;
const activeSeats = (s: PresidentState) => s.names.map((_, i) => i).filter(i => s.hands[i].length > 0);

function legalCards(s: PresidentState, seat: number): Card[] {
  const hand = s.hands[seat];
  const t = top(s);
  if (!t) return hand.slice();
  const need = t.cards.length;
  const p = power(t.cards[0]);
  const byPow = new Map<number, number>();
  for (const c of hand) byPow.set(power(c), (byPow.get(power(c)) ?? 0) + 1);
  return hand.filter(c => power(c) > p && (byPow.get(power(c)) ?? 0) >= need);
}

function actionsFor(s: PresidentState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'exchange') {
    const g = s.pending[0];
    if (!g || g.giver !== seat) return [];
    return [{ id: 'give', label: `Berikan ${g.count}`, style: 'primary', cards: { min: g.count, max: g.count },
      hint: `Pilih ${g.count} kartu untuk ${s.names[g.receiver]}` }];
  }
  if (s.phase !== 'play') return [];
  const t = top(s);
  const acts: GActionSpec[] = [];
  if (!t) {
    acts.push({ id: 'play', label: 'Lempar', style: 'primary', cards: { min: 1, max: 4 } });
  } else {
    if (legalCards(s, seat).length) acts.push({ id: 'play', label: 'Lempar', style: 'primary', cards: { min: t.cards.length, max: t.cards.length } });
    acts.push({ id: 'pass', label: 'Pass' });
  }
  return acts;
}

function setTurn(s: PresidentState, seat: number) {
  s.turn = seat;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function nextActiveFrom(s: PresidentState, seat: number, includeSelf: boolean): number {
  const n = s.names.length;
  for (let k = includeSelf ? 0 : 1; k <= n; k++) {
    const p = (seat + k) % n;
    if (s.hands[p].length > 0) return p;
  }
  return seat;
}

function startDeal(s: PresidentState, rng: Rng) {
  const n = s.names.length;
  const deck = shuffledDeck(rng);
  s.hands = s.names.map(() => []);
  deck.forEach((c, i) => s.hands[i % n].push(c));
  s.hands.forEach(sortHand);
  s.finished = [];
  s.trick = [];
  s.passed = s.names.map(() => false);
  s.lastPlayer = null;
  s.pending = [];
  pushLog(s.log, { seat: null, text: `Ronde ${s.deal}/${s.options.deals} dimulai — kartu dibagikan.` });
  if (s.lastOrder) {
    const order = s.lastOrder;
    const pres = order[0], scum = order[n - 1];
    const giveBest = (from: number, to: number, k: number) => {
      const best = sortHand(s.hands[from].slice()).slice(-k);
      removeCards(s.hands[from], best);
      s.hands[to].push(...best);
      sortHand(s.hands[to]);
      pushLog(s.log, { seat: from, text: `${s.names[from]} menyerahkan ${k} kartu terbaik ke ${s.names[to]}` });
    };
    giveBest(scum, pres, 2);
    s.pending.push({ giver: pres, receiver: scum, count: 2 });
    if (n >= 4) {
      giveBest(order[2], order[1], 1);
      s.pending.push({ giver: order[1], receiver: order[2], count: 1 });
    }
    s.phase = 'exchange';
    setTurn(s, s.pending[0].giver);
  } else {
    s.phase = 'play';
    const opener = s.hands.findIndex(h => h.includes('3C'));
    pushLog(s.log, { seat: opener, text: `${s.names[opener]} memegang 3♣ dan membuka.` });
    setTurn(s, opener);
  }
}

function endDeal(s: PresidentState) {
  const n = s.names.length;
  for (const i of activeSeats(s)) s.finished.push(i);
  const titles = titlesFor(n);
  s.finished.forEach((seat, k) => { s.points[seat] += n - 1 - k; });
  s.lastOrder = s.finished.slice();
  s.trick = [];
  s.turn = null;
  s.turnDeadline = null;
  pushLog(s.log, { seat: null, text: `Ronde ${s.deal} selesai: ` + s.finished.map((p, k) => `${titles[k]} ${s.names[p]}`).join(', ') });
  if (s.deal >= s.options.deals) {
    s.over = true;
    s.phase = 'dealEnd';
    pushLog(s.log, { seat: null, text: '🏁 Permainan selesai — peringkat dari total poin.' });
  } else {
    s.phase = 'dealEnd';
  }
}

/** Setelah `from` beraksi: cari giliran berikutnya atau bersihkan meja. */
function advanceTurn(s: PresidentState, from: number) {
  const n = s.names.length;
  for (let k = 1; k <= n; k++) {
    const p = (from + k) % n;
    if (p === s.lastPlayer) break;
    if (s.hands[p].length > 0 && !s.passed[p]) { setTurn(s, p); return; }
  }
  // Semua pemain lain pass → meja bersih.
  const lp = s.lastPlayer ?? from;
  s.trick = [];
  s.passed = s.names.map(() => false);
  s.lastPlayer = null;
  const leader = nextActiveFrom(s, lp, true);
  pushLog(s.log, { seat: leader, text: `Meja bersih — ${s.names[leader]} membuka trik baru` });
  setTurn(s, leader);
}

export const president: GameModule<PresidentState, GenericAction, GenericView, PresidentOptions> = {
  id: 'president',
  minPlayers: 3,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      deals: clampInt(r.deals, 1, 5, 3),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 3 || seats.length > 4) throw new RuleError('President butuh 3–4 pemain');
    const s: PresidentState = {
      gameId: 'president', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], phase: 'play', deal: 1, finished: [], lastOrder: null, points: seats.map(() => 0),
      trick: [], passed: seats.map(() => false), lastPlayer: null, pending: [], turn: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase === 'dealEnd' ? null : s.turn),

  apply(state, seat, raw) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat || state.phase === 'dealEnd') throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (spec.id === 'give') {
      const g = s.pending.shift()!;
      const cards = takeCards(hand, a.cards, g.count, g.count);
      removeCards(hand, cards);
      s.hands[g.receiver].push(...cards);
      sortHand(s.hands[g.receiver]);
      pushLog(s.log, { seat, text: `${name} mengembalikan ${g.count} kartu ke ${s.names[g.receiver]}` });
      if (s.pending.length) { setTurn(s, s.pending[0].giver); return s; }
      s.phase = 'play';
      const scum = s.lastOrder![s.names.length - 1];
      pushLog(s.log, { seat: scum, text: `${s.names[scum]} (Scum) membuka ronde.` });
      setTurn(s, scum);
      return s;
    }

    if (spec.id === 'pass') {
      s.passed[seat] = true;
      pushLog(s.log, { seat, text: `${name} pass` });
      advanceTurn(s, seat);
      return s;
    }

    // play
    const cards = takeCards(hand, a.cards, spec.cards!.min, spec.cards!.max);
    const p = power(cards[0]);
    if (!cards.every(c => power(c) === p)) throw new RuleError('Semua kartu harus berangka sama');
    const t = top(s);
    if (t && p <= power(t.cards[0])) throw new RuleError(`Harus lebih tinggi dari ${powerLabel(power(t.cards[0]))}`);
    removeCards(hand, cards);
    s.trick.push({ seat, cards: cards.slice() });
    s.lastPlayer = seat;
    const kind = ['', 'single', 'pair', 'triple', '4 kartu'][cards.length];
    pushLog(s.log, { seat, text: `${name} melempar ${kind} ${cards.map(cardLabel).join(' ')}` });
    if (hand.length === 0) {
      s.finished.push(seat);
      pushLog(s.log, { seat, text: `✅ ${name} habis kartu (#${s.finished.length})` });
      if (activeSeats(s).length <= 1) { endDeal(s); return s; }
    }
    advanceTurn(s, seat);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'dealEnd' ? 3000 : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'dealEnd') return state;
    const s = clone(state);
    s.deal += 1;
    startDeal(s, rng);
    return s;
  },

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    const give = acts.find(x => x.id === 'give');
    if (give) return { type: 'act', id: 'give', cards: s.hands[seat].slice(0, give.cards!.min) };
    if (acts.some(x => x.id === 'pass')) return { type: 'act', id: 'pass' };
    return { type: 'act', id: 'play', cards: [s.hands[seat][0]] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.names.length ? seat : null;
    const n = s.names.length;
    const titles = titlesFor(n);
    const myTurn = me !== null && s.turn === me && !s.over && s.phase !== 'dealEnd';
    const t = top(s);
    const lastTitle = (i: number) => (s.lastOrder ? titles[s.lastOrder.indexOf(i)] : undefined);
    const shortTag = (x?: string) => (x === 'Presiden' ? 'Pres' : x === 'Wakil Presiden' ? 'Wapres' : x === 'Wakil Scum' ? 'W.Scum' : x === 'Scum' ? 'Scum' : undefined);
    const give = s.phase === 'exchange' ? s.pending[0] : undefined;
    return {
      gameId: 'president',
      generic: true,
      you: me,
      turn: s.over || s.phase === 'dealEnd' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: president.results(s),
      players: s.names.map((name, i) => {
        const place = s.finished.indexOf(i);
        return {
          name, isBot: s.bots[i], count: s.hands[i]?.length ?? 0,
          score: `${s.points[i]} pt`,
          status: place >= 0 ? `${titles[place] ?? ''} #${place + 1}` : s.phase === 'play' && s.passed[i] ? 'Pass' : undefined,
          tag: shortTag(lastTitle(i)),
          out: place >= 0,
        };
      }),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [{ id: 'trick', label: 'Meja', cards: t ? t.cards.slice() : [], spread: true, highlight: !!t,
        caption: t ? `oleh ${s.names[t.seat]}` : 'Kosong — bebas membuka' }],
      actions: actionsFor(s, me),
      playable: myTurn && s.phase === 'play' ? legalCards(s, me!) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'dealEnd' ? 'Ronde selesai — ronde berikutnya segera dimulai…'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : give ? `Pilih ${give.count} kartu untuk dikembalikan ke ${s.names[give.receiver]}`
        : !t ? 'Buka trik: lempar 1–4 kartu berangka sama'
        : `Lempar ${t.cards.length} kartu lebih tinggi dari ${powerLabel(power(t.cards[0]))}, atau Pass`,
      badges: [
        `Ronde ${s.deal}/${s.options.deals}`,
        ...(t ? [`Wajib ${t.cards.length} kartu`] : []),
        '2 tertinggi',
      ],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const give = v.actions.find(a => a.id === 'give');
    if (give) {
      const k = give.cards!.min;
      const sorted = v.hand.slice().sort((a, b) => power(a) - power(b));
      return { type: 'act', id: 'give', cards: difficulty === 'easy' ? sorted.slice().sort(() => rng.float() - 0.5).slice(0, k) : sorted.slice(0, k) };
    }
    const play = v.actions.find(a => a.id === 'play');
    const canPass = v.actions.some(a => a.id === 'pass');
    const groups = new Map<number, Card[]>();
    for (const c of v.playable ?? []) groups.set(power(c), [...(groups.get(power(c)) ?? []), c]);
    if (!play || !groups.size) return { type: 'act', id: 'pass' };
    const keys = [...groups.keys()].sort((a, b) => a - b);
    if (!canPass) {
      // Membuka trik.
      const pk = difficulty === 'easy' ? keys[rng.int(keys.length)]
        : keys.length <= 2 ? keys[0] // sisa sedikit: buang yang rendah dulu, simpan yang tinggi untuk akhir
        : keys.filter(k => k < 14)[0] ?? keys[0];
      return { type: 'act', id: 'play', cards: groups.get(pk)! };
    }
    const need = play.cards!.min;
    if (difficulty === 'easy') {
      if (rng.float() < 0.25) return { type: 'act', id: 'pass' };
      const pk = keys[rng.int(keys.length)];
      return { type: 'act', id: 'play', cards: groups.get(pk)!.slice(0, need) };
    }
    // Utamakan kombinasi pas (tidak memecah), angka terendah; hemat 2 dan A selagi kartu masih banyak.
    const exact = keys.filter(k => groups.get(k)!.length === need);
    const pool = difficulty === 'hard' && exact.length ? exact : keys;
    const handSize = v.hand.length;
    const cheap = pool.filter(k => k < 14 || handSize <= 5 + need);
    if (!cheap.length) return { type: 'act', id: 'pass' };
    return { type: 'act', id: 'play', cards: groups.get(cheap[0])!.slice(0, need) };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.points);
  },
};
