// Integration test: teman & peringkat memakai akun nyata (tanpa data contoh).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dataDir = mkdtempSync(join(tmpdir(), 'cardora-friends-'));
process.env.KUYPOKER_DATA_DIR = dataDir;

const { createApp } = await import('../src/app');
const { config } = await import('../src/config');

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

describe('teman & peringkat', () => {
  it('cari akun nyata, tambah, daftar, hapus', async () => {
    const a = await reg('andi_test');
    const b = await reg('bella_test');
    expect((await call('/users/search?q=bel')).status).toBe(401);

    const found = await call('/users/search?q=bel', { token: a.token });
    expect(found.body.users.map((u: any) => u.username)).toEqual(['bella_test']);
    expect(found.body.users[0].isFriend).toBe(false);
    expect((await call('/users/search?q=andi', { token: a.token })).body.users).toEqual([]); // diri sendiri tidak muncul

    expect((await call('/friends', { method: 'POST', token: a.token, body: { userId: a.user.id } })).status).toBe(400);
    expect((await call('/friends', { method: 'POST', token: a.token, body: { userId: 9999 } })).status).toBe(404);
    expect((await call('/friends', { method: 'POST', token: a.token, body: { userId: b.user.id } })).status).toBe(201);

    const list = await call('/friends', { token: a.token });
    expect(list.body.friends).toHaveLength(1);
    expect(list.body.friends[0]).toMatchObject({ username: 'bella_test', status: 'offline', played: 0 });
    expect((await call('/users/search?q=bel', { token: a.token })).body.users[0].isFriend).toBe(true);

    await call(`/friends/${b.user.id}`, { method: 'DELETE', token: a.token });
    expect((await call('/friends', { token: a.token })).body.friends).toEqual([]);
  });

  it('peringkat kosong bila belum ada pertandingan online', async () => {
    expect((await call('/leaderboard')).body.players).toEqual([]);
  });
});
