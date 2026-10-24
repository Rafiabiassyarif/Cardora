// api.ts — REST: health, akun (opsional, butuh PostgreSQL), statistik online.
import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AVATARS, CATALOG } from '@kuypoker/engine';
import { config } from './config';
import { db, dbEnabled } from './db';
import { RateLimiter } from './rateLimit';
import type { ResultSink } from './rooms';
import { log } from './logger';

import { localUserStore } from './localUserStore';
import { randomBytes } from 'node:crypto';

const authLimiter = new RateLimiter(10, 10 / 60); // 10 percobaan, isi ulang 10/menit
let DUMMY_HASH: string | undefined;

export interface AuthUser { id: number; username: string; displayName: string; avatar: string }

export function signToken(userId: number) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: unknown): number | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub?: string };
    const id = Number(p.sub);
    return Number.isInteger(id) ? id : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Masuk dengan Google (Google Identity Services → ID token / "credential").
// Verifikasi memakai endpoint tokeninfo resmi Google (tanpa dependency tambahan), lalu
// klaim aud/iss/exp/email_verified dicek ulang di server. Tidak pernah percaya data dari klien.
// ---------------------------------------------------------------------------
export interface GoogleIdentity { sub: string; email: string; name: string }

async function verifyGoogleIdToken(credential: string, clientId: string): Promise<GoogleIdentity | null> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) {
    log.warn('google tokeninfo fetch failed', { status: res.status });
    return null;
  }
  const c = await res.json() as Record<string, string>;
  const issOk = c.iss === 'accounts.google.com' || c.iss === 'https://accounts.google.com';
  const notExpired = Number(c.exp) * 1000 > Date.now();
  const verified = c.email_verified === 'true' || (c.email_verified as unknown) === true;
  const targetId = clientId.trim();
  const audOk = c.aud?.trim() === targetId || c.azp?.trim() === targetId;
  if (!audOk || !issOk || !notExpired || !verified || !c.sub || !c.email) {
    log.warn('google token rejected', { audOk, issOk, notExpired, verified, aud: c.aud, azp: c.azp, expected: targetId });
    return null;
  }
  return { sub: c.sub, email: c.email, name: c.name || c.given_name || c.email.split('@')[0] };
}

/** Dapat diganti di test (tanpa memanggil Google sungguhan). */
export const googleAuth = { verify: verifyGoogleIdToken };

/** Username unik dari email/nama Google: huruf/angka/_ 3–20 karakter. */
async function uniqueUsername(seed: string, taken: (u: string) => Promise<boolean>): Promise<string> {
  let base = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
  if (base.length < 3) base = `pemain${base}`.slice(0, 16);
  if (!(await taken(base))) return base;
  for (let i = 0; i < 50; i++) {
    const cand = `${base.slice(0, 15)}${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 20);
    if (!(await taken(cand))) return cand;
  }
  return `g${randomBytes(6).toString('hex')}`.slice(0, 20);
}

const ip = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function bearer(req: Request) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export type Presence = (userId: number) => 'online' | 'playing' | 'offline';

export function apiRouter(presence: Presence = () => 'offline'): Router {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ 
    ok: true, 
    db: true, 
    storage: dbEnabled() ? 'postgres' : 'local_json',
    games: CATALOG.filter(g => g.status === 'available').map(g => g.id) 
  }));

  /** Konfigurasi login untuk klien (Client ID Google bersifat publik, bukan rahasia). */
  r.get('/auth/config', (_req, res) => res.json({ google: config.googleClientId || null }));

  r.post('/auth/google', wrap(async (req, res) => {
    if (!authLimiter.take(`google:${ip(req)}`)) return res.status(429).json({ error: 'Terlalu banyak percobaan, tunggu sebentar' });
    if (!config.googleClientId) return res.status(503).json({ error: 'Masuk dengan Google belum dikonfigurasi di server' });
    const { credential, displayName, avatar } = req.body ?? {};
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096) return res.status(400).json({ error: 'Token Google tidak valid' });

    let g: GoogleIdentity | null = null;
    try { g = await googleAuth.verify(credential, config.googleClientId); }
    catch (e) { log.warn('google verify failed', { err: String(e) }); return res.status(502).json({ error: 'Tidak bisa memverifikasi ke Google, coba lagi' }); }
    if (!g) return res.status(401).json({ error: 'Login Google ditolak atau kedaluwarsa' });

    const name = (typeof displayName === 'string' && displayName.trim() ? displayName.trim() : g.name).slice(0, 20);
    const av = AVATARS.includes(avatar) ? avatar : AVATARS[0];
    // Akun Google tidak punya password: simpan hash acak yang tidak mungkin ditebak.
    const unusableHash = () => bcrypt.hash(randomBytes(32).toString('hex'), 10);

    if (dbEnabled()) {
      const pool = db()!;
      const found = (await pool.query('SELECT id, username, display_name, avatar FROM users WHERE google_sub = $1', [g.sub])).rows[0];
      if (found) {
        return res.json({ token: signToken(Number(found.id)), user: { id: Number(found.id), username: found.username, displayName: found.display_name, avatar: found.avatar }, created: false });
      }
      const username = await uniqueUsername(g.email.split('@')[0], async u => (await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [u])).rowCount! > 0);
      const q = await pool.query('INSERT INTO users(username, password_hash, display_name, avatar, google_sub, email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [username, await unusableHash(), name, av, g.sub, g.email]);
      const id = Number(q.rows[0].id);
      return res.status(201).json({ token: signToken(id), user: { id, username, displayName: name, avatar: av }, created: true });
    }

    const found = await localUserStore.findByGoogleSub(g.sub);
    if (found) {
      return res.json({ token: signToken(found.id), user: { id: found.id, username: found.username, displayName: found.displayName, avatar: found.avatar }, created: false });
    }
    const username = await uniqueUsername(g.email.split('@')[0], u => localUserStore.usernameTaken(u));
    const user = await localUserStore.createUser(username, await unusableHash(), name, av, { googleSub: g.sub, email: g.email });
    return res.status(201).json({ token: signToken(user.id), user: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }, created: true });
  }));

  r.post('/auth/register', wrap(async (req, res) => {
    if (!authLimiter.take(`reg:${ip(req)}`)) return res.status(429).json({ error: 'Terlalu banyak percobaan, tunggu sebentar' });
    const { username, password, displayName, avatar } = req.body ?? {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3–20 karakter (huruf, angka, _)' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password 8–72 karakter' });
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 20) : username;
    const av = AVATARS.includes(avatar) ? avatar : AVATARS[0];
    const hash = await bcrypt.hash(password, 12);

    if (dbEnabled()) {
      try {
        const q = await db()!.query('INSERT INTO users(username, password_hash, display_name, avatar) VALUES ($1,$2,$3,$4) RETURNING id', [username, hash, name, av]);
        const id = Number(q.rows[0].id);
        return res.status(201).json({ token: signToken(id), user: { id, username, displayName: name, avatar: av } });
      } catch (e: any) {
        if (e?.code === '23505') return res.status(409).json({ error: 'Username sudah dipakai' });
        throw e;
      }
    } else {
      try {
        const user = await localUserStore.createUser(username, hash, name, av);
        return res.status(201).json({ token: signToken(user.id), user: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar } });
      } catch (e: any) {
        if (e?.code === '23505') return res.status(409).json({ error: 'Username sudah dipakai' });
        throw e;
      }
    }
  }));

  r.post('/auth/login', wrap(async (req, res) => {
    if (!authLimiter.take(`login:${ip(req)}`)) return res.status(429).json({ error: 'Terlalu banyak percobaan, tunggu sebentar' });
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username dan password wajib diisi' });

    if (dbEnabled()) {
      const q = await db()!.query('SELECT id, username, password_hash, display_name, avatar FROM users WHERE lower(username) = lower($1)', [username]);
      const u = q.rows[0];
      const ok = await bcrypt.compare(password, u?.password_hash ?? (DUMMY_HASH ??= await bcrypt.hash('kuypoker-dummy', 12)));
      if (!u || !ok) return res.status(401).json({ error: 'Username atau password salah' });
      return res.json({ token: signToken(Number(u.id)), user: { id: Number(u.id), username: u.username, displayName: u.display_name, avatar: u.avatar } });
    } else {
      const u = await localUserStore.findByUsername(username);
      const ok = await bcrypt.compare(password, u?.passwordHash ?? (DUMMY_HASH ??= await bcrypt.hash('kuypoker-dummy', 12)));
      if (!u || !ok) return res.status(401).json({ error: 'Username atau password salah' });
      return res.json({ token: signToken(u.id), user: { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar } });
    }
  }));

  r.get('/me', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Silakan masuk' });

    if (dbEnabled()) {
      const u = (await db()!.query('SELECT id, username, display_name, avatar FROM users WHERE id=$1', [id])).rows[0];
      if (!u) return res.status(401).json({ error: 'Akun tidak ditemukan' });
      const stats = (await db()!.query('SELECT game_id, played, wins FROM user_game_stats WHERE user_id=$1 ORDER BY played DESC', [id])).rows;
      const history = (await db()!.query(
        `SELECT m.game_id, m.finished_at, m.players, mp.rank, mp.score
           FROM match_players mp JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = $1 ORDER BY m.finished_at DESC LIMIT 20`, [id])).rows;
      return res.json({ user: { id: Number(u.id), username: u.username, displayName: u.display_name, avatar: u.avatar }, stats, history });
    } else {
      const u = await localUserStore.findById(id);
      if (!u) return res.status(401).json({ error: 'Akun tidak ditemukan' });
      const stats = Object.entries(u.stats).map(([game_id, s]) => ({ game_id, played: s.played, wins: s.wins }));
      return res.json({ user: { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar }, stats, history: u.history });
    }
  }));

  r.patch('/me', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Silakan masuk' });
    const { displayName, avatar } = req.body ?? {};
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 20) : null;
    const av = AVATARS.includes(avatar) ? avatar : null;

    if (dbEnabled()) {
      await db()!.query('UPDATE users SET display_name = COALESCE($2, display_name), avatar = COALESCE($3, avatar) WHERE id=$1', [id, name, av]);
    } else {
      await localUserStore.updateUser(id, { displayName: name, avatar: av });
    }
    return res.json({ ok: true });
  }));

  // ---------------- Teman & peringkat (data nyata dari akun terdaftar) ----------------
  const pub = (u: { id: number | string; username: string; display_name?: string; displayName?: string; avatar: string }) =>
    ({ id: Number(u.id), username: u.username, displayName: u.displayName ?? u.display_name ?? u.username, avatar: u.avatar });

  r.get('/users/search', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Masuk dulu untuk mencari teman' });
    const q = String(req.query.q ?? '').trim().replace(/^@/, '').slice(0, 20);
    if (q.length < 2) return res.json({ users: [] });
    if (dbEnabled()) {
      const rows = (await db()!.query(
        `SELECT u.id, u.username, u.display_name, u.avatar, (f.friend_id IS NOT NULL) AS is_friend
           FROM users u LEFT JOIN friendships f ON f.user_id = $1 AND f.friend_id = u.id
          WHERE u.id <> $1 AND (lower(u.username) LIKE lower($2) || '%' OR lower(u.display_name) LIKE '%' || lower($2) || '%')
          ORDER BY u.username LIMIT 8`, [id, q])).rows;
      return res.json({ users: rows.map(u => ({ ...pub(u), isFriend: u.is_friend })) });
    }
    const me = await localUserStore.findById(id);
    const mine = new Set(me?.friends ?? []);
    const users = await localUserStore.search(q, id);
    return res.json({ users: users.map(u => ({ ...pub(u), isFriend: mine.has(u.id) })) });
  }));

  r.get('/friends', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Silakan masuk' });
    const list = dbEnabled()
      ? (await db()!.query(
          `SELECT u.id, u.username, u.display_name, u.avatar,
                  COALESCE(SUM(s.wins),0)::int AS wins, COALESCE(SUM(s.played),0)::int AS played
             FROM friendships f JOIN users u ON u.id = f.friend_id
             LEFT JOIN user_game_stats s ON s.user_id = u.id
            WHERE f.user_id = $1 GROUP BY u.id ORDER BY u.username`, [id])).rows.map(u => ({ ...pub(u), wins: u.wins, played: u.played }))
      : (await localUserStore.friendsOf(id)).map(u => ({ ...pub(u), wins: u.wins, played: u.played }));
    return res.json({ friends: list.map(f => ({ ...f, status: presence(f.id) })) });
  }));

  r.post('/friends', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Masuk dulu untuk menambah teman' });
    const friendId = Number(req.body?.userId);
    if (!Number.isInteger(friendId) || friendId <= 0) return res.status(400).json({ error: 'Pemain tidak valid' });
    if (friendId === id) return res.status(400).json({ error: 'Tidak bisa menambahkan diri sendiri' });
    if (dbEnabled()) {
      const exists = (await db()!.query('SELECT 1 FROM users WHERE id=$1', [friendId])).rowCount;
      if (!exists) return res.status(404).json({ error: 'Pemain tidak ditemukan' });
      await db()!.query('INSERT INTO friendships(user_id, friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, friendId]);
    } else {
      if (!(await localUserStore.findById(friendId))) return res.status(404).json({ error: 'Pemain tidak ditemukan' });
      await localUserStore.addFriend(id, friendId);
    }
    return res.status(201).json({ ok: true });
  }));

  r.delete('/friends/:id', wrap(async (req, res) => {
    const id = verifyToken(bearer(req));
    if (!id) return res.status(401).json({ error: 'Silakan masuk' });
    const friendId = Number(req.params.id);
    if (dbEnabled()) await db()!.query('DELETE FROM friendships WHERE user_id=$1 AND friend_id=$2', [id, friendId]);
    else await localUserStore.removeFriend(id, friendId);
    return res.json({ ok: true });
  }));

  /** Peringkat dari pertandingan ONLINE yang tercatat di server (bukan data contoh). */
  r.get('/leaderboard', wrap(async (_req, res) => {
    const rows = dbEnabled()
      ? (await db()!.query(
          `SELECT u.id, u.username, u.display_name, u.avatar, SUM(s.wins)::int AS wins, SUM(s.played)::int AS played
             FROM user_game_stats s JOIN users u ON u.id = s.user_id
            GROUP BY u.id HAVING SUM(s.played) > 0 ORDER BY wins DESC, played ASC LIMIT 20`)).rows.map(u => ({ ...pub(u), wins: u.wins, played: u.played }))
      : (await localUserStore.leaderboard()).map(u => ({ ...pub(u), wins: u.wins, played: u.played }));
    return res.json({ players: rows.map((p, i) => ({ rank: i + 1, ...p })) });
  }));

  return r;
}

/** Simpan hasil pertandingan online ke DB atau localUserStore. */
export const persistResults: ResultSink = (r) => {
  const pool = db();
  if (pool) {
    (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const m = await client.query('INSERT INTO matches(game_id, room_code, players) VALUES ($1,$2,$3) RETURNING id', [r.gameId, r.code, r.players.length]);
        const matchId = m.rows[0].id;
        for (const p of r.players) {
          const res = r.results.find(x => x.seat === p.seat)!;
          await client.query('INSERT INTO match_players(match_id, seat, user_id, name, is_bot, rank, score) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [matchId, p.seat, p.userId, p.name, p.isBot, res.rank, res.score]);
          if (p.userId) {
            await client.query(
              `INSERT INTO user_game_stats(user_id, game_id, played, wins) VALUES ($1,$2,1,$3)
               ON CONFLICT (user_id, game_id) DO UPDATE SET played = user_game_stats.played + 1,
                 wins = user_game_stats.wins + EXCLUDED.wins, updated_at = now()`,
              [p.userId, r.gameId, res.rank === 1 ? 1 : 0]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('persist results failed', { err: String(e) });
      } finally { client.release(); }
    })();
  } else {
    // Mode offline / local JSON store:
    for (const p of r.players) {
      if (p.userId) {
        const res = r.results.find(x => x.seat === p.seat);
        if (res) {
          localUserStore.recordMatch(p.userId, r.gameId, res.rank, res.score, r.players.length).catch(() => {});
        }
      }
    }
  }
};

