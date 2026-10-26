// economy.ts — jembatan ekonomi: saat login, chip/XP/misi/pencapaian berasal dari SERVER.
// Tamu tetap memakai penyimpanan perangkat (tanpa akun).
import { api } from './auth';
import { getData, update, emitNotice } from './store';
import { play } from './sound';
import type { Economy, Quest, Achievement, VipTier } from './store';

export interface ServerEconomy {
  chips: number;
  xp: number;
  level: number;
  xpForNextLevel: number;
  vipTier: VipTier;
  lastDailyClaim: number;
  lastHourlyClaim: number;
  lastSpinTime: number;
  freeRefillsToday: number;
  quests: (Quest & { completed: boolean })[];
  achievements: (Achievement & { unlocked: boolean })[];
}

export const isAccountMode = () => !!getData().session.authToken;

/** Tulis state dari server ke store lokal (UI tetap membaca store). */
export function applyServerEconomy(eco: ServerEconomy) {
  update(d => {
    d.economy.chips = eco.chips;
    d.economy.xp = eco.xp;
    d.economy.level = eco.level;
    d.economy.vipTier = eco.vipTier;
    d.economy.lastDailyClaim = eco.lastDailyClaim;
    d.economy.lastHourlyClaim = eco.lastHourlyClaim;
    d.economy.lastSpinTime = eco.lastSpinTime;
    d.economy.freeRefillsToday = eco.freeRefillsToday;
    d.economy.quests = eco.quests.map(q => ({ ...q }));
    d.economy.achievements = eco.achievements.map(a => ({ ...a }));
  });
}

export async function refreshEconomy(): Promise<boolean> {
  if (!isAccountMode()) return false;
  try {
    const r = await api<{ economy: ServerEconomy }>('/economy');
    applyServerEconomy(r.economy);
    return true;
  } catch {
    return false;
  }
}

interface SettleResponse {
  economy: ServerEconomy;
  chipsDelta: number;
  xpDelta: number;
  levelUp: number | null;
  unlocked: string[];
  questsCompleted: string[];
}

/** Kirim hasil pertandingan ke server; server menghitung chip & XP. */
export async function settleMatch(input: { gameId: string; rank: number; players: number; mode: 'bot' | 'online' }) {
  if (!isAccountMode()) return null;
  try {
    const r = await api<SettleResponse>('/economy/settle', { method: 'POST', body: JSON.stringify(input) });
    applyServerEconomy(r.economy);
    if (r.levelUp) emitNotice('success', `⬆️ Naik ke Level ${r.levelUp}!`);
    return r;
  } catch {
    return null;
  }
}

type ClaimKind = 'quest' | 'achievement' | 'daily' | 'hourly' | 'spin' | 'refill';

export interface ClaimResponse {
  economy: ServerEconomy;
  reward?: { chips: number; xp?: number; index?: number; chipsDelta?: number };
}

/** Klaim hadiah di server. `null` = mode tamu (pakai logika lokal). */
export async function claimRemote(kind: ClaimKind, id?: string): Promise<ClaimResponse | null> {
  if (!isAccountMode()) return null;
  const r = await api<ClaimResponse>('/economy/claim', { method: 'POST', body: JSON.stringify({ kind, id }) });
  applyServerEconomy(r.economy);
  play('win');
  return r;
}

/** Kejadian meja untuk progres pencapaian (chat, tema, all-in, natural 21). */
export async function sendEconomyEvent(type: 'chat' | 'theme' | 'allin' | 'blackjack21') {
  if (!isAccountMode()) return;
  try {
    const r = await api<{ economy: ServerEconomy }>('/economy/event', { method: 'POST', body: JSON.stringify({ type }) });
    applyServerEconomy(r.economy);
  } catch { /* abaikan: progres menyusul saat refresh berikutnya */ }
}

/**
 * Pindahkan saldo tamu (perangkat ini) ke akun SEKALI saat pertama login.
 * Server menolak bila ekonomi akun sudah terpakai, jadi tidak bisa diulang.
 */
export async function migrateGuestProgress(): Promise<void> {
  const eco = getData().economy;
  if (eco.chips <= 10000) return;
  try {
    const r = await api<{ economy: ServerEconomy; migrated: number }>('/economy/migrate', {
      method: 'POST',
      body: JSON.stringify({ chips: eco.chips }),
    });
    applyServerEconomy(r.economy);
    if (r.migrated > 0) emitNotice('success', `🔗 Progres tamu dipindahkan ke akun: ${r.migrated.toLocaleString('id-ID')} Chip.`);
  } catch { /* akun sudah punya progres: pakai saldo server */ }
}
