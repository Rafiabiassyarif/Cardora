// Unit test aturan ekonomi (chip/XP/misi/pencapaian) — dipakai server sebagai otoritas.
import { describe, expect, it } from 'vitest';
import {
  newEconomy, normalizeEconomy, settleGame, claimQuest, claimAchievement,
  claimDaily, claimHourly, spinWheel, claimRefill, applyEvent,
  levelForXp, vipTierForLevel, WHEEL_PRIZES, MAX_CHIPS_PER_MATCH, START_CHIPS,
  QUESTS, ACHIEVEMENTS, BANKRUPT_LIMIT, DAILY_COOLDOWN_MS, SPIN_COOLDOWN_MS,
} from '../src/economy';
import { seededRng } from '../src/rng';

describe('ekonomi akun', () => {
  it('level & VIP mengikuti XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(1500)).toBe(6);
    expect(vipTierForLevel(1)).toBe('Bronze');
    expect(vipTierForLevel(5)).toBe('Silver');
    expect(vipTierForLevel(10)).toBe('Gold');
    expect(vipTierForLevel(20)).toBe('Platinum');
    expect(vipTierForLevel(35)).toBe('Diamond');
  });

  it('state baru punya semua misi & pencapaian', () => {
    const eco = newEconomy();
    expect(eco.chips).toBe(START_CHIPS);
    expect(Object.keys(eco.quests).sort()).toEqual(QUESTS.map(q => q.id).sort());
    expect(Object.keys(eco.achievements).sort()).toEqual(ACHIEVEMENTS.map(a => a.id).sort());
  });

  it('hasil menang memberi chip & XP, dibatasi MAX_CHIPS_PER_MATCH', () => {
    const r = settleGame(newEconomy(), { gameId: 'holdem', rank: 1, players: 4, mode: 'bot' });
    expect(r.chipsDelta).toBe(500 + 250 * 3);
    expect(r.xpDelta).toBe(160);
    expect(r.state.chips).toBe(START_CHIPS + r.chipsDelta);
    expect(r.unlocked).toContain('first_game');
    expect(r.unlocked).toContain('first_win');
    expect(r.questsCompleted).toContain('win_games');

    const huge = settleGame(newEconomy(), { gameId: 'holdem', rank: 1, players: 99, mode: 'bot' });
    expect(huge.chipsDelta).toBe(MAX_CHIPS_PER_MATCH);
  });

  it('kalah tetap dapat hiburan kecil, tanpa progres kemenangan', () => {
    const r = settleGame(newEconomy(), { gameId: 'cangkulan', rank: 3, players: 4, mode: 'bot' });
    expect(r.chipsDelta).toBe(80);
    expect(r.unlocked).toContain('first_game');
    expect(r.unlocked).not.toContain('first_win');
  });

  it('misi hanya bisa diklaim sekali dan hanya bila selesai', () => {
    let eco = newEconomy();
    expect(claimQuest(eco, 'play_games').ok).toBe(false);
    for (let i = 0; i < 3; i++) eco = settleGame(eco, { gameId: 'holdem', rank: 2, players: 4, mode: 'bot' }).state;
    const first = claimQuest(eco, 'play_games');
    expect(first.ok).toBe(true);
    expect(first.reward!.chips).toBe(2000);
    expect(claimQuest(first.state, 'play_games').ok).toBe(false);
  });

  it('pencapaian terkunci tidak bisa diklaim', () => {
    const eco = newEconomy();
    expect(claimAchievement(eco, 'five_wins').ok).toBe(false);
  });

  it('bonus harian & jam mengikuti cooldown', () => {
    const t0 = 1_700_000_000_000;
    const d1 = claimDaily(newEconomy(t0), t0);
    expect(d1.ok).toBe(true);
    expect(d1.reward!.chips).toBe(3000 + 250);
    const d2 = claimDaily(d1.state, t0 + 1000);
    expect(d2.ok).toBe(false);
    expect(d2.nextInMs).toBeGreaterThan(0);
    expect(claimDaily(d1.state, t0 + DAILY_COOLDOWN_MS).ok).toBe(true);

    const h1 = claimHourly(newEconomy(t0), t0);
    expect(h1.reward!.chips).toBe(600);
    expect(claimHourly(h1.state, t0 + 60_000).ok).toBe(false);
  });

  it('roda: hadiah dipilih server, sekali per 12 jam', () => {
    const t0 = 1_700_000_000_000;
    const rng = seededRng(42);
    const s1 = spinWheel(newEconomy(t0), rng, t0);
    expect(s1.ok).toBe(true);
    expect(s1.reward!.index).toBeGreaterThanOrEqual(0);
    expect(s1.reward!.index).toBeLessThan(WHEEL_PRIZES.length);
    expect(s1.reward!.chips).toBe(WHEEL_PRIZES[s1.reward!.index]);
    expect(spinWheel(s1.state, rng, t0 + 60_000).ok).toBe(false);
    expect(spinWheel(s1.state, rng, t0 + SPIN_COOLDOWN_MS).ok).toBe(true);
  });

  it('bantuan darurat hanya saat saldo rendah & kuotanya terbatas', () => {
    const rich = newEconomy();
    expect(claimRefill(rich).ok).toBe(false);
    const poor = { ...newEconomy(), chips: BANKRUPT_LIMIT - 1 };
    const r1 = claimRefill(poor);
    expect(r1.ok).toBe(true);
    expect(r1.state.chips).toBe(poor.chips + 2500);
    let st = r1.state;
    for (let i = 0; i < 2; i++) st = claimRefill({ ...st, chips: 0 }).state;
    expect(claimRefill({ ...st, chips: 0 }).ok).toBe(false);
  });

  it('kejadian meja menambah progres pencapaian (maks target)', () => {
    let eco = newEconomy();
    for (let i = 0; i < 7; i++) eco = applyEvent(eco, 'chat');
    expect(eco.achievements.social_chatter.current).toBe(5);
    eco = applyEvent(eco, 'allin');
    expect(eco.achievements.allin_hero.current).toBe(1);
  });

  it('normalizeEconomy memperbaiki data rusak/negatif', () => {
    const eco = normalizeEconomy({ chips: -50, xp: -10, quests: { play_games: { current: 999, claimed: true } } } as any);
    expect(eco.chips).toBe(0);
    expect(eco.xp).toBe(0);
    expect(eco.quests.play_games.current).toBe(3);
    expect(eco.quests.play_games.claimed).toBe(true);
  });
});
