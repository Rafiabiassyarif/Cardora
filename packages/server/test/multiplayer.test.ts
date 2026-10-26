// Integration test: server Socket.IO sungguhan + beberapa klien socket.io-client.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp, type AppHandle } from '../src/app';
import { config } from '../src/config';
import type { HoldemView, CangkulanView, RoomView, BaseView } from '@kuypoker/engine';

let app: AppHandle & { url: string };
let url: string;
const sockets: Socket[] = [];

async function start(over: Partial<typeof config>) {
  const a = createApp({ ...config, port: 0, turnSeconds: 2, reconnectGraceSeconds: 2, databaseUrl: '', webDist: '', ...over });
  await new Promise<void>(r => a.http.listen(0, '127.0.0.1', r));
  return Object.assign(a, { url: `http://127.0.0.1:${(a.http.address() as AddressInfo).port}` });
}

beforeAll(async () => {
  // Batas rate limit dinaikkan untuk test fungsional (semua klien dari satu IP);
  // rate limiting sendiri diuji di server terpisah dengan batas produksi.
  app = await start({ createRoomBurst: 1000, joinBurst: 1000 });
  url = app.url;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
});

interface Client {
  socket: Socket;
  token: string;
  room: RoomView | null;
  view: BaseView | null;
  notices: string[];
  closed: string[];
  call<T = any>(event: string, payload?: unknown): Promise<T>;
  callRaw(event: string, payload?: unknown): Promise<{ ok: boolean; error?: string; data?: any }>;
}

async function client(name: string, token?: string, base = url): Promise<Client> {
  const socket = connect(base, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const c: Client = {
    socket, token: '', room: null, view: null, notices: [], closed: [],
    callRaw: (event, payload = {}) => new Promise(res => socket.emit(event, payload, res)),
    async call(event, payload = {}) {
      const r = await c.callRaw(event, payload);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  };
  socket.on('room:state', r => { c.room = r; });
  socket.on('game:view', v => { c.view = v; });
  socket.on('room:notice', n => c.notices.push(n.text));
  socket.on('room:closed', n => { c.closed.push(n.reason); c.room = null; });
  await new Promise<void>(r => socket.on('connect', () => r()));
  const hello = await c.call('session:hello', { name, avatar: '🦊', sessionToken: token });
  c.token = hello.sessionToken;
  if (hello.room) c.room = hello.room;
  return c;
}

const until = async (pred: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout menunggu kondisi');
    await new Promise(r => setTimeout(r, 20));
  }
};

describe('room code & lobby', () => {
  it('membuat room → kode 6 karakter tanpa karakter ambigu', async () => {
    const a = await client('Andi');
    const { room } = await a.call('room:create', { gameId: 'holdem', maxPlayers: 4 });
    expect(room.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(room.members).toHaveLength(1);
    expect(room.members[0].isHost).toBe(true);
    await a.call('room:leave');
  });

  it('kode tidak valid / tidak ada / game tidak dikenal ditolak dengan pesan jelas', async () => {
    const a = await client('Budi');
    expect((await a.callRaw('room:join', { code: '12' })).error).toMatch(/6 karakter/);
    expect((await a.callRaw('room:join', { code: 'ZZZZZZ' })).error).toMatch(/tidak ditemukan/);
    expect((await a.callRaw('room:create', { gameId: 'xyz', maxPlayers: 4 })).error).toMatch(/tidak dikenal/);
  });

  it('room penuh ditolak; host-only actions dijaga', async () => {
    const h = await client('Host');
    const { room } = await h.call('room:create', { gameId: 'cangkulan', maxPlayers: 2 });
    const g = await client('Tamu');
    await g.call('room:join', { code: room.code.toLowerCase() }); // case-insensitive
    const x = await client('Telat');
    expect((await x.callRaw('room:join', { code: room.code })).error).toMatch(/penuh/);
    expect((await g.callRaw('room:start')).error).toMatch(/host/);
    expect((await g.callRaw('room:configure', { maxPlayers: 4 })).error).toMatch(/host/);
    await h.call('room:leave'); await g.call('room:leave');
  });

  it('host wajib menunggu semua siap; host berpindah saat host keluar', async () => {
    const h = await client('H1');
    const { room } = await h.call('room:create', { gameId: 'cangkulan', maxPlayers: 3 });
    const g = await client('G1');
    await g.call('room:join', { code: room.code });
    expect((await h.callRaw('room:start')).error).toMatch(/Menunggu siap: G1/);
    await h.call('room:leave');
    await until(() => !!g.room?.members.find(m => m.isYou)?.isHost);
    expect(g.room!.members).toHaveLength(1);
    await g.call('room:leave');
  });

  it('room ditutup jika semua manusia keluar', async () => {
    const h = await client('Solo');
    const { room } = await h.call('room:create', { gameId: 'holdem', maxPlayers: 4 });
    await h.call('room:addBot');
    await h.call('room:leave');
    expect(app.rooms.rooms.has(room.code)).toBe(false);
  });
});

describe('permainan online authoritative', () => {
  it("Hold'em 2 manusia: kartu lawan TIDAK pernah dikirim; giliran divalidasi", async () => {
    const a = await client('Ani');
    const { room } = await a.call('room:create', { gameId: 'holdem', maxPlayers: 3 });
    const b = await client('Bayu');
    await b.call('room:join', { code: room.code });
    await b.call('room:ready', { ready: true });
    // Rekam semua payload game:view mentah yang diterima B.
    const rawB: string[] = [];
    b.socket.on('game:view', v => rawB.push(JSON.stringify(v)));
    await a.call('room:start');
    await until(() => (a.view as HoldemView)?.gameId === 'holdem' && (b.view as HoldemView)?.gameId === 'holdem');

    const state = app.rooms.rooms.get(room.code)!.game!.state;
    const va = a.view as HoldemView, vb = b.view as HoldemView;
    const seatA = va.you!, seatB = vb.you!;
    expect(seatA).not.toBe(seatB);
    expect(va.seats[seatA].hole.every(Boolean)).toBe(true);
    expect(va.seats[seatB].hole).toEqual([null, null]);
    for (const c of state.seats[seatA].hole) for (const raw of rawB) expect(raw).not.toContain(`"${c}"`);
    for (const raw of rawB) expect(raw).not.toContain('"deck"');

    // Pemain yang bukan giliran ditolak.
    const notTurn = va.turn === seatA ? b : a;
    expect((await notTurn.callRaw('game:action', { action: { type: 'fold' } })).error).toMatch(/giliran/);
    // Aksi ilegal ditolak.
    const turnClient = va.turn === seatA ? a : b;
    expect((await turnClient.callRaw('game:action', { action: { type: 'raise', amount: 1 } })).error).toMatch(/minimum/);
    expect((await turnClient.callRaw('game:action', { action: 'garbage' })).error).toBeTruthy();
    // Fold → tangan selesai, pemenang dapat pot.
    await turnClient.call('game:action', { action: { type: 'fold' } });
    await until(() => (a.view as HoldemView).street === 'handOver');
    expect((a.view as HoldemView).lastHand!.winners).toHaveLength(1);
    await a.call('room:leave'); await b.call('room:leave');
  });

  it('reconnect dengan token sesi → kursi & kartu kembali; token lain tidak bisa mengambil alih', async () => {
    const a = await client('Cici');
    const { room } = await a.call('room:create', { gameId: 'cangkulan', maxPlayers: 2 });
    const b = await client('Dodi');
    await b.call('room:join', { code: room.code });
    await b.call('room:ready', { ready: true });
    await a.call('room:start');
    await until(() => (b.view as CangkulanView)?.hand?.length > 0);
    const handBefore = (b.view as CangkulanView).hand.slice().sort();

    b.socket.disconnect();
    await until(() => a.room?.members.find(m => !m.isYou)?.connected === false);
    expect(a.notices.some(n => /terputus/.test(n))).toBe(true);

    // Penyusup dengan token acak tidak mendapat room B.
    const intruder = await client('Iseng', 'f'.repeat(64));
    expect(intruder.room).toBeNull();

    const b2 = await client('Dodi', b.token);
    expect(b2.room?.code).toBe(room.code);
    await until(() => (b2.view as CangkulanView)?.gameId === 'cangkulan');
    const v = b2.view as CangkulanView;
    // Tangan setelah reconnect = tangan authoritative di server untuk seat B (persis).
    const srv = app.rooms.rooms.get(room.code)!.game!.state;
    expect(v.hand.slice().sort()).toEqual(srv.hands[v.you!].slice().sort());
    expect(handBefore.length).toBeGreaterThan(0);
    await until(() => a.room?.members.every(m => m.connected) === true);
    await a.call('room:leave'); await b2.call('room:leave');
  });

  it('pemain terputus saat giliran → aksi otomatis, meja tidak macet', async () => {
    const a = await client('Eka');
    const { room } = await a.call('room:create', { gameId: 'blackjack', maxPlayers: 2 });
    const b = await client('Fajar');
    await b.call('room:join', { code: room.code });
    await b.call('room:ready', { ready: true });
    await a.call('room:start');
    await until(() => a.view?.gameId === 'blackjack');
    const g = app.rooms.rooms.get(room.code)!.game!;
    const roundBefore = g.state.round;
    // Keduanya tidak beraksi; B putus. Timer (2 dtk / 5 dtk saat putus) harus memajukan permainan.
    b.socket.disconnect();
    await until(() => g.state.phase !== 'betting' || g.state.round > roundBefore, 9000);
    expect(a.notices.some(n => /kehabisan waktu/.test(n))).toBe(true);
    await a.call('room:leave');
  }, 15000);

  it('host + bot menyelesaikan Cangkulan; rematch kembali ke lobby', async () => {
    const a = await client('Gita');
    const { room } = await a.call('room:create', { gameId: 'cangkulan', maxPlayers: 3 });
    await a.call('room:configure', { options: { handSize: 5 } });
    await a.call('room:addBot');
    await a.call('room:addBot');
    expect(a.room!.members).toHaveLength(3);
    await a.call('room:start');
    // Mainkan sebagai manusia: aksi legal pertama setiap giliran.
    const deadline = Date.now() + 60000;
    while (a.room?.status !== 'finished' && Date.now() < deadline) {
      const v = a.view as CangkulanView | null;
      if (v?.turn === v?.you && v?.legal) {
        const l = v.legal;
        const action = l.playable.length ? { type: 'play', card: l.playable[0] } : l.canDraw ? { type: 'draw' } : { type: 'pass' };
        await a.callRaw('game:action', { action });
      }
      await new Promise(r => setTimeout(r, 30));
    }
    expect(a.room?.status).toBe('finished');
    expect(a.view?.results).toHaveLength(3);
    await a.call('room:rematch');
    await until(() => a.room?.status === 'lobby');
    await a.call('room:leave');
  }, 70000);
});

describe('rate limiting (batas produksi)', () => {
  it('menebak kode room & membuat room massal diblokir', async () => {
    const prod = await start({});
    try {
      const a = await client('Spammer', undefined, prod.url);
      const joins = [];
      for (let i = 0; i < 14; i++) joins.push((await a.callRaw('room:join', { code: 'QQQQQQ' })).error);
      expect(joins.slice(0, 10).every(e => /tidak ditemukan/.test(e!))).toBe(true);
      expect(joins.slice(10).every(e => /Terlalu banyak/.test(e!))).toBe(true);
      const creates = [];
      for (let i = 0; i < 7; i++) creates.push((await a.callRaw('room:create', { gameId: 'holdem', maxPlayers: 2 })).ok);
      expect(creates).toEqual([true, true, true, true, true, false, false]);
    } finally { await prod.close(); }
  });
});
