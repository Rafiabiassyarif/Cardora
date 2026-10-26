// games/remi.ts — Remi Indonesia, 2–4 pemain.
//
// Aturan yang diterapkan:
//  1. Deck 52. Tiap pemain 7 kartu; satu kartu dibuka sebagai buangan pertama.
//  2. Giliran: ambil 1 kartu dari deck ATAU kartu buangan teratas, lalu buang 1 kartu
//     (kartu buangan yang baru diambil tidak boleh langsung dibuang lagi).
//  3. Kombinasi sah: Set = 3–4 kartu angka sama (beda lambang); Run/Seri = 3+ kartu berurutan
//     selambang. As boleh rendah (A-2-3) atau tinggi (Q-K-A), tetapi tidak memutar (K-A-2 tidak sah).
//  4. "Tutup": jika setelah membuang seluruh 7 kartu tersisa bisa dibagi habis menjadi kombinasi
//     sah, pemain otomatis menang deal.
//  5. Skor deal: pemenang +50; pemain lain dikurangi nilai kartu yang tidak masuk kombinasi
//     (susunan terbaik dihitung otomatis). Nilai kartu: As = 15, 10/J/Q/K = 10, 2–9 = 5.
//  6. Deck habis → buangan (kecuali teratas) dikocok ulang; bila tetap tidak bisa / batas giliran
//     pengaman tercapai, deal berakhir tanpa pemenang. Beberapa deal (opsi); peringkat dari total.

import { type Card, rankOf, suitOf, shuffledDeck, shuffle, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog, clampInt } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface RemiOptions { turnSeconds: number; passAndPlay: boolean; deals: number }

export interface RemiState {
  gameId: 'remi';
  options: RemiOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  phase: 'draw' | 'discard' | 'dealEnd';
  turn: number | null;
  tookDiscard: Card | null;
  dealNo: number;
  dealer: number;
  turnsThisDeal: number;
  scores: number[];
  lastDeal: number[] | null;
  /** Susunan kombinasi tiap pemain saat kartu dibuka. */
  revealMelds: Card[][][] | null;
  winner: number | null;
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

const DEFAULTS: RemiOptions = { turnSeconds: 25, passAndPlay: false, deals: 3 };
const HAND_SIZE = 7;
const WIN_BONUS = 50;
const MAX_TURNS_PER_DEAL = 160;
const DEAL_END_DELAY = 4000;

export const remiPoints = (c: Card) => {
  const r = rankOf(c);
  return r === 14 ? 15 : r >= 10 ? 10 : 5;
};

/* ----------------------------- meld solver ------------------------------ */

/** Apakah kartu-kartu ini satu kombinasi sah (set atau run)? */
export function isValidMeld(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const ranks = cards.map(rankOf);
  if (cards.length <= 4 && ranks.every(x => x === ranks[0])) {
    return new Set(cards.map(suitOf)).size === cards.length;
  }
  const suit = suitOf(cards[0]);
  if (!cards.every(c => suitOf(c) === suit)) return false;
  for (const aceLow of [false, true]) {
    const rs = ranks.map(x => (x === 14 && aceLow ? 1 : x)).sort((a, b) => a - b);
    let ok = true;
    for (let i = 1; i < rs.length; i++) if (rs[i] !== rs[i - 1] + 1) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/** Semua kombinasi sah yang bisa dibentuk dari kartu-kartu di tangan. */
export function allMelds(hand: Card[]): Card[][] {
  const out: Card[][] = [];
  // Set
  const byRank = new Map<number, Card[]>();
  for (const c of hand) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  for (const group of byRank.values()) {
    const g = [...new Map(group.map(c => [suitOf(c), c])).values()];
    if (g.length >= 3) {
      if (g.length === 4) out.push(g.slice());
      for (let skip = 0; skip < g.length; skip++) {
        if (g.length === 3 && skip > 0) break;
        out.push(g.length === 3 ? g.slice() : g.filter((_, i) => i !== skip));
      }
    }
  }
  // Run: urutan rank 1..14 (1 = As rendah).
  const has = new Set(hand);
  for (const suit of ['S', 'H', 'D', 'C']) {
    const at = (r: number): Card | null => {
      const c = (r === 1 || r === 14 ? 'A' : '23456789TJQK'[r - 2]) + suit;
      return has.has(c) ? c : null;
    };
    for (let start = 1; start <= 12; start++) {
      const run: Card[] = [];
      for (let r = start; r <= (start === 1 ? 13 : 14); r++) {
        const c = at(r);
        if (!c) break;
        run.push(c);
        if (run.length >= 3) out.push(run.slice());
      }
    }
  }
  return out;
}

/**
 * Susunan terbaik: kombinasi yang meminimalkan nilai kartu sisa (deadwood).
 * Mengembalikan melds + deadwood. Jika deadwood kosong → tangan bisa ditutup.
 */
export function bestPartition(hand: Card[]): { melds: Card[][]; deadwood: Card[]; points: number } {
  const melds = allMelds(hand);
  let best = { melds: [] as Card[][], deadwood: hand.slice(), points: hand.reduce((t, c) => t + remiPoints(c), 0) };
  const rec = (remaining: Card[], chosen: Card[][], dead: Card[]) => {
    if (remaining.length === 0) {
      const pts = dead.reduce((t, c) => t + remiPoints(c), 0);
      if (pts < best.points || (pts === best.points && dead.length < best.deadwood.length)) {
        best = { melds: chosen.map(m => m.slice()), deadwood: dead.slice(), points: pts };
      }
      return;
    }
    const first = remaining[0];
    for (const m of melds) {
      if (!m.includes(first) || !m.every(c => remaining.includes(c))) continue;
      chosen.push(m);
      rec(remaining.filter(c => !m.includes(c)), chosen, dead);
      chosen.pop();
    }
    dead.push(first);
    rec(remaining.slice(1), chosen, dead);
    dead.pop();
  };
  rec(hand.slice(), [], []);
  return best;
}

/** Apakah seluruh kartu bisa dibagi habis menjadi kombinasi sah? */
export function canCloseHand(hand: Card[]): boolean {
  return hand.length > 0 && bestPartition(hand).deadwood.length === 0;
}

/* ------------------------------- engine --------------------------------- */

function actionsFor(s: RemiState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase === 'dealEnd') return [];
  if (s.phase === 'draw') {
    const acts: GActionSpec[] = [];
    if (s.deck.length) acts.push({ id: 'deck', label: 'Ambil Deck', style: 'primary' });
    if (s.discard.length) acts.push({ id: 'take', label: 'Ambil Buangan' });
    return acts;
  }
  return [{ id: 'discard', label: 'Buang', style: 'primary', cards: { min: 1, max: 1 }, hint: 'Jika sisa kartu semuanya kombinasi sah, otomatis Tutup' }];
}

function startDeal(s: RemiState, rng: Rng) {
  s.deck = shuffledDeck(rng);
  s.hands = s.names.map(() => s.deck.splice(0, HAND_SIZE));
  s.discard = [s.deck.shift()!];
  s.tookDiscard = null;
  s.turnsThisDeal = 0;
  s.lastDeal = null;
  s.revealMelds = null;
  s.winner = null;
  s.banner = null;
  s.phase = 'draw';
  s.turn = (s.dealer + 1) % s.names.length;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}/${s.options.deals} dimulai. Buangan pertama: ${cardLabel(s.discard[0])}.` });
}

function endDeal(s: RemiState, winner: number | null, reason: string) {
  const parts = s.hands.map(h => bestPartition(h));
  const pts = parts.map((p, i) => (i === winner ? WIN_BONUS : -p.points));
  for (let i = 0; i < pts.length; i++) s.scores[i] += pts[i];
  s.lastDeal = pts;
  s.revealMelds = parts.map(p => (p.deadwood.length ? [...p.melds, p.deadwood] : p.melds));
  s.winner = winner;
  s.phase = 'dealEnd';
  s.turn = null;
  s.turnDeadline = null;
  s.banner = reason;
  pushLog(s.log, { seat: winner, text: reason });
  for (let i = 0; i < pts.length; i++) if (i !== winner) pushLog(s.log, { seat: i, text: `${s.names[i]}: sisa ${parts[i].points} poin (${pts[i]})` });
}

function refillDeck(s: RemiState, rng: Rng) {
  if (s.deck.length > 0 || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.deck = shuffle(s.discard, rng);
  s.discard = [keep];
  pushLog(s.log, { seat: null, text: 'Tumpukan buangan dikocok menjadi deck baru.' });
}

export const remi: GameModule<RemiState, GenericAction, GenericView, RemiOptions> = {
  id: 'remi',
  minPlayers: 2,
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
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Remi butuh 2–4 pemain');
    const s: RemiState = {
      gameId: 'remi', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], deck: [], discard: [], phase: 'draw', turn: null, tookDiscard: null,
      dealNo: 1, dealer: rng.int(seats.length), turnsThisDeal: 0,
      scores: seats.map(() => 0), lastDeal: null, revealMelds: null, winner: null, banner: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase === 'dealEnd' ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.phase === 'dealEnd') throw new RuleError('Tunggu deal berikutnya');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (spec.id === 'deck') {
      hand.push(s.deck.shift()!);
      s.phase = 'discard';
      pushLog(s.log, { seat, text: `${name} mengambil dari deck` });
      return s;
    }
    if (spec.id === 'take') {
      const c = s.discard.pop()!;
      hand.push(c);
      s.tookDiscard = c;
      s.phase = 'discard';
      pushLog(s.log, { seat, text: `${name} mengambil ${cardLabel(c)} dari buangan` });
      return s;
    }
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (card === s.tookDiscard) throw new RuleError('Kartu yang baru diambil dari buangan tidak boleh langsung dibuang');
    removeCards(hand, [card]);
    s.discard.push(card);
    s.tookDiscard = null;
    pushLog(s.log, { seat, text: `${name} membuang ${cardLabel(card)}` });
    if (canCloseHand(hand)) { endDeal(s, seat, `🎉 ${name} Tutup! Semua kartu tersusun.`); return s; }
    s.turnsThisDeal += 1;
    if (s.turnsThisDeal >= MAX_TURNS_PER_DEAL) { endDeal(s, null, 'Batas giliran tercapai — deal berakhir tanpa pemenang.'); return s; }
    refillDeck(s, rng);
    if (s.deck.length === 0) { endDeal(s, null, 'Deck habis — deal berakhir tanpa pemenang.'); return s; }
    s.turn = (seat + 1) % s.names.length;
    s.phase = 'draw';
    s.turnDeadline = deadline(s.options.turnSeconds);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'dealEnd' ? DEAL_END_DELAY : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'dealEnd') return state;
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
    if (s.phase === 'draw') return { type: 'act', id: s.deck.length ? 'deck' : 'take' };
    return { type: 'act', id: 'discard', cards: [bestDiscardRemi(s.hands[seat], s.tookDiscard).card] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const top = s.discard[s.discard.length - 1];
    const revealed = s.phase === 'dealEnd' || s.over;
    const myPart = me !== null && !revealed ? bestPartition(s.hands[me]) : null;
    return {
      gameId: 'remi',
      generic: true,
      you: me,
      turn: s.over || s.phase === 'dealEnd' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: remi.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        status: revealed && s.lastDeal ? (s.winner === i ? 'Tutup! 🏆' : `Deal: ${s.lastDeal[i]}`) : undefined,
        tag: i === s.dealer ? 'D' : undefined,
        melds: revealed && s.revealMelds ? s.revealMelds[i] : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length },
        { id: 'discard', label: 'Buangan', cards: top ? [top] : [], count: s.discard.length, highlight: true },
        ...(myPart && myPart.melds.length ? [{ id: 'mine', label: 'Kombinasimu', cards: myPart.melds.flat(), spread: true,
          caption: `Sisa ${myPart.points} poin` }] : []),
      ],
      actions: actionsFor(s, me),
      playable: me !== null && s.turn === me && s.phase === 'discard' ? s.hands[me].filter(c => c !== s.tookDiscard) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'dealEnd' ? 'Kartu dibuka — deal berikutnya segera dimulai…'
        : s.turn !== me ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.phase === 'draw' ? 'Ambil dari deck atau buangan'
        : 'Buang 1 kartu — jika sisanya kombinasi sah, kamu Tutup!',
      badges: [`Deal ${s.dealNo}/${s.options.deals}`],
      banner: revealed ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const hand = v.hand;
    if (ids.includes('deck') || ids.includes('take')) {
      const top = v.piles.find(p => p.id === 'discard')?.cards[0] ?? null;
      if (top && ids.includes('take') && difficulty !== 'easy') {
        const cur = bestPartition(hand).points;
        const withTop = bestDiscardRemi([...hand, top], top);
        const inMeld = bestPartition([...hand.filter(c => c !== withTop.card), top]);
        if (withTop.points === 0 || (inMeld.points < cur - 4 && !inMeld.deadwood.includes(top))) return { type: 'act', id: 'take' };
      }
      if (ids.includes('deck')) return { type: 'act', id: 'deck' };
      return { type: 'act', id: 'take' };
    }
    const forbidden = v.playable && v.playable.length < hand.length ? hand.find(c => !v.playable!.includes(c)) ?? null : null;
    if (difficulty === 'easy' && rng.float() < 0.4) {
      const pool = v.playable && v.playable.length ? v.playable : hand;
      return { type: 'act', id: 'discard', cards: [pool[rng.int(pool.length)]] };
    }
    return { type: 'act', id: 'discard', cards: [bestDiscardRemi(hand, forbidden).card] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};

/** Kartu terbaik untuk dibuang: sisa deadwood paling kecil (seri: buang kartu bernilai tertinggi). */
export function bestDiscardRemi(hand: Card[], forbidden: Card | null): { card: Card; points: number } {
  let best: { card: Card; points: number; tie: number } | null = null;
  for (const c of hand) {
    if (c === forbidden) continue;
    const p = bestPartition(hand.filter(x => x !== c)).points;
    // Seri: buang kartu bernilai tinggi yang "terisolasi" (jauh dari kartu lain).
    const near = hand.filter(x => x !== c && (rankOf(x) === rankOf(c) || (suitOf(x) === suitOf(c) && Math.abs(rankOf(x) - rankOf(c)) <= 2))).length;
    const tie = remiPoints(c) - near * 6;
    if (!best || p < best.points || (p === best.points && tie > best.tie)) best = { card: c, points: p, tie };
  }
  return { card: best!.card, points: best!.points };
}
