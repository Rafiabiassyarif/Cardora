// games/kartu41.ts — Kartu 41 (permainan kartu khas Indonesia), 2–4 pemain.
//
// Aturan yang diterapkan:
//  1. Tiap pemain memegang 4 kartu (tidak boleh kurang atau lebih di akhir giliran).
//  2. Nilai kartu: As = 11, K/Q/J/10 = 10, 2–9 sesuai nominal.
//     Nilai tangan = jumlah kartu dari SATU lambang/suit terbaik dikurangi jumlah kartu lambang lainnya.
//  3. Giliran pemain:
//     - Mengambil 1 kartu dari cangkulan (deck) ATAU kartu yang dibuang oleh pemain persis sebelum dia (1 orang sebelum dia).
//     - Kartu buangan pemain sebelumnya hanya bisa diambil oleh pemain berikutnya; jika pemain tersebut mencangkul, kartu buangan hangus.
//     - Membuang 1 kartu ke meja (kembali tepat 4 kartu di tangan). Kartu yang baru diambil dari buangan tidak boleh langsung dibuang lagi.
//  4. Pemenang utama: Siapa yang berhasil mengumpulkan nilai tepat 41 (4 kartu lambang/suit sama semua: As + tiga kartu bernilai 10)
//     langsung menang deal seketika!
//  5. Jika kartu cangkulan habis (deck kosong), deal berakhir dan semua kartu dibuka:
//     pemain dengan poin tertinggi (maksimal 41) menang deal.
//  6. Total poin diakumulasi sesuai jumlah deal yang dipilih.

import { type Card, rankOf, suitOf, shuffledDeck, cardLabel, SUITS } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog, clampInt } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';

export interface Kartu41Options { turnSeconds: number; passAndPlay: boolean; deals: number }

export interface Kartu41State {
  gameId: '41';
  options: Kartu41Options;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  /** Kartu buangan yang aktif dan HANYA bisa diambil oleh pemain berikutnya (1 orang sesudahnya). */
  availableDiscard: Card | null;
  phase: 'draw' | 'discard' | 'dealEnd';
  turn: number | null;
  /** Kartu buangan yang baru diambil (tidak boleh langsung dibuang lagi). */
  tookDiscard: Card | null;
  dealNo: number;
  dealer: number;
  turnsThisDeal: number;
  scores: number[];
  /** Nilai tangan per pemain pada deal terakhir (diisi saat kartu dibuka). */
  lastDeal: number[] | null;
  revealed: boolean;
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

const DEFAULTS: Kartu41Options = { turnSeconds: 25, passAndPlay: false, deals: 3 };
const MAX_TURNS_PER_DEAL = 80;
const DEAL_END_DELAY = 3500;

export const cardValue41 = (c: Card) => {
  const r = rankOf(c);
  return r === 14 ? 11 : r >= 10 ? 10 : r;
};

/** Nilai tangan: suit terbaik dikurangi suit lain. Kembalikan juga suit terbaiknya. */
export function handValue41(hand: Card[]): { value: number; suit: string } {
  const total = hand.reduce((t, c) => t + cardValue41(c), 0);
  let best = -Infinity, bestSuit = 'S';
  for (const s of SUITS) {
    const inSuit = hand.filter(c => suitOf(c) === s).reduce((t, c) => t + cardValue41(c), 0);
    if (inSuit === 0) continue;
    const v = inSuit - (total - inSuit);
    if (v > best) { best = v; bestSuit = s; }
  }
  if (best === -Infinity) best = 0;
  return { value: best, suit: bestSuit };
}

export const is41 = (hand: Card[]) => hand.length === 4 && handValue41(hand).value === 41;

/** Kartu terbaik untuk dibuang dari 5 kartu (menghasilkan nilai tertinggi). */
export function bestDiscard41(hand: Card[], forbidden: Card | null): { card: Card; value: number } {
  let best: { card: Card; value: number } | null = null;
  for (const c of hand) {
    if (c === forbidden) continue;
    const rest = hand.filter(x => x !== c);
    const v = handValue41(rest).value;
    if (!best || v > best.value || (v === best.value && cardValue41(c) < cardValue41(best.card))) best = { card: c, value: v };
  }
  return best!;
}

function actionsFor(s: Kartu41State, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase === 'dealEnd') return [];
  if (s.phase === 'draw') {
    const acts: GActionSpec[] = [{ id: 'deck', label: 'Cangkul', style: 'primary' }];
    if (s.availableDiscard) {
      acts.push({
        id: 'take',
        label: 'Ambil Buangan',
        hint: `Ambil ${cardLabel(s.availableDiscard)} dari buangan pemain sebelumnya`,
      });
    }
    return acts;
  }
  return [{ id: 'discard', label: 'Buang', style: 'primary', cards: { min: 1, max: 1 } }];
}

function startDeal(s: Kartu41State, rng: Rng) {
  const n = s.names.length;
  s.deck = shuffledDeck(rng);
  s.hands = s.names.map(() => s.deck.splice(0, 4));
  s.discard = [];
  s.availableDiscard = null;
  s.tookDiscard = null;
  s.turnsThisDeal = 0;
  s.revealed = false;
  s.lastDeal = null;
  s.banner = null;
  s.phase = 'draw';
  s.turn = (s.dealer + 1) % n;
  s.turnDeadline = deadline(s.options.turnSeconds);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}/${s.options.deals} dimulai. ${s.names[s.turn]} jalan duluan.` });
  // 41 dari kartu bagian awal langsung menang.
  for (let k = 0; k < n; k++) {
    const p = (s.turn + k) % n;
    if (is41(s.hands[p])) { endDeal(s, `${s.names[p]} langsung dapat 41!`, p); return; }
  }
}

function endDeal(s: Kartu41State, reason: string, instant: number | null = null) {
  const vals = s.hands.map(h => handValue41(h).value);
  const best = Math.max(...vals);
  const pts = vals.slice();
  for (let i = 0; i < pts.length; i++) s.scores[i] += pts[i];
  s.lastDeal = pts;
  s.revealed = true;
  s.phase = 'dealEnd';
  s.turn = null;
  s.turnDeadline = null;
  const winners = instant !== null ? [instant] : vals.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
  s.banner = `${reason} Pemenang deal: ${winners.map(w => s.names[w]).join(', ')} (${instant !== null ? 41 : best} poin).`;
  pushLog(s.log, { seat: null, text: s.banner });
  for (let i = 0; i < pts.length; i++) pushLog(s.log, { seat: i, text: `${s.names[i]}: ${s.hands[i].map(cardLabel).join(' ')} = ${pts[i]}` });
}

function endTurn(s: Kartu41State) {
  s.turnsThisDeal += 1;
  s.tookDiscard = null;
  const n = s.names.length;
  s.turn = ((s.turn ?? 0) + 1) % n;
  s.phase = 'draw';
  s.turnDeadline = deadline(s.options.turnSeconds);
  if (s.deck.length === 0) { endDeal(s, 'Kartu cangkulan habis — kartu dibuka.'); return; }
  if (s.turnsThisDeal >= MAX_TURNS_PER_DEAL) { endDeal(s, 'Batas giliran tercapai — kartu dibuka.'); return; }
}

export const kartu41: GameModule<Kartu41State, GenericAction, GenericView, Kartu41Options> = {
  id: '41',
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
    if (seats.length < 2 || seats.length > 4) throw new RuleError('Kartu 41 butuh 2–4 pemain');
    const s: Kartu41State = {
      gameId: '41', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], deck: [], discard: [], availableDiscard: null, phase: 'draw', turn: null, tookDiscard: null,
      dealNo: 1, dealer: rng.int(seats.length), turnsThisDeal: 0,
      scores: seats.map(() => 0), lastDeal: null, revealed: false, banner: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase === 'dealEnd' ? null : s.turn),

  apply(state, seat, raw, _rng) {
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
      s.availableDiscard = null; // Cangkul dari deck membuat buangan sebelumnya hangus untuk giliran berikutnya
      s.phase = 'discard';
      pushLog(s.log, { seat, text: `${name} mencangkul kartu dari deck` });
      return s;
    }
    if (spec.id === 'take') {
      if (!s.availableDiscard) throw new RuleError('Tidak ada kartu buangan yang bisa diambil');
      const c = s.availableDiscard;
      hand.push(c);
      s.tookDiscard = c;
      const idx = s.discard.lastIndexOf(c);
      if (idx >= 0) s.discard.splice(idx, 1);
      s.availableDiscard = null;
      s.phase = 'discard';
      pushLog(s.log, { seat, text: `${name} mengambil ${cardLabel(c)} dari buangan` });
      return s;
    }
    // discard
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (card === s.tookDiscard) throw new RuleError('Kartu yang baru diambil dari buangan tidak boleh langsung dibuang');
    removeCards(hand, [card]);
    s.discard.push(card);
    s.availableDiscard = card; // Hanya pemain berikutnya yang boleh mengambil kartu ini
    pushLog(s.log, { seat, text: `${name} membuang ${cardLabel(card)}` });
    if (is41(hand)) { endDeal(s, `🎉 ${name} mendapat 41!`, seat); return s; }
    endTurn(s);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'dealEnd' ? DEAL_END_DELAY : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'dealEnd') return state;
    const s = clone(state);
    if (s.dealNo >= s.options.deals) {
      s.over = true;
      s.turn = null;
      s.turnDeadline = null;
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
    if (s.phase === 'draw') return { type: 'act', id: 'deck' };
    const d = bestDiscard41(s.hands[seat], s.tookDiscard);
    return { type: 'act', id: 'discard', cards: [d.card] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const top = s.availableDiscard ?? (s.discard.length ? s.discard[s.discard.length - 1] : null);
    const myVal = me !== null ? handValue41(s.hands[me]).value : null;
    const acts = actionsFor(s, me);
    return {
      gameId: '41',
      generic: true,
      you: me,
      turn: s.over || s.phase === 'dealEnd' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: kartu41.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`,
        status: s.revealed && s.lastDeal ? `Deal: ${s.lastDeal[i] >= 0 ? '+' : ''}${s.lastDeal[i]}` : undefined,
        tag: i === s.dealer ? 'D' : undefined,
        faceUp: s.revealed ? s.hands[i].slice() : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Cangkulan', cards: s.deck.length ? [null] : [], count: s.deck.length },
        {
          id: 'discard',
          label: 'Buangan',
          cards: s.availableDiscard ? [s.availableDiscard] : (top ? [top] : []),
          count: s.discard.length,
          highlight: Boolean(s.availableDiscard && me !== null && s.turn === me && s.phase === 'draw'),
          caption: s.availableDiscard ? 'Bisa diambil' : (s.discard.length ? 'Hangus' : undefined),
        },
      ],
      actions: acts,
      playable: me !== null && s.turn === me && s.phase === 'discard' ? s.hands[me].filter(c => c !== s.tookDiscard) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'dealEnd' ? 'Kartu dibuka — deal berikutnya segera dimulai…'
        : s.turn !== me ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.phase === 'draw' ? (s.availableDiscard ? 'Cangkul kartu atau ambil kartu buangan pemain sebelumnya' : 'Cangkul kartu dari deck')
        : 'Pilih 1 kartu untuk dibuang',
      badges: [
        `Deal ${s.dealNo}/${s.options.deals}`,
        ...(myVal !== null ? [`Nilaimu: ${myVal}`] : []),
      ],
      banner: s.phase === 'dealEnd' || s.over ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const hand = v.hand;
    const discardPile = v.piles.find(p => p.id === 'discard');
    const top = discardPile?.cards[0] ?? null;
    if (ids.includes('deck')) {
      const cur = handValue41(hand).value;
      if (difficulty === 'easy') {
        if (top && ids.includes('take') && rng.float() < 0.3) return { type: 'act', id: 'take' };
        return { type: 'act', id: 'deck' };
      }
      if (top && ids.includes('take')) {
        const withTop = bestDiscard41([...hand, top], top).value;
        if (withTop > cur) return { type: 'act', id: 'take' };
      }
      return { type: 'act', id: 'deck' };
    }
    const forbidden = v.playable && v.playable.length < hand.length ? hand.find(c => !v.playable!.includes(c)) ?? null : null;
    let pick: Card;
    if (difficulty === 'easy' && rng.float() < 0.35) {
      const pool = v.playable && v.playable.length ? v.playable : hand;
      pick = pool[rng.int(pool.length)];
    } else {
      pick = bestDiscard41(hand, forbidden).card;
    }
    return { type: 'act', id: 'discard', cards: [pick] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
