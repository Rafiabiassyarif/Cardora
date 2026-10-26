// generic.ts — protokol "meja universal" untuk game kartu yang tidak punya meja khusus.
//
// Engine menjelaskan SEMUA yang perlu digambar & SEMUA aksi yang boleh dilakukan viewer
// lewat GenericView. UI (UniversalTable) hanya merender view ini dan mengirim GenericAction.
// Dengan begitu, menambah game baru cukup menulis engine — tanpa menyentuh UI.
//
// Aturan penting:
//  - view.actions hanya berisi aksi yang SAH untuk viewer saat ini (boleh kosong).
//  - apply() tetap wajib memvalidasi ulang semuanya (klien tidak dipercaya).
//  - Aksi boleh tersedia di luar giliran (mis. "Tepok!"), selama apply() mengizinkannya.

import { type Card, rankOf, suitOf } from './cards';
import { isValidToken } from './tokens';
import { type BaseView, RuleError } from './types';

export interface GActionSpec {
  /** Id aksi; dikirim kembali di GenericAction.id. */
  id: string;
  /** Teks tombol. */
  label: string;
  style?: 'primary' | 'danger' | 'normal';
  /** Aksi ini butuh memilih kartu dari tangan (jumlah min..max). */
  cards?: { min: number; max: number };
  /** Aksi ini butuh angka (taruhan/bid). */
  amount?: { min: number; max: number; step: number; default?: number };
  /** Aksi ini butuh memilih pemain lain (seat). */
  targets?: number[];
  /** Penjelasan singkat (tooltip). */
  hint?: string;
}

export interface GPile {
  id: string;
  label: string;
  /** Kartu yang terlihat; null = tertutup. */
  cards: (Card | null)[];
  /** Jumlah kartu sebenarnya bila hanya sebagian yang digambar (mis. deck). */
  count?: number;
  /** true = gambar berjajar (meld, trik); false = tumpuk (hanya kartu teratas). */
  spread?: boolean;
  highlight?: boolean;
  /** Teks kecil di bawah tumpukan (mis. pemilik kartu dalam trik). */
  caption?: string;
  /** Rantai domino: digambar mendatar (bukan tegak) + penanda ujung kiri/kanan. */
  chain?: { left: number; right: number } | null;
}

export interface GPlayer {
  name: string;
  isBot: boolean;
  /** Jumlah kartu di tangan. */
  count: number;
  /** Teks skor singkat, mis. "12 pt" / "1.200 chip". */
  score?: string;
  /** Status singkat, mis. "Bid 3 · 1 trik", "Pass", "Selesai #1". */
  status?: string;
  /** Label kecil di samping avatar, mis. "D", "Tim A". */
  tag?: string;
  /** Tidak aktif (fold/keluar/selesai). */
  out?: boolean;
  /** Kartu terbuka di depan pemain (stud up-cards, kartu duel, dll). null = tertutup. */
  faceUp?: (Card | null)[];
  /** Meld/kombinasi yang sudah diturunkan. */
  melds?: Card[][];
}

export interface GenericView extends BaseView {
  generic: true;
  players: GPlayer[];
  /** Kartu tangan viewer (kosong untuk penonton). */
  hand: Card[];
  piles: GPile[];
  actions: GActionSpec[];
  /** Kartu tangan yang sah untuk dimainkan sekarang (disorot di UI). */
  playable?: Card[];
  /** Instruksi untuk viewer. */
  prompt: string;
  /** Info ringkas di tengah meja, mis. ["Ronde 2/5", "Truf ♠"]. */
  badges: string[];
  /** Hasil ronde terakhir untuk ditampilkan sebentar (opsional). */
  banner?: string | null;
}

export interface GenericAction {
  type: 'act';
  id: string;
  cards?: Card[];
  amount?: number;
  target?: number;
}

/* ------------------------------ helpers -------------------------------- */

/** Validasi bentuk aksi dari klien; kembalikan aksi yang sudah dinormalisasi. */
export function parseAction(raw: unknown): GenericAction {
  const a = raw as Partial<GenericAction> | null;
  if (!a || typeof a !== 'object' || a.type !== 'act' || typeof a.id !== 'string') {
    throw new RuleError('Aksi tidak dikenali');
  }
  const out: GenericAction = { type: 'act', id: a.id };
  if (a.cards !== undefined) {
    if (!Array.isArray(a.cards) || a.cards.length > 60 || !a.cards.every(isValidToken)) {
      throw new RuleError('Kartu tidak valid');
    }
    out.cards = a.cards.slice();
  }
  if (a.amount !== undefined) {
    const n = Number(a.amount);
    if (!Number.isFinite(n)) throw new RuleError('Angka tidak valid');
    out.amount = Math.floor(n);
  }
  if (a.target !== undefined) {
    const t = Number(a.target);
    if (!Number.isInteger(t) || t < 0) throw new RuleError('Pemain tujuan tidak valid');
    out.target = t;
  }
  return out;
}

/**
 * Pastikan `cards` ada di `hand`, tanpa duplikat, jumlah min..max.
 * Kembalikan salinan kartu yang dipilih.
 */
export function takeCards(hand: Card[], cards: Card[] | undefined, min: number, max: number): Card[] {
  const sel = cards ?? [];
  if (sel.length < min || sel.length > max) {
    throw new RuleError(min === max ? `Pilih tepat ${min} kartu` : `Pilih ${min}–${max} kartu`);
  }
  if (new Set(sel).size !== sel.length) throw new RuleError('Kartu tidak boleh dipilih dua kali');
  for (const c of sel) if (!hand.includes(c)) throw new RuleError('Kartu tidak ada di tanganmu');
  return sel.slice();
}

/** Buang kartu-kartu dari tangan (mutasi). Asumsikan sudah divalidasi. */
export function removeCards(hand: Card[], cards: Card[]) {
  for (const c of cards) {
    const i = hand.indexOf(c);
    if (i < 0) throw new RuleError('Kartu tidak ada di tanganmu');
    hand.splice(i, 1);
  }
}

/** Cari spesifikasi aksi di daftar aksi sah; lempar jika tidak ada. */
export function requireAction(actions: GActionSpec[], id: string): GActionSpec {
  const spec = actions.find(a => a.id === id);
  if (!spec) throw new RuleError('Aksi itu tidak bisa dilakukan sekarang');
  return spec;
}

/** Peringkat berdasarkan skor (higherIsBetter), seri mendapat rank sama. */
export function rankByScore(scores: number[], higherIsBetter = true): { seat: number; rank: number; score: number }[] {
  const order = scores.map((score, seat) => ({ seat, score }))
    .sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));
  let rank = 0, prev: number | null = null;
  return order.map((o, k) => {
    if (o.score !== prev) { rank = k + 1; prev = o.score; }
    return { seat: o.seat, rank, score: o.score };
  });
}

export const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<string, string> = { S: 'Sekop ♠', H: 'Hati ♥', D: 'Wajik ♦', C: 'Keriting ♣' };

/** Label rank tanpa suit: "A", "10", "K". */
export function rankLabel(rank: number): string {
  return rank === 14 ? 'A' : rank === 13 ? 'K' : rank === 12 ? 'Q' : rank === 11 ? 'J' : String(rank);
}

/** Pemenang trik: kartu tertinggi dari suit truf (jika ada), selain itu tertinggi dari suit pembuka. */
export function trickWinner(trick: { seat: number; card: Card }[], trump: string | null, rank: (c: Card) => number = rankOf,
  suit: (c: Card) => string = suitOf): number {
  const lead = suit(trick[0].card);
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const bt = trump !== null && suit(best.card) === trump;
    const tt = trump !== null && suit(t.card) === trump;
    if (tt && !bt) best = t;
    else if (tt === bt && suit(t.card) === suit(best.card) && rank(t.card) > rank(best.card)) best = t;
    else if (!tt && !bt && suit(t.card) === lead && suit(best.card) !== lead) best = t;
  }
  return best.seat;
}

/** Deadline giliran dari opsi turnSeconds (0 = tanpa batas). */
export function deadline(turnSeconds: number | undefined): number | null {
  const s = turnSeconds ?? 0;
  return s > 0 ? Date.now() + s * 1000 : null;
}

/** Opsi standar yang dipakai hampir semua game generik. */
export const TURN_SECONDS_OPTION = {
  key: 'turnSeconds',
  label: 'Batas Waktu Giliran',
  type: 'select' as const,
  choices: [
    { value: 0, label: '♾️ Tanpa Batas Waktu (Santai)' },
    { value: 15, label: '15 Detik (Cepat)' },
    { value: 25, label: '25 Detik (Standar)' },
    { value: 40, label: '40 Detik (Santai)' },
  ],
  help: 'Waktu berpikir tiap giliran sebelum sistem otomatis beraksi',
};

export const PASS_AND_PLAY_OPTION = {
  key: 'passAndPlay',
  label: 'Mode Operan HP (Multiplayer Lokal)',
  type: 'boolean' as const,
  help: 'Tampilkan layar privasi saat berganti giliran antar pemain fisik',
};

export function sanitizeTurnSeconds(v: unknown, fallback = 25): number {
  const n = Number(v);
  if (v === undefined || v === null || !Number.isFinite(n)) return fallback;
  if (n === 0) return 0;
  return Math.min(60, Math.max(10, Math.round(n)));
}
