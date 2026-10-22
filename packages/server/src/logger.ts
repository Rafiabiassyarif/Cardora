// logger.ts — log terstruktur sederhana. JANGAN log kartu, token, atau password.
import { config } from './config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const min = LEVELS[(config.logLevel as Level)] ?? LEVELS.info;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < min || process.env.VITEST) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};
