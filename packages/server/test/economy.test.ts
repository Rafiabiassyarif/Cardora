// Integration test: chip/XP/misi disimpan di akun (server otoritatif).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dataDir = mkdtempSync(join(tmpdir(), 'cardora-eco-'));
process.env.KUYPOKER_DATA_DIR = dataDir;

const { createApp } = await import('../src/app');
const { config } = await import('../src/config');
const { START_CHIPS, BANKRUPT_LIMIT } = await import('@kuypoker/engine');

let base = '';
let close: () => Promise<void>;
async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const reg = async (u: string) => (await call('/auth/register', { method: 'POST', body: { username: u, password: 'rahasia123', displayName: u } })).body;

beforeAll(async () => {
  const a = createApp({ ...config, port: 0, databaseUrl: '', webDist: '' });
  await new Promise<void>(r => a.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(a.http.address() as AddressInfo).port}`;
  close = a.close;
});
afterAll(async () => { await close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('ekonomi akun', () => {
  it('butuh login', async () => {
    expect((await call('/economy')).status).toBe(401);
    expect((await call('/economy/settle', { method: 'POST', body: {} })).status).toBe(401);
  });

  it('saldo awal dari server, bukan dari klien', async () => {
    const u = await reg('eko_satu');
    const r = await call('/economy', { token: u.token });
    expect(r.status).toBe(200);
    expect(r.body.economy.chips).toBe(START_CHIPS);
    expect(r.body.economy.level).toBe(1);
    expect(r.body.economy.quests.length).toBeGreaterThan(0);
  });

  it('hasil pertandingan menambah chip & XP di server; klien tidak bisa mengirim jumlah chip', async () => {
    const u = await reg('eko_dua');
    // Klien mencoba menyuntik chips besar → diabaikan (server hanya pakai rank/players).
    const r = await call('/economy/settle', { method: 'POST', token: u.token, body: { gameId: 'holdem', rank: 1, players: 4, mode: 'bot', chips: 999999, xp: 999999 } });
    expect(r.status).toBe(200);
    expect(r.body.chipsDelta).toBe(1250);
    expect(r.body.economy.chips).toBe(START_CHIPS + 1250);
    expect(r.body.unlocked).toContain('first_game');

    const after = await call('/economy', { token: u.token });
    expect(after.body.economy.chips).toBe(START_CHIPS + 1250);
  });

  it('hasil kedua terlalu cepat ditolak (anti-spam)', async () => {
    const u = await reg('eko_tiga');
    expect((await call('/economy/settle', { method: 'POST', token: u.token, body: { gameId: 'holdem', rank: 1, players: 4 } })).status).toBe(200);
    const second = await call('/economy/settle', { method: 'POST', token: u.token, body: { gameId: 'holdem', rank: 1, players: 4 } });
    expect(second.status).toBe(429);
  });

  it('misi: belum selesai ditolak, setelah selesai bisa diklaim sekali', async () => {
    const u = await reg('eko_empat');
    const early = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'quest', id: 'play_games' } });
    expect(early.status).toBe(409);

    for (let i = 0; i < 3; i++) {
      await call('/economy/settle', { method: 'POST', token: u.token, body: { gameId: 'holdem', rank: 2, players: 4 } });
      await new Promise(r => setTimeout(r, 4100)); // jeda minimal antar hasil
    }
    const claimed = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'quest', id: 'play_games' } });
    expect(claimed.status).toBe(200);
    expect(claimed.body.reward.chips).toBe(2000);
    const again = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'quest', id: 'play_games' } });
    expect(again.status).toBe(409);
  }, 30000);

  it('roda: hadiah ditentukan server & cooldown 12 jam', async () => {
    const u = await reg('eko_lima');
    const first = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'spin' } });
    expect(first.status).toBe(200);
    expect(first.body.reward.index).toBeGreaterThanOrEqual(0);
    expect(first.body.reward.chips).toBeGreaterThan(0);
    const second = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'spin' } });
    expect(second.status).toBe(409);
  });

  it('bantuan darurat hanya saat saldo rendah', async () => {
    const u = await reg('eko_enam');
    const rich = await call('/economy/claim', { method: 'POST', token: u.token, body: { kind: 'refill' } });
    expect(rich.status).toBe(409);
    expect(rich.body.reason).toBe('not_broke');
  });

  it('migrasi saldo tamu hanya sekali per akun', async () => {
    const u = await reg('eko_tujuh');
    const m1 = await call('/economy/migrate', { method: 'POST', token: u.token, body: { chips: 45000 } });
    expect(m1.status).toBe(200);
    expect(m1.body.migrated).toBe(35000);
    expect(m1.body.economy.chips).toBe(45000);
    const m2 = await call('/economy/migrate', { method: 'POST', token: u.token, body: { chips: 90000 } });
    expect(m2.body.migrated).toBe(0);
    expect(m2.body.economy.chips).toBe(45000);
  });

  it('kejadian meja menambah progres pencapaian', async () => {
    const u = await reg('eko_delapan');
    const r = await call('/economy/event', { method: 'POST', token: u.token, body: { type: 'chat' } });
    expect(r.status).toBe(200);
    const chat = r.body.economy.achievements.find((a: any) => a.id === 'social_chatter');
    expect(chat.current).toBe(1);
    expect((await call('/economy/event', { method: 'POST', token: u.token, body: { type: 'ngawur' } })).status).toBe(400);
  });

  it('saldo & progres tidak hilang setelah server diakses ulang (tersimpan di akun)', async () => {
    const u = await reg('eko_sembilan');
    await call('/economy/settle', { method: 'POST', token: u.token, body: { gameId: 'cangkulan', rank: 1, players: 4 } });
    const again = await call('/economy', { token: u.token });
    expect(again.body.economy.chips).toBeGreaterThan(START_CHIPS);
    expect(again.body.economy.xp).toBeGreaterThan(0);
    expect(BANKRUPT_LIMIT).toBeGreaterThan(0);
  });
});
