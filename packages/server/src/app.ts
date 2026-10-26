// app.ts — rakit HTTP + Socket.IO. Dipisah dari index.ts agar bisa diuji.
import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient, Ack } from '@kuypoker/engine';
import { config as defaultConfig, type Config } from './config';
import { RoomManager, UserError } from './rooms';
import { RateLimiter } from './rateLimit';
import { apiRouter, persistResults, verifyToken } from './api';
import { log } from './logger';

export interface AppHandle {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient>;
  rooms: RoomManager;
  close(): Promise<void>;
}

/** Origin bawaan yang selalu diizinkan: dev lokal & aplikasi Capacitor. */
const DEFAULT_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(:\d+)?$/, // LAN (uji di HP)
  'capacitor://localhost', 'ionic://localhost', 'https://localhost',
];

export function createApp(cfg: Config = defaultConfig): AppHandle {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use('/api', apiRouter(uid => rooms.presence(uid)));

  // Sajikan build web (opsional) dari server yang sama → satu domain, tanpa CORS.
  const webDist = cfg.webDist ? resolve(cfg.webDist) : '';
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
    log.info('serving web build', { dir: webDist });
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('http error', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Terjadi kesalahan di server' });
  });

  function originAllowed(origin: string) {
    if (cfg.corsOrigins.includes(origin)) return true;
    return DEFAULT_ORIGINS.some(o => (typeof o === 'string' ? o === origin : o.test(origin)));
  }

  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: { origin: (origin, cb) => cb(null, !origin || originAllowed(origin)) },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const rooms = new RoomManager({
    room: (pid, room) => io.to(`p:${pid}`).emit('room:state', room),
    view: (pid, view) => io.to(`p:${pid}`).emit('game:view', view),
    notice: (pid, kind, text) => io.to(`p:${pid}`).emit('room:notice', { kind, text }),
    closed: (pid, reason) => io.to(`p:${pid}`).emit('room:closed', { reason }),
    chat: (pid, msg) => io.to(`p:${pid}`).emit('room:chat', msg),
  }, persistResults, cfg);

  const actionLimiter = new RateLimiter(process.env.NODE_ENV === 'test' ? 100 : 20, process.env.NODE_ENV === 'test' ? 50 : 8); // per socket: burst 20, 8/detik (diuji test lebih tinggi)
  const createLimiter = new RateLimiter(cfg.createRoomBurst, 1 / 30); // per IP, isi ulang 1 per 30 detik
  const joinLimiter = new RateLimiter(cfg.joinBurst, 1 / 6);          // per IP: tebakan kode dibatasi

  io.on('connection', (socket) => {
    let playerId: string | null = null;
    const addr = socket.handshake.address;

    /** Bungkus handler: rate limit, sesi wajib, error → pesan ramah. */
    const on = <K extends keyof ClientToServer>(event: K, handler: (p: any) => unknown, opts: { needSession?: boolean } = {}) => {
      socket.on(event as any, (payload: unknown, ack: Ack<any>) => {
        const reply: Ack<any> = typeof ack === 'function' ? ack : () => {};
        if (!actionLimiter.take(socket.id)) return reply({ ok: false, error: 'Terlalu cepat — tunggu sebentar' });
        if (opts.needSession !== false && !playerId) return reply({ ok: false, error: 'Sesi belum dimulai' });
        try {
          const data = handler(payload ?? {});
          reply({ ok: true, data });
        } catch (e) {
          if (e instanceof UserError) return reply({ ok: false, error: e.message });
          log.error('socket handler error', { event, err: e instanceof Error ? e.message : String(e) });
          reply({ ok: false, error: 'Terjadi kesalahan di server' });
        }
      });
    };

    on('session:hello', (p: { sessionToken?: string; name?: string; avatar?: string; authToken?: string }) => {
      if (playerId) socket.leave(`p:${playerId}`);
      const userId = verifyToken(p.authToken);
      const s = rooms.hello(typeof p.sessionToken === 'string' ? p.sessionToken : undefined, p.name, p.avatar, userId);
      // Satu sesi bisa punya beberapa tab; semua menerima update.
      playerId = s.playerId;
      socket.join(`p:${playerId}`);
      const room = s.roomCode ? rooms.rooms.get(s.roomCode) : undefined;
      if (room) {
        const v = rooms.gameViewFor(room, s.playerId);
        if (v) setTimeout(() => socket.emit('game:view', v), 0);
      }
      return { sessionToken: s.token, playerId: s.playerId, room: room ? rooms.roomView(room, s.playerId) : null };
    }, { needSession: false });

    on('room:create', (p) => {
      if (!createLimiter.take(addr)) throw new UserError('Terlalu banyak room dibuat, tunggu sebentar');
      const room = rooms.create(playerId!, p.gameId, p.maxPlayers);
      return { room: rooms.roomView(room, playerId!) };
    });
    on('room:join', (p) => {
      if (!joinLimiter.take(addr)) throw new UserError('Terlalu banyak percobaan kode, tunggu sebentar');
      const room = rooms.join(playerId!, p.code);
      return { room: rooms.roomView(room, playerId!) };
    });
    on('room:leave', () => rooms.leave(playerId!));
    on('room:ready', (p) => rooms.setReady(playerId!, !!p.ready));
    on('room:configure', (p) => rooms.configure(playerId!, p));
    on('room:addBot', () => rooms.addBot(playerId!));
    on('room:removeBot', (p) => rooms.removeBot(playerId!, p.slot));
    on('room:start', () => rooms.start(playerId!));
    on('room:rematch', () => rooms.rematch(playerId!));
    on('room:endSeries', () => rooms.endSeries(playerId!));
    on('game:action', (p) => rooms.action(playerId!, p.action));
    on('room:chat', (p) => rooms.chat(playerId!, p.text));

    socket.on('disconnect', async () => {
      if (!playerId) return;
      // Masih ada tab lain dari sesi yang sama? Jangan anggap terputus.
      const others = await io.in(`p:${playerId}`).fetchSockets();
      if (others.length === 0) rooms.disconnect(playerId);
    });
  });

  return {
    http, io, rooms,
    close: () => new Promise<void>(res => { rooms.dispose(); io.close(); http.close(() => res()); }),
  };
}
