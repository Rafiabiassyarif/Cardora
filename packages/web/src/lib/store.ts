// store.ts — data LOKAL: preferensi, profil tamu, statistik lokal, ekonomi, level/XP, misi, pencapaian, riwayat.
import { useSyncExternalStore } from 'react';
import { AVATARS } from '@kuypoker/engine';
import { play, startBgm, stopBgm, updateBgmVolume } from './sound';

export interface MusicSettings {
  mode: 'youtube' | 'synth';
  youtubePlaylistId: string;
  youtubeCustomUrl?: string;
  youtubeTitle?: string;
}

export interface Settings {
  sound: boolean;
  bgm: boolean;
  bgmVolume: number;
  animations: 'full' | 'reduced' | 'off';
  botDifficulty: 'easy' | 'normal' | 'hard';
  /** URL server multiplayer (kosong = sama dengan origin web / VITE_SERVER_URL). */
  serverUrl: string;
  notifications: boolean;
  music?: MusicSettings;
}

export interface Profile {
  name: string;
  avatar: string;
}

export interface LocalResult {
  gameId: string;
  at: number;
  mode: 'bot' | 'online';
  rank: number;
  players: number;
}

export interface Session {
  token: string | null;
  authToken: string | null;
  username: string | null;
  /** true bila pengguna memilih "Main sebagai Tamu" di landing page. */
  guest: boolean;
  /** Cara masuk terakhir (untuk label UI). */
  provider: 'password' | 'google' | null;
  /** Kode room online yang sedang diikuti — dipakai untuk kembali ke meja setelah reload. */
  lastRoom: string | null;
}

export interface Quest {
  id: string;
  title: string;
  desc: string;
  rewardChips: number;
  rewardXp: number;
  target: number;
  current: number;
  completed: boolean;
  claimed: boolean;
  icon: string;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  target: number;
  current: number;
  rewardChips: number;
  rewardXp: number;
  unlocked: boolean;
  claimed: boolean;
}

export type FeltTheme = 'emerald' | 'sapphire' | 'crimson' | 'obsidian';
export type CardTheme = 'classic' | 'gold' | 'cyber';
export type VipTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export interface Economy {
  chips: number;
  xp: number;
  level: number;
  vipTier: VipTier;
  lastDailyClaim: number;
  lastHourlyClaim: number;
  lastSpinTime: number;
  feltTheme: FeltTheme;
  cardTheme: CardTheme;
  quests: Quest[];
  achievements: Achievement[];
  freeRefillsToday: number;
  lastRefillDate: string;
}

interface Data {
  settings: Settings;
  profile: Profile;
  favorites: string[];
  history: LocalResult[];
  session: Session;
  economy: Economy;
  onboarded: boolean;
}

export interface AppNotice {
  id: number;
  kind: 'info' | 'warn' | 'success';
  text: string;
}

let noticeCounter = 0;
let globalNotices: AppNotice[] = [];
const noticeListeners = new Set<() => void>();

export function emitNotice(kind: 'info' | 'warn' | 'success', text: string) {
  const n: AppNotice = { id: ++noticeCounter, kind, text };
  globalNotices = [...globalNotices, n].slice(-5);
  noticeListeners.forEach(l => l());
  setTimeout(() => {
    globalNotices = globalNotices.filter(x => x.id !== n.id);
    noticeListeners.forEach(l => l());
  }, 4500);
}

export const useAppNotices = () =>
  useSyncExternalStore(
    cb => { noticeListeners.add(cb); return () => noticeListeners.delete(cb); },
    () => globalNotices,
  );

const KEY = 'cardora.v2';
const randomName = () => `Pemain${Math.floor(100 + Math.random() * 900)}`;

export function defaultQuests(): Quest[] {
  return [
    {
      id: 'play_games',
      title: 'Pejuang Kartu',
      desc: 'Mainkan 3 pertandingan game apa saja',
      rewardChips: 2000,
      rewardXp: 80,
      target: 3,
      current: 0,
      completed: false,
      claimed: false,
      icon: '🃏',
    },
    {
      id: 'win_games',
      title: 'Pemenang Sejati',
      desc: 'Raih juara 1 dalam pertandingan apa saja',
      rewardChips: 3500,
      rewardXp: 120,
      target: 1,
      current: 0,
      completed: false,
      claimed: false,
      icon: '🏆',
    },
    {
      id: 'play_holdem',
      title: 'Spesialis Texas Hold\'em',
      desc: 'Selesaikan 2 sesi meja Texas Hold\'em',
      rewardChips: 2500,
      rewardXp: 100,
      target: 2,
      current: 0,
      completed: false,
      claimed: false,
      icon: '♠️',
    },
    {
      id: 'play_cangkulan_bj',
      title: 'Eksplorasi Variasi',
      desc: 'Mainkan 1 ronde Cangkulan atau Blackjack',
      rewardChips: 1500,
      rewardXp: 70,
      target: 1,
      current: 0,
      completed: false,
      claimed: false,
      icon: '⛏️',
    },
  ];
}

export function defaultAchievements(): Achievement[] {
  return [
    {
      id: 'first_game',
      title: 'Langkah Perdana',
      desc: 'Selesaikan pertandingan game kartu pertamamu',
      icon: '🌱',
      target: 1,
      current: 0,
      rewardChips: 2000,
      rewardXp: 80,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'first_win',
      title: 'Kemenangan Pertama',
      desc: 'Raih juara 1 pertama kalinya di game apa saja',
      icon: '🥇',
      target: 1,
      current: 0,
      rewardChips: 3500,
      rewardXp: 150,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'five_wins',
      title: 'Juara Bertahan',
      desc: 'Menangkan 5 pertandingan game kartu',
      icon: '👑',
      target: 5,
      current: 0,
      rewardChips: 10000,
      rewardXp: 400,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'holdem_pro',
      title: 'Master Hold\'em',
      desc: 'Menangkan 3 game Texas Hold\'em',
      icon: '♠️',
      target: 3,
      current: 0,
      rewardChips: 15000,
      rewardXp: 500,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'cangkulan_master',
      title: 'Raja Cangkulan',
      desc: 'Menangkan 3 game Cangkulan tradisional',
      icon: '🌾',
      target: 3,
      current: 0,
      rewardChips: 15000,
      rewardXp: 500,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'blackjack_21',
      title: 'Natural 21',
      desc: 'Dapatkan Blackjack natural 21 di meja Blackjack',
      icon: '🃏',
      target: 1,
      current: 0,
      rewardChips: 8000,
      rewardXp: 300,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'allin_hero',
      title: 'All-in Hero',
      desc: 'Lakukan taruhan All-in di Texas Hold\'em',
      icon: '💥',
      target: 1,
      current: 0,
      rewardChips: 10000,
      rewardXp: 350,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'rich_sultan',
      title: 'Sultan Chip',
      desc: 'Kumpulkan saldo total mencapai 35.000 chip',
      icon: '💰',
      target: 35000,
      current: 10000,
      rewardChips: 20000,
      rewardXp: 600,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'wheel_spinner',
      title: 'Roda Hoki',
      desc: 'Putar Roda Keberuntungan harian 3 kali',
      icon: '🎰',
      target: 3,
      current: 0,
      rewardChips: 5000,
      rewardXp: 200,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'table_designer',
      title: 'Gaya Kasino',
      desc: 'Ganti warna karpet meja atau gaya kartu',
      icon: '🎨',
      target: 1,
      current: 0,
      rewardChips: 4000,
      rewardXp: 150,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'social_chatter',
      title: 'Jiwa Sosial',
      desc: 'Kirimkan pesan chat atau emote di meja 5 kali',
      icon: '💬',
      target: 5,
      current: 0,
      rewardChips: 5000,
      rewardXp: 200,
      unlocked: false,
      claimed: false,
    },
    {
      id: 'vip_club',
      title: 'VIP Elite',
      desc: 'Capai level 5 dan masuk ke jajaran VIP Silver',
      icon: '💎',
      target: 5,
      current: 1,
      rewardChips: 25000,
      rewardXp: 1000,
      unlocked: false,
      claimed: false,
    },
  ];
}

function defaultEconomy(): Economy {
  return {
    chips: 10000,
    xp: 0,
    level: 1,
    vipTier: 'Bronze',
    lastDailyClaim: 0,
    lastHourlyClaim: 0,
    lastSpinTime: 0,
    feltTheme: 'emerald',
    cardTheme: 'classic',
    quests: defaultQuests(),
    achievements: defaultAchievements(),
    freeRefillsToday: 3,
    lastRefillDate: new Date().toDateString(),
  };
}

const defaults = (): Data => ({
  settings: {
    sound: true,
    bgm: false,
    bgmVolume: 0.35,
    animations: 'full',
    botDifficulty: 'normal',
    serverUrl: '',
    notifications: false,
    music: {
      mode: 'youtube',
      youtubePlaylistId: 'PL-zaZSuM_d7QvDbJPSCMMbKWuPh4WXgRP',
      youtubeTitle: 'Smooth Jazz Lounge',
    },
  },
  profile: { name: randomName(), avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] },
  favorites: ['holdem'],
  history: [],
  session: { token: null, authToken: null, username: null, guest: false, provider: null, lastRoom: null },
  economy: defaultEconomy(),
  onboarded: false,
});

function calculateVipTier(level: number): VipTier {
  if (level >= 35) return 'Diamond';
  if (level >= 20) return 'Platinum';
  if (level >= 10) return 'Gold';
  if (level >= 5) return 'Silver';
  return 'Bronze';
}

function mergeAchievements(saved: Achievement[] | undefined): Achievement[] {
  const def = defaultAchievements();
  if (!saved || !saved.length) return def;
  return def.map(d => {
    const s = saved.find(x => x.id === d.id);
    return s ? { ...d, ...s } : d;
  });
}

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem('cardora.v1') || localStorage.getItem('kuypoker.v2') || localStorage.getItem('kuypoker.v1');
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    const base = defaults();
    const eco: Economy = {
      ...defaultEconomy(),
      ...(d.economy ?? {}),
      quests: d.economy?.quests && d.economy.quests.length ? d.economy.quests : defaultQuests(),
      achievements: mergeAchievements(d.economy?.achievements),
    };
    const prof: Profile = {
      ...base.profile,
      ...(d.profile ?? {}),
    };
    return {
      ...base,
      ...d,
      settings: { ...base.settings, ...d.settings, notifications: d.settings?.notifications ?? false },
      profile: prof,
      session: { ...base.session, ...d.session },
      economy: eco,
    };
  } catch {
    return defaults();
  }
}

let data = load();
const listeners = new Set<() => void>();

export function update(fn: (d: Data) => Data | void) {
  const next = structuredClone(data);
  data = fn(next) ?? next;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota */
  }
  listeners.forEach(l => l());
}

/** Catat / lupakan room online aktif (dipakai App untuk memulihkan meja setelah reload). */
export function setLastRoom(code: string | null) {
  if (data.session.lastRoom === code) return;
  update(d => { d.session.lastRoom = code; });
}

export const getData = () => data;
export function useData<T>(select: (d: Data) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(data),
  );
}

function applyXpAndChips(d: Data, xpGain: number, chipsGain: number) {
  d.economy.chips = Math.max(0, d.economy.chips + chipsGain);
  d.economy.xp += xpGain;

  // Level formula: XP required for level N is N * 300
  let xpReq = d.economy.level * 300;
  while (d.economy.xp >= xpReq) {
    d.economy.xp -= xpReq;
    d.economy.level += 1;
    // Level up reward!
    const lvlReward = d.economy.level * 1500;
    d.economy.chips += lvlReward;
    xpReq = d.economy.level * 300;
    emitNotice('success', `🎉 Naik ke Level ${d.economy.level}! Bonus +${lvlReward.toLocaleString('id-ID')} Chip!`);
  }
  d.economy.vipTier = calculateVipTier(d.economy.level);

  // Check VIP / Level achievement
  trackAchievementInternal(d, 'vip_club', d.economy.level, true);
  trackAchievementInternal(d, 'rich_sultan', d.economy.chips, true);
}

function trackAchievementInternal(d: Data, id: string, amount: number, absolute = false) {
  const ach = d.economy.achievements.find(a => a.id === id);
  if (!ach || ach.unlocked) return;
  if (absolute) {
    ach.current = Math.max(ach.current, amount);
  } else {
    ach.current = Math.min(ach.target, ach.current + amount);
  }
  if (ach.current >= ach.target && !ach.unlocked) {
    ach.unlocked = true;
    play('achievement');
    emitNotice('success', `🏆 Pencapaian Terbuka: "${ach.title}"! Buka profil untuk klaim.`);
  }
}

export function trackAchievement(id: string, amount = 1, absolute = false) {
  update(d => {
    trackAchievementInternal(d, id, amount, absolute);
  });
}

export function claimAchievement(id: string): boolean {
  let ok = false;
  update(d => {
    const a = d.economy.achievements.find(x => x.id === id);
    if (!a || !a.unlocked || a.claimed) return;
    a.claimed = true;
    applyXpAndChips(d, a.rewardXp, a.rewardChips);
    ok = true;
  });
  if (ok) play('win');
  return ok;
}

export function recordResult(r: LocalResult) {
  update(d => {
    d.history = [r, ...d.history].slice(0, 100);

    const won = r.rank === 1;
    const gainedXp = won ? 160 : r.rank === 2 ? 80 : 40;
    const gainedChips = won ? 1500 : r.rank === 2 ? 500 : 200;

    applyXpAndChips(d, gainedXp, gainedChips);

    // Achievements tracking
    trackAchievementInternal(d, 'first_game', 1);
    if (won) {
      trackAchievementInternal(d, 'first_win', 1);
      trackAchievementInternal(d, 'five_wins', 1);
      if (r.gameId === 'holdem') trackAchievementInternal(d, 'holdem_pro', 1);
      if (r.gameId === 'cangkulan') trackAchievementInternal(d, 'cangkulan_master', 1);
    }

    // Update quest progress
    for (const q of d.economy.quests) {
      if (q.id === 'play_games') q.current = Math.min(q.target, q.current + 1);
      if (q.id === 'win_games' && won) q.current = Math.min(q.target, q.current + 1);
      if (q.id === 'play_holdem' && r.gameId === 'holdem') q.current = Math.min(q.target, q.current + 1);
      if (q.id === 'play_cangkulan_bj' && (r.gameId === 'cangkulan' || r.gameId === 'blackjack')) {
        q.current = Math.min(q.target, q.current + 1);
      }
      if (q.current >= q.target) q.completed = true;
    }
  });
}

export function claimQuest(questId: string): boolean {
  let ok = false;
  update(d => {
    const q = d.economy.quests.find(x => x.id === questId);
    if (!q || !q.completed || q.claimed) return;
    q.claimed = true;
    applyXpAndChips(d, q.rewardXp, q.rewardChips);
    ok = true;
  });
  if (ok) play('win');
  return ok;
}

export function claimDailyBonus(): { ok: boolean; chips: number; nextInMs: number } {
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  const left = Math.max(0, data.economy.lastDailyClaim + cooldown - now);
  if (left > 0) return { ok: false, chips: 0, nextInMs: left };

  const reward = 3000 + data.economy.level * 250;
  update(d => {
    d.economy.lastDailyClaim = now;
    applyXpAndChips(d, 100, reward);
  });
  return { ok: true, chips: reward, nextInMs: cooldown };
}

export function claimHourlyBonus(): { ok: boolean; chips: number; nextInMs: number } {
  const now = Date.now();
  const cooldown = 60 * 60 * 1000;
  const left = Math.max(0, data.economy.lastHourlyClaim + cooldown - now);
  if (left > 0) return { ok: false, chips: 0, nextInMs: left };

  const reward = 600;
  update(d => {
    d.economy.lastHourlyClaim = now;
    applyXpAndChips(d, 25, reward);
  });
  return { ok: true, chips: reward, nextInMs: cooldown };
}

export function spinLuckyWheel(wonChips: number) {
  const now = Date.now();
  update(d => {
    d.economy.lastSpinTime = now;
    applyXpAndChips(d, 50, wonChips);
    trackAchievementInternal(d, 'wheel_spinner', 1);
  });
}

/** Bantuan kebangkrutan hanya untuk saldo di bawah batas ini. */
export const BANKRUPT_LIMIT = 2000;

/** Sisa kuota bantuan hari ini (kuota direset tiap ganti tanggal). */
export const refillsLeftToday = (eco: Economy) => (eco.lastRefillDate !== new Date().toDateString() ? 3 : eco.freeRefillsToday);

export function claimBankruptcyRefill(): { ok: boolean; chips: number; reason?: 'quota' | 'not_broke' } {
  const today = new Date().toDateString();
  let ok = false;
  let reason: 'quota' | 'not_broke' | undefined;
  const amount = 2500;
  update(d => {
    if (d.economy.lastRefillDate !== today) {
      d.economy.freeRefillsToday = 3;
      d.economy.lastRefillDate = today;
    }
    if (d.economy.chips >= BANKRUPT_LIMIT) { reason = 'not_broke'; return; }
    if (d.economy.freeRefillsToday <= 0) { reason = 'quota'; return; }
    d.economy.freeRefillsToday -= 1;
    d.economy.chips += amount;
    ok = true;
  });
  return { ok, chips: amount, reason };
}

export function rebuyChips(amount = 10000): { ok: boolean; added: number } {
  update(d => {
    d.economy.chips += amount;
  });
  play('rebuy');
  emitNotice('success', `🪙 Berhasil isi ulang +${amount.toLocaleString('id-ID')} Chip!`);
  return { ok: true, added: amount };
}

export function setFeltTheme(felt: FeltTheme) {
  update(d => {
    d.economy.feltTheme = felt;
    trackAchievementInternal(d, 'table_designer', 1);
  });
}

export function setCardTheme(card: CardTheme) {
  update(d => {
    d.economy.cardTheme = card;
    trackAchievementInternal(d, 'table_designer', 1);
  });
}

export function toggleBgm(): boolean {
  let next = false;
  update(d => {
    d.settings.bgm = !d.settings.bgm;
    next = d.settings.bgm;
  });
  if (next) startBgm();
  else stopBgm();
  return next;
}

export function setBgmVolume(vol: number) {
  update(d => {
    d.settings.bgmVolume = vol;
  });
  updateBgmVolume(vol);
}

export function toggleFavorite(id: string) {
  update(d => {
    d.favorites = d.favorites.includes(id) ? d.favorites.filter(x => x !== id) : [...d.favorites, id];
  });
}

export function statsFor(history: LocalResult[]) {
  const by = new Map<string, { played: number; wins: number }>();
  for (const h of history) {
    const s = by.get(h.gameId) ?? { played: 0, wins: 0 };
    s.played++;
    if (h.rank === 1) s.wins++;
    by.set(h.gameId, s);
  }
  const played = history.length;
  const wins = history.filter(h => h.rank === 1).length;
  return { played, wins, rate: played ? Math.round((wins / played) * 100) : 0, by };
}

export function resetLocal() {
  const keep = data.session;
  data = { ...defaults(), session: keep, onboarded: true };
  update(() => data);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    emitNotice('warn', 'Browser ini tidak mendukung Web Notifications.');
    return false;
  }
  if (Notification.permission === 'granted') {
    update(d => { d.settings.notifications = true; });
    emitNotice('success', '🔔 Notifikasi browser sudah aktif!');
    return true;
  }
  try {
    const res = await Notification.requestPermission();
    if (res === 'granted') {
      update(d => { d.settings.notifications = true; });
      emitNotice('success', '🔔 Notifikasi browser berhasil diaktifkan!');
      try {
        new Notification('Cardora Aktif', {
          body: 'Notifikasi giliran, ajakan room teman, dan bonus harian siap ditampilkan.',
          icon: '/favicon.svg',
        });
      } catch {}
      return true;
    } else {
      update(d => { d.settings.notifications = false; });
      emitNotice('warn', 'Izin notifikasi ditolak oleh browser.');
      return false;
    }
  } catch {
    return false;
  }
}

export function sendPushNotification(title: string, body: string) {
  if (
    data.settings.notifications &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
    } catch {}
  }
}

/** Animasi efektif: hormati prefers-reduced-motion sistem. */
export function effectiveMotion(s: Settings): Settings['animations'] {
  if (s.animations === 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced';
  return s.animations;
}

export function exportProgressBackup(): string {
  const payload = {
    version: 2,
    exportedAt: Date.now(),
    profile: data.profile,
    economy: data.economy,
    history: data.history,
    favorites: data.favorites,
    settings: data.settings,
  };
  const json = JSON.stringify(payload);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return `CARDORA-BACKUP-${base64}`;
}

export function importProgressBackup(backupStr: string): { ok: boolean; message: string } {
  try {
    let clean = backupStr.trim();
    if (clean.startsWith('CARDORA-BACKUP-')) {
      clean = clean.replace('CARDORA-BACKUP-', '');
    } else if (clean.startsWith('KUY-BACKUP-')) {
      clean = clean.replace('KUY-BACKUP-', '');
    }
    const json = decodeURIComponent(escape(atob(clean)));
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !parsed.economy || !parsed.profile) {
      return { ok: false, message: 'Format kode cadangan tidak valid atau rusak.' };
    }

    update(d => {
      d.profile = { ...d.profile, ...parsed.profile };
      d.economy = { ...d.economy, ...parsed.economy };
      if (Array.isArray(parsed.history)) d.history = parsed.history;
      if (Array.isArray(parsed.favorites)) d.favorites = parsed.favorites;
      if (parsed.settings) d.settings = { ...d.settings, ...parsed.settings };
    });

    play('achievement');
    emitNotice('success', `🎉 Progres berhasil dipulihkan! Saldo: ${parsed.economy.chips.toLocaleString('id-ID')} Chip, Level ${parsed.economy.level}.`);
    return { ok: true, message: 'Progres berhasil dipulihkan!' };
  } catch (e: any) {
    return { ok: false, message: `Gagal memulihkan: ${e.message || 'Kode cadangan tidak valid'}` };
  }
}

export function downloadBackupFile() {
  const backup = exportProgressBackup();
  const blob = new Blob([backup], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cardora-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  emitNotice('success', '📥 File cadangan progres berhasil diunduh!');
}

export function claimRegisterBonus() {
  const BONUS_CHIPS = 25000;
  const BONUS_XP = 200;
  update(d => {
    applyXpAndChips(d, BONUS_XP, BONUS_CHIPS);
  });
  play('achievement');
  emitNotice('success', `🎁 Bonus Akun Terhubung: +${BONUS_CHIPS.toLocaleString('id-ID')} Chip & +${BONUS_XP} XP! Progresmu kini aman.`);
}

