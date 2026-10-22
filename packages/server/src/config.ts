// config.ts — konfigurasi dari environment. Tidak ada rahasia di kode.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret && process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  throw new Error('JWT_SECRET wajib diisi di production bila akun (DATABASE_URL) aktif');
}

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  /** Origin yang boleh terhubung (pisahkan koma). Kosong = sama-origin + localhost + capacitor. */
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || '',
  /** Jika kosong (dev), dibuat acak per proses — token lama tidak berlaku setelah restart. */
  jwtSecret: jwtSecret || randomBytes(32).toString('hex'),
  /** OAuth Client ID (Web) dari Google Cloud Console. Kosong = tombol "Masuk dengan Google" nonaktif. */
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  turnSeconds: num(process.env.TURN_SECONDS, 30),
  /** Berapa lama kursi ditahan untuk pemain yang terputus (detik). */
  reconnectGraceSeconds: num(process.env.RECONNECT_GRACE_SECONDS, 60),
  /** Room tanpa aktivitas dihapus setelah (menit). */
  roomIdleMinutes: num(process.env.ROOM_IDLE_MINUTES, 30),
  maxRooms: num(process.env.MAX_ROOMS, 2000),
  /** Rate limit per IP: burst pembuatan room & percobaan kode room. */
  createRoomBurst: num(process.env.CREATE_ROOM_BURST, 5),
  joinBurst: num(process.env.JOIN_BURST, 10),
  /** Folder build web untuk disajikan (opsional). */
  webDist: process.env.WEB_DIST || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  /** Jeda giliran bot (ms). Bila di test mode bernilai kecil agar tidak timeout. */
  botDelayMs: process.env.BOT_DELAY_MS !== undefined ? num(process.env.BOT_DELAY_MS, 30) : (process.env.NODE_ENV === 'test' ? 15 : null),
};

export type Config = typeof config;
