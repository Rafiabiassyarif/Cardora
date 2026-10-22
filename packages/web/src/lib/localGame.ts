// localGame.ts — menjalankan modul game di perangkat (single-player vs bot, offline).
// Mendukung sistem multi-ronde (Match Series), akumulasi skor, dan klasemen ronde.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type BaseView, type Difficulty, type GameModule, cryptoRng, getGame, RuleError, AVATARS } from '@kuypoker/engine';
import { recordResult, getData } from './store';
import { play } from './sound';

const BOT_NAMES = ['Bot Budi', 'Bot Sari', 'Bot Joko', 'Bot Rina', 'Bot Dewi', 'Bot Agus', 'Bot Tono', 'Bot Lina'];

export interface RoundHistoryItem {
  round: number;
  rank: number;
  score?: number;
  pointsEarned: number;
}

export interface SeriesPlayerScore {
  seat: number;
  name: string;
  avatar: string;
  totalPoints: number;
  wins: number;
  rounds: RoundHistoryItem[];
}

export interface MatchSeries {
  currentRound: number;
  targetRounds: number; // 0 = tanpa batas
  scores: SeriesPlayerScore[];
  isRoundOver: boolean;
  isSeriesOver: boolean;
  roundResults: any[] | null;
}

export interface GameController {
  view: BaseView | null;
  error: string | null;
  act(action: unknown): Promise<void>;
  restart(): void;
  nextRound(): void;
  series: MatchSeries;
  turnDeadline: number | null;
}

export function useLocalGame(gameId: string, players: number, difficulty: Difficulty, options: Record<string, unknown>): GameController {
  const mod = getGame(gameId) as GameModule;
  const rng = useRef(cryptoRng()).current;
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Format target ronde (default 3 ronde jika tidak ditentukan)
  const targetRounds = typeof options.targetRounds === 'number' ? options.targetRounds : 3;
  const isPassAndPlay = Boolean(options.passAndPlay);

  const [currentRound, setCurrentRound] = useState(1);
  const [isSeriesOver, setIsSeriesOver] = useState(false);
  const [scores, setScores] = useState<SeriesPlayerScore[]>([]);
  const recorded = useRef(false);

  // Buat daftar kursi pemain
  const getSeats = useCallback(() => {
    const profile = getData().profile;
    return isPassAndPlay
      ? [
          { id: 'p0', name: `${profile.name} (P1)`, avatar: profile.avatar, isBot: false },
          { id: 'p1', name: 'Pemain 2', avatar: AVATARS[1], isBot: false },
          { id: 'p2', name: 'Pemain 3', avatar: AVATARS[2], isBot: false },
          { id: 'p3', name: 'Pemain 4', avatar: AVATARS[3], isBot: false },
        ]
      : [
          { id: 'you', name: profile.name, avatar: profile.avatar },
          ...BOT_NAMES.slice(0, players - 1).map((n, i) => ({
            id: `bot${i}`,
            name: n,
            avatar: AVATARS[(i * 3 + 1) % AVATARS.length],
            isBot: true,
          })),
        ];
  }, [isPassAndPlay, players]);

  // Inisialisasi awal seri pertandingan
  useEffect(() => {
    const seats = getSeats();
    setScores(
      seats.map((s, idx) => ({
        seat: idx,
        name: s.name,
        avatar: s.avatar ?? '🙂',
        totalPoints: 0,
        wins: 0,
        rounds: [],
      }))
    );
    setCurrentRound(1);
    setIsSeriesOver(false);
    setState(mod.setup(seats, mod.sanitizeOptions(options), rng));
    recorded.current = false;
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, players, isPassAndPlay]);

  // Langkah otomatis, bot, dan timer timeout 15 detik.
  useEffect(() => {
    if (!state) return;
    if (mod.isOver(state)) {
      if (!recorded.current) {
        recorded.current = true;
        const res = mod.results(state)!;
        
        // Akumulasi skor seri untuk ronde ini
        setScores(prev => {
          const nextScores = prev.map(p => ({ ...p, rounds: [...p.rounds] }));
          res.forEach(r => {
            const player = nextScores.find(p => p.seat === r.seat);
            if (player) {
              // Poin ronde: Juara 1 = players-1, Juara 2 = players-2, dst. (min 0)
              const pointsEarned = r.rank === 1 ? Math.max(1, players - 1) : Math.max(0, players - r.rank);
              player.totalPoints += pointsEarned;
              if (r.rank === 1) player.wins += 1;
              player.rounds.push({
                round: currentRound,
                rank: r.rank,
                score: r.score,
                pointsEarned,
              });
            }
          });
          return nextScores;
        });

        const mine = res.find(r => r.seat === 0)!;
        recordResult({ gameId, at: Date.now(), mode: 'bot', rank: mine.rank, players });

        // Cek apakah seluruh ronde dalam seri pertandingan sudah selesai
        const finalRound = targetRounds > 0 && currentRound >= targetRounds;
        if (finalRound) {
          setIsSeriesOver(true);
        }

        if (mine.rank === 1) play('win');
      }
      return;
    }

    const delay = mod.autoDelay(state);
    if (delay !== null) {
      const t = setTimeout(() => {
        setState((s: any) => {
          if (!s) return s;
          // Pastikan game masih dalam fase yang membutuhkan auto advance (dealer, roundOver, dsb)
          if (mod.autoDelay(s) !== null) {
            try {
              return mod.advance(s, rng);
            } catch (err) {
              console.error('Error in auto advance:', err);
              return s;
            }
          }
          return s;
        });
      }, delay);
      return () => clearTimeout(t);
    }

    const seat = mod.currentSeat(state);

    // Jika giliran bot (bukan mode pass & play dan seat bukan 0)
    if (!isPassAndPlay && seat !== null && seat !== 0) {
      const t = setTimeout(() => {
        setState((s: any) => {
          if (!s) return s;
          const current = mod.currentSeat(s);
          if (current === null || current !== seat) return s;
          try { return mod.apply(s, seat, mod.bot(mod.view(s, seat), difficulty, rng), rng); }
          catch { return mod.apply(s, seat, mod.timeoutAction(s, seat), rng); }
        });
        play('card');
      }, 650 + Math.random() * 600);
      return () => clearTimeout(t);
    }

    // Timer deadline giliran (15 detik real-time)
    if (state.turnDeadline && seat !== null) {
      const remaining = Math.max(50, state.turnDeadline - Date.now());
      const t = setTimeout(() => {
        setState((s: any) => {
          if (!s || mod.isOver(s)) return s;
          const current = mod.currentSeat(s);
          if (current === null || current !== seat) return s;
          try {
            return mod.apply(s, current, mod.timeoutAction(s, current), rng);
          } catch {
            return s;
          }
        });
      }, remaining);
      return () => clearTimeout(t);
    }

    if (seat === 0 || isPassAndPlay) play('turn');
  }, [state, mod, rng, difficulty, gameId, players, isPassAndPlay, currentRound, targetRounds]);

  // Validasi di luar updater (RuleError ditangkap sinkron), lalu commit state baru.
  const act = useCallback(async (action: unknown) => {
    if (!state) return;
    const actorSeat = isPassAndPlay ? (mod.currentSeat(state) ?? 0) : 0;
    let next: any;
    try { next = mod.apply(state, actorSeat, action, rng); } catch (e) {
      setError(e instanceof RuleError ? e.message : 'Aksi gagal');
      play('error');
      return;
    }
    setState((s: any) => (s ? next : s));
    setError(null);
    play('card');
  }, [state, mod, rng, isPassAndPlay]);

  // Melanjutkan ke ronde berikutnya dalam seri
  const nextRound = useCallback(() => {
    const seats = getSeats();
    const lastWinner = state && mod.isOver(state)
      ? (mod.results(state)?.find((r: any) => r.rank === 1)?.seat ?? null)
      : null;
    const nextR = currentRound + 1;
    setCurrentRound(nextR);
    recorded.current = false;
    setError(null);
    setState(mod.setup(seats, mod.sanitizeOptions({ ...options, round: nextR, previousWinner: lastWinner }), rng));
    play('shuffle');
  }, [getSeats, mod, options, rng, state, currentRound]);

  // Mengulang seluruh seri pertandingan dari ronde 1
  const restart = useCallback(() => {
    const seats = getSeats();
    setScores(
      seats.map((s, idx) => ({
        seat: idx,
        name: s.name,
        avatar: s.avatar ?? '🙂',
        totalPoints: 0,
        wins: 0,
        rounds: [],
      }))
    );
    setCurrentRound(1);
    setIsSeriesOver(false);
    recorded.current = false;
    setError(null);
    setState(mod.setup(seats, mod.sanitizeOptions({ ...options, round: 1, previousWinner: null }), rng));
    play('shuffle');
  }, [getSeats, mod, options, rng]);

  const activeViewer = isPassAndPlay && state ? (mod.currentSeat(state) ?? 0) : 0;

  const isRoundOver = Boolean(state && mod.isOver(state));
  const roundResults = isRoundOver ? mod.results(state) : null;

  const matchSeries: MatchSeries = {
    currentRound,
    targetRounds,
    scores,
    isRoundOver,
    isSeriesOver,
    roundResults,
  };

  return {
    view: state ? mod.view(state, activeViewer) : null,
    error,
    act,
    restart,
    nextRound,
    series: matchSeries,
    turnDeadline: state?.turnDeadline ?? null,
  };
}
