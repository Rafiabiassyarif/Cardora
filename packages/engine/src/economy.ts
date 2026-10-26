// economy.ts — aturan chip/XP/level/misi/pencapaian. PURE & dipakai bersama:
// server menghitung (otoritatif, tidak bisa diubah dari browser), web hanya menampilkan.
import type { Rng } from './rng';

export interface QuestDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  target: number;
  rewardChips: number;
  rewardXp: number;
}

export interface AchievementDef extends QuestDef {}

export const QUESTS: QuestDef[] = [
  { id: 'play_games', title: 'Pejuang Kartu', desc: 'Mainkan 3 pertandingan game apa saja', icon: '🃏', target: 3, rewardChips: 2000, rewardXp: 80 },
  { id: 'win_games', title: 'Pemenang Sejati', desc: 'Raih juara 1 dalam pertandingan apa saja', icon: '🏆', target: 1, rewardChips: 3500, rewardXp: 120 },
  { id: 'play_holdem', title: "Spesialis Texas Hold'em", desc: "Selesaikan 2 sesi meja Texas Hold'em", icon: '♠️', target: 2, rewardChips: 2500, rewardXp: 100 },
  { id: 'play_cangkulan_bj', title: 'Eksplorasi Variasi', desc: 'Mainkan 1 ronde Cangkulan atau Blackjack', icon: '⛏️', target: 1, rewardChips: 1500, rewardXp: 70 },
];

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_game', title: 'Langkah Perdana', desc: 'Selesaikan pertandingan game kartu pertamamu', icon: '🌱', target: 1, rewardChips: 2000, rewardXp: 80 },
  { id: 'first_win', title: 'Kemenangan Pertama', desc: 'Raih juara 1 pertama kalinya di game apa saja', icon: '🥇', target: 1, rewardChips: 3500, rewardXp: 150 },
  { id: 'five_wins', title: 'Juara Bertahan', desc: 'Menangkan 5 pertandingan game kartu', icon: '👑', target: 5, rewardChips: 10000, rewardXp: 400 },
  { id: 'holdem_pro', title: "Master Hold'em", desc: "Menangkan 3 game Texas Hold'em", icon: '♠️', target: 3, rewardChips: 15000, rewardXp: 500 },
  { id: 'cangkulan_master', title: 'Raja Cangkulan', desc: 'Menangkan 3 game Cangkulan tradisional', icon: '🌾', target: 3, rewardChips: 15000, rewardXp: 500 },
  { id: 'blackjack_21', title: 'Natural 21', desc: 'Dapatkan Blackjack natural 21 di meja Blackjack', icon: '🃏', target: 1, rewardChips: 8000, rewardXp: 300 },
  { id: 'allin_hero', title: 'All-in Hero', desc: "Lakukan taruhan All-in di Texas Hold'em", icon: '💥', target: 1, rewardChips: 10000, rewardXp: 350 },
  { id: 'rich_sultan', title: 'Sultan Chip', desc: 'Kumpulkan saldo total mencapai 35.000 chip', icon: '💰', target: 35000, rewardChips: 20000, rewardXp: 600 },
  { id: 'wheel_spinner', title: 'Roda Hoki', desc: 'Putar Roda Keberuntungan harian 3 kali', icon: '🎰', target: 3, rewardChips: 5000, rewardXp: 200 },
  { id: 'table_designer', title: 'Gaya Kasino', desc: 'Ganti warna karpet meja atau gaya kartu', icon: '🎨', target: 1, rewardChips: 4000, rewardXp: 150 },
  { id: 'social_chatter', title: 'Jiwa Sosial', desc: 'Kirimkan pesan chat atau emote di meja 5 kali', icon: '💬', target: 5, rewardChips: 5000, rewardXp: 200 },
  { id: 'vip_club', title: 'VIP Elite', desc: 'Capai level 5 dan masuk ke jajaran VIP Silver', icon: '💎', target: 5, rewardChips: 25000, rewardXp: 1000 },
];

export const XP_PER_LEVEL = 300;
export const START_CHIPS = 10000;
export const BANKRUPT_LIMIT = 2000;
export const REFILLS_PER_DAY = 3;
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const HOURLY_COOLDOWN_MS = 60 * 60 * 1000;
export const SPIN_COOLDOWN_MS = 12 * 60 * 60 * 1000;
/** Hadiah roda (indeks dipilih SERVER, bukan browser). */
export const WHEEL_PRIZES = [500, 1000, 2500, 5000, 1500, 10000, 2000, 25000];
/** Batas wajar chip per pertandingan, agar hasil yang dilaporkan klien tidak bisa dipakai mencetak chip. */
export const MAX_CHIPS_PER_MATCH = 5000;
/** Batas atas pemindahan saldo tamu ke akun (sekali per akun). */
export const MAX_MIGRATE_CHIPS = 100000;

export type VipTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export interface QuestState { current: number; claimed: boolean }
export interface AchievementState { current: number; claimed: boolean }

/** Kondisi ekonomi yang disimpan di akun (server). */
export interface EconomyState {
  chips: number;
  xp: number;
  lastDailyClaim: number;
  lastHourlyClaim: number;
  lastSpinTime: number;
  freeRefillsToday: number;
  lastRefillDate: string;
  quests: Record<string, QuestState>;
  achievements: Record<string, AchievementState>;
}

export const levelForXp = (xp: number) => Math.max(1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1);

export function vipTierForLevel(level: number): VipTier {
  if (level >= 35) return 'Diamond';
  if (level >= 20) return 'Platinum';
  if (level >= 10) return 'Gold';
  if (level >= 5) return 'Silver';
  return 'Bronze';
}

export const todayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function newEconomy(now = Date.now()): EconomyState {
  return {
    chips: START_CHIPS,
    xp: 0,
    lastDailyClaim: 0,
    lastHourlyClaim: 0,
    lastSpinTime: 0,
    freeRefillsToday: REFILLS_PER_DAY,
    lastRefillDate: todayKey(now),
    quests: Object.fromEntries(QUESTS.map(q => [q.id, { current: 0, claimed: false }])),
    achievements: Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, { current: 0, claimed: false }])),
  };
}

/** Lengkapi state lama/parsial agar selalu punya semua kunci misi & pencapaian. */
export function normalizeEconomy(input: Partial<EconomyState> | undefined, now = Date.now()): EconomyState {
  const base = newEconomy(now);
  const src = input ?? {};
  const quests = { ...base.quests };
  for (const q of QUESTS) {
    const v = src.quests?.[q.id];
    quests[q.id] = { current: Math.min(q.target, Math.max(0, Number(v?.current) || 0)), claimed: !!v?.claimed };
  }
  const achievements = { ...base.achievements };
  for (const a of ACHIEVEMENTS) {
    const v = src.achievements?.[a.id];
    achievements[a.id] = { current: Math.max(0, Number(v?.current) || 0), claimed: !!v?.claimed };
  }
  return {
    chips: Math.max(0, Math.floor(Number(src.chips ?? base.chips))),
    xp: Math.max(0, Math.floor(Number(src.xp ?? 0))),
    lastDailyClaim: Number(src.lastDailyClaim) || 0,
    lastHourlyClaim: Number(src.lastHourlyClaim) || 0,
    lastSpinTime: Number(src.lastSpinTime) || 0,
    freeRefillsToday: Number.isFinite(Number(src.freeRefillsToday)) ? Math.max(0, Math.floor(Number(src.freeRefillsToday))) : base.freeRefillsToday,
    lastRefillDate: typeof src.lastRefillDate === 'string' && src.lastRefillDate ? src.lastRefillDate : base.lastRefillDate,
    quests,
    achievements,
  };
}

/** Naikkan progres satu pencapaian; tandai terbuka saat target tercapai. */
function bump(st: EconomyState, id: string, amount: number): void {
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (!def || amount <= 0) return;
  const cur = st.achievements[id] ?? { current: 0, claimed: false };
  st.achievements[id] = { ...cur, current: Math.min(def.target, cur.current + amount) };
}

const isUnlocked = (st: EconomyState, id: string) => {
  const def = ACHIEVEMENTS.find(a => a.id === id);
  const cur = st.achievements[id];
  return !!def && !!cur && cur.current >= def.target;
};

export interface SettleInput {
  gameId: string;
  rank: number;
  players: number;
  mode: 'bot' | 'online';
}

export interface SettleResult {
  state: EconomyState;
  chipsDelta: number;
  xpDelta: number;
  unlocked: string[];
  questsCompleted: string[];
  levelBefore: number;
  levelAfter: number;
}

/**
 * Terapkan hasil satu pertandingan. Server memakai ini sebagai satu-satunya sumber kebenaran:
 * hadiah dihitung dari (juara, jumlah pemain, mode), lalu dibatasi MAX_CHIPS_PER_MATCH.
 */
export function settleGame(input: EconomyState, p: SettleInput): SettleResult {
  const st = normalizeEconomy(input);
  const levelBefore = levelForXp(st.xp);
  const rank = Math.max(1, Math.floor(p.rank) || 1);
  const players = Math.max(2, Math.floor(p.players) || 2);
  const won = rank === 1;

  const xpDelta = won ? 160 : rank === 2 ? 80 : 40;
  // Menang: makin banyak lawan makin besar; kalah: tetap dapat hiburan kecil.
  const raw = won ? 500 + 250 * (players - 1) : rank === 2 ? 200 : 80;
  const chipsDelta = Math.min(MAX_CHIPS_PER_MATCH, Math.max(0, raw));

  st.xp += xpDelta;
  st.chips += chipsDelta;

  bump(st, 'first_game', 1);
  if (won) {
    bump(st, 'first_win', 1);
    bump(st, 'five_wins', 1);
    if (p.gameId === 'holdem') bump(st, 'holdem_pro', 1);
    if (p.gameId === 'cangkulan') bump(st, 'cangkulan_master', 1);
  }
  bump(st, 'rich_sultan', chipsDelta);
  if (levelForXp(st.xp) >= 5) {
    const v = st.achievements.vip_club ?? { current: 0, claimed: false };
    st.achievements.vip_club = { ...v, current: Math.max(v.current, 5) };
  }

  const questsCompleted: string[] = [];
  const questBump = (id: string) => {
    const def = QUESTS.find(q => q.id === id);
    const cur = st.quests[id];
    if (!def || !cur || cur.current >= def.target) return;
    st.quests[id] = { ...cur, current: Math.min(def.target, cur.current + 1) };
    if (st.quests[id].current >= def.target) questsCompleted.push(id);
  };
  questBump('play_games');
  if (won) questBump('win_games');
  if (p.gameId === 'holdem') questBump('play_holdem');
  if (p.gameId === 'cangkulan' || p.gameId === 'blackjack') questBump('play_cangkulan_bj');

  const unlocked = ACHIEVEMENTS.filter(a => isUnlocked(st, a.id)).map(a => a.id);
  return { state: st, chipsDelta, xpDelta, unlocked, questsCompleted, levelBefore, levelAfter: levelForXp(st.xp) };
}

export type EconomyEvent = 'chat' | 'theme' | 'allin' | 'blackjack21';

/** Kejadian kecil dari meja (chat, ganti tema, all-in, natural 21) → progres pencapaian. */
export function applyEvent(input: EconomyState, ev: EconomyEvent): EconomyState {
  const st = normalizeEconomy(input);
  if (ev === 'chat') bump(st, 'social_chatter', 1);
  if (ev === 'theme') bump(st, 'table_designer', 1);
  if (ev === 'allin') bump(st, 'allin_hero', 1);
  if (ev === 'blackjack21') bump(st, 'blackjack_21', 1);
  return st;
}

export interface ClaimResult<T> { ok: boolean; reason?: string; reward?: T; state: EconomyState; nextInMs?: number }

export function claimQuest(input: EconomyState, id: string): ClaimResult<{ chips: number; xp: number }> {
  const st = normalizeEconomy(input);
  const def = QUESTS.find(q => q.id === id);
  const cur = st.quests[id];
  if (!def || !cur) return { ok: false, reason: 'unknown', state: st };
  if (cur.current < def.target) return { ok: false, reason: 'not_complete', state: st };
  if (cur.claimed) return { ok: false, reason: 'claimed', state: st };
  st.quests[id] = { ...cur, claimed: true };
  st.chips += def.rewardChips;
  st.xp += def.rewardXp;
  return { ok: true, reward: { chips: def.rewardChips, xp: def.rewardXp }, state: st };
}

export function claimAchievement(input: EconomyState, id: string): ClaimResult<{ chips: number; xp: number }> {
  const st = normalizeEconomy(input);
  const def = ACHIEVEMENTS.find(a => a.id === id);
  const cur = st.achievements[id];
  if (!def || !cur) return { ok: false, reason: 'unknown', state: st };
  if (cur.current < def.target) return { ok: false, reason: 'locked', state: st };
  if (cur.claimed) return { ok: false, reason: 'claimed', state: st };
  st.achievements[id] = { ...cur, claimed: true };
  st.chips += def.rewardChips;
  st.xp += def.rewardXp;
  return { ok: true, reward: { chips: def.rewardChips, xp: def.rewardXp }, state: st };
}

export function claimDaily(input: EconomyState, now = Date.now()): ClaimResult<{ chips: number; xp: number }> {
  const st = normalizeEconomy(input, now);
  const left = Math.max(0, st.lastDailyClaim + DAILY_COOLDOWN_MS - now);
  if (left > 0) return { ok: false, reason: 'cooldown', state: st, nextInMs: left };
  const chips = 3000 + levelForXp(st.xp) * 250;
  st.lastDailyClaim = now;
  st.chips += chips;
  st.xp += 100;
  return { ok: true, reward: { chips, xp: 100 }, state: st, nextInMs: DAILY_COOLDOWN_MS };
}

export function claimHourly(input: EconomyState, now = Date.now()): ClaimResult<{ chips: number; xp: number }> {
  const st = normalizeEconomy(input, now);
  const left = Math.max(0, st.lastHourlyClaim + HOURLY_COOLDOWN_MS - now);
  if (left > 0) return { ok: false, reason: 'cooldown', state: st, nextInMs: left };
  st.lastHourlyClaim = now;
  st.chips += 600;
  st.xp += 25;
  return { ok: true, reward: { chips: 600, xp: 25 }, state: st, nextInMs: HOURLY_COOLDOWN_MS };
}

/** Putar roda: indeks hadiah dipilih server dengan rng kriptografis. */
export function spinWheel(input: EconomyState, rng: Rng, now = Date.now()): ClaimResult<{ index: number; chips: number; xp: number }> {
  const st = normalizeEconomy(input, now);
  const left = Math.max(0, st.lastSpinTime + SPIN_COOLDOWN_MS - now);
  if (left > 0) return { ok: false, reason: 'cooldown', state: st, nextInMs: left };
  const index = Math.min(WHEEL_PRIZES.length - 1, Math.max(0, rng.int(WHEEL_PRIZES.length)));
  const chips = WHEEL_PRIZES[index];
  st.lastSpinTime = now;
  st.chips += chips;
  st.xp += 50;
  bump(st, 'wheel_spinner', 1);
  return { ok: true, reward: { index, chips, xp: 50 }, state: st, nextInMs: SPIN_COOLDOWN_MS };
}

export const refillsLeft = (st: EconomyState, now = Date.now()) =>
  st.lastRefillDate !== todayKey(now) ? REFILLS_PER_DAY : Math.max(0, st.freeRefillsToday);

export function claimRefill(input: EconomyState, now = Date.now()): ClaimResult<{ chips: number }> {
  const st = normalizeEconomy(input, now);
  if (st.lastRefillDate !== todayKey(now)) { st.lastRefillDate = todayKey(now); st.freeRefillsToday = REFILLS_PER_DAY; }
  if (st.chips >= BANKRUPT_LIMIT) return { ok: false, reason: 'not_broke', state: st };
  if (st.freeRefillsToday <= 0) return { ok: false, reason: 'quota', state: st };
  st.freeRefillsToday -= 1;
  st.chips += 2500;
  return { ok: true, reward: { chips: 2500 }, state: st };
}
