// games/kartuWarna.ts — Kartu Warna, 2–8 pemain. Game "buang kartu" bergaya game kartu warna populer.
//
// Deck: 108 token kartu warna dari tokens.ts (4 warna × [0, 1–9 ×2, Lewati ×2, Balik ×2, +2 ×2] + 4 Wild + 4 Wild +4).
//
// Aturan yang diimplementasikan:
//  1. Tiap pemain 7 kartu. Satu kartu dibuka sebagai kartu pembuka. Jika kartu pembuka Wild ATAU Wild +4,
//     kartu dikembalikan ke deck, deck dikocok, lalu dibuka ulang (pilihan sederhana untuk Wild biasa).
//     Kartu aksi pembuka langsung berlaku untuk pemain pertama (kiri dealer):
//     Lewati → pemain pertama dilewati; Balik → arah berbalik dan dealer jalan duluan;
//     +2 → pemain pertama ambil 2 & dilewati (selalu, meski opsi tumpuk aktif).
//  2. Mainkan 1 kartu yang SAMA WARNA dengan warna aktif, ATAU SAMA angka/simbol dengan kartu teratas.
//     Wild (Ganti Warna) selalu boleh. Wild +4 HANYA boleh bila tidak punya kartu berwarna aktif
//     (aturan resmi; ditegakkan, tanpa mekanisme tantangan).
//  3. Lewati: pemain berikutnya kehilangan giliran. Balik: arah berbalik (2 pemain = Lewati).
//     +2: pemain berikutnya ambil 2 & kehilangan giliran. Wild +4: pilih warna, pemain berikutnya
//     ambil 4 & kehilangan giliran. Setelah Wild/Wild +4 pemain memilih warna (Merah/Kuning/Hijau/Biru).
//     Opsi "Tumpuk +2/+4" (default mati): korban boleh membalas +2 di atas +2, atau Wild +4 (bila sah)
//     di atas +2/+4; hukuman menumpuk; yang tidak membalas menekan "Ambil N" lalu gilirannya selesai.
//  4. Tidak bisa/tidak mau main: ambil 1 kartu. Bila kartu itu bisa dimainkan, boleh langsung dimainkan
//     (hanya kartu itu) atau "Lewat"; bila tidak bisa, giliran otomatis berlalu.
//     Deck habis → buangan (kecuali kartu teratas) dikocok menjadi deck baru.
//  5. "Satu Kartu!": saat memainkan kartu kedua-terakhir (tangan 2 kartu), pemain harus memakai tombol
//     "Mainkan + Satu Kartu!". Jika memakai "Mainkan" biasa dan tersisa 1 kartu → otomatis ambil 2 kartu (penalti).
//  6. Pemain pertama yang kartunya habis memenangkan deal (jika kartu terakhir +2/+4, pemain berikutnya
//     tetap mengambil kartunya). Pemenang mendapat poin dari kartu lawan: angka = nominal,
//     Lewati/Balik/+2 = 20, Wild/Wild +4 = 50. Jumlah deal 1/3/5 (default 1) atau target skor (maks 10 deal).
//     Peringkat akhir: total poin (tinggi lebih baik), seri dipecah penalti kartu tersisa di deal terakhir
//     (kecil lebih baik), lalu jumlah kartu (sedikit lebih baik).
//  7. Pengaman: buntu (semua lewat tanpa bisa ambil kartu) atau batas 600 giliran per deal → deal
//     selesai tanpa pemenang (tanpa poin).

import { type Card, shuffle } from '../cards';
import type { Rng } from '../rng';
import { type Difficulty, type GameModule, type LogEntry, type OptionSpec, type SeatInfo, type SeatResult, RuleError, clone, pushLog } from '../types';
import {
  type GActionSpec, type GenericAction, type GenericView, parseAction, requireAction, takeCards, removeCards,
  deadline, sanitizeTurnSeconds, TURN_SECONDS_OPTION, PASS_AND_PLAY_OPTION,
} from '../generic';
import { colorDeck, colorCardInfo, colorCardLabel, U_COLORS, U_COLOR_NAME, type UColor } from '../tokens';

export interface KartuWarnaOptions {
  turnSeconds: number;
  passAndPlay: boolean;
  /** Jumlah deal (1/3/5); diabaikan bila target > 0. */
  deals: number;
  /** Target skor (0 = pakai jumlah deal). */
  target: number;
  /** Boleh menumpuk +2/+4. */
  stacking: boolean;
}

export type KartuWarnaPhase = 'play' | 'color' | 'dealEnd';

export interface KartuWarnaState {
  gameId: 'kartu-warna';
  options: KartuWarnaOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  activeColor: UColor;
  /** 1 = searah jarum jam (⟳), -1 = berlawanan (⟲). */
  direction: 1 | -1;
  phase: KartuWarnaPhase;
  turn: number | null;
  dealer: number;
  /** Pemain sudah mengambil 1 kartu di giliran ini dan kartu itu bisa dimainkan. */
  drewThisTurn: boolean;
  /** Hukuman ambil yang menumpuk (hanya dengan opsi tumpuk). */
  pendingDraw: number;
  passes: number;
  turns: number;
  scores: number[];
  dealNo: number;
  dealWinner: number | null;
  banner: string | null;
  over: boolean;
  log: LogEntry[];
  turnDeadline: number | null;
}

const MAX_TURNS = 600;
const MAX_DEALS = 10;
const DEAL_PAUSE = 4000;
const HAND_SIZE = 7;
const COLOR_ICON: Record<string, string> = { R: '🔴', Y: '🟡', G: '🟢', B: '🔵' };

const OPTIONS: OptionSpec[] = [
  { key: 'deals', label: 'Jumlah Deal', type: 'select', choices: [{ value: 1, label: '1 Deal (Cepat)' }, { value: 3, label: '3 Deal' }, { value: 5, label: '5 Deal' }] },
  { key: 'target', label: 'Target Skor', type: 'select', choices: [{ value: 0, label: 'Tanpa Target (pakai jumlah deal)' }, { value: 200, label: '200 Poin' }, { value: 500, label: '500 Poin (Klasik)' }],
    help: 'Jika dipilih, permainan selesai saat ada yang mencapai target (maks 10 deal)' },
  { key: 'stacking', label: 'Tumpuk +2/+4', type: 'boolean', help: 'Korban +2/+4 boleh membalas dengan +2/+4 sehingga hukuman menumpuk' },
  TURN_SECONDS_OPTION,
  PASS_AND_PLAY_OPTION,
];

const DEFAULTS: KartuWarnaOptions = { turnSeconds: 25, passAndPlay: false, deals: 1, target: 0, stacking: false };

/** Poin kartu sisa: angka = nominal, aksi = 20, wild = 50. */
export function kartuWarnaPoints(c: Card): number {
  const { color, value } = colorCardInfo(c);
  if (color === 'W') return 50;
  if (value === 'S' || value === 'R' || value === 'D') return 20;
  return Number(value);
}

const handPoints = (h: Card[]) => h.reduce((t, c) => t + kartuWarnaPoints(c), 0);
const top = (s: KartuWarnaState) => s.discard[s.discard.length - 1];
const isWild = (c: Card) => colorCardInfo(c).color === 'W';
const n = (s: KartuWarnaState) => s.names.length;
const step = (s: KartuWarnaState, from: number, k: number) => (((from + s.direction * k) % n(s)) + n(s)) % n(s);
const canDraw = (s: KartuWarnaState) => s.deck.length > 0 || s.discard.length > 1;

/** Wild +4 sah hanya bila tidak memegang kartu berwarna aktif. */
const w4Legal = (s: KartuWarnaState, hand: Card[]) => !hand.some(c => colorCardInfo(c).color === s.activeColor);

function canPlay(s: KartuWarnaState, hand: Card[], c: Card): boolean {
  const { color, value } = colorCardInfo(c);
  const t = colorCardInfo(top(s));
  if (s.pendingDraw > 0) {
    if (color === 'W') return value === '4' && w4Legal(s, hand);
    return value === 'D' && t.value === 'D';
  }
  if (color === 'W') return value === 'W' || w4Legal(s, hand);
  return color === s.activeColor || (t.color !== 'W' && value === t.value);
}

function playableCards(s: KartuWarnaState, seat: number): Card[] {
  const hand = s.hands[seat];
  if (s.drewThisTurn) return [hand[hand.length - 1]].filter(c => c !== undefined && canPlay(s, hand, c));
  return hand.filter(c => canPlay(s, hand, c));
}

function refillDeck(s: KartuWarnaState, rng: Rng) {
  if (s.deck.length > 0 || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.deck = shuffle(s.discard, rng);
  s.discard = [keep];
  pushLog(s.log, { seat: null, text: 'Tumpukan buangan dikocok menjadi deck baru.' });
}

/** Ambil k kartu (sebanyak yang tersedia). Kembalikan jumlah yang benar-benar diambil. */
function drawCards(s: KartuWarnaState, seat: number, k: number, rng: Rng): number {
  let got = 0;
  for (let i = 0; i < k; i++) {
    refillDeck(s, rng);
    if (!s.deck.length) break;
    s.hands[seat].push(s.deck.shift()!);
    got++;
  }
  return got;
}

function actionsFor(s: KartuWarnaState, seat: number | null): GActionSpec[] {
  if (s.over || seat === null || s.turn !== seat) return [];
  if (s.phase === 'color') {
    return U_COLORS.map(c => ({ id: `color:${c}`, label: `${COLOR_ICON[c]} ${U_COLOR_NAME[c]}`, style: 'primary' as const }));
  }
  if (s.phase !== 'play') return [];
  const acts: GActionSpec[] = [];
  const hand = s.hands[seat];
  if (playableCards(s, seat).length) {
    acts.push({ id: 'play', label: 'Mainkan', style: hand.length === 2 ? 'normal' : 'primary', cards: { min: 1, max: 1 } });
    if (hand.length === 2) {
      acts.push({ id: 'playOne', label: 'Mainkan + Satu Kartu!', style: 'primary', cards: { min: 1, max: 1 },
        hint: 'Wajib saat tersisa 1 kartu, kalau lupa ambil 2 kartu' });
    }
  }
  if (s.pendingDraw > 0) {
    acts.push({ id: 'take', label: `Ambil ${s.pendingDraw}`, style: 'danger', hint: 'Terima hukuman, giliranmu selesai' });
    return acts;
  }
  if (!s.drewThisTurn && canDraw(s)) acts.push({ id: 'draw', label: 'Ambil Kartu' });
  if (s.drewThisTurn || !canDraw(s)) acts.push({ id: 'pass', label: 'Lewat' });
  return acts;
}

function setTurn(s: KartuWarnaState, seat: number) {
  s.turn = seat;
  s.phase = 'play';
  s.drewThisTurn = false;
  s.turns += 1;
  s.turnDeadline = deadline(s.options.turnSeconds);
  if (s.turns >= MAX_TURNS) endDeal(s, null, 'Batas giliran tercapai — deal selesai tanpa pemenang.');
}

const isFinalDeal = (s: KartuWarnaState) =>
  s.options.target > 0
    ? Math.max(...s.scores) >= s.options.target || s.dealNo >= MAX_DEALS
    : s.dealNo >= s.options.deals;

function endDeal(s: KartuWarnaState, winner: number | null, why?: string) {
  s.dealWinner = winner;
  s.turn = null;
  s.turnDeadline = null;
  s.phase = 'dealEnd';
  s.pendingDraw = 0;
  s.drewThisTurn = false;
  if (winner !== null) {
    const pts = s.hands.reduce((t, h, i) => t + (i === winner ? 0 : handPoints(h)), 0);
    s.scores[winner] += pts;
    s.banner = `Deal ${s.dealNo}: ${s.names[winner]} menghabiskan kartu! +${pts} poin`;
    pushLog(s.log, { seat: winner, text: `🏆 ${s.banner}` });
  } else {
    s.banner = `Deal ${s.dealNo}: ${why ?? 'Permainan buntu — tanpa pemenang.'}`;
    pushLog(s.log, { seat: null, text: s.banner });
  }
  if (isFinalDeal(s)) {
    s.over = true;
    const best = Math.max(...s.scores);
    const multi = s.options.target > 0 || s.options.deals > 1;
    if (multi) pushLog(s.log, { seat: null, text: `Permainan selesai — skor tertinggi ${best} poin.` });
  }
}

/** Efek kartu yang baru dimainkan (warna aktif sudah ditetapkan). */
function applyEffect(s: KartuWarnaState, seat: number, card: Card, rng: Rng) {
  const { value } = colorCardInfo(card);
  const next = step(s, seat, 1);
  if (value === 'S') {
    pushLog(s.log, { seat: next, text: `${s.names[next]} dilewati` });
    setTurn(s, step(s, seat, 2));
  } else if (value === 'R') {
    s.direction = s.direction === 1 ? -1 : 1;
    if (n(s) === 2) {
      pushLog(s.log, { seat: next, text: `Arah berbalik — ${s.names[next]} dilewati` });
      setTurn(s, seat);
    } else {
      pushLog(s.log, { seat: null, text: `Arah berbalik ${s.direction === 1 ? '⟳' : '⟲'}` });
      setTurn(s, step(s, seat, 1));
    }
  } else if (value === 'D' || value === '4') {
    const k = value === 'D' ? 2 : 4;
    if (s.options.stacking) {
      s.pendingDraw += k;
      setTurn(s, next);
    } else {
      const got = drawCards(s, next, k, rng);
      pushLog(s.log, { seat: next, text: `${s.names[next]} mengambil ${got} kartu dan dilewati` });
      setTurn(s, step(s, seat, 2));
    }
  } else {
    setTurn(s, next);
  }
}

function startDeal(s: KartuWarnaState, rng: Rng) {
  const deck = shuffle(colorDeck(), rng);
  s.hands = s.names.map(() => deck.splice(0, HAND_SIZE));
  let first = deck.shift()!;
  while (isWild(first)) {
    deck.push(first);
    const re = shuffle(deck, rng);
    deck.length = 0;
    deck.push(...re);
    first = deck.shift()!;
  }
  s.deck = deck;
  s.discard = [first];
  s.activeColor = colorCardInfo(first).color as UColor;
  s.direction = 1;
  s.pendingDraw = 0;
  s.drewThisTurn = false;
  s.passes = 0;
  s.turns = 0;
  s.dealWinner = null;
  s.banner = null;
  s.phase = 'play';
  const d = s.dealer;
  pushLog(s.log, { seat: null, text: `Deal ${s.dealNo} dimulai. Kartu pembuka: ${colorCardLabel(first)}.` });
  const { value } = colorCardInfo(first);
  const p1 = step(s, d, 1);
  if (value === 'S') {
    pushLog(s.log, { seat: p1, text: `${s.names[p1]} dilewati (kartu pembuka)` });
    setTurn(s, step(s, d, 2));
  } else if (value === 'R') {
    s.direction = -1;
    pushLog(s.log, { seat: d, text: `Kartu pembuka Balik — ${s.names[d]} (dealer) jalan duluan ⟲` });
    setTurn(s, d);
  } else if (value === 'D') {
    const got = drawCards(s, p1, 2, rng);
    pushLog(s.log, { seat: p1, text: `${s.names[p1]} mengambil ${got} kartu dan dilewati (kartu pembuka)` });
    setTurn(s, step(s, d, 2));
  } else {
    setTurn(s, p1);
  }
}

function nextSeatHint(s: KartuWarnaState): number | null {
  if (s.over || s.phase === 'dealEnd' || s.turn === null) return null;
  return step(s, s.turn, 1);
}

function mostHeldColor(hand: Card[], rng: Rng | null): UColor {
  const counts: Record<string, number> = { R: 0, Y: 0, G: 0, B: 0 };
  for (const c of hand) {
    const { color } = colorCardInfo(c);
    if (color !== 'W') counts[color] += 1 + kartuWarnaPoints(c) / 100;
  }
  const best = Math.max(...Object.values(counts));
  const tops = U_COLORS.filter(c => counts[c] === best);
  return tops[rng ? rng.int(tops.length) : 0];
}

export const kartuWarna: GameModule<KartuWarnaState, GenericAction, GenericView, KartuWarnaOptions> = {
  id: 'kartu-warna',
  minPlayers: 2,
  maxPlayers: 8,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const deals = Number(r.deals);
    const target = Number(r.target);
    return {
      turnSeconds: sanitizeTurnSeconds(r.turnSeconds),
      passAndPlay: Boolean(r.passAndPlay),
      deals: deals === 3 || deals === 5 ? deals : 1,
      target: target === 200 || target === 500 ? target : 0,
      stacking: r.stacking === true || r.stacking === 'true',
    };
  },

  setup(seats: SeatInfo[], options, rng) {
    if (seats.length < 2 || seats.length > 8) throw new RuleError('Kartu Warna butuh 2–8 pemain');
    const s: KartuWarnaState = {
      gameId: 'kartu-warna', options,
      names: seats.map(p => p.name), bots: seats.map(p => !!p.isBot),
      hands: [], deck: [], discard: [], activeColor: 'R', direction: 1, phase: 'play',
      turn: null, dealer: rng.int(seats.length), drewThisTurn: false, pendingDraw: 0, passes: 0, turns: 0,
      scores: seats.map(() => 0), dealNo: 1, dealWinner: null, banner: null,
      over: false, log: [], turnDeadline: null,
    };
    startDeal(s, rng);
    return s;
  },

  currentSeat: s => (s.over || s.phase === 'dealEnd' ? null : s.turn),

  apply(state, seat, raw, rng) {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.phase === 'dealEnd') throw new RuleError('Deal sudah selesai');
    if (state.turn !== seat) throw new RuleError('Bukan giliranmu');
    const a = parseAction(raw);
    const spec = requireAction(actionsFor(state, seat), a.id);
    const s = clone(state);
    const name = s.names[seat];
    const hand = s.hands[seat];

    if (spec.id.startsWith('color:')) {
      s.activeColor = spec.id.slice(6) as UColor;
      pushLog(s.log, { seat, text: `${name} memilih warna ${U_COLOR_NAME[s.activeColor]} ${COLOR_ICON[s.activeColor]}` });
      applyEffect(s, seat, top(s), rng);
      return s;
    }
    if (spec.id === 'take') {
      const k = s.pendingDraw;
      s.pendingDraw = 0;
      const got = drawCards(s, seat, k, rng);
      s.passes = 0;
      pushLog(s.log, { seat, text: `${name} mengambil ${got} kartu (hukuman) dan gilirannya selesai` });
      setTurn(s, step(s, seat, 1));
      return s;
    }
    if (spec.id === 'draw') {
      drawCards(s, seat, 1, rng);
      s.passes = 0;
      const c = hand[hand.length - 1];
      if (canPlay(s, hand, c)) {
        s.drewThisTurn = true;
        pushLog(s.log, { seat, text: `${name} mengambil 1 kartu` });
      } else {
        pushLog(s.log, { seat, text: `${name} mengambil 1 kartu dan lewat` });
        setTurn(s, step(s, seat, 1));
      }
      return s;
    }
    if (spec.id === 'pass') {
      s.passes += 1;
      pushLog(s.log, { seat, text: `${name} lewat` });
      if (s.passes >= n(s) && !canDraw(s)) { endDeal(s, null); return s; }
      setTurn(s, step(s, seat, 1));
      return s;
    }
    // play / playOne
    const called = spec.id === 'playOne';
    const [card] = takeCards(hand, a.cards, 1, 1);
    if (!playableCards(s, seat).includes(card)) {
      const info = colorCardInfo(card);
      throw new RuleError(
        s.drewThisTurn ? 'Setelah mengambil, hanya kartu yang baru diambil yang boleh dimainkan'
          : s.pendingDraw > 0 ? 'Balas dengan +2/+4, atau ambil hukuman'
          : info.color === 'W' && info.value === '4' ? `Wild +4 hanya boleh jika kamu tidak punya kartu ${U_COLOR_NAME[s.activeColor]}`
          : `Kartu harus ${U_COLOR_NAME[s.activeColor]} atau angka/simbol yang sama`);
    }
    removeCards(hand, [card]);
    s.discard.push(card);
    s.passes = 0;
    s.drewThisTurn = false;
    pushLog(s.log, { seat, text: `${name} memainkan ${colorCardLabel(card)}` });
    const info = colorCardInfo(card);

    if (hand.length === 0) {
      // Kartu terakhir +2/+4 tetap berlaku untuk pemain berikutnya (dihitung ke poin).
      const k = s.pendingDraw + (info.value === 'D' ? 2 : info.value === '4' ? 4 : 0);
      if (k > 0) {
        const victim = step(s, seat, 1);
        const got = drawCards(s, victim, k, rng);
        pushLog(s.log, { seat: victim, text: `${s.names[victim]} mengambil ${got} kartu` });
      }
      endDeal(s, seat);
      return s;
    }
    if (hand.length === 1) {
      if (called) pushLog(s.log, { seat, text: `📣 ${name}: "Satu Kartu!"` });
      else {
        const got = drawCards(s, seat, 2, rng);
        pushLog(s.log, { seat, text: `${name} lupa bilang "Satu Kartu!" — ambil ${got} kartu (penalti)` });
      }
    }
    if (info.color === 'W') {
      s.phase = 'color';
      s.turnDeadline = deadline(s.options.turnSeconds);
      return s;
    }
    s.activeColor = info.color;
    applyEffect(s, seat, card, rng);
    return s;
  },

  autoDelay: s => (!s.over && s.phase === 'dealEnd' ? DEAL_PAUSE : null),

  advance(state, rng) {
    if (state.over || state.phase !== 'dealEnd') return state;
    const s = clone(state);
    s.dealNo += 1;
    s.dealer = (s.dealer + 1) % n(s);
    startDeal(s, rng);
    return s;
  },

  timeoutAction(s, seat) {
    if (s.phase === 'color') return { type: 'act', id: `color:${mostHeldColor(s.hands[seat], null)}` };
    if (s.pendingDraw > 0) return { type: 'act', id: 'take' };
    if (s.drewThisTurn) return { type: 'act', id: 'pass' };
    const p = playableCards(s, seat);
    if (p.length) return { type: 'act', id: s.hands[seat].length === 2 ? 'playOne' : 'play', cards: [p[0]] };
    if (canDraw(s)) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  view(s, seat) {
    const me = seat !== null && seat >= 0 && seat < s.hands.length ? seat : null;
    const nextSeat = nextSeatHint(s);
    const multi = s.options.target > 0 || s.options.deals > 1;
    const t = top(s);
    const myTurn = me !== null && s.turn === me && !s.over && s.phase !== 'dealEnd';
    const badges = [
      `Warna: ${COLOR_ICON[s.activeColor]} ${U_COLOR_NAME[s.activeColor]}`,
      `Arah: ${s.direction === 1 ? '⟳' : '⟲'}`,
    ];
    if (s.pendingDraw > 0) badges.push(`Tumpukan +${s.pendingDraw}`);
    if (s.options.target > 0) badges.push(`Deal ${s.dealNo} · Target ${s.options.target}`);
    else if (s.options.deals > 1) badges.push(`Deal ${s.dealNo}/${s.options.deals}`);
    return {
      gameId: 'kartu-warna',
      generic: true,
      you: me,
      turn: s.over || s.phase === 'dealEnd' ? null : s.turn,
      over: s.over,
      log: s.log.slice(-30),
      results: kartuWarna.results(s),
      players: s.names.map((name, i) => ({
        name, isBot: s.bots[i], count: s.hands[i].length,
        score: multi || s.over ? `${s.scores[i]} pt` : undefined,
        status: s.dealWinner === i && s.phase === 'dealEnd' ? 'Habis! 🏆'
          : s.phase === 'dealEnd' ? `Sisa ${handPoints(s.hands[i])} poin`
          : s.hands[i].length === 1 ? 'Satu Kartu! 📣' : undefined,
        tag: nextSeat === i ? 'Berikut' : undefined,
      })),
      hand: me !== null ? s.hands[me].slice() : [],
      piles: [
        { id: 'deck', label: 'Deck', cards: s.deck.length ? [null] : [], count: s.deck.length },
        { id: 'discard', label: 'Buangan', cards: [t], count: s.discard.length, highlight: true,
          caption: isWild(t) ? `Warna: ${COLOR_ICON[s.activeColor]} ${U_COLOR_NAME[s.activeColor]}` : undefined },
      ],
      actions: actionsFor(s, me),
      playable: myTurn && s.phase === 'play' ? playableCards(s, me!) : [],
      prompt: s.over ? 'Permainan selesai'
        : s.phase === 'dealEnd' ? 'Deal selesai — deal berikutnya segera dimulai'
        : !myTurn ? `Menunggu ${s.names[s.turn ?? 0]}…`
        : s.phase === 'color' ? 'Pilih warna baru'
        : s.pendingDraw > 0 ? `Balas dengan +2/+4 atau ambil ${s.pendingDraw} kartu`
        : s.drewThisTurn ? 'Mainkan kartu yang baru diambil, atau lewat'
        : `Mainkan kartu ${U_COLOR_NAME[s.activeColor]} atau simbol yang sama — Wild bebas`,
      badges,
      banner: s.banner,
    };
  },

  bot(v, difficulty: Difficulty, rng) {
    const ids = v.actions.map(a => a.id);
    if (ids.some(i => i.startsWith('color:'))) {
      if (difficulty === 'easy' && rng.float() < 0.5) return { type: 'act', id: `color:${U_COLORS[rng.int(4)]}` };
      return { type: 'act', id: `color:${mostHeldColor(v.hand, rng)}` };
    }
    const playable = v.playable ?? [];
    const callId = ids.includes('playOne') ? 'playOne' : 'play';
    const playId = () => (callId === 'playOne' && difficulty === 'easy' && rng.float() < 0.3 ? 'play' : callId);
    if (playable.length && ids.includes('play')) {
      if (difficulty === 'easy') return { type: 'act', id: playId(), cards: [playable[rng.int(playable.length)]] };
      const nextIdx = v.players.findIndex(p => p.tag === 'Berikut');
      const danger = nextIdx >= 0 && v.players[nextIdx].count <= 2;
      const fav = mostHeldColor(v.hand, null);
      const score = (c: Card) => {
        const { color, value } = colorCardInfo(c);
        if (color === 'W') {
          // Simpan wild untuk nanti, kecuali lawan berikut hampir menang.
          if (value === '4') return danger ? 90 : v.hand.length <= 2 ? 5 : -40;
          return v.hand.length <= 2 ? 6 : -30;
        }
        const action = value === 'S' || value === 'D' || (value === 'R' && v.players.length === 2);
        let sc = kartuWarnaPoints(c) / 4 + (color === fav ? 3 : 0);
        if (action) sc += danger ? 60 : value === 'D' ? 4 : 2;
        return sc;
      };
      const pick = playable.slice().sort((a, b) => score(b) - score(a))[0];
      // Tidak ada kartu berwarna yang sah & lawan aman → lebih baik ambil daripada buang wild terlalu dini (hard).
      if (difficulty === 'hard' && score(pick) < -35 && ids.includes('draw') && v.hand.length > 4) return { type: 'act', id: 'draw' };
      return { type: 'act', id: playId(), cards: [pick] };
    }
    if (ids.includes('take')) return { type: 'act', id: 'take' };
    if (ids.includes('draw')) return { type: 'act', id: 'draw' };
    return { type: 'act', id: 'pass' };
  },

  isOver: s => s.over,

  results(s): SeatResult[] | null {
    if (!s.over) return null;
    const keyed = s.names.map((_, seat) => ({ seat, score: s.scores[seat], pen: handPoints(s.hands[seat]), cards: s.hands[seat].length }));
    const order = keyed.slice().sort((a, b) => b.score - a.score || a.pen - b.pen || a.cards - b.cards);
    let rank = 0;
    let prev: (typeof order)[number] | null = null;
    return order.map((o, k) => {
      if (!prev || o.score !== prev.score || o.pen !== prev.pen || o.cards !== prev.cards) rank = k + 1;
      prev = o;
      return { seat: o.seat, rank, score: o.score };
    });
  },
};
