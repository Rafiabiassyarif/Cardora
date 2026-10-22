// types.ts — kontrak umum setiap modul game.
//
// Setiap game adalah modul murni (tanpa UI, tanpa jaringan):
//   setup → state; apply(state, seat, action) → state baru (atau RuleError);
//   view(state, seat) → hanya informasi yang BOLEH diketahui seat tersebut.
// Bot hanya menerima `view`, sehingga secara struktural tidak bisa mengintip kartu tersembunyi.

import type { Rng } from './rng';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface SeatInfo {
  id: string;
  name: string;
  isBot?: boolean;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export interface LogEntry {
  seat: number | null;
  text: string;
}

export interface SeatResult {
  seat: number;
  /** 1 = juara. Seri boleh memiliki rank sama. */
  rank: number;
  /** Skor/chip akhir (opsional menurut game). */
  score: number;
}

/** Deskripsi opsi untuk layar pengaturan (dirender generik oleh UI). */
export type OptionSpec =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; help?: string }
  | { key: string; label: string; type: 'select'; choices: { value: string | number; label: string }[]; help?: string }
  | { key: string; label: string; type: 'boolean'; help?: string };

/** View dasar yang dikirim ke klien. Game menambahkan field sendiri. */
export interface BaseView {
  gameId: string;
  /** Seat milik viewer (null = penonton). */
  you: number | null;
  /** Seat yang sedang giliran (null = tidak ada / otomatis). */
  turn: number | null;
  over: boolean;
  log: LogEntry[];
  results: SeatResult[] | null;
}

export interface GameModule<S = any, A = any, V extends BaseView = BaseView, O = any> {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  defaultOptions: O;
  options: OptionSpec[];
  /** Normalisasi & validasi opsi dari klien (tidak pernah percaya input). */
  sanitizeOptions(raw: unknown): O;
  setup(seats: SeatInfo[], options: O, rng: Rng): S;
  /** Seat yang harus beraksi sekarang, atau null. */
  currentSeat(state: S): number | null;
  /** Terapkan aksi. Wajib melempar RuleError untuk aksi ilegal. Tidak memutasi `state`. */
  apply(state: S, seat: number, action: A, rng: Rng): S;
  /** Jika state butuh langkah otomatis (mis. tangan berikutnya), kembalikan jeda ms; jika tidak, null. */
  autoDelay(state: S): number | null;
  /** Jalankan langkah otomatis. */
  advance(state: S, rng: Rng): S;
  /** Aksi aman bila pemain kehabisan waktu / terputus. */
  timeoutAction(state: S, seat: number): A;
  view(state: S, seat: number | null): V;
  bot(view: V, difficulty: Difficulty, rng: Rng): A;
  isOver(state: S): boolean;
  results(state: S): SeatResult[] | null;
}

/** Klon dalam untuk state JSON-serializable (pola apply yang immutable). */
export function clone<T>(v: T): T {
  return structuredClone(v);
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function pushLog(log: LogEntry[], entry: LogEntry, max = 60) {
  log.push(entry);
  if (log.length > max) log.splice(0, log.length - max);
}
