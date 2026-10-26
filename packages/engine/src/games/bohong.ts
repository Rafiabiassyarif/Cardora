// games/bohong.ts — Bohong! ("Bohong-bohongan" / Cheat / I Doubt It), 3–8 pemain.
//
// Aturan yang diterapkan:
//  1. Satu deck 52 kartu dibagi habis serata mungkin (untuk 7–8 pemain tetap satu deck;
//     sebagian pemain mendapat 1 kartu lebih). Pemegang A♠ jalan duluan dengan angka wajib "A".
//  2. Angka wajib berputar A, 2, 3, … 10, J, Q, K, lalu kembali ke A — maju satu setiap
//     kali ada kartu ditaruh (apa pun hasilnya).
//  3. Giliran: taruh 1–4 kartu TERTUTUP ke tumpukan tengah dan (otomatis) mengaku semuanya
//     adalah angka wajib. Boleh jujur, boleh bohong.
//  4. Setelah kartu ditaruh, jendela "Bohong!" terbuka (±3 detik). Semua pemain lain yang masih
//     bermain boleh menekan "Bohong!" — penekan tercepat yang berhak. Kartu yang baru ditaruh dibuka:
//     ada SATU saja yang bukan angka wajib → penaruh mengambil seluruh tumpukan; semuanya jujur →
//     penuduh yang mengambil seluruh tumpukan. Bila tidak ada yang menuduh, giliran lanjut.
//     Setelah tuduhan, giliran tetap jatuh ke pemain sesudah penaruh.
//  5. Kartu habis = selesai, tapi hanya jika taruhan terakhirnya lolos (tidak terbukti bohong).
//     Urutan selesai = peringkat. Permainan berakhir saat tinggal satu pemain (peringkat terakhir)
//     — atau, opsi "Pemain Pertama Habis", begitu ada yang selesai — atau batas jumlah taruhan
//     tercapai (sisa pemain diperingkat dari kartu paling sedikit).
//  6. Bot penuduh memutuskan saat jendela dibuka HANYA dari view-nya sendiri (jumlah klaim,
//     kartu angka itu di tangannya + kartunya sendiri di tumpukan, sisa kartu penaruh, ukuran
//     tumpukan, jumlah calon penuduh) + gaya bot (polos/normal/curiga). Waktu tuduhan diundi.

import { type Card, rankOf, suitOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankLabel, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export type BotStyle = 'polos' | 'normal' | 'curiga';
export type EndMode = 'semua' | 'pertama';
export interface BohongOptions { turnSeconds: number; passAndPlay: boolean; botStyle: BotStyle; windowSeconds: number; maxPlays: number; endMode: EndMode }

export interface CallWindow {
  openedAt: number;
  until: number;
  /** Seat yang boleh menuduh. */
  participants: number[];
  /** Seat manusia yang memilih "Percaya". */
  passed: number[];
  /** Waktu tuduhan bot yang sudah diundi (ms sejak dibuka); null = tidak menuduh / bukan bot. */
  botCalls: (number | null)[];
}

export interface BohongState {
  gameId: 'bohong';
  options: BohongOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  /** Tumpukan tengah (tertutup). Kartu terakhir = taruhan terbaru. */
  pile: Card[];
  /** Kartu yang ditaruh tiap seat ke tumpukan saat ini (hanya diperlihatkan ke pemiliknya). */
  pileBy: Card[][];
  /** Index angka wajib berikutnya (0 = A, 1 = 2, … 12 = K). */
  required: number;
  /** Taruhan terakhir (isi kartu RAHASIA — tidak pernah masuk view kecuali setelah dibuka). */
  lastPlay: { seat: number; cards: Card[]; rankIdx: number } | null;
  phase: 'play' | 'window' | 'reveal';
  window: CallWindow | null;
  /** Kartu yang dibuka setelah tuduhan (publik). */
  reveal: { seat: number; caller: number; cards: Card[]; lie: boolean; rankIdx: number } | null;
  revealUntil: number | null;
  /** Giliran berikutnya setelah jeda pembukaan. */
  nextTurn: number | null;
  turn: number | null;
  finished: number[];
  plays: number;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

/** Info publik tambahan di view (dibaca bot; diabaikan UI). */
export interface BohongView extends GenericView {
  bohong: {
    required: number;
    claim: { seat: number; count: number; rankIdx: number; left: number } | null;
    pileCount: number;
    /** Kartu milik viewer sendiri yang ada di tumpukan (ingatan sendiri, bukan rahasia orang lain). */
    myPile: Card[];
    windowOpen: boolean;
    /** Jumlah pemain yang boleh menuduh taruhan ini. */
    callers: number;
    style: BotStyle;
  };
}

const OPTIONS: OptionSpec[] = [
  { key: 'botStyle', label: 'Gaya Bot', type: 'select', choices: [
    { value: 'polos', label: '😇 Polos (jarang curiga)' }, { value: 'normal', label: '🙂 Normal' }, { value: 'curiga', label: '🕵️ Curiga' }] },
  { key: 'endMode', label: 'Akhir Permainan', type: 'select', choices: [
    { value: 'semua', label: 'Sampai Tersisa 1 Pemain' }, { value: 'pertama', label: 'Pemain Pertama Habis (Cepat)' }],
    help: 'Mode cepat: sisa pemain diperingkat dari kartu paling sedikit' },
  { key: 'windowSeconds', label: 'Waktu Tuduh', type: 'select', choices: [
    { value: 2, label: '2 Detik (Cepat)' }, { value: 3, label: '3 Detik (Standar)' }, { value: 5, label: '5 Detik (Santai)' }] },
  { key: 'maxPlays', label: 'Batas Taruhan', type: 'select', choices: [
    { value: 120, label: '120 (Singkat)' }, { value: 200, label: '200 (Standar)' }, { value: 350, label: '350 (Panjang)' }],
    help: 'Pengaman: setelah batas ini, pemain dengan kartu paling sedikit yang unggul' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: BohongOptions = { turnSeconds: 25, passAndPlay: false, botStyle: 'normal', windowSeconds: 3, maxPlays: 200, endMode: 'pertama' };
export const REVEAL_MS = 2200;
/** Urutan angka wajib dalam kode rank (A = 14). */
export const SEQUENCE = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const seqLabel = (idx: number) => rankLabel(SEQUENCE[idx]);
const seqIndexOf = (c: Card) => SEQUENCE.indexOf(rankOf(c));
const sortHand = (h: Card[]) => h.sort((a, b) => seqIndexOf(a) - seqIndexOf(b) || suitOf(a).localeCompare(suitOf(b)));

const isActive = (s: BohongState, i: number) => !s.finished.includes(i);

function actionsFor(s: BohongState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || seat < 0 || seat >= s.names.length || !isActive(s, seat)) return [];
  if (s.phase === 'window' && s.window) {
    const w = s.window;
    if (!w.participants.includes(seat) || w.passed.includes(seat)) return [];
    return [
      { id: 'bohong', label: 'Bohong! 🤥', style: 'danger', hint: 'Salah tuduh = kamu yang ambil tumpukan' },
      { id: 'percaya', label: 'Percaya' },
    ];
  }
  if (s.phase === 'play' && s.turn === seat && s.hands[seat].length) {
    const max = Math.min(4, s.hands[seat].length);
    return [{ id: 'taruh', label: `Taruh (${seqLabel(s.required)})`, style: 'primary', cards: { min: 1, max },
      hint: `Kartu dianggap semuanya ${seqLabel(s.required)}` }];
  }
  return [];
}

function nextActive(s: BohongState, from: number): number | null {
  const n = s.names.length;
  for (let k = 1; k <= n; k++) {
    const p = (from + k) % n;
    if (isActive(s, p) && s.hands[p].length) return p;
  }
  return null;
}

function setTurn(s: BohongState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function finishGame(s: BohongState, reason: string) {
  s.over = true;
  s.phase = 'play';
  s.window = null;
  s.revealUntil = null;
  s.nextTurn = null;
  setTurn(s, null);
  s.banner = s.banner ? `${s.banner} ${reason}` : reason;
  pushLog(s.log, { seat: null, text: reason });
}

/** Penaruh lolos dengan tangan kosong → selesai. Kembalikan true bila permainan berakhir. */
function settle(s: BohongState, player: number): boolean {
  if (isActive(s, player) && s.hands[player].length === 0) {
    s.finished.push(player);
    pushLog(s.log, { seat: player, text: `🎉 ${s.names[player]} kartunya habis — selesai #${s.finished.length}!` });
  }
  const active = s.names.map((_, i) => i).filter(i => isActive(s, i));
  if (active.length <= 1) {
    finishGame(s, active.length === 1 ? `Permainan selesai! ${s.names[active[0]]} masih memegang kartu.` : 'Permainan selesai!');
    return true;
  }
  if (s.options.endMode === 'pertama' && s.finished.length > 0) {
    finishGame(s, `Permainan selesai! ${s.names[s.finished[0]]} habis duluan — sisa pemain diperingkat dari kartu paling sedikit.`);
    return true;
  }
  if (s.plays >= s.options.maxPlays) {
    finishGame(s, 'Batas taruhan tercapai — peringkat dari kartu paling sedikit.');
    return true;
  }
  return false;
}

/* ------------------------------ keputusan bot ------------------------------ */

/**
 * Peluang bot menuduh, HANYA dari view bot itu sendiri.
 * Kartu angka yang sama di tangan sendiri + jumlah klaim > 4 → pasti bohong.
 */
export function callChance(v: BohongView): number {
  const c = v.bohong.claim;
  if (!c || c.seat === v.you) return 0;
  const style = v.bohong.style;
  const known = v.hand.concat(v.bohong.myPile);
  const mine = known.filter(x => seqIndexOf(x) === c.rankIdx).length;
  const left4 = 4 - mine;
  if (c.count > left4) return style === 'polos' ? 0.85 : style === 'normal' ? 0.97 : 1;
  // Peluang klaim jujur ≈ P(penaruh memegang ≥ count kartu angka itu) — hipergeometrik
  // atas kartu yang tidak diketahui viewer (anggap orang jujur bila bisa).
  const unknown = Math.max(1, 52 - known.length);
  const draws = Math.min(unknown, c.left + c.count);
  const pTrue = hyperAtLeast(unknown, left4, draws, c.count);
  const pLie = 1 - pTrue;
  const mult = style === 'polos' ? 0.5 : style === 'normal' ? 0.8 : 1.2;
  let p = mult * (0.3 * pLie * pLie);
  if (c.left === 0) p += 0.2 * pLie; // kartu terakhir — jangan biarkan menang mudah
  if (v.bohong.pileCount > 12) p *= 0.7; // salah tuduh mahal
  p = Math.max(0, Math.min(0.9, p));
  // p = peluang "ada yang menuduh" di meja; dibagi ke semua calon penuduh agar
  // meja besar tidak otomatis lebih sering menuduh.
  const k = Math.max(1, v.bohong.callers);
  return 1 - Math.pow(1 - p, 1 / k);
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(X ≥ m) untuk X ~ Hipergeometrik(N populasi, K sukses, n ambil). */
export function hyperAtLeast(N: number, K: number, n: number, m: number): number {
  const total = choose(N, n);
  if (total === 0) return 0;
  let p = 0;
  for (let x = m; x <= Math.min(K, n); x++) p += (choose(K, x) * choose(N - K, n - x)) / total;
  return Math.max(0, Math.min(1, p));
}

/** Undi keputusan + waktu tuduhan bot (ms) dari view-nya; null = tidak menuduh. */
export function decideCall(v: BohongView, windowMs: number, rng: Rng): number | null {
  const p = callChance(v);
  if (rng.float() >= p) return null;
  return 450 + Math.floor(rng.float() * windowMs * 0.6);
}

function openWindow(s: BohongState, player: number, rng: Rng) {
  const participants = s.names.map((_, i) => i).filter(i => i !== player && isActive(s, i));
  const now = Date.now();
  const ms = s.options.windowSeconds * 1000;
  s.phase = 'window';
  s.window = { openedAt: now, until: now + ms, participants, passed: [], botCalls: s.names.map(() => null) };
  setTurn(s, null);
  for (const p of participants) {
    if (!s.bots[p]) continue;
    // Keputusan hanya dari view seat itu (tidak bisa melihat isi taruhan).
    s.window.botCalls[p] = decideCall(buildView(s, p), ms, rng);
  }
}

/** Bot tercepat yang menuduh dalam ≤ t ms (urut dari pemain sesudah penaruh bila seri). */
function earliestBot(s: BohongState, t = Infinity): number | null {
  const w = s.window!;
  const n = s.names.length;
  const player = s.lastPlay!.seat;
  let best: number | null = null, bt = Infinity;
  for (let k = 1; k < n; k++) {
    const p = (player + k) % n;
    const x = w.botCalls[p];
    if (!w.participants.includes(p) || x === null || x === undefined || x > t) continue;
    if (x < bt) { bt = x; best = p; }
  }
  return best;
}

function resolveCall(s: BohongState, caller: number) {
  const lp = s.lastPlay!;
  const want = SEQUENCE[lp.rankIdx];
  const lie = lp.cards.some(c => rankOf(c) !== want);
  const loser = lie ? lp.seat : caller;
  const n = s.pile.length;
  s.hands[loser].push(...s.pile);
  sortHand(s.hands[loser]);
  s.pile = [];
  s.pileBy = s.names.map(() => []);
  s.window = null;
  s.reveal = { seat: lp.seat, caller, cards: lp.cards.slice(), lie, rankIdx: lp.rankIdx };
  const shown = lp.cards.map(cardLabel).join(', ');
  s.banner = lie
    ? `${s.names[caller]}: "Bohong!" — Benar! ${s.names[lp.seat]} ketahuan (${shown}) dan mengambil ${n} kartu.`
    : `${s.names[caller]}: "Bohong!" — Salah! ${s.names[lp.seat]} jujur (${shown}). ${s.names[caller]} mengambil ${n} kartu.`;
  pushLog(s.log, { seat: caller, text: `🔍 ${s.banner}` });
  s.lastPlay = null;
  if (settle(s, lp.seat)) return;
  s.phase = 'reveal';
  s.revealUntil = Date.now() + REVEAL_MS;
  s.nextTurn = nextActive(s, lp.seat);
  setTurn(s, null);
}

function closeWindow(s: BohongState) {
  const lp = s.lastPlay!;
  s.window = null;
  s.lastPlay = null;
  s.phase = 'play';
  pushLog(s.log, { seat: lp.seat, text: `Tidak ada yang menuduh ${s.names[lp.seat]}.` });
  if (settle(s, lp.seat)) return;
  setTurn(s, nextActive(s, lp.seat));
  if (s.turn === null) finishGame(s, 'Permainan selesai!');
}

/* ---------------------------------- view ----------------------------------- */

function buildView(s: BohongState, seat: number | null): BohongView {
  const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
  const acts = actionsFor(s, me);
  const lp = s.lastPlay;
  const w = s.window;
  const claim = lp && s.phase === 'window' ? { seat: lp.seat, count: lp.cards.length, rankIdx: lp.rankIdx, left: s.hands[lp.seat].length } : null;
  const piles: GenericView['piles'] = [
    { id: 'pile', label: 'Tumpukan', cards: s.pile.length ? [null] : [], count: s.pile.length, highlight: s.phase === 'window',
      caption: claim ? `Klaim: ${claim.count} buah ${seqLabel(claim.rankIdx)}` : `Berikutnya: ${seqLabel(s.required)}` },
  ];
  if (s.reveal) {
    piles.push({ id: 'reveal', label: s.reveal.lie ? 'Ketahuan Bohong!' : 'Ternyata Jujur', cards: s.reveal.cards.slice(), spread: true,
      highlight: s.phase === 'reveal', caption: `${s.names[s.reveal.seat]} mengaku ${s.reveal.cards.length} buah ${seqLabel(s.reveal.rankIdx)}` });
  }
  const turnSeat = s.over || s.phase !== 'play' ? null : s.turn;
  let prompt: string;
  if (s.over) prompt = 'Permainan selesai';
  else if (s.phase === 'window' && claim) {
    prompt = me === claim.seat ? 'Menunggu… ada yang menuduh "Bohong!"?'
      : acts.length ? `${s.names[claim.seat]} mengaku ${claim.count} buah ${seqLabel(claim.rankIdx)} — percaya?`
      : 'Menunggu pemain lain…';
  } else if (s.phase === 'reveal') prompt = 'Kartu dibuka!';
  else if (me !== null && s.finished.includes(me)) prompt = 'Kartumu habis — kamu selesai!';
  else if (s.turn === me) prompt = `Taruh 1–4 kartu tertutup dan akui sebagai "${seqLabel(s.required)}"`;
  else prompt = `Menunggu ${s.names[s.turn ?? 0]} menaruh "${seqLabel(s.required)}"…`;
  return {
    gameId: 'bohong',
    generic: true,
    you: me,
    turn: turnSeat,
    over: s.over,
    log: s.log.slice(-30),
    results: bohong.results(s),
    players: s.names.map((name, i) => {
      const fin = s.finished.indexOf(i);
      let status: string | undefined;
      if (fin >= 0) status = `Selesai #${fin + 1}`;
      else if (claim && claim.seat === i) status = `Klaim ${claim.count}× ${seqLabel(claim.rankIdx)}`;
      else if (w && w.passed.includes(i)) status = 'Percaya';
      else if (s.reveal && s.phase === 'reveal' && s.reveal.caller === i) status = 'Bohong! 🤥';
      return { name, isBot: s.bots[i], count: s.hands[i].length, score: `${s.hands[i].length} kartu`, status, out: fin >= 0 };
    }),
    hand: me !== null ? s.hands[me].slice() : [],
    piles,
    actions: acts,
    playable: me !== null && turnSeat === me ? s.hands[me].filter(c => seqIndexOf(c) === s.required) : [],
    prompt,
    badges: [
      `Angka wajib: ${seqLabel(claim ? claim.rankIdx : s.required)}`,
      `Tumpukan: ${s.pile.length}`,
      `Taruhan ${s.plays}/${s.options.maxPlays}`,
    ],
    banner: s.phase === 'window' && claim
      ? `${s.names[claim.seat]} menaruh ${claim.count} kartu: '${claim.count} buah ${seqLabel(claim.rankIdx)}'`
      : s.banner,
    bohong: { required: s.required, claim, pileCount: s.pile.length, myPile: me !== null ? (s.pileBy[me] ?? []).slice() : [], windowOpen: s.phase === 'window', callers: w ? w.participants.length : 0, style: s.options.botStyle },
  };
}

/* --------------------------------- modul ----------------------------------- */

export const bohong: GameModule<BohongState, GenericAction, GenericView, BohongOptions> = {
  id: 'bohong',
  minPlayers: 3,
  maxPlayers: 8,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const st = r.botStyle === 'polos' || r.botStyle === 'curiga' ? r.botStyle : 'normal';
    const ws = Number(r.windowSeconds);
    const mp = Number(r.maxPlays);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      botStyle: st,
      windowSeconds: ws === 2 || ws === 5 ? ws : 3,
      maxPlays: mp === 120 || mp === 350 ? mp : 200,
      endMode: r.endMode === 'semua' ? 'semua' : 'pertama',
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 3 || seats.length > 8) throw new RuleError('Bohong! butuh 3–8 pemain');
    const deck = shuffledDeck(rng);
    const n = seats.length;
    const off = rng.int(n);
    const hands: Card[][] = seats.map(() => []);
    deck.forEach((c, i) => hands[(off + i) % n].push(c));
    hands.forEach(sortHand);
    const first = hands.findIndex(h => h.includes('AS'));
    const s: BohongState = {
      gameId: 'bohong', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, pile: [], pileBy: seats.map(() => []), required: 0, lastPlay: null, phase: 'play', window: null,
      reveal: null, revealUntil: null, nextTurn: null, turn: first, finished: [], plays: 0,
      banner: null, over: false, log: [], turnDeadline: deadline(options.turnSeconds),
    };
    pushLog(s.log, { seat: null, text: `Kartu dibagi habis. ${s.names[first]} memegang A♠ dan mulai dengan "A".` });
    return s;
  },

  currentSeat: s => (s.over || s.phase !== 'play' ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];

    if (spec.id === 'taruh') {
      const hand = s.hands[seat];
      const cards = takeCards(hand, a.cards, 1, Math.min(4, hand.length));
      removeCards(hand, cards);
      s.pile.push(...cards);
      s.pileBy[seat].push(...cards);
      const rankIdx = s.required;
      s.lastPlay = { seat, cards, rankIdx };
      s.required = (s.required + 1) % 13;
      s.plays += 1;
      s.reveal = null;
      s.banner = null;
      pushLog(s.log, { seat, text: `${name} menaruh ${cards.length} kartu: '${cards.length} buah ${seqLabel(rankIdx)}'` });
      openWindow(s, seat, rng);
      return s;
    }

    const w = s.window!;
    if (spec.id === 'percaya') {
      w.passed.push(seat);
      w.botCalls[seat] = null;
      const allIn = w.participants.every(p => w.passed.includes(p) || s.bots[p]);
      if (allIn) {
        const b = earliestBot(s);
        if (b !== null) resolveCall(s, b); else closeWindow(s);
      }
      return s;
    }

    // bohong — penekan tercepat berhak; bot yang waktunya sudah lewat lebih dulu.
    const t = Math.max(0, Date.now() - w.openedAt);
    const b = earliestBot(s, t);
    resolveCall(s, b !== null && b !== seat ? b : seat);
    return s;
  },

  autoDelay(s) {
    if (s.over) return null;
    const now = Date.now();
    if (s.phase === 'window' && s.window) {
      const w = s.window;
      if (w.participants.every(p => w.passed.includes(p) || s.bots[p])) {
        // Hanya bot: tutup lebih cepat bila tak ada yang menuduh.
        const b = earliestBot(s);
        const at = b !== null ? w.openedAt + w.botCalls[b]! : Math.min(w.until, w.openedAt + 1200);
        return Math.max(0, at - now);
      }
      const b = earliestBot(s);
      const at = b !== null ? Math.min(w.until, w.openedAt + w.botCalls[b]!) : w.until;
      return Math.max(0, at - now);
    }
    if (s.phase === 'reveal') return Math.max(0, (s.revealUntil ?? now) - now);
    return null;
  },

  advance(state, _rng) {
    if (state.over) return state;
    const s = clone(state);
    if (s.phase === 'window' && s.window) {
      const b = earliestBot(s);
      if (b !== null) resolveCall(s, b); else closeWindow(s);
      return s;
    }
    if (s.phase === 'reveal') {
      s.phase = 'play';
      s.revealUntil = null;
      const nt = s.nextTurn;
      s.nextTurn = null;
      setTurn(s, nt);
      if (s.turn === null) finishGame(s, 'Permainan selesai!');
      return s;
    }
    return state;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'window') return { type: 'act', id: 'percaya' };
    const hand = s.hands[seat] ?? [];
    const truth = hand.filter(c => seqIndexOf(c) === s.required);
    return { type: 'act', id: 'taruh', cards: [truth[0] ?? hand[0]] };
  },

  view: (s, seat) => buildView(s, seat),

  bot(view, difficulty: Difficulty, rng) {
    const v = view as BohongView;
    const ids = v.actions.map(a => a.id);
    if (ids.includes('bohong')) {
      return { type: 'act', id: rng.float() < callChance(v) ? 'bohong' : 'percaya' };
    }
    if (!ids.includes('taruh')) return { type: 'act', id: ids[0] ?? 'percaya' };
    const hand = v.hand;
    const req = v.bohong.required;
    const truth = hand.filter(c => seqIndexOf(c) === req);
    // Kartu bluff: angka yang paling lama lagi dibutuhkan (jarak putaran terjauh).
    const far = hand.filter(c => seqIndexOf(c) !== req)
      .sort((a, b) => ((seqIndexOf(b) - req + 13) % 13) - ((seqIndexOf(a) - req + 13) % 13));
    const pickBluff = (k: number) => far.slice(0, Math.max(1, Math.min(k, far.length)));
    if (difficulty === 'easy') {
      if (truth.length && rng.float() < 0.65) return { type: 'act', id: 'taruh', cards: truth.slice(0, 1 + rng.int(truth.length)) };
      const k = 1 + rng.int(Math.min(2, hand.length));
      const pool = hand.slice();
      const pick: Card[] = [];
      for (let i = 0; i < k; i++) pick.push(pool.splice(rng.int(pool.length), 1)[0]);
      return { type: 'act', id: 'taruh', cards: pick };
    }
    if (truth.length) {
      const cards = truth.slice(0, 4);
      // Hard: kadang selipkan 1 kartu bluff bila klaim masih masuk akal.
      if (difficulty === 'hard' && cards.length <= 2 && far.length && hand.length > 4 && rng.float() < 0.25) cards.push(far[0]);
      return { type: 'act', id: 'taruh', cards };
    }
    const k = difficulty === 'hard' && hand.length > 6 && rng.float() < 0.35 ? 2 : 1;
    return { type: 'act', id: 'taruh', cards: pickBluff(k) };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const out: SeatResult[] = s.finished.map((seat, k) => ({ seat, rank: k + 1, score: 0 }));
    const rest = s.names.map((_, i) => i).filter(i => !s.finished.includes(i))
      .sort((a, b) => s.hands[a].length - s.hands[b].length);
    let rank = 0, prev: number | null = null;
    rest.forEach((seat, k) => {
      const c = s.hands[seat].length;
      if (c !== prev) { rank = s.finished.length + k + 1; prev = c; }
      out.push({ seat, rank, score: c });
    });
    return out;
  },
};
