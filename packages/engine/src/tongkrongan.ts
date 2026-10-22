// tongkrongan.ts — Poker Tongkrongan (permainan shedding 4 pemain khas tongkrongan).
//
// Aturan:
//  1. 4 pemain, 52 kartu remi tanpa Joker, masing-masing mendapat 13 kartu (terbagi habis).
//  2. Tujuan: menghabiskan seluruh kartu di tangan secepat mungkin.
//  3. Pemain pembuka ronde bebas mengeluarkan kombinasi sah:
//     - Single (1 kartu)
//     - Pair (2 kartu bernilai sama)
//     - Three of a Kind (3 kartu bernilai sama)
//     - 5 Kartu: Straight, Flush, Full House, Four of a Kind, Straight Flush, Royal Flush.
//  4. Pemain berikutnya searah jarum jam harus Lawan (kombinasi sama banyak & lebih tinggi) atau Skip.
//  5. Aturan Tiga Kali Skip: Jika semua pemain aktif lainnya Skip berturut-turut, ronde selesai.
//     Pemain terakhir yang melempar kartu memenangkan ronde dan memimpin ronde baru dengan kombinasi bebas.
//  6. Timer 15 detik per giliran. Jika waktu habis, sistem otomatis melakukan Skip (atau lempar kartu terendah jika memimpin).
//  7. Pemain yang habis kartunya keluar dan mendapat peringkat (1, 2, 3). Permainan lanjut sampai tersisa 1 pemain yang kalah (peringkat 4).
//  8. Aturan Kartu Angka 3:
//     - Ronde 1: Pemegang kartu 3 terendah (3♦ Wajik) memimpin giliran pertama dan WAJIB memainkan kombinasi yang menyertakan kartu angka 3.
//     - Ronde Selanjutnya: TIDAK PERLU lagi kartu angka 3. Pemimpin ronde baru adalah pemenang di ronde sebelumnya dan bebas mengeluarkan kartu apa saja.

import { 
  type Card, 
  rankOf, 
  suitOf, 
  cardLabel, 
  shuffledDeck, 
  type Suit 
} from './cards';
import type { Rng } from './rng';
import {
  type BaseView, 
  type Difficulty, 
  type GameModule, 
  type LogEntry, 
  type OptionSpec,
  type SeatInfo, 
  type SeatResult, 
  RuleError, 
  clampInt, 
  clone, 
  pushLog 
} from './types';

export type ComboType = 
  | 'single'
  | 'pair'
  | 'triple'
  | 'straight'
  | 'flush'
  | 'fullhouse'
  | 'quads'
  | 'straightflush'
  | 'royalflush'
  | 'bomb';

const SUIT_POWER: Record<Suit, number> = {
  S: 4, // ♠ Sekop (tertinggi)
  H: 3, // ♥ Hati
  C: 2, // ♣ Keriting
  D: 1, // ♦ Wajik (terendah)
};

const FIVE_CARD_CATEGORY_POWER: Record<ComboType, number> = {
  single: 0,
  pair: 0,
  triple: 0,
  straight: 1,
  flush: 2,
  fullhouse: 3,
  quads: 4,
  straightflush: 5,
  royalflush: 6,
  bomb: 0,
};

export interface TongkronganCombo {
  type: ComboType;
  cards: Card[];
  count: number;
  score: number;
  description: string;
}

export type TongkronganAction =
  | { type: 'play'; cards: Card[] }
  | { type: 'skip' }
  | { type: 'discard3'; cards?: Card[] };

export interface TongkronganOptions {
  passAndPlay: boolean;
  turnSeconds: number;
  /** Nomor ronde dalam seri pertandingan. Default 1. */
  round?: number;
  /** Kursi pemenang (Juara 1) dari ronde sebelumnya. */
  previousWinner?: number | null;
  /** Aturan kartu 3 di awal: buang semua kartu 3 atau hanya pemegang 3 sekop. */
  openingRule?: 'discard_all' | 'spade3_only';
  /** Bom 4 angka sama dapat membalas kartu 2 tunggal dan reset ronde. */
  allowBombReset?: boolean;
  /** Dilarang menyisakan kartu 2/poker di akhir penutup (kalah ke-4). */
  forbidPokerLast?: boolean;
  /** Multiplier penalti poin kartu sisa di tangan yang kalah. */
  penaltyMultiplier?: 'standard' | 'double_twos' | 'extreme';
  /** Urutkan kartu otomatis dari kecil ke besar di tangan. */
  autoSortHand?: boolean;
  /** Beri sorotan visual rekomendasi kombinasi kartu yang sah. */
  showHints?: boolean;
}

export interface TongkronganState {
  gameId: 'tongkrongan';
  /** Tahap permainan: 'discard3' (hanya di ronde 1) atau 'play'. */
  phase: 'discard3' | 'play';
  /** Nomor ronde dalam seri pertandingan. */
  round: number;
  /** Pemenang (Juara 1) dari ronde sebelumnya. */
  previousWinner: number | null;
  /** Daftar pemain yang belum membuang kartu 3 di tahap discard3 ronde 1. */
  pendingDiscard3: number[];
  /** Riwayat kartu 3 yang dikeluarkan para pemain ke meja di ronde 1. */
  discards3: {
    seat: number;
    cards: Card[];
  }[];
  options: TongkronganOptions;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  currentCombo: TongkronganCombo | null;
  lastPlaySeat: number | null;
  consecutiveSkips: number;
  turn: number | null;
  finished: number[]; // seats in finish order (first element = rank 1)
  /** Kursi pemain yang dihukum menjadi Peringkat 4 karena menutup dengan kartu 2. */
  penalizedRank4: number[];
  log: LogEntry[];
  over: boolean;
  turnDeadline: number | null;
  /** Info pembuka: pemegang 3♠ yang memimpin ronde pertama. */
  opening: {
    seat: number;
    card: Card;
    discards?: {
      seat: number;
      cards: Card[];
    }[];
  } | null;
}

export interface TongkronganView extends BaseView {
  gameId: 'tongkrongan';
  phase: 'discard3' | 'play';
  round: number;
  previousWinner: number | null;
  pendingDiscard3: number[];
  discards3: {
    seat: number;
    cards: Card[];
  }[];
  names: string[];
  bots: boolean[];
  handCounts: number[];
  hand: Card[];
  currentCombo: TongkronganCombo | null;
  lastPlaySeat: number | null;
  consecutiveSkips: number;
  skipsNeeded: number;
  finished: number[];
  /** Kursi pemain yang dihukum menjadi Peringkat 4 karena menutup dengan kartu 2. */
  penalizedRank4: number[];
  passAndPlay: boolean;
  turnSeconds: number;
  /** Info pembuka: pemegang 3♠ yang memimpin ronde pertama. */
  opening: {
    seat: number;
    card: Card;
    discards?: {
      seat: number;
      cards: Card[];
    }[];
  } | null;
  legal: {
    canPlay: boolean;
    canSkip: boolean;
    canDiscard3: boolean;
  };
}

/** Kartu penentu pembuka: pemain yang mengeluarkan 3♠ (3 of Spades) memimpin ronde pertama. */
export const OPENING_CARD: Card = '3S';
export const OPENING_RANK = 3;

const DEFAULTS: TongkronganOptions = {
  passAndPlay: false,
  turnSeconds: 15,
  round: 1,
  previousWinner: null,
  openingRule: 'discard_all',
  allowBombReset: true,
  forbidPokerLast: true,
  penaltyMultiplier: 'standard',
  autoSortHand: true,
  showHints: true,
};

const OPTIONS: OptionSpec[] = [
  { key: 'passAndPlay', label: 'Mode Operan HP (4 Pemain Lokal)', type: 'boolean', help: 'Tampilkan layar privasi serahkan HP sebelum giliran berikutnya' },
  {
    key: 'turnSeconds',
    label: 'Batas Waktu Giliran',
    type: 'select',
    choices: [
      { value: 0, label: '♾️ Tanpa Batas Waktu (Santai)' },
      { value: 10, label: '10 Detik (Kilat)' },
      { value: 15, label: '15 Detik (Standar Tongkrongan)' },
      { value: 20, label: '20 Detik (Santai)' },
      { value: 30, label: '30 Detik (Mikir Panjang)' },
    ],
    help: 'Waktu berpikir tiap giliran sebelum otomatis skip atau jalan'
  },
  {
    key: 'openingRule',
    label: 'Aturan Kartu 3 di Ronde 1',
    type: 'select',
    choices: [
      { value: 'discard_all', label: 'Wajib Buka Semua Kartu 3 (Rekomendasi Tongkrongan)' },
      { value: 'spade3_only', label: 'Tradisional (Hanya Pemegang 3♠ Buka Meja)' },
    ],
    help: 'Cara penentuan giliran pertama saat pertandingan ronde 1 dimulai'
  },
  {
    key: 'allowBombReset',
    label: 'Bom 4 Angka Sama (Four of a Kind)',
    type: 'boolean',
    help: 'Kombinasi 4 kartu sama dapat membalas kartu 2 poker tunggal & me-reset ronde dari awal'
  },
  {
    key: 'forbidPokerLast',
    label: 'Larangan Kartu 2/Poker di Akhir',
    type: 'boolean',
    help: 'Kartu 2 (poker) dilarang dikeluarkan saat kartu tersisa 1-2 atau jadi kartu penutup (auto kalah ke-4)'
  },
  {
    key: 'penaltyMultiplier',
    label: 'Sistem Penalti Poin Kartu Sisa',
    type: 'select',
    choices: [
      { value: 'standard', label: 'Standar (1 Poin per Kartu)' },
      { value: 'double_twos', label: 'Kartu 2 Dihitung Dobel (x2 Poin Denda)' },
      { value: 'extreme', label: 'Hangus (>10 Kartu Kena Denda Dobel)' },
    ],
    help: 'Aturan perhitungan poin denda kartu yang tersisa di tangan pemain yang kalah'
  },
  {
    key: 'showHints',
    label: 'Asisten Kombinasi (Smart Hint)',
    type: 'boolean',
    help: 'Sorot otomatis rekomendasi kombinasi kartu sah yang bisa melawan meja'
  },
  {
    key: 'autoSortHand',
    label: 'Urutkan Kartu Otomatis',
    type: 'boolean',
    help: 'Otomatis rapikan susunan kartu tangan dari terendah (3) hingga terkuat (2)'
  },
];

/**
 * Nilai kekuatan kartu dalam Poker Tongkrongan:
 * Angka 2 adalah kartu poker terbesar!
 * Urutan nilai: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J (11) < Q (12) < K (13) < As (14) < 2 (15)
 */
export function tongkronganRank(card: Card): number {
  const r = rankOf(card);
  return r === 2 ? 15 : r;
}

/** Hitung skor kartu tunggal: (tongkronganRank * 10) + suitPower. 2♠ adalah kartu terbesar! */
export function cardScore(card: Card): number {
  return tongkronganRank(card) * 10 + SUIT_POWER[suitOf(card)];
}

/** Urutkan kartu dari terendah ke tertinggi (3♦ terendah ... 2♠ tertinggi) */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => cardScore(a) - cardScore(b));
}

/** Cek apakah 5 kartu membentuk Straight. Return high card atau null */
function checkStraight(cards: Card[]): { isStraight: boolean; highCard: Card } | null {
  if (cards.length !== 5) return null;
  const rawRanks = cards.map(rankOf);
  const unique = new Set(rawRanks);
  if (unique.size !== 5) return null;

  // Case A: J-Q-K-A-2 (ranks 2, 11, 12, 13, 14) -> 2 adalah kartu tertinggi!
  if (unique.has(2) && unique.has(11) && unique.has(12) && unique.has(13) && unique.has(14)) {
    const card2 = cards.find(c => rankOf(c) === 2)!;
    return { isStraight: true, highCard: card2 };
  }

  // Case B: A-2-3-4-5 (ranks 2, 3, 4, 5, 14) -> 5 adalah kartu tertinggi! (Wheel)
  if (unique.has(14) && unique.has(2) && unique.has(3) && unique.has(4) && unique.has(5)) {
    const card5 = cards.find(c => rankOf(c) === 5)!;
    return { isStraight: true, highCard: card5 };
  }

  // Case C: 2-3-4-5-6 (ranks 2, 3, 4, 5, 6) -> 6 adalah kartu tertinggi!
  if (unique.has(2) && unique.has(3) && unique.has(4) && unique.has(5) && unique.has(6)) {
    const card6 = cards.find(c => rankOf(c) === 6)!;
    return { isStraight: true, highCard: card6 };
  }

  // Case D: Consecutive standard 3..14 (3-4-5-6-7 s.d. 10-J-Q-K-A)
  const sorted = [...cards].sort((a, b) => rankOf(a) - rankOf(b));
  const rSorted = sorted.map(rankOf);
  if (rSorted[4] - rSorted[0] === 4) {
    return { isStraight: true, highCard: sorted[4] };
  }

  return null;
}

/** Evaluasi kombinasi kartu Tongkrongan. Mengembalikan null jika kombinasi tidak sah. */
export function evaluateCombo(rawCards: Card[]): TongkronganCombo | null {
  if (!rawCards || rawCards.length === 0) return null;
  const cards = sortCards(rawCards);
  const n = cards.length;

  // 1. Single (1 kartu)
  if (n === 1) {
    const c = cards[0];
    return {
      type: 'single',
      cards,
      count: 1,
      score: cardScore(c),
      description: `Single ${cardLabel(c)}`,
    };
  }

  // 2. Pair (2 kartu bernilai sama)
  if (n === 2) {
    if (rankOf(cards[0]) === rankOf(cards[1])) {
      const highestCard = cardScore(cards[0]) > cardScore(cards[1]) ? cards[0] : cards[1];
      const rankPower = tongkronganRank(cards[0]);
      return {
        type: 'pair',
        cards,
        count: 2,
        score: rankPower * 100 + SUIT_POWER[suitOf(highestCard)],
        description: `Pair ${cardLabel(cards[0]).slice(0, -1)}`,
      };
    }
    return null;
  }

  // 3. Three of a Kind (3 kartu bernilai sama)
  if (n === 3) {
    if (rankOf(cards[0]) === rankOf(cards[1]) && rankOf(cards[1]) === rankOf(cards[2])) {
      return {
        type: 'triple',
        cards,
        count: 3,
        score: tongkronganRank(cards[0]),
        description: `Three of a Kind ${cardLabel(cards[0]).slice(0, -1)}`,
      };
    }
    return null;
  }

  // 4. Bom (4 kartu kembar murni — senjata pamungkas penakluk kartu 2!)
  if (n === 4) {
    if (
      rankOf(cards[0]) === rankOf(cards[1]) &&
      rankOf(cards[1]) === rankOf(cards[2]) &&
      rankOf(cards[2]) === rankOf(cards[3])
    ) {
      const quadRank = rankOf(cards[0]);
      const quadPower = quadRank === 2 ? 15 : quadRank;
      const rankName = quadRank === 2 ? '2' : quadRank === 14 ? 'As' : quadRank === 13 ? 'K' : quadRank === 12 ? 'Q' : quadRank === 11 ? 'J' : `${quadRank}`;
      return {
        type: 'bomb',
        cards,
        count: 4,
        score: quadPower * 1000,
        description: `Bom 4 Kartu ${rankName} 💣`,
      };
    }
    return null;
  }

  // 5. Kombinasi 5 Kartu Poker
  if (n === 5) {
    const ranks = cards.map(rankOf);
    const suits = cards.map(suitOf);

    const rankCounts: Record<number, number> = {};
    for (const r of ranks) {
      rankCounts[r] = (rankCounts[r] || 0) + 1;
    }
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const isFlush = suits.every(s => s === suits[0]);
    const straightInfo = checkStraight(cards);

    // 5A. Royal Flush: 10-J-Q-K-As sama kembang
    if (isFlush && straightInfo?.isStraight && rankOf(straightInfo.highCard) === 14 && ranks.includes(10)) {
      const suitVal = SUIT_POWER[suits[0]];
      return {
        type: 'royalflush',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.royalflush * 10000000 + suitVal,
        description: `Royal Flush ${suits[0]}`,
      };
    }

    // 5B. Straight Flush: 5 kartu berurutan sama jenis
    if (isFlush && straightInfo?.isStraight) {
      const highCard = straightInfo.highCard;
      return {
        type: 'straightflush',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.straightflush * 10000000 + cardScore(highCard),
        description: `Straight Flush ${cardLabel(highCard)}`,
      };
    }

    // 5C. Four of a Kind (4 kartu kembar + 1 kicker)
    if (counts[0] === 4) {
      const quadRank = Number(Object.keys(rankCounts).find(k => rankCounts[Number(k)] === 4));
      const quadPower = quadRank === 2 ? 15 : quadRank;
      return {
        type: 'quads',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.quads * 10000000 + quadPower * 100,
        description: `Four of a Kind ${quadRank === 2 ? '2' : quadRank === 14 ? 'As' : quadRank}`,
      };
    }

    // 5D. Full House (3 kartu kembar + 2 kartu kembar)
    if (counts[0] === 3 && counts[1] === 2) {
      const tripleRank = Number(Object.keys(rankCounts).find(k => rankCounts[Number(k)] === 3));
      const pairRank = Number(Object.keys(rankCounts).find(k => rankCounts[Number(k)] === 2));
      const triplePower = tripleRank === 2 ? 15 : tripleRank;
      const pairPower = pairRank === 2 ? 15 : pairRank;
      return {
        type: 'fullhouse',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.fullhouse * 10000000 + triplePower * 100 + pairPower,
        description: `Full House ${tripleRank === 2 ? '2' : tripleRank === 14 ? 'As' : tripleRank}`,
      };
    }

    // 5E. Flush (5 kartu jenis sama)
    if (isFlush) {
      const suitVal = SUIT_POWER[suits[0]];
      const highestCard = cards[cards.length - 1];
      return {
        type: 'flush',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.flush * 10000000 + suitVal * 10000 + cardScore(highestCard),
        description: `Flush ${suits[0]}`,
      };
    }

    // 5F. Straight (5 kartu berurutan)
    if (straightInfo?.isStraight) {
      const highCard = straightInfo.highCard;
      return {
        type: 'straight',
        cards,
        count: 5,
        score: FIVE_CARD_CATEGORY_POWER.straight * 10000000 + cardScore(highCard),
        description: `Straight ${cardLabel(highCard)}`,
      };
    }
  }

  // Kombinasi tidak dikenal atau panjang tidak sesuai
  return null;
}

/** Cek apakah combo A dapat mengalahkan combo B di meja */
export function comboBeats(a: TongkronganCombo, b: TongkronganCombo): boolean {
  // ATURAN BOM:
  // - Bom 4 kartu mengalahkan kartu Single 2 (angka 2 adalah kartu poker tertinggi).
  // - Bom 4 kartu mengalahkan Bom lain dengan nilai lebih rendah.
  if (a.type === 'bomb') {
    if (b.type === 'single' && rankOf(b.cards[0]) === 2) {
      return true;
    }
    if (b.type === 'bomb') {
      return a.score > b.score;
    }
    return false;
  }

  // Jika meja adalah Bom, hanya Bom lebih tinggi yang bisa melawannya
  if (b.type === 'bomb') {
    return false;
  }

  if (a.count !== b.count) return false;

  // Single, Pair, Triple: jenis combo harus sama persis
  if (a.count === 1 || a.count === 2 || a.count === 3) {
    if (a.type !== b.type) return false;
    return a.score > b.score;
  }

  // 5-Card Hands: Kategori lebih tinggi otomatis mengalahkan kategori lebih rendah
  if (a.count === 5) {
    const powerA = FIVE_CARD_CATEGORY_POWER[a.type];
    const powerB = FIVE_CARD_CATEGORY_POWER[b.type];
    if (powerA > powerB) return true;
    if (powerA < powerB) return false;
    return a.score > b.score;
  }

  return false;
}

const active = (s: TongkronganState, seat: number) => 
  s.hands[seat].length > 0 && !s.finished.includes(seat) && !s.penalizedRank4.includes(seat);

function activeSeats(s: TongkronganState): number[] {
  return [0, 1, 2, 3].filter(seat => active(s, seat));
}

function nextActiveSeat(s: TongkronganState, fromSeat: number): number | null {
  for (let step = 1; step <= 4; step++) {
    const seat = (fromSeat + step) % 4;
    if (active(s, seat)) return seat;
  }
  return null;
}

/** Cari pemain yang memegang kartu angka 3 terendah (prioritas: 3♦) */
function findStarter(hands: Card[][]): { seat: number; card: Card } {
  // Prioritas 1: 3♦ Wajik (kartu terendah absolut di deck)
  for (let i = 0; i < 4; i++) {
    if (hands[i].includes('3D')) return { seat: i, card: '3D' };
  }
  // Prioritas 2: 3♣, 3♥, 3♠
  for (const c of ['3C', '3H', '3S'] as Card[]) {
    for (let i = 0; i < 4; i++) {
      if (hands[i].includes(c)) return { seat: i, card: c };
    }
  }
  // Fallback: kartu terendah dari seluruh pemain
  let lowestSeat = 0;
  let lowestCard = hands[0][0];
  for (let i = 0; i < 4; i++) {
    for (const c of hands[i]) {
      if (cardScore(c) < cardScore(lowestCard)) {
        lowestCard = c;
        lowestSeat = i;
      }
    }
  }
  return { seat: lowestSeat, card: lowestCard };
}

export const tongkrongan: GameModule<TongkronganState, TongkronganAction, TongkronganView, TongkronganOptions> = {
  id: 'tongkrongan',
  minPlayers: 4,
  maxPlayers: 4,
  defaultOptions: DEFAULTS,
  options: OPTIONS,

  sanitizeOptions(raw: unknown): TongkronganOptions {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const round = typeof r.round === 'number' && r.round >= 1 ? Math.floor(r.round) : 1;
    const prevWinner = typeof r.previousWinner === 'number' && r.previousWinner >= 0 && r.previousWinner < 4 
      ? Math.floor(r.previousWinner) 
      : null;
    return {
      passAndPlay: Boolean(r.passAndPlay),
      turnSeconds: Number(r.turnSeconds) === 0 ? 0 : clampInt(r.turnSeconds, 10, 60, DEFAULTS.turnSeconds),
      round,
      previousWinner: prevWinner,
      openingRule: r.openingRule === 'spade3_only' ? 'spade3_only' : 'discard_all',
      allowBombReset: r.allowBombReset !== undefined ? Boolean(r.allowBombReset) : true,
      forbidPokerLast: r.forbidPokerLast !== undefined ? Boolean(r.forbidPokerLast) : true,
      penaltyMultiplier: r.penaltyMultiplier === 'double_twos' || r.penaltyMultiplier === 'extreme' ? r.penaltyMultiplier : 'standard',
      autoSortHand: r.autoSortHand !== undefined ? Boolean(r.autoSortHand) : true,
      showHints: r.showHints !== undefined ? Boolean(r.showHints) : true,
    };
  },

  setup(seats: SeatInfo[], options: TongkronganOptions, rng: Rng): TongkronganState {
    if (seats.length !== 4) throw new Error('Poker Tongkrongan membutuhkan tepat 4 pemain');
    const deck = shuffledDeck(rng, 1); // 52 kartu teracak
    const hands: Card[][] = [[], [], [], []];
    
    // Bagikan tepat 13 kartu per pemain tanpa sisa (52 / 4 = 13)
    for (let i = 0; i < 52; i++) {
      hands[i % 4].push(deck[i]);
    }
    // Urutkan kartu masing-masing pemain (3 terendah ... 2 tertinggi)
    for (let i = 0; i < 4; i++) {
      hands[i] = sortCards(hands[i]);
    }

    const names = seats.map((s, i) => s.name || `Pemain ${i + 1}`);
    const bots = seats.map(s => Boolean(s.isBot));
    const round = options.round ?? 1;
    const previousWinner = options.previousWinner ?? null;

    // ATURAN KARTU ANGKA 3:
    // Ronde 1: Seluruh pemain yang memegang kartu 3 wajib mengeluarkannya ke meja untuk menentukan giliran pertama (pemegang 3♠).
    // Ronde Selanjutnya (> 1): Tidak ada lagi pengeluaran kartu angka 3! Pemimpin giliran pertama langsung pemenang (Juara 1) ronde sebelumnya.
    if (round === 1) {
      const pendingDiscard3 = [0, 1, 2, 3].filter(seat => hands[seat].some(c => rankOf(c) === 3));
      const phase = pendingDiscard3.length > 0 ? 'discard3' : 'play';
      const turn = pendingDiscard3.length > 0 ? pendingDiscard3[0] : 0;
      const turnDeadline = options.turnSeconds > 0 ? Date.now() + options.turnSeconds * 1000 : null;

      const log: LogEntry[] = [
        { seat: null, text: '🃏 Ronde 1: 52 kartu dibagikan habis (13 kartu per pemain).' },
        { 
          seat: turn, 
          text: '🌟 Tahap Awal Ronde 1: Seluruh pemain yang memegang kartu angka 3 wajib mengeluarkannya ke meja untuk menentukan siapa yang mulai main duluan (pemegang 3♠)!' 
        },
      ];

      return {
        gameId: 'tongkrongan',
        phase,
        round: 1,
        previousWinner: null,
        pendingDiscard3,
        discards3: [],
        options,
        names,
        bots,
        hands,
        currentCombo: null,
        lastPlaySeat: null,
        consecutiveSkips: 0,
        turn,
        finished: [],
        penalizedRank4: [],
        log,
        over: false,
        turnDeadline,
        opening: null,
      };
    }

    // Ronde 2, 3, dst.: Tidak ada pengeluaran kartu angka 3 lagi!
    // Pemimpin ronde adalah pemenang ronde sebelumnya (Juara 1).
    const starterSeat = previousWinner !== null && previousWinner >= 0 && previousWinner < 4 ? previousWinner : 0;
    const turnDeadline = options.turnSeconds > 0 ? Date.now() + options.turnSeconds * 1000 : null;

    const log: LogEntry[] = [
      { seat: null, text: `🃏 Ronde ${round}: 52 kartu dibagikan habis (13 kartu per pemain).` },
      { 
        seat: starterSeat, 
        text: `👑 Ronde ${round}: ${names[starterSeat]} (pemenang ronde sebelumnya) langsung memimpin permainan! Di ronde ini tidak perlu mengeluarkan kartu angka 3.` 
      },
    ];

    return {
      gameId: 'tongkrongan',
      phase: 'play',
      round,
      previousWinner,
      pendingDiscard3: [],
      discards3: [],
      options,
      names,
      bots,
      hands,
      currentCombo: null,
      lastPlaySeat: null,
      consecutiveSkips: 0,
      turn: starterSeat,
      finished: [],
      penalizedRank4: [],
      log,
      over: false,
      turnDeadline,
      opening: null,
    };
  },

  currentSeat(state: TongkronganState): number | null {
    if (state.over) return null;
    return state.turn;
  },

  apply(state: TongkronganState, seat: number, action: TongkronganAction, rng: Rng): TongkronganState {
    if (state.over) throw new RuleError('Permainan sudah selesai');
    if (state.turn === null || state.turn !== seat) throw new RuleError('Bukan giliranmu');
    if (!active(state, seat)) throw new RuleError('Pemain sudah selesai dan tidak memiliki giliran');

    const s = clone(state);
    const playerName = s.names[seat];

    // TAHAP 1: DISCARD 3 (HANYA BERJALAN DI AWAL RONDE 1)
    if (s.phase === 'discard3') {
      if (action.type !== 'discard3' && action.type !== 'play') {
        throw new RuleError('Saat ini tahap mengeluarkan kartu angka 3');
      }

      const threes = s.hands[seat].filter(c => rankOf(c) === 3);
      if (threes.length === 0) {
        throw new RuleError('Kamu tidak memiliki kartu angka 3');
      }

      let toDiscard = threes;
      if ('cards' in action && action.cards && action.cards.length > 0) {
        for (const c of action.cards) {
          if (rankOf(c) !== 3 || !threes.includes(c)) {
            throw new RuleError('Hanya kartu angka 3 yang dapat dikeluarkan pada tahap ini');
          }
        }
        if (action.cards.length !== threes.length) {
          throw new RuleError('Seluruh kartu angka 3 yang kamu miliki harus dikeluarkan');
        }
        toDiscard = action.cards;
      }

      // Hapus kartu 3 dari tangan pemain
      s.hands[seat] = s.hands[seat].filter(c => !toDiscard.includes(c));
      s.discards3.push({ seat, cards: toDiscard });
      pushLog(s.log, { seat, text: `${playerName} mengeluarkan kartu 3: ${toDiscard.map(cardLabel).join(', ')} ke meja.` });

      s.pendingDiscard3 = s.pendingDiscard3.filter(x => x !== seat);
      if (s.pendingDiscard3.length > 0) {
        s.turn = s.pendingDiscard3[0];
        s.turnDeadline = Date.now() + s.options.turnSeconds * 1000;
        return s;
      }

      // Seluruh pemain yang punya 3 sudah mengeluarkan kartu 3 mereka!
      // Cari siapa yang mengeluarkan 3♠ (OPENING_CARD)
      let starterSeat: number | undefined = s.discards3.find(d => d.cards.includes(OPENING_CARD))?.seat;
      if (starterSeat === undefined) {
        let highestCard: Card = '3D';
        let highestSeat = 0;
        for (const d of s.discards3) {
          for (const c of d.cards) {
            if (cardScore(c) >= cardScore(highestCard)) {
              highestCard = c;
              highestSeat = d.seat;
            }
          }
        }
        starterSeat = highestSeat;
      }

      s.phase = 'play';
      s.turn = starterSeat;
      s.turnDeadline = s.options.turnSeconds > 0 ? Date.now() + s.options.turnSeconds * 1000 : null;
      s.opening = { seat: starterSeat, card: OPENING_CARD, discards: clone(s.discards3) };

      pushLog(s.log, { 
        seat: starterSeat, 
        text: `🌟 Seluruh kartu 3 telah keluar! Kartu ${cardLabel(OPENING_CARD)} dikeluarkan oleh ${s.names[starterSeat]}. ${s.names[starterSeat]} mulai main duluan!` 
      });
      return s;
    }

    if (action.type === 'skip') {
      // Pemain yang memimpin ronde baru (meja kosong) TIDAK boleh skip!
      if (!s.currentCombo) {
        throw new RuleError('Kamu memimpin ronde baru, kamu wajib mengeluarkan kombinasi kartu!');
      }

      s.consecutiveSkips += 1;
      pushLog(s.log, { seat, text: `${playerName} melakukan Skip.` });

      const remainingActives = activeSeats(s);
      const skipsNeeded = Math.max(1, remainingActives.length - 1);

      // Cek Aturan Tiga Kali Skip (atau N-1 skip untuk sisa pemain): ronde selesai!
      if (s.consecutiveSkips >= skipsNeeded) {
        // Trick selesai! Pemain terakhir yang melempar kartu menang trik ini
        const leaderSeat = s.lastPlaySeat !== null && active(s, s.lastPlaySeat)
          ? s.lastPlaySeat
          : nextActiveSeat(s, s.lastPlaySeat ?? seat)!;

        pushLog(s.log, { 
          seat: null, 
          text: `🔔 ${skipsNeeded} pemain Skip berturut-turut! Meja dibersihkan. ${s.names[leaderSeat]} (pemenang trik sebelumnya) memimpin ronde baru!` 
        });

        s.currentCombo = null;
        s.lastPlaySeat = null;
        s.consecutiveSkips = 0;
        s.turn = leaderSeat;
        s.turnDeadline = s.options.turnSeconds > 0 ? Date.now() + s.options.turnSeconds * 1000 : null;
        return s;
      }

      // Giliran lanjut ke pemain aktif berikutnya
      s.turn = nextActiveSeat(s, seat);
      s.turnDeadline = s.options.turnSeconds > 0 ? Date.now() + s.options.turnSeconds * 1000 : null;
      return s;
    }

    if (action.type === 'play') {
      const selected = action.cards;
      if (!selected || selected.length === 0) {
        throw new RuleError('Pilih kartu yang ingin dikeluarkan');
      }

      // Validasi kepemilikan kartu di tangan
      const playerHand = s.hands[seat];
      for (const c of selected) {
        if (!playerHand.includes(c)) {
          throw new RuleError(`Kartu ${cardLabel(c)} tidak ada di tanganmu`);
        }
      }

      // Evaluasi kombinasi kartu
      const newCombo = evaluateCombo(selected);
      if (!newCombo) {
        throw new RuleError('Kombinasi kartu yang kamu pilih tidak sah');
      }

      // Jika meja sudah ada kombinasi, kombinasi baru harus mengalahkannya
      if (s.currentCombo) {
        if (!comboBeats(newCombo, s.currentCombo)) {
          throw new RuleError(
            `Kombinasi ${newCombo.description} tidak dapat mengalahkan ${s.currentCombo.description} di meja`
          );
        }
      }

      // Cek apakah aksi ini adalah ngebom kartu Single 2 di meja:
      const isBombingTwo = 
        s.currentCombo && 
        s.currentCombo.type === 'single' && 
        rankOf(s.currentCombo.cards[0]) === 2 && 
        newCombo.type === 'bomb';

      if (isBombingTwo) {
        // Meja dan ronde diledakkan! Mulai ulang dari awal ronde ini:
        const seats: SeatInfo[] = s.names.map((name, i) => ({
          id: `p${i + 1}`,
          name,
          isBot: s.bots[i],
        }));

        const restarted = tongkrongan.setup(
          seats,
          {
            ...s.options,
            round: s.round,
            previousWinner: s.previousWinner,
          },
          rng
        );

        restarted.log = [
          {
            seat,
            text: `💣💥 BOOM! ${playerName} melempar ${newCombo.description} untuk ngebom kartu 2 Single di meja!`,
          },
          {
            seat: null,
            text: `🔄 Ronde ${s.round} di-restart dari awal karena kartu 2 di-bom! Seluruh kartu dikocok ulang.`,
          },
          ...restarted.log,
        ];

        return restarted;
      }

      // Hapus kartu dari tangan pemain
      s.hands[seat] = s.hands[seat].filter(c => !selected.includes(c));
      s.currentCombo = newCombo;
      s.lastPlaySeat = seat;
      s.consecutiveSkips = 0;

      pushLog(s.log, { 
        seat, 
        text: `${playerName} mengeluarkan ${newCombo.description} (${selected.length} kartu).` 
      });

      // Cek apakah pemain ini berhasil menghabiskan seluruh kartunya
      if (s.hands[seat].length === 0) {
        const containsTwo = selected.some(c => rankOf(c) === 2);
        if (containsTwo) {
          // ATURAN TUTUP POKER (KARTU 2):
          // Jika kartu terakhir yang dikeluarkan mengandung kartu angka 2, pemain langsung dihukum KALAH (Peringkat ke-4)!
          s.penalizedRank4.push(seat);
          pushLog(s.log, {
            seat,
            text: `⚠️ HUKUMAN TUTUP POKER! ${playerName} menghabiskan seluruh kartunya menggunakan kombinasi yang menyertakan kartu angka 2! Menurut aturan, pemain yang menutup dengan kartu 2 otomatis KALAH sebagai Peringkat ke-4!`,
          });
        } else {
          s.finished.push(seat);
          const rank = s.finished.length;
          const rankLabel = rank === 1 ? 'Juara 1 🏆' : rank === 2 ? 'Juara 2 🥈' : 'Juara 3 🥉';
          pushLog(s.log, { 
            seat, 
            text: `🎉 ${playerName} menghabiskan seluruh kartunya! Keluar sebagai ${rankLabel}!` 
          });
        }

        // Cek sisa pemain aktif
        const remaining = activeSeats(s);
        if (remaining.length <= 1) {
          if (remaining.length === 1) {
            const lastSeat = remaining[0];
            s.finished.push(lastSeat);
            const hasPenalty = s.penalizedRank4.length > 0;
            const remainingRank = s.finished.length === 2 ? 'Juara 2 🥈' : s.finished.length === 3 ? 'Juara 3 🥉' : 'Kalah (Peringkat 4)';
            pushLog(s.log, { 
              seat: lastSeat, 
              text: hasPenalty
                ? `💥 Permainan selesai! ${s.names[lastSeat]} menyelesaikan pertandingan di posisi ${remainingRank} (karena ada pemain yang terkena hukuman tutup kartu 2).`
                : `💥 Permainan selesai! ${s.names[lastSeat]} adalah pemain terakhir yang tersisa (Kalah).` 
            });
          }
          s.over = true;
          s.turn = null;
          s.turnDeadline = null;
          return s;
        }
      }

      // Lanjut giliran ke pemain aktif berikutnya
      s.turn = nextActiveSeat(s, seat);
      s.turnDeadline = s.options.turnSeconds > 0 ? Date.now() + s.options.turnSeconds * 1000 : null;
      return s;
    }

    throw new RuleError('Aksi tidak dikenali');
  },

  autoDelay(state: TongkronganState): number | null {
    return null;
  },

  advance(state: TongkronganState, rng: Rng): TongkronganState {
    return state;
  },

  timeoutAction(state: TongkronganState, seat: number): TongkronganAction {
    if (state.phase === 'discard3') {
      return { type: 'discard3' };
    }
    // Jika ada kombinasi di meja, aksi aman saat timeout adalah Skip
    if (state.currentCombo) {
      return { type: 'skip' };
    }
    const hand = state.hands[seat];
    if (hand && hand.length > 0) {
      const sorted = sortCards(hand);
      return { type: 'play', cards: [sorted[0]] };
    }
    return { type: 'skip' };
  },

  view(state: TongkronganState, seat: number | null): TongkronganView {
    const handCounts = state.hands.map(h => h.length);
    const myHand = seat !== null && seat >= 0 && seat < 4 ? state.hands[seat] : [];

    const remainingActives = activeSeats(state);
    const skipsNeeded = Math.max(1, remainingActives.length - 1);

    const isMyTurn = seat !== null && state.turn === seat && !state.over;
    const canDiscard3 = state.phase === 'discard3' && isMyTurn;
    const canPlay = state.phase === 'play' && isMyTurn;
    const canSkip = state.phase === 'play' && isMyTurn && state.currentCombo !== null;

    return {
      gameId: 'tongkrongan',
      phase: state.phase,
      round: state.round,
      previousWinner: state.previousWinner,
      pendingDiscard3: state.pendingDiscard3,
      discards3: state.discards3,
      you: seat,
      turn: state.turn,
      over: state.over,
      log: state.log,
      results: this.results(state),
      names: state.names,
      bots: state.bots,
      handCounts,
      hand: myHand,
      currentCombo: state.currentCombo,
      lastPlaySeat: state.lastPlaySeat,
      consecutiveSkips: state.consecutiveSkips,
      skipsNeeded,
      finished: state.finished,
      penalizedRank4: state.penalizedRank4,
      passAndPlay: state.options.passAndPlay,
      turnSeconds: state.options.turnSeconds,
      opening: state.opening,
      legal: {
        canPlay,
        canSkip,
        canDiscard3,
      },
    };
  },

  bot(view: TongkronganView, difficulty: Difficulty, rng: Rng): TongkronganAction {
    if (view.phase === 'discard3') {
      return { type: 'discard3' };
    }

    const hand = view.hand;
    if (!hand || hand.length === 0) return { type: 'skip' };
    const sorted = sortCards(hand);

    // KASUS 1: Meja Kosong (Memimpin Ronde Baru)
    if (!view.currentCombo) {
      const rankGroups: Record<number, Card[]> = {};
      for (const c of sorted) {
        const r = rankOf(c);
        if (!rankGroups[r]) rankGroups[r] = [];
        rankGroups[r].push(c);
      }

      // Mode sulit: prioritaskan combo pair jika punya pair rendah
      if (difficulty === 'hard') {
        const pairs = Object.values(rankGroups).filter(g => g.length >= 2);
        if (pairs.length > 0 && rng.int(10) < 7) {
          return { type: 'play', cards: pairs[0].slice(0, 2) };
        }
      }

      // Default lead: keluarkan single kartu terendah
      return { type: 'play', cards: [sorted[0]] };
    }

    // KASUS 2: Ada kombinasi di meja yang harus dilawan
    const target = view.currentCombo;

    // Lawan Bom (hanya bisa dilawan dengan Bom yang lebih tinggi nilainya)
    if (target.type === 'bomb') {
      const rankGroups: Record<number, Card[]> = {};
      for (const c of sorted) {
        const r = rankOf(c);
        if (!rankGroups[r]) rankGroups[r] = [];
        rankGroups[r].push(c);
      }
      for (const group of Object.values(rankGroups)) {
        if (group.length >= 4) {
          const bombCombo = evaluateCombo(group.slice(0, 4));
          if (bombCombo && comboBeats(bombCombo, target)) {
            return { type: 'play', cards: group.slice(0, 4) };
          }
        }
      }
      return { type: 'skip' };
    }

    // Lawan Single
    if (target.count === 1) {
      // Jika kartu di meja adalah Single 2, cek apakah bot punya Bom 4 kartu untuk meledakkan meja!
      if (rankOf(target.cards[0]) === 2) {
        const rankGroups: Record<number, Card[]> = {};
        for (const c of sorted) {
          const r = rankOf(c);
          if (!rankGroups[r]) rankGroups[r] = [];
          rankGroups[r].push(c);
        }
        const bomb = Object.values(rankGroups).find(g => g.length >= 4);
        if (bomb) {
          return { type: 'play', cards: bomb.slice(0, 4) };
        }
      }

      for (const c of sorted) {
        const combo = evaluateCombo([c]);
        if (combo && comboBeats(combo, target)) {
          if (difficulty === 'easy' && tongkronganRank(c) >= 13 && rng.int(10) < 6) continue;
          return { type: 'play', cards: [c] };
        }
      }
      return { type: 'skip' };
    }

    // Lawan Pair
    if (target.count === 2) {
      for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (rankOf(sorted[i]) === rankOf(sorted[j])) {
            const pairCombo = evaluateCombo([sorted[i], sorted[j]]);
            if (pairCombo && comboBeats(pairCombo, target)) {
              return { type: 'play', cards: [sorted[i], sorted[j]] };
            }
          }
        }
      }
      return { type: 'skip' };
    }

    // Lawan Triple
    if (target.count === 3) {
      for (let i = 0; i < sorted.length - 2; i++) {
        if (rankOf(sorted[i]) === rankOf(sorted[i + 1]) && rankOf(sorted[i + 1]) === rankOf(sorted[i + 2])) {
          const tripCombo = evaluateCombo([sorted[i], sorted[i + 1], sorted[i + 2]]);
          if (tripCombo && comboBeats(tripCombo, target)) {
            return { type: 'play', cards: [sorted[i], sorted[i + 1], sorted[i + 2]] };
          }
        }
      }
      return { type: 'skip' };
    }

    // Lawan 5 Kartu
    if (target.count === 5 && sorted.length >= 5) {
      const rankGroups: Record<number, Card[]> = {};
      for (const c of sorted) {
        const r = rankOf(c);
        if (!rankGroups[r]) rankGroups[r] = [];
        rankGroups[r].push(c);
      }
      const triples = Object.values(rankGroups).filter(g => g.length >= 3);
      const pairs = Object.values(rankGroups).filter(g => g.length >= 2);

      if (triples.length > 0 && pairs.length > 1) {
        for (const t of triples) {
          for (const p of pairs) {
            if (rankOf(t[0]) !== rankOf(p[0])) {
              const fullHouseCards = [...t.slice(0, 3), ...p.slice(0, 2)];
              const combo = evaluateCombo(fullHouseCards);
              if (combo && comboBeats(combo, target)) {
                return { type: 'play', cards: fullHouseCards };
              }
            }
          }
        }
      }
    }

    return { type: 'skip' };
  },

  isOver(state: TongkronganState): boolean {
    return state.over;
  },

  results(state: TongkronganState): SeatResult[] | null {
    if (!state.over && state.finished.length + state.penalizedRank4.length < 3) return null;

    const normalWinners = [...state.finished];
    const penalized = [...state.penalizedRank4];
    const remainingSeats = [0, 1, 2, 3].filter(
      seat => !normalWinners.includes(seat) && !penalized.includes(seat)
    );

    // rankOrder: normal winners duluan (Rank 1, 2...), lalu sisa pemain, lalu pemain yang dihukum di posisi buncit (Rank 4)
    const rankOrder = [...normalWinners, ...remainingSeats, ...penalized];

    return rankOrder.map((seat, index) => {
      const rank = index + 1;
      const cardsLeft = state.hands[seat].length;
      return {
        seat,
        rank,
        score: cardsLeft,
      };
    });
  },
};
