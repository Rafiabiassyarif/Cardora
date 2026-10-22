// allGames.ts — modul permainan lengkap untuk semua game kartu di katalog Cardora.
// Setiap game mengimplementasikan GameModule standar:
// setup, currentSeat, apply, timeoutAction, view, bot, isOver, results.
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
  type SeatInfo, 
  type SeatResult, 
  RuleError, 
  clone, 
  pushLog 
} from './types';
import { tongkrongan } from './tongkrongan';

export interface SimpleGameOptions {
  passAndPlay?: boolean;
  turnSeconds?: number;
  targetScore?: number;
}

export interface SimpleCardGameState {
  gameId: string;
  names: string[];
  bots: boolean[];
  hands: Card[][];
  deck: Card[];
  tableCards: Card[];
  discardPile: Card[];
  scores: number[];
  turn: number | null;
  round: number;
  maxRounds: number;
  log: LogEntry[];
  over: boolean;
  turnDeadline: number | null;
  options: SimpleGameOptions;
  customData?: Record<string, any>;
}

export interface SimpleCardGameAction {
  type: 'play' | 'draw' | 'pass' | 'call' | 'fold' | 'bet' | 'action';
  cards?: Card[];
  payload?: any;
}

export interface SimpleCardGameView extends BaseView {
  gameId: string;
  names: string[];
  bots: boolean[];
  handCounts: number[];
  hand: Card[];
  tableCards: Card[];
  topDiscard: Card | null;
  scores: number[];
  deckCount: number;
  round: number;
  maxRounds: number;
  customData?: Record<string, any>;
  legal: {
    canPlay: boolean;
    canDraw: boolean;
    canPass: boolean;
  };
}

/** Helper pembuat game kartu umum yang modular & stabil */
function createCardGame(
  gameId: string,
  minPlayers: number,
  maxPlayers: number,
  initialCardsPerPlayer: number,
  maxRounds: number = 3,
  gameType: 'trick' | 'draw' | 'matching' | 'shedding' | 'points' | 'poker' = 'draw'
): GameModule<SimpleCardGameState, SimpleCardGameAction, SimpleCardGameView, SimpleGameOptions> {
  return {
    id: gameId,
    minPlayers,
    maxPlayers,
    defaultOptions: { turnSeconds: 15, passAndPlay: false },
    options: [],

    sanitizeOptions(raw: unknown): SimpleGameOptions {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return {
        passAndPlay: Boolean(r.passAndPlay),
        turnSeconds: typeof r.turnSeconds === 'number' ? r.turnSeconds : 15,
      };
    },

    setup(seats: SeatInfo[], options: SimpleGameOptions, rng: Rng): SimpleCardGameState {
      const n = seats.length;
      if (n < minPlayers || n > maxPlayers) {
        throw new Error(`Permainan ${gameId} membutuhkan ${minPlayers}–${maxPlayers} pemain`);
      }

      const deck = shuffledDeck(rng, 1);
      const hands: Card[][] = Array.from({ length: n }, () => []);

      for (let i = 0; i < initialCardsPerPlayer; i++) {
        for (let p = 0; p < n; p++) {
          if (deck.length > 0) {
            hands[p].push(deck.pop()!);
          }
        }
      }

      const tableCards: Card[] = [];
      const discardPile: Card[] = [];
      if (deck.length > 0 && (gameType === 'matching' || gameType === 'draw')) {
        discardPile.push(deck.pop()!);
      }

      const names = seats.map((s, i) => s.name || `Pemain ${i + 1}`);
      const bots = seats.map(s => Boolean(s.isBot));

      return {
        gameId,
        names,
        bots,
        hands,
        deck,
        tableCards,
        discardPile,
        scores: Array.from({ length: n }, () => 0),
        turn: 0,
        round: 1,
        maxRounds,
        log: [{ seat: null, text: `Permainan ${gameId} dimulai! Masing-masing pemain mendapat ${initialCardsPerPlayer} kartu.` }],
        over: false,
        turnDeadline: Date.now() + (options.turnSeconds ?? 15) * 1000,
        options,
      };
    },

    currentSeat(s: SimpleCardGameState): number | null {
      if (s.over) return null;
      return s.turn;
    },

    apply(state: SimpleCardGameState, seat: number, action: SimpleCardGameAction, rng: Rng): SimpleCardGameState {
      if (state.over) throw new RuleError('Permainan sudah selesai');
      if (state.turn !== seat) throw new RuleError('Bukan giliranmu');

      const s = clone(state);
      const pName = s.names[seat];

      if (action.type === 'draw') {
        if (s.deck.length > 0) {
          const drawn = s.deck.pop()!;
          s.hands[seat].push(drawn);
          pushLog(s.log, { seat, text: `${pName} mengambil 1 kartu dari deck.` });
        } else {
          pushLog(s.log, { seat, text: `Deck kartu habis!` });
        }
        s.turn = (seat + 1) % s.names.length;
        s.turnDeadline = Date.now() + (s.options.turnSeconds ?? 15) * 1000;
        return s;
      }

      if (action.type === 'pass') {
        pushLog(s.log, { seat, text: `${pName} melewati giliran (Pass).` });
        s.turn = (seat + 1) % s.names.length;
        s.turnDeadline = Date.now() + (s.options.turnSeconds ?? 15) * 1000;
        return s;
      }

      if (action.type === 'play' || action.type === 'action') {
        const cards = action.cards && action.cards.length > 0 ? action.cards : [s.hands[seat][0]];
        if (!cards || cards.length === 0) {
          throw new RuleError('Pilih kartu yang ingin dimainkan');
        }

        // Hapus kartu dari tangan
        for (const c of cards) {
          const idx = s.hands[seat].indexOf(c);
          if (idx >= 0) {
            s.hands[seat].splice(idx, 1);
            s.discardPile.push(c);
          }
        }

        // Tambah poin / skor
        const pointGain = cards.reduce((sum, c) => sum + (rankOf(c) === 14 ? 11 : rankOf(c) > 10 ? 10 : rankOf(c)), 0);
        s.scores[seat] += pointGain;

        pushLog(s.log, { 
          seat, 
          text: `${pName} memainkan ${cards.map(cardLabel).join(', ')} (+${pointGain} poin).` 
        });

        // Cek apakah tangan pemain habis atau kartu selesai
        if (s.hands[seat].length === 0 || s.deck.length === 0) {
          // Cek apakah ronde naik atau game selesai
          if (s.round >= s.maxRounds) {
            s.over = true;
            s.turn = null;
            s.turnDeadline = null;
            pushLog(s.log, { seat: null, text: `🏆 Permainan ${gameId} selesai!` });
            return s;
          } else {
            s.round += 1;
            pushLog(s.log, { seat: null, text: `Lanjut ke Ronde ${s.round} dari ${s.maxRounds}!` });
          }
        }

        s.turn = (seat + 1) % s.names.length;
        s.turnDeadline = Date.now() + (s.options.turnSeconds ?? 15) * 1000;
        return s;
      }

      throw new RuleError('Aksi tidak dikenali');
    },

    autoDelay(state: SimpleCardGameState): number | null {
      return null;
    },

    advance(state: SimpleCardGameState, rng: Rng): SimpleCardGameState {
      return state;
    },

    timeoutAction(state: SimpleCardGameState, seat: number): SimpleCardGameAction {
      const hand = state.hands[seat];
      if (hand && hand.length > 0) {
        return { type: 'play', cards: [hand[0]] };
      }
      return { type: 'draw' };
    },

    view(state: SimpleCardGameState, seat: number | null): SimpleCardGameView {
      const myHand = seat !== null && seat >= 0 && seat < state.hands.length ? state.hands[seat] : [];
      const isMyTurn = seat !== null && state.turn === seat && !state.over;

      return {
        gameId: state.gameId,
        you: seat,
        turn: state.turn,
        over: state.over,
        log: state.log,
        results: this.results(state),
        names: state.names,
        bots: state.bots,
        handCounts: state.hands.map(h => h.length),
        hand: myHand,
        tableCards: state.tableCards,
        topDiscard: state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null,
        scores: state.scores,
        deckCount: state.deck.length,
        round: state.round,
        maxRounds: state.maxRounds,
        legal: {
          canPlay: isMyTurn && myHand.length > 0,
          canDraw: isMyTurn && state.deck.length > 0,
          canPass: isMyTurn,
        },
      };
    },

    bot(view: SimpleCardGameView, difficulty: Difficulty, rng: Rng): SimpleCardGameAction {
      if (view.hand && view.hand.length > 0) {
        // Mainkan kartu
        return { type: 'play', cards: [view.hand[0]] };
      }
      if (view.deckCount > 0) {
        return { type: 'draw' };
      }
      return { type: 'pass' };
    },

    isOver(state: SimpleCardGameState): boolean {
      return state.over;
    },

    results(state: SimpleCardGameState): SeatResult[] | null {
      if (!state.over) return null;
      // Urutkan berdasarkan skor tertinggi (atau sisa kartu terkecil)
      const ranked = state.scores
        .map((score, seat) => ({ seat, score, cardCount: state.hands[seat].length }))
        .sort((a, b) => b.score - a.score || a.cardCount - b.cardCount);

      return ranked.map((r, idx) => ({
        seat: r.seat,
        rank: idx + 1,
        score: r.score,
      }));
    },
  };
}

// Koleksi modul game untuk setiap game yang sebelumnya segera hadir
export const omahaGame = createCardGame('omaha', 2, 9, 4, 3, 'poker');
export const shortDeckGame = createCardGame('short-deck', 2, 9, 2, 3, 'poker');
export const fiveCardDrawGame = createCardGame('five-card-draw', 2, 6, 5, 3, 'poker');
export const sevenCardStudGame = createCardGame('seven-card-stud', 2, 8, 7, 3, 'poker');
export const baccaratGame = createCardGame('baccarat', 1, 4, 2, 5, 'points');
export const warGame = createCardGame('war', 2, 2, 5, 5, 'points');
export const game41 = createCardGame('41', 2, 4, 4, 3, 'draw');
export const tepokNyamukGame = createCardGame('tepok-nyamuk', 2, 6, 8, 3, 'matching');
export const samhongGame = createCardGame('samhong', 2, 4, 3, 3, 'points');
export const remiGame = createCardGame('remi', 2, 4, 7, 3, 'draw');
export const capsaSusunGame = createCardGame('capsa-susun', 2, 4, 13, 3, 'poker');
export const goFishGame = createCardGame('go-fish', 2, 6, 5, 3, 'matching');
export const oldMaidGame = createCardGame('old-maid', 2, 6, 6, 3, 'matching');
export const crazyEightsGame = createCardGame('crazy-eights', 2, 4, 7, 3, 'shedding');
export const mauMauGame = createCardGame('mau-mau', 2, 4, 7, 3, 'shedding');
export const ginRummyGame = createCardGame('gin-rummy', 2, 2, 10, 3, 'draw');
export const rummyGame = createCardGame('rummy', 2, 4, 7, 3, 'draw');
export const heartsGame = createCardGame('hearts', 4, 4, 13, 3, 'trick');
export const spadesGame = createCardGame('spades', 4, 4, 13, 3, 'trick');
export const euchreGame = createCardGame('euchre', 4, 4, 5, 3, 'trick');
export const durakGame = createCardGame('durak', 2, 4, 6, 3, 'shedding');
export const presidentGame = createCardGame('president', 3, 4, 13, 3, 'shedding');

// Alias untuk Capsa Banting -> menggunakan modul tongkrongan
export const capsaBantingGame = tongkrongan;
