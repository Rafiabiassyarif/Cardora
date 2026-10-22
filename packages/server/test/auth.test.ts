// Integration test: alur akun REST (daftar, masuk, /me, Google) di server sungguhan.
// Memakai folder data sementara (KUYPOKER_DATA_DIR) sehingga tidak menyentuh data dev.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dataDir = mkdtempSync(join(tmpdir(), 'kuypoker-auth-'));
process.env.KUYPOKER_DATA_DIR = dataDir;

const { createApp } = await import('../src/app');
const { config } = await import('../src/config');
const { googleAuth } = await import('../src/api');

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

beforeAll(async () => {
  const a = createApp({ ...config, port: 0, databaseUrl: '', webDist: '' });
  await new Promise<void>(r => a.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(a.http.address() as AddressInfo).port}`;
  close = () => a.close();
});

afterAll(async () => {
  await close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Akun: daftar & masuk', () => {
  const username = `uji_${Date.now() % 100000}`;

  it('daftar → token & user; username kembar ditolak 409', async () => {
    const r = await call('/auth/register', { method: 'POST', body: { username, password: 'rahasia123', displayName: 'Uji' } });
    expect(r.status).toBe(201);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.user.username).toBe(username);
    const dup = await call('/auth/register', { method: 'POST', body: { username: username.toUpperCase(), password: 'rahasia123' } });
    expect(dup.status).toBe(409);
  });

  it('validasi input daftar', async () => {
    expect((await call('/auth/register', { method: 'POST', body: { username: 'a', password: 'rahasia123' } })).status).toBe(400);
    expect((await call('/auth/register', { method: 'POST', body: { username: 'valid_name', password: 'pendek' } })).status).toBe(400);
  });

  it('masuk benar → /me valid; password salah → 401', async () => {
    const ok = await call('/auth/login', { method: 'POST', body: { username, password: 'rahasia123' } });
    expect(ok.status).toBe(200);
    const me = await call('/me', { token: ok.body.token });
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(username);
    const bad = await call('/auth/login', { method: 'POST', body: { username, password: 'salahsekali' } });
    expect(bad.status).toBe(401);
    expect((await call('/me', { token: 'token-palsu' })).status).toBe(401);
  });
});

describe('Masuk dengan Google', () => {
  it('belum dikonfigurasi → config null & endpoint 503', async () => {
    config.googleClientId = '';
    expect((await call('/auth/config')).body.google).toBeNull();
    const r = await call('/auth/google', { method: 'POST', body: { credential: 'x'.repeat(40) } });
    expect(r.status).toBe(503);
  });

  it('token ditolak verifier → 401; token valid → akun dibuat lalu dipakai ulang', async () => {
    config.googleClientId = 'client-uji.apps.googleusercontent.com';
    expect((await call('/auth/config')).body.google).toBe(config.googleClientId);

    const original = googleAuth.verify;
    try {
      googleAuth.verify = async () => null;
      expect((await call('/auth/google', { method: 'POST', body: { credential: 'x'.repeat(40) } })).status).toBe(401);

      let seenAud = '';
      googleAuth.verify = async (_cred, aud) => { seenAud = aud; return { sub: 'g-123', email: 'budi.santoso@gmail.com', name: 'Budi Santoso' }; };
      const first = await call('/auth/google', { method: 'POST', body: { credential: 'y'.repeat(40) } });
      expect(seenAud).toBe(config.googleClientId);
      expect(first.status).toBe(201);
      expect(first.body.created).toBe(true);
      expect(first.body.user.username).toMatch(/^budisantoso/);

      const again = await call('/auth/google', { method: 'POST', body: { credential: 'z'.repeat(40) } });
      expect(again.status).toBe(200);
      expect(again.body.created).toBe(false);
      expect(again.body.user.id).toBe(first.body.user.id);

      const me = await call('/me', { token: again.body.token });
      expect(me.status).toBe(200);
      // Akun Google tidak bisa dimasuki dengan password apa pun.
      expect((await call('/auth/login', { method: 'POST', body: { username: first.body.user.username, password: '' } })).status).toBe(401);
    } finally {
      googleAuth.verify = original;
      config.googleClientId = '';
    }
  });
});
