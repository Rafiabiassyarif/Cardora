// games/gaple.ts — Domino Gaple (domino blok khas Indonesia), 2–4 pemain, set balak 6 (28 kartu).
//
// Aturan:
//  1. Tiap pemain 7 kartu. Bila kurang dari 4 pemain, sisa kartu "tidur" (tertutup, tidak dipakai).
//     Tidak ada pengambilan kartu (permainan blok).
//  2. Deal pertama: pemegang balak tertinggi (6|6, lalu 5|5, …) jalan duluan dan wajib membuka
//     dengan balak itu. (Jika tak seorang pun memegang balak — sangat jarang pada 2 pemain —
//     pemegang kartu dengan total titik terbesar membuka dengan kartu itu.)
//     Deal berikutnya: pemenang deal sebelumnya jalan duluan dengan kartu bebas.
//  3. Giliran (searah jarum jam): pasang 1 kartu yang angkanya cocok dengan salah satu ujung rantai.
//     Pemain memilih ujung: "Pasang Kiri" / "Pasang Kanan" (bila kedua ujung sama atau rantai
//     masih kosong: satu tombol "Pasang"). "Lewat" hanya boleh bila tidak ada kartu yang cocok.
//  4. Deal selesai bila seorang pemain menghabiskan kartu (ia menang deal), atau rantai "Gaple!"
//     (buntu: tak seorang pun bisa memasang — dicek otomatis setiap langkah). Saat buntu, pemenang
//     adalah pemain dengan total titik terkecil di tangan; bila seri, yang paling awal dalam urutan
//     giliran dimulai dari pemain yang terakhir memasang (pemain itu sendiri lebih dulu).
//  5. Skor deal: pemenang mendapat jumlah titik semua kartu yang tersisa di tangan lawan
//     (titik milik pemenang sendiri tidak dikurangkan). Bonus +10 bila menutup (kartu terakhir)
//     dengan balak.
//  6. Deal diulang sampai ada yang mencapai target (50/100/150, default 100) atau batas 20 deal.
//     Peringkat akhir menurut total skor (seri = peringkat sama).

import { type Card, shuffle } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { dominoSet, dominoPips, dominoOriented, dominoCanon, isBalak, dominoLabel, isDomino } from '../tokens';

export interface GapleOptions { turnSeconds: number; passAndPlay: boolean; target: number }

export type GaplePhase = 'play' | 'dealEnd';

export interface GapleState {
  gameId: 'domino-gaple';
  options: GapleOptions;
  names: string[];
  bots: boolean[];
  /** Kartu tangan (token kanonik). */
  hands: Card[][];
  /** Kartu tidur (tertutup, tidak dipakai di deal ini). */
  sleeping: Card[];
  /** Rantai di meja, kiri → kanan, sebagai token TERORIENTASI (angka kiri tiap kartu bersambung). */
  chain: Card[];
  phase: GaplePhase;
  turn: number | null;
  dealNo: number;
  scores: number[];
  /** Kartu pembuka wajib (deal pertama), null = bebas. */
  mustOpen: Card | null;
  /** Pemain terakhir yang memasang kartu. */
  lastPlayer: number | null;
  /** Lewat berturut-turut (pengaman buntu). */
  passes: number;
  /** Angka ujung saat pemain lewat di deal ini (informasi publik). */
  passedOn: number[][];
  dealWinner: number | null;
  /** Total titik tiap tangan saat deal selesai (publik setelah deal berakhir). */
  dealPips: number[] | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'target', label: 'Target Skor', type: 'select', choices: [
    { value: 50, label: '50 (Cepat)' }, { value: 100, label: '100 (Standar)' }, { value: 150, label: '150 (Panjang)' },
  ], help: 'Permainan selesai saat ada pemain mencapai skor ini' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: GapleOptions = { turnSeconds: 25, passAndPlay: false, target: 100 };
export const GAPLE_MAX_DEALS = 20;
export const BALAK_BONUS = 10;
const DEAL_PAUSE = 3500;
const HAND_SIZE = 7;

export const pipsOf = (t: Card) => { const [a, b] = dominoPips(t); return a + b; };
export const handPips = (h: Card[]) => h.reduce((x, t) => x + pipsOf(t), 0);
const sortHand = (h: Card[]) => h.slice().sort((a, b) => pipsOf(a) - pipsOf(b) || a.localeCompare(b));

/** Ujung kiri & kanan rantai (null bila kosong). */
export function chainEnds(chain: Card[]): [number, number] | null {
  if (!chain.length) return null;
  return [dominoPips(chain[0])[0], dominoPips(chain[chain.length - 1])[1]];
}

const fits = (t: Card, n: number) => { const [a, b] = dominoPips(t); return a === n || b === n; };

function canFitSide(s: GapleState, t: Card, side: 'left' | 'right'): boolean {
  const ends = chainEnds(s.chain);
  if (!ends) return false;
  return fits(t, side === 'left' ? ends[0] : ends[1]);
}

/** Kartu yang sah dipasang seat ini (di ujung mana pun). */
function playableTiles(s: GapleState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.chain.length) return s.mustOpen ? hand.filter(t => t === s.mustOpen) : hand.slice();
  const [l, r] = chainEnds(s.chain)!;
  return hand.filter(t => fits(t, l) || fits(t, r));
}

function actionsFor(s: GapleState, seat: number | null): GActionSpec[] {
  if (s.over || s.phase !== 'play' || seat === null || s.turn !== seat) return [];
  const playable = playableTiles(s, seat);
  if (!playable.length) return [{ id: 'pass', label: 'Lewat', style: 'danger', hint: 'Tidak ada kartu yang cocok' }];
  const ends = chainEnds(s.chain);
  if (!ends || ends[0] === ends[1]) return [{ id: 'play', label: 'Pasang', style: 'primary', cards: { min: 1, max: 1 } }];
  const acts: GActionSpec[] = [];
  if (playable.some(t => fits(t, ends[0]))) acts.push({ id: 'left', label: `Pasang Kiri (${ends[0]})`, style: 'primary', cards: { min: 1, max: 1 } });
  if (playable.some(t => fits(t, ends[1]))) acts.push({ id: 'right', label: `Pasang Kanan (${ends[1]})`, style: 'primary', cards: { min: 1, max: 1 } });
  return acts;
}

function nextSeat(s: GapleState, seat: number) { return (seat + 1) % s.names.length; }

function setTurn(s: GapleState, seat: number) {
  s.turn = seat;
  s.turnDeadline = deadline(s.options.turnSeconds);
}

/** Pasang kartu kanonik `t` di sisi tertentu (mutasi). */
function placeTile(s: GapleState, t: Card, side: 'left' | 'right') {
  const ends = chainEnds(s.chain);
  if (!ends) { s.chain.push(t); return; }
  const [a, b] = dominoPips(t);
  if (side === 'left') {
    const other = a === ends[0] ? b : a;
    s.chain.unshift(dominoOriented(t, other));
  } else {
    s.chain.push(dominoOriented(t, ends[1]));
  }
}

function nobodyCanPlay(s: GapleState): boolean {
  return s.hands.every((_, i) => playableTiles(s, i).length === 0);
}

function finishDeal(s: GapleState, winner: number, blocked: boolean, lastTile: Card | null) {
  const pips = s.hands.map(handPips);
  let gain = pips.reduce((x, p, i) => (i === winner ? x : x + p), 0);
  const bonus = !blocked && lastTile !== null && isBalak(lastTile) ? BALAK_BONUS : 0;
  gain += bonus;
  s.scores[winner] += gain;
  s.dealWinner = winner;
  s.dealPips = pips;
  s.phase = 'dealEnd';
  s.turn = null;
  s.turnDeadline = null;
  const how = blocked ? `Gaple! Buntu — ${s.names[winner]} titik terkecil (${pips[winner]})` : `${s.names[winner]} habis kartu`;
  s.banner = `Deal ${s.dealNo}: ${how} · +${gain}${bonus ? ` (bonus balak +${bonus})` : ''}`;
  pushLog(s.log, { seat: winner, text: s.banner });
  pushLog(s.log, { seat: null, text: 'Sisa titik: ' + s.names.map((n, i) => `${n} ${pips[i]}`).join(', ') });
  if (Math.max(...s.scores) >= s.options.target || s.dealNo >= GAPLE_MAX_DEALS) {
    s.over = true;
    const best = Math.max(...s.scores);
    const winners = s.names.filter((_, i) => s.scores[i] === best);
    pushLog(s.log, { seat: null, text: `🏆 ${winners.join(' & ')} menang dengan ${best} poin!` });
  }
}

/** Pemenang saat buntu: titik terkecil; seri → paling awal dari pemain terakhir yang memasang. */
export function blockedWinner(s: GapleState): number {
  const n = s.names.length;
  const start = s.lastPlayer ?? 0;
  let best = start, bestPips = Infinity;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const p = handPips(s.hands[i]);
    if (p < bestPips) { best = i; bestPips = p; }
  }
  return best;
}

function startDeal(s: GapleState, rng: Rng, starter: number | null) {
  const tiles = shuffle(dominoSet(), rng);
  const n = s.names.length;
  s.hands = Array.from({ length: n }, () => sortHand(tiles.splice(0, HAND_SIZE)));
  s.sleeping = tiles;
  s.chain = [];
  s.phase = 'play';
  s.passes = 0;
  s.passedOn = s.names.map(() => []);
  s.dealWinner = null;
  s.dealPips = null;
  s.lastPlayer = null;
  s.banner = null;
  if (starter === null) {
    // Deal pertama: balak tertinggi; cadangan: kartu bertitik terbesar.
    let open: Card | null = null, who = 0;
    for (let v = 6; v >= 0 && open === null; v--) {
      const t = `d:${v}${v}`;
      const i = s.hands.findIndex(h => h.includes(t));
      if (i >= 0) { open = t; who = i; }
    }
    if (open === null) {
      let best = -1;
      s.hands.forEach((h, i) => h.forEach(t => { if (pipsOf(t) > best) { best = pipsOf(t); open = t; who = i; } }));
    }
    s.mustOpen = open;
    setTurn(s, who);
    pushLog(s.log, { seat: who, text: `Deal ${s.dealNo}: ${s.names[who]} memegang ${dominoLabel(open!)} dan wajib membuka.` });
  } else {
    s.mustOpen = null;
    setTurn(s, starter);
    pushLog(s.log, { seat: starter, text: `Deal ${s.dealNo}: ${s.names[starter]} (pemenang deal lalu) membuka bebas.` });
  }
}

function parseSide(id: string): 'left' | 'right' | null {
  return id === 'left' ? 'left' : id === 'right' ? 'right' : null;
}

/* --------------------------------- bot ---------------------------------- */

interface Move { tile: Card; id: string; side: 'left' | 'right' | null }

function viewEnds(v: GenericView): [number, number] | null {
  const chain = v.piles.find(p => p.id === 'chain')?.cards.filter((c): c is Card => !!c) ?? [];
  return chainEnds(chain);
}

function movesFromView(v: GenericView): Move[] {
  const playable = v.playable ?? [];
  const out: Move[] = [];
  const ends = viewEnds(v);
  for (const a of v.actions) {
    if (a.id === 'play') for (const t of playable) out.push({ tile: t, id: 'play', side: null });
    if ((a.id === 'left' || a.id === 'right') && ends) {
      const n = a.id === 'left' ? ends[0] : ends[1];
      for (const t of playable) if (fits(t, n)) out.push({ tile: t, id: a.id, side: a.id });
    }
  }
  return out;
}

/** Ujung baru setelah langkah (dari sudut pandang view). */
function endsAfter(ends: [number, number] | null, m: Move): [number, number] {
  const [a, b] = dominoPips(m.tile);
  if (!ends) return [a, b];
  if (m.side === 'right') return [ends[0], ends[1] === a ? b : a];
  // 'left' atau 'play' saat kedua ujung sama: pasang di kiri
  return [ends[0] === a ? b : a, ends[1]];
}

function passedNumbers(status: string | undefined): number[] {
  const m = /Lewat di ([\d·]+)/.exec(status ?? '');
  return m ? m[1].split('·').map(Number).filter(x => Number.isInteger(x)) : [];
}

function scoreMove(v: GenericView, m: Move, difficulty: Difficulty): number {
  const ends = viewEnds(v);
  const [l, r] = endsAfter(ends, m);
  const rest = v.hand.filter(t => t !== m.tile);
  let sc = pipsOf(m.tile) * 1.0 + (isBalak(m.tile) ? 6 : 0);
  // Pertahankan ujung yang cocok dengan kartu sendiri.
  const matchL = rest.filter(t => fits(t, l)).length;
  const matchR = rest.filter(t => fits(t, r)).length;
  sc += 2.5 * (Math.min(matchL, 2) + Math.min(matchR, 2));
  if (rest.length === 0) sc += 100;
  if (difficulty === 'hard' && v.you !== null) {
    // Angka yang pernah dilewati lawan berikutnya = ia tidak punya → ujung itu menahannya.
    const n = v.players.length;
    const next = (v.you + 1) % n;
    const weak = passedNumbers(v.players[next]?.status);
    if (weak.includes(l)) sc += 4;
    if (weak.includes(r)) sc += 4;
    // Kalau lawan hampir habis, utamakan menutup dengan angka yang dilewatinya.
    if ((v.players[next]?.count ?? 9) <= 2 && weak.includes(l) && weak.includes(r)) sc += 10;
  }
  return sc;
}

export const gaple: GameModule<GapleState, GenericAction, GenericView, GapleOptions> = {
  id: 'domino-gaple',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const t = Number(r.target);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      target: t === 50 || t === 150 ? t : 100,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Domino Gaple butuh 2–4 pemain');
    const s: GapleState = {
      gameId: 'domino-gaple', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], sleeping: [], chain: [], phase: 'play', turn: null, dealNo: 1,
      scores: seats.map(() => 0), mustOpen: null, lastPlayer: null, passes: 0,
      passedOn: seats.map(() => []), dealWinner: null, dealPips: null, banner: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng, null);
    return s;
  },

  currentSeat: s => (s.over || s.phase !== 'play' ? null : s.turn),

  apply(state, seat, raw) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.phase !== 'play') throw new RuleError('Deal sedang berganti');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (spec.id === 'pass') {
      const ends = chainEnds(s.chain);
      if (ends) for (const e of ends) if (!s.passedOn[seat].includes(e)) s.passedOn[seat].push(e);
      s.passedOn[seat].sort((x, y) => x - y);
      s.passes += 1;
      pushLog(s.log, { seat, text: `${name} lewat${ends ? ` (tidak punya ${ends[0]}/${ends[1]})` : ''}` });
      if (s.passes >= s.names.length) { finishDeal(s, blockedWinner(s), true, null); return s; }
      setTurn(s, nextSeat(s, seat));
      return s;
    }

    const [tile] = takeCards(hand, a.cards, 1, 1);
    if (!isDomino(tile) || dominoCanon(tile) !== tile) throw new RuleError('Kartu tidak valid');
    if (!playableTiles(s, seat).includes(tile)) {
      if (s.mustOpen) throw new RuleError(`Deal pertama wajib dibuka dengan ${dominoLabel(s.mustOpen)}`);
      const ends = chainEnds(s.chain)!;
      throw new RuleError(`Kartu harus cocok dengan ujung ${ends[0]} atau ${ends[1]}`);
    }
    let side = parseSide(spec.id);
    if (side && !canFitSide(s, tile, side)) {
      const ends = chainEnds(s.chain)!;
      throw new RuleError(`${dominoLabel(tile)} tidak cocok di ujung ${side === 'left' ? 'kiri' : 'kanan'} (${side === 'left' ? ends[0] : ends[1]})`);
    }
    if (!side) side = 'left';
    const wasEmpty = s.chain.length === 0;
    placeTile(s, tile, side);
    removeCards(hand, [tile]);
    s.mustOpen = null;
    s.passes = 0;
    s.lastPlayer = seat;
    pushLog(s.log, { seat, text: wasEmpty ? `${name} membuka dengan ${dominoLabel(tile)}`
      : `${name} memasang ${dominoLabel(tile)} di ${side === 'left' ? 'kiri' : 'kanan'}` });
    if (hand.length === 0) { finishDeal(s, seat, false, tile); return s; }
    if (nobodyCanPlay(s)) { finishDeal(s, blockedWinner(s), true, null); return s; }
    setTurn(s, nextSeat(s, seat));
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'dealEnd' ? DEAL_PAUSE : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'dealEnd') return state;
    const s = clone(state);
    s.dealNo += 1;
    startDeal(s, rng, s.dealWinner);
    return s;
  },

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    if (!acts.length || acts[0].id === 'pass') return { type: 'act', id: 'pass' };
    const p = playableTiles(s, seat);
    for (const act of acts) {
      const side = parseSide(act.id);
      const t = side ? p.find(x => canFitSide(s, x, side)) : p[0];
      if (t) return { type: 'act', id: act.id, cards: [t] };
    }
    return { type: 'act', id: 'pass' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const myTurn = me !== null && s.turn === me && s.phase === 'play' && !s.over;
    const ends = chainEnds(s.chain);
    const piles: GPile[] = [
      { id: 'chain', label: 'Rantai', cards: s.chain.slice(), spread: true, highlight: true,
        caption: ends ? `Ujung kiri ${ends[0]} · kanan ${ends[1]}` : 'Belum ada kartu' },
    ];
    if (s.sleeping.length) piles.push({ id: 'sleep', label: 'Kartu Tidur', cards: [null], count: s.sleeping.length });
    const acts = actionsFor(s, me);
    return {
      gameId: 'domino-gaple',
      generic: true,
      you: me,
      turn: s.over || s.phase !== 'play' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: gaple.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        status: s.phase === 'dealEnd' || s.over
          ? (s.dealWinner === i ? `Menang deal 🏆 · sisa ${s.dealPips?.[i] ?? 0}` : `Sisa ${s.dealPips?.[i] ?? 0} titik`)
          : s.passedOn[i].length ? `Lewat di ${s.passedOn[i].join('·')}` : undefined,
        tag: s.lastPlayer === i && s.phase === 'play' ? 'Terakhir' : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles,
      actions: acts,
      playable: myTurn ? playableTiles(s, me!) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'dealEnd' ? 'Deal selesai — deal berikutnya segera dimulai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.mustOpen ? `Buka dengan ${dominoLabel(s.mustOpen)}`
        : !ends ? 'Buka dengan kartu apa saja'
        : acts[0]?.id === 'pass' ? `Tidak ada kartu ${ends[0]} atau ${ends[1]} — Lewat`
        : `Pasang kartu ${ends[0]} atau ${ends[1]}, lalu pilih ujung`,
      badges: [
        `Deal ${s.dealNo}`,
        ends ? `Ujung: ${ends[0]} · ${ends[1]}` : 'Ujung: –',
        `Tidur: ${s.sleeping.length}`,
        `Target ${s.options.target}`,
      ],
      banner: s.banner,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const moves = movesFromView(v);
    if (!moves.length) {
      const act = v.actions[0];
      return { type: 'act', id: act?.id ?? 'pass' };
    }
    let pick: Move;
    if (difficulty === 'easy') pick = moves[rng.int(moves.length)];
    else {
      pick = moves[0];
      let best = -Infinity;
      for (const m of moves) {
        const sc = scoreMove(v, m, difficulty) + rng.float() * 0.1;
        if (sc > best) { best = sc; pick = m; }
      }
    }
    return { type: 'act', id: pick.id, cards: [pick.tile] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
