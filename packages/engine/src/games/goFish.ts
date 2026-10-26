// games/goFish.ts — Go Fish, 2–6 pemain.
//
// Aturan:
//  1. Deck 52. Kartu awal 7 per pemain untuk 2–3 pemain, 5 untuk 4+ (bisa diatur lewat opsi).
//     Sisa kartu menjadi "kolam" (pond).
//  2. Giliran: pilih 1 kartu dari tanganmu (menentukan angka yang diminta) dan 1 lawan yang masih
//     memegang kartu. Kamu wajib memegang minimal 1 kartu angka tersebut.
//  3. Jika lawan punya, ia menyerahkan SEMUA kartu angka itu dan kamu jalan lagi.
//     Jika tidak: "Go Fish!" — ambil 1 kartu dari kolam. Bila kartu itu angka yang diminta,
//     kamu menunjukkannya dan jalan lagi; jika tidak, giliran berpindah.
//  4. Empat kartu berangka sama otomatis diturunkan sebagai 1 "Buku" (terbuka untuk semua).
//  5. Pemain bertangan kosong mengambil 1 kartu dari kolam saat gilirannya; bila kolam juga
//     kosong, ia selesai. Bila tak ada lawan yang memegang kartu, pemain cukup "Mancing".
//  6. Permainan selesai saat 13 buku lengkap. Buku terbanyak menang (seri = peringkat sama).

import { type Card, rankOf, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION, rankLabel,
} from '../generic';

export interface GoFishOptions { turnSeconds: number; passAndPlay: boolean; handSize: number }

export interface GoFishState {
  gameId: 'go-fish';
  options: GoFishOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  pond: Card[];
  books: Card[][][];
  turn: number | null;
  /** Angka terakhir yang diminta tiap pemain (info publik, untuk ingatan bot). */
  lastAsk: (number | null)[];
  steps: number;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_STEPS = 2000;

const OPTIONS: OptionSpec[] = [
  { key: 'handSize', label: 'Kartu Awal', type: 'select', choices: [
    { value: 0, label: 'Otomatis (7 / 5 kartu)' }, { value: 5, label: '5 Kartu' }, { value: 7, label: '7 Kartu' },
  ], help: 'Otomatis: 7 kartu untuk 2–3 pemain, 5 kartu untuk 4+ pemain' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: GoFishOptions = { turnSeconds: 25, passAndPlay: false, handSize: 0 };

const totalBooks = (s: GoFishState) => s.books.reduce((t, b) => t + b.length, 0);
const sortHand = (h: Card[]) => h.sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));

function opponentsWithCards(s: GoFishState, seat: number): number[] {
  return s.names.map((_, i) => i).filter(i => i !== seat && s.hands[i].length > 0);
}

function actionsFor(s: GoFishState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  const opp = opponentsWithCards(s, seat);
  if (s.hands[seat].length > 0 && opp.length) {
    return [{ id: 'ask', label: 'Minta', style: 'primary', cards: { min: 1, max: 1 }, targets: opp,
      hint: 'Pilih 1 kartu (angka yang diminta) lalu pilih lawan' }];
  }
  return [{ id: 'fish', label: 'Mancing', style: 'primary' }];
}

/** Turunkan buku (4 kartu sama angka) dari tangan seat. */
function layBooks(s: GoFishState, seat: number) {
  const hand = s.hands[seat];
  const byRank = new Map<number, Card[]>();
  for (const c of hand) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  for (const [r, cs] of byRank) {
    if (cs.length === 4) {
      s.hands[seat] = s.hands[seat].filter(c => rankOf(c) !== r);
      s.books[seat].push(cs.slice().sort());
      for (let i = 0; i < s.lastAsk.length; i++) if (s.lastAsk[i] === r) s.lastAsk[i] = null;
      pushLog(s.log, { seat, text: `📚 ${s.names[seat]} melengkapi buku ${rankLabel(r)}` });
    }
  }
}

function endGame(s: GoFishState, why?: string) {
  s.over = true;
  s.turn = null;
  s.turnDeadline = null;
  pushLog(s.log, { seat: null, text: why ?? 'Semua buku sudah lengkap!' });
}

/**
 * Siapkan giliran `seat` (atau pemain berikutnya yang masih bisa bermain):
 * tangan kosong → ambil 1 dari kolam; kolam juga kosong → lewati.
 */
function startTurn(s: GoFishState, seat: number) {
  const n = s.names.length;
  if (totalBooks(s) >= 13) { endGame(s); return; }
  for (let k = 0; k < n; k++) {
    const p = (seat + k) % n;
    if (s.hands[p].length === 0) {
      if (s.pond.length === 0) continue;
      s.hands[p].push(s.pond.shift()!);
      sortHand(s.hands[p]);
      pushLog(s.log, { seat: p, text: `${s.names[p]} tidak punya kartu, mengambil 1 dari kolam` });
    }
    s.turn = p;
    s.turnDeadline = deadline(s.options.turnSeconds);
    return;
  }
  endGame(s, 'Tidak ada kartu tersisa.');
}

export const goFish: GameModule<GoFishState, GenericAction, GenericView, GoFishOptions> = {
  id: 'go-fish',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const h = Number(r.handSize);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      handSize: h === 5 || h === 7 ? h : 0,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 6) throw new RuleError('Go Fish butuh 2–6 pemain');
    const deck = shuffledDeck(rng);
    const size = options.handSize || (seats.length <= 3 ? 7 : 5);
    const hands = seats.map(() => sortHand(deck.splice(0, size)));
    const s: GoFishState = {
      gameId: 'go-fish', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands, pond: deck, books: seats.map(() => []), turn: null,
      lastAsk: seats.map(() => null), steps: 0,
      over: false, log: [], turnDeadline: null,
    };
    for (let i = 0; i < seats.length; i++) layBooks(s, i);
    const first = rng.int(seats.length);
    pushLog(s.log, { seat: null, text: `Kartu dibagikan (${size} per pemain). ${s.names[first]} jalan duluan.` });
    startTurn(s, first);
    return s;
  },

  currentSeat: s => (s.over ? null : s.turn),

  apply(state, seat, raw) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const n = s.names.length;
    const name = s.names[seat];
    s.steps += 1;

    if (spec.id === 'fish') {
      if (s.pond.length) {
        s.hands[seat].push(s.pond.shift()!);
        sortHand(s.hands[seat]);
        pushLog(s.log, { seat, text: `${name} mancing 1 kartu` });
        layBooks(s, seat);
      } else {
        pushLog(s.log, { seat, text: `${name} lewat` });
      }
      startTurn(s, (seat + 1) % n);
      return s;
    }

    // ask
    const [card] = takeCards(s.hands[seat], a.cards, 1, 1);
    const target = a.target;
    if (target === undefined || !spec.targets!.includes(target)) throw new RuleError('Pilih lawan yang masih memegang kartu');
    const rank = rankOf(card);
    s.lastAsk[seat] = rank;
    const got = s.hands[target].filter(c => rankOf(c) === rank);
    let again = false;
    if (got.length) {
      s.hands[target] = s.hands[target].filter(c => rankOf(c) !== rank);
      if (s.lastAsk[target] === rank) s.lastAsk[target] = null;
      s.hands[seat].push(...got);
      sortHand(s.hands[seat]);
      pushLog(s.log, { seat, text: `${name} minta ${rankLabel(rank)} ke ${s.names[target]} — dapat ${got.length} kartu!` });
      again = true;
    } else {
      pushLog(s.log, { seat, text: `${name} minta ${rankLabel(rank)} ke ${s.names[target]} — "Go Fish!" 🐟` });
      if (s.pond.length) {
        const c = s.pond.shift()!;
        s.hands[seat].push(c);
        sortHand(s.hands[seat]);
        if (rankOf(c) === rank) {
          pushLog(s.log, { seat, text: `${name} memancing ${cardLabel(c)} — tepat sasaran, jalan lagi!` });
          again = true;
        }
      }
    }
    layBooks(s, seat);
    if (s.steps >= MAX_STEPS) { endGame(s, 'Batas langkah tercapai.'); return s; }
    startTurn(s, again ? seat : (seat + 1) % n);
    return s;
  },

  autoDelay: () => null,
  advance: s => s,

  timeoutAction(s, seat) {
    const acts = actionsFor(s, seat);
    const ask = acts.find(x => x.id === 'ask');
    if (ask) return { type: 'act', id: 'ask', cards: [s.hands[seat][0]], target: ask.targets![0] };
    return { type: 'act', id: 'fish' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const myTurn = me !== null && s.turn === me && !s.over;
    return {
      gameId: 'go-fish',
      generic: true,
      you: me,
      turn: s.over ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: goFish.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.books[i].length} buku`,
        status: s.lastAsk[i] !== null ? `Minta ${rankLabel(s.lastAsk[i]!)}` : undefined,
        out: s.hands[i].length === 0 && s.pond.length === 0,
        melds: s.books[i].map(b => b.slice()),
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [{ id: 'pond', label: 'Kolam', cards: s.pond.length ? [null] : [], count: s.pond.length }],
      actions: actionsFor(s, me),
      playable: myTurn ? s.hands[me!].slice() : [],
      prompt: s.over ? 'Permainan selesai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : actionsFor(s, me).some(x => x.id === 'ask') ? 'Pilih kartu (angka yang diminta) lalu pilih lawan'
        : 'Tidak ada lawan yang bisa ditanya — mancing dari kolam',
      badges: [`Buku ${totalBooks(s)}/13`, `Kolam ${s.pond.length}`],
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ask = v.actions.find(a => a.id === 'ask');
    if (!ask) return { type: 'act', id: 'fish' };
    const targets = ask.targets!;
    const counts = new Map<number, Card[]>();
    for (const c of v.hand) counts.set(rankOf(c), [...(counts.get(rankOf(c)) ?? []), c]);
    if (difficulty === 'easy') {
      return { type: 'act', id: 'ask', cards: [v.hand[rng.int(v.hand.length)]], target: targets[rng.int(targets.length)] };
    }
    // Ingatan: lawan yang terakhir meminta angka yang juga kita pegang kemungkinan memilikinya.
    const memory = targets.filter(t => {
      const m = /^Minta (.+)$/.exec(v.players[t].status ?? '');
      return m && v.hand.some(c => rankLabel(rankOf(c)) === m[1]);
    });
    if (memory.length) {
      const t = memory[rng.int(memory.length)];
      const lbl = /^Minta (.+)$/.exec(v.players[t].status!)![1];
      const card = v.hand.find(c => rankLabel(rankOf(c)) === lbl)!;
      return { type: 'act', id: 'ask', cards: [card], target: t };
    }
    // Minta angka yang paling banyak dipegang; ke lawan dengan kartu terbanyak (hard) atau acak.
    const best = [...counts.values()].sort((a, b) => b.length - a.length);
    const top = best.filter(g => g.length === best[0].length);
    const card = top[rng.int(top.length)][0];
    const target = difficulty === 'hard'
      ? targets.slice().sort((a, b) => v.players[b].count - v.players[a].count)[0]
      : targets[rng.int(targets.length)];
    return { type: 'act', id: 'ask', cards: [card], target };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.books.map(b => b.length));
  },
};
