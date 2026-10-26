// games/oldMaid.ts — Old Maid, 2–6 pemain.
//
// Aturan:
//  1. Q♣ dikeluarkan dari deck (51 kartu) sehingga tepat satu Queen tidak punya pasangan: si Old Maid.
//     Opsi "sama warna": pasangan harus angka sama DAN warna sama → Old Maid = Q♠.
//     Opsi "angka sama" (standar): dua kartu angka sama mana pun boleh dipasangkan.
//  2. Semua kartu dibagikan habis. Pasangan di tangan otomatis dibuang (terbuka).
//  3. Giliran: ambil 1 kartu tertutup dari pemain berikutnya (ke kiri) yang masih punya kartu,
//     dengan memilih posisi kartu di kipasnya ("Ambil kartu ke-N"). Tangan pemilik dikocok setiap kali
//     sebelum diambil, sehingga posisi tidak bisa dimanfaatkan.
//  4. Bila kartu yang diambil membentuk pasangan, pasangan otomatis dibuang.
//  5. Pemain yang kartunya habis selamat (urutan selesai = peringkat). Pemain terakhir yang
//     memegang Old Maid kalah (peringkat terakhir).
//  6. Pengaman: setelah 1.500 pengambilan, permainan dihentikan; pemegang Old Maid kalah,
//     yang lain diperingkat dari sisa kartu.

import { type Card, rankOf, suitOf, shuffle, standardDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction,
  deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface OldMaidOptions { turnSeconds: number; passAndPlay: boolean; pairRule: 'rank' | 'color' }

export interface OldMaidState {
  gameId: 'old-maid';
  options: OldMaidOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  /** Pasangan yang sudah dibuang (publik). */
  discards: Card[][];
  /** Pasangan terakhir yang dibuang tiap pemain (untuk ditampilkan). */
  lastPair: (Card[] | null)[];
  turn: number | null;
  /** Urutan pemain yang selamat. */
  finished: number[];
  loser: number | null;
  draws: number;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_DRAWS = 1500;
const REMOVED: Card = 'QC';

const OPTIONS: OptionSpec[] = [
  { key: 'pairRule', label: 'Aturan Pasangan', type: 'select', choices: [
    { value: 'rank', label: 'Angka Sama (Standar)' }, { value: 'color', label: 'Angka & Warna Sama' },
  ], help: 'Angka & warna sama: misalnya 7♥ hanya berpasangan dengan 7♦' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: OldMaidOptions = { turnSeconds: 25, passAndPlay: false, pairRule: 'rank' };

const isRed = (c: Card) => suitOf(c) === 'H' || suitOf(c) === 'D';
const pairKey = (s: OldMaidState, c: Card) => (s.options.pairRule === 'color' ? `${c[0]}${isRed(c) ? 'r' : 'b'}` : c[0]);
const sortHand = (h: Card[]) => h.sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));

/** Buang semua pasangan dari tangan seat (mutasi). */
function discardPairs(s: OldMaidState, seat: number, quiet = false) {
  const groups = new Map<string, Card[]>();
  for (const c of s.hands[seat]) groups.set(pairKey(s, c), [...(groups.get(pairKey(s, c)) ?? []), c]);
  let removed = 0;
  for (const cs of groups.values()) {
    for (let i = 0; i + 1 < cs.length; i += 2) {
      const pair = [cs[i], cs[i + 1]];
      s.hands[seat] = s.hands[seat].filter(c => !pair.includes(c));
      s.discards.push(pair);
      s.lastPair[seat] = pair;
      removed++;
      if (!quiet) pushLog(s.log, { seat, text: `${s.names[seat]} membuang pasangan ${cardLabel(pair[0])} ${cardLabel(pair[1])}` });
    }
  }
  return removed;
}

const active = (s: OldMaidState) => s.names.map((_, i) => i).filter(i => s.hands[i].length > 0);

/** Pemain berikutnya (ke kiri) dari `seat` yang masih memegang kartu. */
function nextWithCards(s: OldMaidState, seat: number): number | null {
  const n = s.names.length;
  for (let k = 1; k < n; k++) {
    const p = (seat + k) % n;
    if (s.hands[p].length > 0) return p;
  }
  return null;
}

function markFinished(s: OldMaidState) {
  for (let i = 0; i < s.names.length; i++) {
    if (s.hands[i].length === 0 && !s.finished.includes(i)) {
      s.finished.push(i);
      pushLog(s.log, { seat: i, text: `✅ ${s.names[i]} kartunya habis — selamat! (#${s.finished.length})` });
    }
  }
}

function checkEnd(s: OldMaidState): boolean {
  const act = active(s);
  if (act.length <= 1) {
    s.over = true;
    s.turn = null;
    s.turnDeadline = null;
    s.loser = act[0] ?? null;
    if (s.loser !== null) pushLog(s.log, { seat: s.loser, text: `👵 ${s.names[s.loser]} memegang Old Maid — kalah!` });
    return true;
  }
  return false;
}

function setTurn(s: OldMaidState, from: number, includeSelf: boolean) {
  const n = s.names.length;
  for (let k = includeSelf ? 0 : 1; k <= n; k++) {
    const p = (from + k) % n;
    if (s.hands[p].length > 0) { s.turn = p; break; }
  }
  s.turnDeadline = deadline(s.options.turnSeconds);
}

function actionsFor(s: OldMaidState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  const from = nextWithCards(s, seat);
  if (from === null) return [];
  const k = s.hands[from].length;
  return [{ id: 'draw', label: 'Ambil kartu ke-', style: 'primary', amount: { min: 1, max: k, step: 1, default: 1 },
    hint: `Ambil 1 kartu tertutup dari ${s.names[from]}` }];
}

export const oldMaid: GameModule<OldMaidState, GenericAction, GenericView, OldMaidOptions> = {
  id: 'old-maid',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      pairRule: r.pairRule === 'color' ? 'color' : 'rank',
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Old Maid butuh 2–6 pemain');
    const deck = shuffle(standardDeck().filter(c => c !== REMOVED), rng);
    const n = seats.length;
    const hands: Card[][] = seats.map(() => []);
    const start = rng.int(n);
    deck.forEach((c, i) => hands[(start + i) % n].push(c));
    const s: OldMaidState = {
      gameId: 'old-maid', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, discards: [], lastPair: seats.map(() => null), turn: null,
      finished: [], loser: null, draws: 0, over: false, log: [], turnDeadline: null,
    };
    for (let i = 0; i < n; i++) { discardPairs(s, i, true); sortHand(s.hands[i]); }
    pushLog(s.log, { seat: null, text: `Satu Queen dikeluarkan. Semua pasangan awal dibuang (${s.discards.length} pasang).` });
    markFinished(s);
    if (!checkEnd(s)) setTurn(s, start, true);
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const pos = a.amount;
    if (pos === undefined || pos < spec.amount!.min || pos > spec.amount!.max) throw new RuleError('Pilih posisi kartu yang valid');
    const s = clone(state);
    const from = nextWithCards(s, seat)!;
    // Kocok tangan pemilik dulu agar posisi tidak bisa dimanfaatkan.
    const fan = shuffle(s.hands[from], rng);
    const card = fan.splice(pos - 1, 1)[0];
    s.hands[from] = sortHand(fan);
    s.hands[seat].push(card);
    sortHand(s.hands[seat]);
    s.draws += 1;
    pushLog(s.log, { seat, text: `${s.names[seat]} mengambil kartu ke-${pos} dari ${s.names[from]}` });
    discardPairs(s, seat);
    markFinished(s);
    if (checkEnd(s)) return s;
    if (s.draws >= MAX_DRAWS) {
      s.over = true; s.turn = null; s.turnDeadline = null;
      s.loser = s.hands.findIndex(h => h.some(c => rankOf(c) === 12)) ;
      if (s.loser < 0) s.loser = null;
      pushLog(s.log, { seat: null, text: 'Batas langkah tercapai — permainan dihentikan.' });
      return s;
    }
    setTurn(s, seat, false);
    return s;
  },

  autoDelay: () => null,
  advance: s => s,

  timeoutAction(s, seat) {
    void seat;
    return { type: 'act', id: 'draw', amount: 1 };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const myTurn = me !== null && s.turn === me && !s.over;
    const from = myTurn ? nextWithCards(s, me!) : null;
    const lastDiscard = s.discards[s.discards.length - 1];
    return {
      gameId: 'old-maid',
      generic: true,
      you: me,
      turn: s.over ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: oldMaid.results(s),
      players: s.names.map((name, i) => {
        const place = s.finished.indexOf(i);
        return {
          name, isBot: s.bots[i], count: s.hands[i].length,
          status: place >= 0 ? `Selamat #${place + 1}` : s.loser === i ? 'Old Maid 👵' : undefined,
          out: place >= 0,
          melds: s.lastPair[i] ? [s.lastPair[i]!.slice()] : undefined,
        };
      }),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        ...(from !== null ? [{ id: 'fan', label: `Kartu ${s.names[from]}`, cards: s.hands[from].map(() => null), count: s.hands[from].length, spread: true, highlight: true }] : []),
        { id: 'discard', label: 'Pasangan Dibuang', cards: lastDiscard ? lastDiscard.slice() : [], count: s.discards.length * 2, spread: true,
          caption: `${s.discards.length} pasang` },
      ],
      actions: actionsFor(s, me),
      playable: [],
      prompt: s.over ? 'Permainan selesai'
        : myTurn ? `Ambil 1 kartu dari ${s.names[from ?? 0]} — pilih posisinya`
        : me !== null && s.hands[me].length === 0 ? 'Kamu sudah selamat! 🎉'
        : `Menunggu ${s.names[s.turn ?? 0]}…`,
      badges: [`Sisa pemain: ${active(s).length}`, s.options.pairRule === 'color' ? 'Pasangan: angka & warna' : `Pasangan: angka sama`],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    void difficulty;
    const a = v.actions.find(x => x.id === 'draw');
    if (!a?.amount) return { type: 'act', id: 'draw', amount: 1 };
    // Posisi tidak membawa informasi (tangan dikocok), jadi pilihan acak sudah optimal.
    return { type: 'act', id: 'draw', amount: a.amount.min + rng.int(a.amount.max - a.amount.min + 1) };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const n = s.names.length;
    const order = s.finished.slice();
    const rest = s.names.map((_, i) => i).filter(i => !order.includes(i) && i !== s.loser)
      .sort((a, b) => s.hands[a].length - s.hands[b].length);
    order.push(...rest);
    if (s.loser !== null) order.push(s.loser);
    return order.map((seat, k) => ({ seat, rank: k + 1, score: n - 1 - k }));
  },
};
