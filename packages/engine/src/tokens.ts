// tokens.ts — "kartu" non-standar yang bisa dipakai game berprotokol GenericView.
//
// Semua kartu tetap berupa string (tipe Card), sehingga takeCards/removeCards/UI bekerja apa adanya.
// Setiap token UNIK di dalam satu deck (duplikat fisik diberi akhiran salinan a–d).
//
//  - Kartu remi standar: "AS", "TD", "9H" (lihat cards.ts).
//  - Kartu Warna (gaya game kartu warna populer): "u:" + warna + nilai + salinan
//      warna: R (Merah), Y (Kuning), G (Hijau), B (Biru), W (Wild/hitam)
//      nilai untuk warna biasa: 0–9, S (Skip/Lewati), R (Balik Arah), D (+2)
//      nilai untuk W: W (Ganti Warna), 4 (Ganti Warna +4)
//      contoh: "u:R5a", "u:GSb", "u:BDa", "u:WWc", "u:W4d"
//  - Domino (balak 6, 28 kartu): "d:" + angka kecil + angka besar, contoh "d:06", "d:66".

import { isValidCard } from './cards';

export type UColor = 'R' | 'Y' | 'G' | 'B';
export const U_COLORS: readonly UColor[] = ['R', 'Y', 'G', 'B'];
export const U_COLOR_NAME: Record<string, string> = { R: 'Merah', Y: 'Kuning', G: 'Hijau', B: 'Biru', W: 'Hitam' };

const U_RE = /^u:(?:[RYGB][0-9SRD]|W[W4])[a-d]$/;
const D_RE = /^d:([0-6])([0-6])$/;

export function isColorCard(t: unknown): t is string {
  return typeof t === 'string' && U_RE.test(t);
}

export function isDomino(t: unknown): t is string {
  if (typeof t !== 'string') return false;
  // Urutan bebas: "d:51" sah untuk tampilan (kartu di rantai meja yang diputar).
  // Kartu di tangan/deck selalu kanonik (angka kecil dulu) — lihat dominoSet().
  return D_RE.test(t);
}

/** Token apa pun yang sah: kartu remi, kartu warna, atau domino. */
export function isValidToken(t: unknown): t is string {
  return isValidCard(t) || isColorCard(t) || isDomino(t);
}

/* ------------------------------ kartu warna ----------------------------- */

export interface ColorCardInfo {
  /** R/Y/G/B, atau W untuk kartu hitam (wild). */
  color: UColor | 'W';
  /** '0'–'9', 'S' skip, 'R' balik arah, 'D' +2, 'W' ganti warna, '4' ganti warna +4. */
  value: string;
}

export function colorCardInfo(t: string): ColorCardInfo {
  if (!isColorCard(t)) throw new Error(`Kartu warna tidak valid: ${t}`);
  return { color: t[2] as UColor | 'W', value: t[3] };
}

/** Deck 108 kartu: tiap warna 1× angka 0, 2× angka 1–9, 2× Skip, 2× Balik, 2× +2; 4× Wild, 4× Wild +4. */
export function colorDeck(): string[] {
  const deck: string[] = [];
  for (const c of U_COLORS) {
    deck.push(`u:${c}0a`);
    for (const v of '123456789SRD') deck.push(`u:${c}${v}a`, `u:${c}${v}b`);
  }
  for (const copy of 'abcd') deck.push(`u:WW${copy}`, `u:W4${copy}`);
  return deck;
}

/** Label pendek untuk log/tombol, mis. "Merah 5", "Biru +2", "Wild +4". */
export function colorCardLabel(t: string): string {
  const { color, value } = colorCardInfo(t);
  if (color === 'W') return value === '4' ? 'Wild +4' : 'Wild';
  const v = value === 'S' ? 'Lewati' : value === 'R' ? 'Balik' : value === 'D' ? '+2' : value;
  return `${U_COLOR_NAME[color]} ${v}`;
}

/* --------------------------------- domino -------------------------------- */

/** Set domino balak 6: 28 kartu "d:00" … "d:66". */
export function dominoSet(): string[] {
  const set: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push(`d:${a}${b}`);
  return set;
}

/** Dua angka domino sesuai urutan tulisan token. */
export function dominoPips(t: string): [number, number] {
  if (!isDomino(t)) throw new Error(`Domino tidak valid: ${t}`);
  return [Number(t[2]), Number(t[3])];
}

export const isBalak = (t: string) => t[2] === t[3];

/** Bentuk kanonik (angka kecil dulu): "d:51" → "d:15". */
export function dominoCanon(t: string): string {
  const [a, b] = dominoPips(t);
  return `d:${Math.min(a, b)}${Math.max(a, b)}`;
}

/** Token tampilan dengan sisi kiri `left`, mis. dominoOriented("d:15", 5) → "d:51". */
export function dominoOriented(t: string, left: number): string {
  const [a, b] = dominoPips(t);
  return a === left ? `d:${a}${b}` : `d:${b}${a}`;
}

/** Label, mis. "3|5", "Balak 6". */
export function dominoLabel(t: string): string {
  const [a, b] = dominoPips(t);
  return a === b ? `Balak ${a}` : `${a}|${b}`;
}
