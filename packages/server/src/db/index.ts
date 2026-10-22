// db/index.ts — koneksi PostgreSQL (opsional). Tanpa DATABASE_URL, server tetap
// jalan dalam mode tamu: room/multiplayer berfungsi, akun & statistik online nonaktif.

import pg from 'pg';
import { config } from '../config';
import { log } from '../logger';

let pool: pg.Pool | null = null;

export function db(): pg.Pool | null {
  if (!config.databaseUrl) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      // Neon/Supabase butuh TLS; set PGSSLMODE=disable untuk Postgres lokal tanpa TLS.
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' },
    });
    pool.on('error', e => log.error('pg pool error', { err: e.message }));
  }
  return pool;
}

export const dbEnabled = () => !!config.databaseUrl;
