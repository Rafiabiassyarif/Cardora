// Integration test: seri ronde di room online (auto-lanjut ronde / tanpa batas).
// Ronde dipicu "selesai" secara langsung agar tes cepat & deterministik;
// deteksi selesai oleh engine sudah diuji di paket engine.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as clientIo, type Socket } from 'socket.io-client';

const dataDir = mkdtempSync(join(tmpdir(), 'cardora-series-'));
process.env.KUYPOKER_DATA_DIR = dataDir;

const { createApp } = await import('../src/app');
const { config } = await import('../src/config');

let base = '';
let close: () => Promise<void>;
let app: any;
const INTERMISSION = 400;

beforeAll(async () => {
  app = createApp({ ...config, port: 0, databaseUrl: '', webDist: '', turnSeconds: 30, botDelayMs: 20, intermissionMs: INTERMISSION });
  await new Promise<void>(r => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  close = app.close;
});
afterAll(async () => { await close(); rmSync(dataDir, { recursive: true, force: true }); });

function sock(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = clientIo(base, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const ack = <T = any>(s: Socket, ev: string, payload: any = {}): Promise<{ ok: boolean; error?: string; data?: T }> =>
  new Promise(res => s.emit(ev, payload, res as any));
const waitFor = async (fn: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 40)); }
  return false;
};
/** Tandai ronde sekarang selesai lalu jalankan alur "setelah perubahan" di server. */
function finishRound(code: string) {
  const room = app.rooms.rooms.get(code);
  room.game.state = { ...room.game.state, over: true };
  app.rooms.afterChange(room);
  return room;
}

describe('seri ronde room online', () => {
  it('tanpa batas: ronde berikutnya mulai otomatis, tidak kembali ke lobby', async () => {
    const host = await sock();
    try {
      await ack(host, 'session:hello', { name: 'Host Uji', avatar: '🦊' });
      const created = await ack<{ room: any }>(host, 'room:create', { gameId: 'cangkulan', maxPlayers: 2 });
      const code = created.data!.room.code;
      expect(created.data!.room.series).toEqual({ round: 0, rounds: 3, intermission: false });

      expect((await ack(host, 'room:configure', { seriesRounds: 0 })).ok).toBe(true);
      expect((await ack(host, 'room:addBot')).ok).toBe(true);

      const live = () => app.rooms.rooms.get(code);
      let room: any = null;
      host.on('room:state', (r: any) => { room = r; });
      expect((await ack(host, 'room:start')).ok).toBe(true);
      expect(await waitFor(() => live()?.status === 'playing' && live()?.series.round === 1)).toBe(true);
      // Klien menerima info seri di room:state.
      expect(await waitFor(() => !!room && room.series?.round === 1)).toBe(true);
      expect(room.series.rounds).toBe(0);

      const r1 = finishRound(code);
      expect(r1.series.nextAt).not.toBeNull();
      expect(await waitFor(() => !!room && room.series.intermission)).toBe(true);

      // Ronde 2 dimulai otomatis tanpa aksi host, kursi tetap.
      expect(await waitFor(() => live()?.series.round === 2 && live()?.status === 'playing' && live()?.series.nextAt === null, 5000)).toBe(true);
      expect(live()?.game?.seatSlots.length).toBe(2);
    } finally { host.close(); }
  }, 20000);

  it('batas ronde: setelah ronde terakhir, seri selesai (status finished)', async () => {
    const host = await sock();
    try {
      await ack(host, 'session:hello', { name: 'Host Dua', avatar: '🐼' });
      const created = await ack<{ room: any }>(host, 'room:create', { gameId: 'cangkulan', maxPlayers: 2 });
      const code = created.data!.room.code;
      expect((await ack(host, 'room:configure', { seriesRounds: 1 })).ok).toBe(true);
      expect((await ack(host, 'room:addBot')).ok).toBe(true);
      expect((await ack(host, 'room:start')).ok).toBe(true);

      const live = () => app.rooms.rooms.get(code);
      expect(await waitFor(() => live()?.status === 'playing')).toBe(true);

      finishRound(code);
      expect(await waitFor(() => live()?.status === 'finished')).toBe(true);
      expect(live()?.series.round).toBe(1);

      expect((await ack(host, 'room:endSeries')).ok).toBe(true);
      expect(await waitFor(() => live()?.status === 'lobby')).toBe(true);
      expect(live()?.series.round).toBe(0);
    } finally { host.close(); }
  }, 20000);

  it('hanya host yang boleh mengubah jumlah ronde / mengakhiri seri', async () => {
    const host = await sock();
    const guest = await sock();
    try {
      await ack(host, 'session:hello', { name: 'Host Tiga', avatar: '🦊' });
      await ack(guest, 'session:hello', { name: 'Tamu Tiga', avatar: '🐼' });
      const created = await ack<{ room: any }>(host, 'room:create', { gameId: 'cangkulan', maxPlayers: 2 });
      const code = created.data!.room.code;
      expect((await ack(guest, 'room:join', { code })).ok).toBe(true);

      expect((await ack(guest, 'room:configure', { seriesRounds: 5 })).ok).toBe(false);
      expect((await ack(host, 'room:configure', { seriesRounds: 5 })).ok).toBe(true);
      expect((await ack(guest, 'room:endSeries')).ok).toBe(false);
      expect((await ack(host, 'room:configure', { seriesRounds: 99 })).ok).toBe(false);
      expect((await ack(host, 'room:configure', { seriesRounds: -1 })).ok).toBe(false);
    } finally { host.close(); guest.close(); }
  }, 20000);
});
