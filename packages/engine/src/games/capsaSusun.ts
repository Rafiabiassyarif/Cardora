// games/capsaSusun.ts — Capsa Susun (Chinese Poker 13 kartu), 2–4 pemain.
//
// Aturan yang diterapkan:
//  1. Deck 52. Tiap pemain 13 kartu.
//  2. Tiap pemain (bergiliran, tersembunyi) menyusun: Baris Atas 3 kartu, Baris Tengah 5 kartu,
//     Baris Bawah 5 kartu (sisa). Wajib: Bawah ≥ Tengah ≥ Atas menurut ranking poker.
//     Baris Atas hanya mengenal Three of a Kind > One Pair > High Card dan dibandingkan dengan
//     baris 5 kartu berdasarkan kategori lalu kartu penentu.
//  3. Aksi: Set Baris Atas (pilih 3), Set Baris Tengah (pilih 5), Ulang, Susun Otomatis,
//     Kunci (Baris Bawah = 5 kartu sisa). Susunan yang melanggar urutan = "Mati".
//  4. Setelah semua mengunci, kartu dibuka dan diadu per baris melawan tiap lawan:
//     menang baris +1 / kalah −1 (seri 0). Menang ketiga baris (sapu bersih) = dobel (±6).
//     Pemain Mati kalah ketiga baris (dihitung sapu bersih) dari lawan yang tidak mati;
//     sesama Mati = 0.
//  5. Beberapa deal (opsi); peringkat akhir berdasarkan total poin.

import { type Card, rankOf, shuffledDeck } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog, clampInt } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { evaluate5, compareScores, CATEGORY_NAME, HandCategory } from '../poker/evaluator';

export interface CapsaSusunOptions { turnSeconds: number; passAndPlay: boolean; deals: number }

export interface CapsaRows { top: Card[] | null; mid: Card[] | null; bot: Card[] | null }

export interface CapsaSusunState {
  gameId: 'capsa-susun';
  options: CapsaSusunOptions;
  names: string[];
  bots: boolean[];
  /** Kartu yang belum dimasukkan ke baris mana pun. */
  hands: Card[][];
  rows: CapsaRows[];
  locked: boolean[];
  phase: 'arrange' | 'showdown';
  turn: number | null;
  dealNo: number;
  dealer: number;
  scores: number[];
  lastDeal: number[] | null;
  /** Ringkasan per pemain saat showdown. */
  lastSummary: string[] | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const OPTIONS: OptionSpec[] = [
  { key: 'deals', label: 'Jumlah Deal', type: 'select', choices: [
    { value: 1, label: '1 Deal (Kilat)' }, { value: 3, label: '3 Deal (Standar)' }, { value: 5, label: '5 Deal (Panjang)' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: CapsaSusunOptions = { turnSeconds: 40, passAndPlay: false, deals: 3 };
const SHOWDOWN_DELAY = 6000;

/* ------------------------------ evaluator ------------------------------- */

/** Skor 3 kartu (Baris Atas): [kategori, ...penentu] dengan kategori sama seperti evaluate5. */
export function score3(cards: Card[]): number[] {
  if (cards.length !== 3) throw new Error('score3 butuh 3 kartu');
  const r = cards.map(rankOf).sort((a, b) => b - a);
  if (r[0] === r[2]) return [HandCategory.ThreeOfAKind, r[0]];
  if (r[0] === r[1]) return [HandCategory.OnePair, r[0], r[2]];
  if (r[1] === r[2]) return [HandCategory.OnePair, r[1], r[0]];
  return [HandCategory.HighCard, ...r];
}

export const rowScore = (cards: Card[]) => (cards.length === 3 ? score3(cards) : evaluate5(cards).score);
export const rowName = (cards: Card[]) => CATEGORY_NAME[rowScore(cards)[0] as HandCategory];

/** Susunan mati (melanggar Bawah ≥ Tengah ≥ Atas)? */
export function isFoul(top: Card[], mid: Card[], bot: Card[]): boolean {
  const t = score3(top), m = evaluate5(mid).score, b = evaluate5(bot).score;
  return compareScores(b, m) < 0 || compareScores(m, t) < 0;
}

function* combos<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]);
    yield* combos(items, k, i + 1, acc);
    acc.pop();
  }
}

const BOT_P = [0, 0.05, 0.2, 0.4, 0.55, 0.68, 0.82, 0.96, 0.99, 1];
const MID_P = [0.05, 0.25, 0.55, 0.75, 0.85, 0.9, 0.96, 0.99, 1, 1];
const rowValue = (score: number[], row: 'top' | 'mid' | 'bot') => {
  const cat = score[0];
  if (row === 'top') {
    if (cat === HandCategory.ThreeOfAKind) return 0.98;
    if (cat === HandCategory.OnePair) return 0.5 + ((score[1] - 2) / 12) * 0.4;
    return Math.max(0, (score[1] - 7) / 7) * 0.35;
  }
  const t = ((score[1] ?? 2) - 2) / 12 * 0.08;
  return (row === 'bot' ? BOT_P : MID_P)[cat] + t;
};

/**
 * Susun otomatis 13 kartu. `greedy` = Bawah terbaik, Tengah terbaik dari sisa (selalu sah).
 * Selain itu dicoba beberapa kandidat Baris Bawah terkuat dan dipilih nilai heuristik tertinggi.
 */
export function autoArrange(cards: Card[], greedy = false): { top: Card[]; mid: Card[]; bot: Card[] } {
  const all = [...combos(cards, 5)].map(c => ({ c, s: evaluate5(c).score }));
  all.sort((a, b) => compareScores(b.s, a.s));
  if (greedy) {
    const bot = all[0].c;
    const rest = cards.filter(x => !bot.includes(x));
    let mid: Card[] | null = null, ms: number[] = [];
    for (const m of combos(rest, 5)) {
      const sc = evaluate5(m).score;
      if (!mid || compareScores(sc, ms) > 0) { mid = m; ms = sc; }
    }
    return { top: rest.filter(x => !mid!.includes(x)), mid: mid!, bot };
  }
  let best: { top: Card[]; mid: Card[]; bot: Card[]; v: number } | null = null;
  for (const b of all.slice(0, 30)) {
    const rest = cards.filter(x => !b.c.includes(x));
    for (const m of combos(rest, 5)) {
      const ms = evaluate5(m).score;
      if (compareScores(b.s, ms) < 0) continue;
      const top = rest.filter(x => !m.includes(x));
      const ts = score3(top);
      if (compareScores(ms, ts) < 0) continue;
      const v = rowValue(b.s, 'bot') + rowValue(ms, 'mid') + rowValue(ts, 'top');
      if (!best || v > best.v) best = { top, mid: m, bot: b.c, v };
    }
  }
  if (!best) throw new Error('autoArrange gagal');
  return { top: best.top, mid: best.mid, bot: best.bot };
}

/* ------------------------------- engine --------------------------------- */

function actionsFor(s: CapsaSusunState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase !== 'arrange' || s.locked[seat]) return [];
  const row = s.rows[seat];
  const hand = s.hands[seat];
  const acts: GActionSpec[] = [];
  if (row.top && row.mid) acts.push({ id: 'lock', label: 'Kunci', style: 'primary', hint: '5 kartu sisa jadi Baris Bawah' });
  if (!row.top && hand.length >= 3) acts.push({ id: 'top', label: 'Set Baris Atas', style: row.mid ? 'primary' : 'normal', cards: { min: 3, max: 3 } });
  if (!row.mid && hand.length >= 5) acts.push({ id: 'mid', label: 'Set Baris Tengah', style: row.top ? 'primary' : 'normal', cards: { min: 5, max: 5 } });
  if (row.top || row.mid) acts.push({ id: 'reset', label: 'Ulang', style: 'danger' });
  acts.push({ id: 'auto', label: 'Susun Otomatis', hint: 'Susunan sah yang kuat' });
  return acts;
}

function startDeal(s: CapsaSusunState, rng: Rng) {
  const deck = shuffledDeck(rng);
  s.hands = s.names.map(() => deck.splice(0, 13));
  s.rows = s.names.map(() => ({ top: null, mid: null, bot: null }));
  s.locked = s.names.map(() => false);
  s.phase = 'arrange';
  s.lastDeal = null;
  s.lastSummary = null;
  s.banner = null;
  s.turn = (s.dealer + 1) % s.names.length;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}/${s.options.deals}: susun 13 kartumu. ${s.names[s.turn]} menyusun duluan.` });
}

/** Poin pasangan (a vs b) dari sudut pandang a. */
export function pairPoints(a: CapsaRows, b: CapsaRows): number {
  const fa = isFoul(a.top!, a.mid!, a.bot!), fb = isFoul(b.top!, b.mid!, b.bot!);
  if (fa && fb) return 0;
  if (fa) return -6;
  if (fb) return 6;
  let won = 0, lost = 0;
  for (const k of ['top', 'mid', 'bot'] as const) {
    const c = compareScores(rowScore(a[k]!), rowScore(b[k]!));
    if (c > 0) won++; else if (c < 0) lost++;
  }
  if (won === 3) return 6;
  if (lost === 3) return -6;
  return won - lost;
}

function showdown(s: CapsaSusunState) {
  const n = s.names.length;
  const pts = s.names.map(() => 0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) pts[i] += pairPoints(s.rows[i], s.rows[j]);
  for (let i = 0; i < n; i++) s.scores[i] += pts[i];
  s.lastDeal = pts;
  s.lastSummary = s.rows.map(r => (isFoul(r.top!, r.mid!, r.bot!) ? 'Mati ☠️' : `${rowName(r.top!)} / ${rowName(r.mid!)} / ${rowName(r.bot!)}`));
  s.phase = 'showdown';
  s.turn = null;
  s.turnDeadline = null;
  const best = Math.max(...pts);
  s.banner = `Kartu diadu! Terbaik deal ini: ${s.names.filter((_, i) => pts[i] === best).join(', ')} (${best > 0 ? '+' : ''}${best}).`;
  pushLog(s.log, { seat: null, text: s.banner });
  for (let i = 0; i < n; i++) pushLog(s.log, { seat: i, text: `${s.names[i]}: ${s.lastSummary[i]} → ${pts[i] > 0 ? '+' : ''}${pts[i]}` });
}

function nextArranger(s: CapsaSusunState, from: number) {
  const n = s.names.length;
  for (let k = 1; k <= n; k++) {
    const p = (from + k) % n;
    if (!s.locked[p]) {
      s.turn = p;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return;
    }
  }
  showdown(s);
}

export const capsaSusun: GameModule<CapsaSusunState, GenericAction, GenericView, CapsaSusunOptions> = {
  id: 'capsa-susun',
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds, 40),
      passAndPlay: Boolean(r.passAndPlay),
      deals: clampInt(r.deals, 1, 5, 3),
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Capsa Susun butuh 2–4 pemain');
    const s: CapsaSusunState = {
      gameId: 'capsa-susun', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], rows: [], locked: [], phase: 'arrange', turn: null,
      dealNo: 1, dealer: rng.int(seats.length), scores: seats.map(() => 0),
      lastDeal: null, lastSummary: null, banner: null, over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase !== 'arrange' ? null : s.turn),

  apply(state, seat, raw, _rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.phase !== 'arrange') throw new RuleError('Kartu sedang diadu');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu menyusun');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const row = s.rows[seat];
    const hand = s.hands[seat];

    if (spec.id === 'top' || spec.id === 'mid') {
      const k = spec.id === 'top' ? 3 : 5;
      const sel = takeCards(hand, a.cards, k, k);
      removeCards(hand, sel);
      row[spec.id] = sel;
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    if (spec.id === 'reset' || spec.id === 'auto') {
      const all = [...hand, ...(row.top ?? []), ...(row.mid ?? [])];
      if (spec.id === 'reset') {
        s.hands[seat] = all;
        s.rows[seat] = { top: null, mid: null, bot: null };
      } else {
        const arr = autoArrange(all);
        s.rows[seat] = { top: arr.top, mid: arr.mid, bot: null };
        s.hands[seat] = arr.bot;
      }
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    // lock
    row.bot = hand.splice(0, hand.length);
    s.locked[seat] = true;
    pushLog(s.log, { seat, text: `${s.names[seat]} mengunci susunannya` });
    nextArranger(s, seat);
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

  timeoutAction(s, seat) {
    const row = s.rows[seat];
    if (row.top && row.mid && !isFoul(row.top, row.mid, s.hands[seat])) return { type: 'act', id: 'lock' };
    return { type: 'act', id: 'auto' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const revealed = s.phase === 'showdown' || s.over;
    const piles: GPile[] = [];
    if (me !== null && !revealed) {
      const row = s.rows[me];
      const bot = row.bot ?? (row.top && row.mid ? s.hands[me] : null);
      piles.push(
        { id: 'rowTop', label: 'Baris Atas', cards: row.top ?? [], spread: true, caption: row.top ? rowName(row.top) : 'Belum diisi (3)' },
        { id: 'rowMid', label: 'Baris Tengah', cards: row.mid ?? [], spread: true, caption: row.mid ? rowName(row.mid) : 'Belum diisi (5)' },
      );
      if (row.bot) piles.push({ id: 'rowBot', label: 'Baris Bawah', cards: row.bot, spread: true, caption: rowName(row.bot) });
      if (row.top && row.mid && bot) {
        const foul = isFoul(row.top, row.mid, bot);
        piles[foul ? 1 : 0].highlight = foul;
        if (foul) piles[1].caption = `${rowName(row.mid)} — ⚠️ Mati!`;
      }
    }
    const myRow = me !== null ? s.rows[me] : null;
    const ready = !!(myRow && myRow.top && myRow.mid && !s.locked[me!]);
    const foulNow = ready && isFoul(myRow!.top!, myRow!.mid!, s.hands[me!]);
    return {
      gameId: 'capsa-susun',
      generic: true,
      you: me,
      turn: s.over || s.phase !== 'arrange' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: capsaSusun.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: revealed ? 0 : 13,
        score: `${s.scores[i]} pt`,
        status: revealed && s.lastSummary && s.lastDeal ? `${s.lastSummary[i]} · ${s.lastDeal[i] > 0 ? '+' : ''}${s.lastDeal[i]}`
          : s.locked[i] ? 'Siap ✓' : s.turn === i ? 'Menyusun…' : 'Menunggu',
        tag: i === s.dealer ? 'D' : undefined,
        melds: revealed ? [s.rows[i].top!, s.rows[i].mid!, s.rows[i].bot!] : undefined,
      })),
      hand: me !== null && !revealed ? s.hands[me].slice() : [],
      piles,
      actions: actionsFor(s, me),
      playable: me !== null && s.turn === me && !revealed ? s.hands[me].slice() : [],
      prompt: s.over ? 'Permainan selesai'
        : revealed ? 'Kartu diadu per baris!'
        : me !== null && s.locked[me] ? 'Susunanmu terkunci — menunggu pemain lain…'
        : s.turn !== me ? `Menunggu ${s.names[s.turn ?? 0]} menyusun…`
        : foulNow ? '⚠️ Susunan Mati (Bawah ≥ Tengah ≥ Atas) — Ulang atau tetap Kunci'
        : ready ? 'Sisa 5 kartu jadi Baris Bawah — tekan Kunci'
        : !myRow!.top ? 'Pilih 3 kartu untuk Baris Atas (atau Susun Otomatis)'
        : 'Pilih 5 kartu untuk Baris Tengah',
      badges: [`Deal ${s.dealNo}/${s.options.deals}`, 'Bawah ≥ Tengah ≥ Atas', 'Sapu bersih = dobel'],
      banner: revealed ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, _rng) {
    const ids = v.actions.map(a => a.id);
    const top = v.piles.find(p => p.id === 'rowTop')?.cards as Card[] | undefined;
    const mid = v.piles.find(p => p.id === 'rowMid')?.cards as Card[] | undefined;
    if (ids.includes('lock') && top?.length === 3 && mid?.length === 5 && v.hand.length === 5 && !isFoul(top, mid, v.hand)) {
      return { type: 'act', id: 'lock' };
    }
    if (difficulty === 'easy' && ids.includes('top') && ids.includes('mid') && v.hand.length === 13) {
      // Pemula: susunan serakah (Bawah terkuat, lalu Tengah terkuat).
      const g = autoArrange(v.hand, true);
      return { type: 'act', id: 'mid', cards: g.mid };
    }
    if (difficulty === 'easy' && ids.includes('top') && !ids.includes('mid') && v.hand.length === 8) {
      const g = autoArrange([...v.hand, ...(mid ?? [])], true);
      const sameMid = mid && g.mid.every(c => mid.includes(c));
      if (sameMid) return { type: 'act', id: 'top', cards: g.top };
    }
    return { type: 'act', id: 'auto' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
