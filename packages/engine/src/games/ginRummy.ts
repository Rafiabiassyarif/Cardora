// games/ginRummy.ts — Gin Rummy, 2 pemain.
//
// Aturan:
//  1. Deck 52, masing-masing 10 kartu; satu kartu dibuka sebagai kartu buka (upcard), sisanya stok.
//  2. Giliran pertama: non-dealer boleh mengambil kartu buka atau lewat; jika lewat, dealer boleh
//     mengambil atau lewat; jika keduanya lewat, non-dealer wajib mengambil dari stok.
//  3. Giliran biasa: ambil 1 kartu (stok atau buangan teratas), lalu buang 1 kartu. Kartu yang baru
//     diambil dari buangan tidak boleh langsung dibuang lagi.
//  4. Meld: Set (3–4 kartu ber-rank sama) atau Run (3+ kartu selambang berurutan, As hanya rendah).
//     Deadwood: As = 1, 2–10 = nominal, J/Q/K = 10. Susunan meld terbaik dihitung otomatis.
//  5. Knock: buang 1 kartu dan akhiri deal bila deadwood sisa ≤ 10. Deadwood 0 = Gin (+25 bonus,
//     lawan tidak boleh menempel). Setelah knock biasa, lawan otomatis menempel kartu ke meld
//     pengetuk. Pengetuk mendapat selisih deadwood; jika deadwood lawan ≤ pengetuk = Undercut,
//     lawan mendapat selisih + 25.
//  6. Jika stok tinggal 2 kartu dan pemain membuang tanpa knock, deal batal (tanpa skor) dan diulang
//     oleh dealer yang sama. Dealer bergantian setiap deal yang sah.
//  7. Pemain pertama yang mencapai target poin (50/100) menang. Pengaman: maksimal 40 deal.

import { type Card, shuffledDeck, cardLabel } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, type GPile, parseAction, requireAction, takeCards, removeCards,
  rankByScore, deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { deadwoodValue, solveMelds, solveWithLayoffs, sortHand } from './rummyCore';

export interface GinRummyOptions { turnSeconds: number; passAndPlay: boolean; target: number }

export interface GinDealResult {
  void: boolean;
  knocker: number | null;
  gin: boolean;
  undercut: boolean;
  knockerMelds: Card[][];
  knockerDead: Card[];
  defenderMelds: Card[][];
  defenderDead: Card[];
  laidOff: Card[];
  knockerDeadwood: number;
  defenderDeadwood: number;
  winner: number | null;
  points: number;
}

export interface GinRummyState {
  gameId: 'gin-rummy';
  options: GinRummyOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  stock: Card[];
  discard: Card[];
  dealer: number;
  turn: number | null;
  /** upcard = tawaran kartu buka; draw = ambil; discard = buang/knock; show = jeda akhir deal. */
  phase: 'upcard' | 'draw' | 'discard' | 'show';
  /** Jumlah lewat pada tawaran kartu buka (0/1). */
  upcardPasses: number;
  /** Giliran ambil hanya dari stok (kedua pemain melewati kartu buka). */
  stockOnly: boolean;
  /** Kartu yang baru diambil dari buangan (tidak boleh dibuang di giliran yang sama). */
  takenDiscard: Card | null;
  scores: number[];
  dealNo: number;
  last: GinDealResult | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_DEALS = 40;

const OPTIONS: OptionSpec[] = [
  { key: 'target', label: 'Target Poin', type: 'select', choices: [{ value: 50, label: '50 Poin (Cepat)' }, { value: 100, label: '100 Poin (Standar)' }] },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: GinRummyOptions = { turnSeconds: 25, passAndPlay: false, target: 50 };

/** Deadwood minimum dari sekumpulan kartu (As rendah). */
export const ginDeadwood = (cards: Card[]) => solveMelds(cards, false).deadwood;

const other = (seat: number) => 1 - seat;

function discardable(s: GinRummyState, seat: number): Card[] {
  return s.hands[seat].filter(c => c !== s.takenDiscard);
}

/** Kartu yang bila dibuang membuat deadwood ≤ 10 (boleh knock). */
function knockCards(s: GinRummyState, seat: number): { card: Card; dw: number }[] {
  const hand = s.hands[seat];
  return discardable(s, seat)
    .map(card => ({ card, dw: ginDeadwood(hand.filter(c => c !== card)) }))
    .filter(x => x.dw <= 10);
}

function actionsFor(s: GinRummyState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat || s.phase === 'show') return [];
  if (s.phase === 'upcard') {
    return [
      { id: 'take', label: 'Ambil Kartu Buka', style: 'primary' },
      { id: 'pass', label: 'Lewat' },
    ];
  }
  if (s.phase === 'draw') {
    const acts: GActionSpec[] = [{ id: 'stock', label: 'Ambil dari Stok', style: 'primary' }];
    if (!s.stockOnly && s.discard.length) acts.push({ id: 'pickup', label: 'Ambil Buangan' });
    return acts;
  }
  const acts: GActionSpec[] = [{ id: 'drop', label: 'Buang', cards: { min: 1, max: 1 } }];
  const k = knockCards(s, seat);
  if (k.length) {
    const gin = k.some(x => x.dw === 0);
    acts.unshift({ id: 'knock', label: gin ? 'Gin!' : 'Knock', style: 'primary', cards: { min: 1, max: 1 },
      hint: 'Pilih kartu yang dibuang sambil knock (deadwood sisa ≤ 10)' });
  }
  return acts;
}

function setTurn(s: GinRummyState, seat: number | null) {
  s.turn = seat;
  s.turnDeadline = seat === null ? null : deadline(s.options.turnSeconds);
}

function deal(s: GinRummyState, rng: Rng) {
  const deck = shuffledDeck(rng);
  const nd = other(s.dealer);
  s.hands = [[], []];
  s.hands[nd] = sortHand(deck.splice(0, 10));
  s.hands[s.dealer] = sortHand(deck.splice(0, 10));
  s.discard = [deck.shift()!];
  s.stock = deck;
  s.phase = 'upcard';
  s.upcardPasses = 0;
  s.stockOnly = false;
  s.takenDiscard = null;
  s.last = null;
  s.banner = null;
  s.dealNo += 1;
  setTurn(s, nd);
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo}: ${s.names[s.dealer]} membagi. Kartu buka ${cardLabel(s.discard[0])}.` });
}

function endDeal(s: GinRummyState, knocker: number | null) {
  setTurn(s, null);
  s.takenDiscard = null;
  if (knocker === null) {
    s.last = { void: true, knocker: null, gin: false, undercut: false, knockerMelds: [], knockerDead: [], defenderMelds: [], defenderDead: [],
      laidOff: [], knockerDeadwood: 0, defenderDeadwood: 0, winner: null, points: 0 };
    s.banner = 'Stok tinggal 2 kartu — deal batal, diulang.';
    pushLog(s.log, { seat: null, text: s.banner });
    s.phase = 'show';
    if (s.dealNo >= MAX_DEALS) s.over = true;
    return;
  }
  const def = other(knocker);
  const ks = solveMelds(s.hands[knocker], false);
  const gin = ks.deadwood === 0;
  const ds = gin ? { ...solveMelds(s.hands[def], false), laidOff: [] as Card[] } : solveWithLayoffs(s.hands[def], ks.melds, false);
  let winner: number;
  let points: number;
  let undercut = false;
  if (gin) {
    winner = knocker;
    points = ds.deadwood + 25;
  } else if (ds.deadwood > ks.deadwood) {
    winner = knocker;
    points = ds.deadwood - ks.deadwood;
  } else {
    winner = def;
    undercut = true;
    points = ks.deadwood - ds.deadwood + 25;
  }
  s.scores[winner] += points;
  s.last = { void: false, knocker, gin, undercut, knockerMelds: ks.melds, knockerDead: ks.dead, defenderMelds: ds.melds, defenderDead: ds.dead,
    laidOff: ds.laidOff, knockerDeadwood: ks.deadwood, defenderDeadwood: ds.deadwood, winner, points };
  const what = gin ? `GIN! ${s.names[knocker]}` : undercut ? `Undercut! ${s.names[def]}` : `${s.names[knocker]} knock`;
  s.banner = `${what} +${points} poin (deadwood ${ks.deadwood} vs ${ds.deadwood}${ds.laidOff.length ? `, ${ds.laidOff.length} kartu ditempel` : ''})`;
  pushLog(s.log, { seat: winner, text: s.banner });
  s.phase = 'show';
  s.dealer = other(s.dealer);
  if (s.scores.some(x => x >= s.options.target) || s.dealNo >= MAX_DEALS) {
    s.over = true;
    const w = s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1;
    pushLog(s.log, { seat: w, text: w === null ? 'Permainan selesai seri.' : `🏆 ${s.names[w]} menang ${s.scores[w]}–${s.scores[other(w)]}!` });
  }
}

function bestDiscard(hand: Card[], allowed: Card[]): { card: Card; dw: number } {
  let best: { card: Card; dw: number } | null = null;
  for (const c of allowed) {
    const dw = ginDeadwood(hand.filter(x => x !== c));
    if (!best || dw < best.dw || (dw === best.dw && deadwoodValue(c) > deadwoodValue(best.card))) best = { card: c, dw };
  }
  return best!;
}

export const ginRummy: GameModule<GinRummyState, GenericAction, GenericView, GinRummyOptions> = {
  id: 'gin-rummy',
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      target: Number(r.target) === 100 ? 100 : 50,
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length !== 2) throw new RuleError('Gin Rummy butuh tepat 2 pemain');
    const s: GinRummyState = {
      gameId: 'gin-rummy', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [[], []], stock: [], discard: [], dealer: rng.int(2), turn: null,
      phase: 'upcard', upcardPasses: 0, stockOnly: false, takenDiscard: null,
      scores: [0, 0], dealNo: 0, last: null, banner: null, over: false, log: [], turnDeadline: null,
    };
    deal(s, rng);
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
    const hand = s.hands[seat];

    switch (spec.id) {
      case 'take':
      case 'pickup': {
        const c = s.discard.pop()!;
        hand.push(c);
        s.takenDiscard = c;
        s.phase = 'discard';
        s.turnDeadline = deadline(s.options.turnSeconds);
        pushLog(s.log, { seat, text: `${name} mengambil ${cardLabel(c)} dari buangan` });
        return s;
      }
      case 'pass': {
        pushLog(s.log, { seat, text: `${name} melewati kartu buka` });
        if (s.upcardPasses === 0) {
          s.upcardPasses = 1;
          setTurn(s, other(seat));
        } else {
          s.phase = 'draw';
          s.stockOnly = true;
          setTurn(s, other(s.dealer));
        }
        return s;
      }
      case 'stock': {
        const c = s.stock.shift()!;
        hand.push(c);
        s.takenDiscard = null;
        s.stockOnly = false;
        s.phase = 'discard';
        s.turnDeadline = deadline(s.options.turnSeconds);
        pushLog(s.log, { seat, text: `${name} mengambil dari stok` });
        return s;
      }
      default: {
        // drop / knock
        const [card] = takeCards(hand, a.cards, 1, 1);
        if (card === s.takenDiscard) throw new RuleError('Kartu yang baru diambil dari buangan tidak boleh langsung dibuang');
        const rest = hand.filter(c => c !== card);
        if (spec.id === 'knock' && ginDeadwood(rest) > 10) throw new RuleError('Deadwood harus ≤ 10 untuk knock');
        removeCards(hand, [card]);
        s.hands[seat] = sortHand(hand);
        s.discard.push(card);
        s.takenDiscard = null;
        pushLog(s.log, { seat, text: `${name} membuang ${cardLabel(card)}${spec.id === 'knock' ? ' dan KNOCK!' : ''}` });
        if (spec.id === 'knock') { endDeal(s, seat); return s; }
        if (s.stock.length <= 2) { endDeal(s, null); return s; }
        s.phase = 'draw';
        s.stockOnly = false;
        setTurn(s, other(seat));
        return s;
      }
    }
  },

  autoDelay: s => (!s.over && s.phase === 'show' ? 6000 : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'show') return state;
    const s = clone(state);
    deal(s, rng);
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'upcard') return { type: 'act', id: 'pass' };
    if (s.phase === 'draw') return { type: 'act', id: 'stock' };
    const b = bestDiscard(s.hands[seat], discardable(s, seat));
    return { type: 'act', id: 'drop', cards: [b.card] };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < 2 ? seat : null;
    const L = s.phase === 'show' || s.over ? s.last : null;
    const reveal = L && !L.void && L.knocker !== null;
    const players = s.names.map((name, i) => {
      let status: string | undefined;
      let melds: Card[][] | undefined;
      let faceUp: (Card | null)[] | undefined;
      if (reveal) {
        const isK = L!.knocker === i;
        melds = isK ? L!.knockerMelds : L!.defenderMelds;
        faceUp = isK ? L!.knockerDead : L!.defenderDead;
        const dw = isK ? L!.knockerDeadwood : L!.defenderDeadwood;
        status = `${isK ? (L!.gin ? 'Gin' : 'Knock') : 'Bertahan'} · deadwood ${dw}`;
      } else if (s.turn === i) {
        status = s.phase === 'upcard' ? 'Memilih kartu buka' : s.phase === 'draw' ? 'Mengambil' : 'Membuang';
      }
      return {
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: `${s.scores[i]} pt`, tag: s.dealer === i ? 'D' : undefined,
        status, melds, faceUp,
      };
    });
    const piles: GPile[] = [
      { id: 'stock', label: 'Stok', cards: s.stock.length ? [null] : [], count: s.stock.length },
      { id: 'discard', label: s.phase === 'upcard' ? 'Kartu Buka' : 'Buangan', cards: s.discard.length ? [s.discard[s.discard.length - 1]] : [],
        count: s.discard.length, highlight: s.phase === 'upcard' || s.phase === 'draw' },
    ];
    if (reveal && L!.laidOff.length) piles.push({ id: 'layoff', label: 'Ditempel', cards: L!.laidOff.slice(), spread: true, caption: `oleh ${s.names[other(L!.knocker!)]}` });
    const badges = [`Deal ${s.dealNo}`, `Target ${s.options.target}`];
    let myDw: number | null = null;
    if (me !== null && s.hands[me].length === 10) myDw = ginDeadwood(s.hands[me]);
    if (myDw !== null) badges.push(`Deadwood-mu: ${myDw}`);
    const acts = actionsFor(s, me);
    let prompt: string;
    if (s.over) prompt = 'Permainan selesai';
    else if (s.phase === 'show') prompt = 'Deal berikutnya segera dimulai…';
    else if (s.turn !== me) prompt = `Menunggu ${s.names[s.turn ?? 0]}…`;
    else if (s.phase === 'upcard') prompt = 'Ambil kartu buka atau lewat';
    else if (s.phase === 'draw') prompt = s.stockOnly ? 'Ambil kartu dari stok' : 'Ambil dari stok atau buangan';
    else prompt = acts.some(x => x.id === 'knock') ? 'Buang 1 kartu — atau pilih kartu lalu Knock!' : 'Pilih 1 kartu untuk dibuang';
    return {
      gameId: 'gin-rummy',
      generic: true,
      you: me,
      turn: s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: ginRummy.results(s),
      players,
      hand: me !== null ? s.hands[me].slice() : [],
      piles,
      actions: acts,
      playable: me !== null && s.turn === me && s.phase === 'discard' ? discardable(s, me) : [],
      prompt,
      badges,
      banner: L ? s.banner : null,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    const hand = v.hand;
    const top = v.piles.find(p => p.id === 'discard')?.cards[0] ?? null;
    const wantsTop = () => {
      if (!top) return false;
      const now = ginDeadwood(hand);
      const withTop = [...hand, top];
      const after = bestDiscard(withTop, hand).dw;
      if (difficulty === 'easy') return after < now && rng.float() < 0.6;
      return after < now - (difficulty === 'hard' ? 1 : 0) || after === 0;
    };
    if (ids.includes('take')) return { type: 'act', id: wantsTop() ? 'take' : 'pass' };
    if (ids.includes('stock')) return { type: 'act', id: ids.includes('pickup') && wantsTop() ? 'pickup' : 'stock' };
    const allowed = v.playable && v.playable.length ? v.playable : hand;
    if (difficulty === 'easy' && rng.float() < 0.35) {
      return { type: 'act', id: 'drop', cards: [allowed[rng.int(allowed.length)]] };
    }
    const b = bestDiscard(hand, allowed);
    if (ids.includes('knock') && b.dw <= 10) {
      const stock = v.piles.find(p => p.id === 'stock')?.count ?? 0;
      // Hard: tunggu gin bila deadwood sudah sangat kecil dan stok masih banyak.
      const wait = difficulty === 'hard' && b.dw > 0 && b.dw <= 3 && stock > 20 && rng.float() < 0.5;
      if (b.dw === 0 || (difficulty !== 'easy' && !wait) || (difficulty === 'easy' && rng.float() < 0.5)) {
        return { type: 'act', id: 'knock', cards: [b.card] };
      }
    }
    return { type: 'act', id: 'drop', cards: [b.card] };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    return rankByScore(s.scores, true);
  },
};
