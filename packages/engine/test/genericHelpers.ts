// Helper uji untuk game berprotokol GenericView (bukan file test).
import { expect } from 'vitest';
import { seededRng, RuleError, type GameModule, type Rng, type GenericView, type GenericAction } from '../src';
import { seats } from './helpers';

function randomSubset<T>(items: T[], k: number, rng: Rng): T[] {
  const a = items.slice();
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** Aksi acak dari daftar aksi sah di view (kartu/angka/target diacak). Bisa saja ilegal secara aturan. */
export function randomAction(v: GenericView, rng: Rng): GenericAction | null {
  if (!v.actions.length) return null;
  const spec = v.actions[rng.int(v.actions.length)];
  const a: GenericAction = { type: 'act', id: spec.id };
  if (spec.cards) {
    const max = Math.min(spec.cards.max, v.hand.length);
    const min = Math.min(spec.cards.min, max);
    const k = min + rng.int(max - min + 1);
    // Utamakan kartu yang disorot sah bila tersedia.
    const pool = v.playable && v.playable.length && rng.float() < 0.7 ? v.playable : v.hand;
    a.cards = randomSubset(pool, Math.min(k, pool.length), rng);
  }
  if (spec.amount) {
    const steps = Math.floor((spec.amount.max - spec.amount.min) / spec.amount.step);
    a.amount = spec.amount.min + spec.amount.step * rng.int(steps + 1);
  }
  if (spec.targets?.length) a.target = spec.targets[rng.int(spec.targets.length)];
  return a;
}

export interface FuzzOptions {
  players: number;
  seed: number;
  /** Probabilitas memakai aksi acak (selain itu aksi bot). */
  chaos?: number;
  maxSteps?: number;
  /** Dipanggil setiap langkah untuk memeriksa invarian state. */
  check?: (state: any) => void;
  options?: Record<string, unknown>;
}

/**
 * Mainkan satu permainan penuh: bot + aksi acak. Gagal jika:
 *  - bot atau timeoutAction menghasilkan aksi ilegal,
 *  - permainan macet (tak ada giliran & tak ada langkah otomatis),
 *  - view tidak konsisten (kartu tangan bocor, dsb.),
 *  - tidak selesai dalam maxSteps.
 */
export function fuzzGeneric(game: GameModule<any, any, any, any>, o: FuzzOptions) {
  const rng = seededRng(o.seed);
  const chaos = o.chaos ?? 0.3;
  let s = game.setup(seats(o.players).map((p, i) => ({ ...p, isBot: i > 0 })), game.sanitizeOptions(o.options ?? {}), rng);
  const maxSteps = o.maxSteps ?? 20000;
  let steps = 0;
  for (; steps < maxSteps && !game.isOver(s); steps++) {
    o.check?.(s);
    // Aksi di luar giliran (mis. tepok) — kadang dicoba oleh seat acak.
    if (rng.float() < 0.1) {
      const any = rng.int(o.players);
      const v = game.view(s, any) as GenericView;
      const a = randomAction(v, rng);
      if (a) { try { s = game.apply(s, any, a, rng); continue; } catch (e) { if (!(e instanceof RuleError)) throw e; } }
    }
    const seat = game.currentSeat(s);
    if (seat === null) {
      const d = game.autoDelay(s);
      expect(d, `permainan macet di langkah ${steps}`).not.toBeNull();
      s = game.advance(s, rng);
      continue;
    }
    const v = game.view(s, seat) as GenericView;
    expect(v.you).toBe(seat);
    let done = false;
    if (rng.float() < chaos) {
      for (let tries = 0; tries < 8 && !done; tries++) {
        const a = randomAction(v, rng);
        if (!a) break;
        try { s = game.apply(s, seat, a, rng); done = true; } catch (e) { if (!(e instanceof RuleError)) throw e; }
      }
    }
    if (!done) {
      const useTimeout = rng.float() < 0.1;
      const a = useTimeout ? game.timeoutAction(s, seat) : game.bot(v, (['easy', 'normal', 'hard'] as const)[rng.int(3)], rng);
      try {
        s = game.apply(s, seat, a, rng);
      } catch (e) {
        throw new Error(`${useTimeout ? 'timeoutAction' : 'bot'} ilegal di langkah ${steps}: ${JSON.stringify(a)} → ${(e as Error).message}`);
      }
    }
  }
  expect(game.isOver(s), `tidak selesai dalam ${maxSteps} langkah`).toBe(true);
  const res = game.results(s)!;
  expect(res).toHaveLength(o.players);
  expect(new Set(res.map(r => r.seat)).size).toBe(o.players);
  expect(res.some(r => r.rank === 1)).toBe(true);
  return { state: s, steps, results: res };
}

/** Pastikan view seat tidak membocorkan kartu tangan pemain lain. */
export function expectNoLeak(game: GameModule<any, any, any, any>, state: any, seat: number, otherHands: string[][]) {
  const v = JSON.stringify(game.view(state, seat));
  for (const h of otherHands) for (const c of h) {
    // Kartu boleh muncul jika memang terbuka di meja; pemanggil menyaring yang memang publik.
    expect(v.includes(`"${c}"`), `kartu ${c} bocor ke seat ${seat}`).toBe(false);
  }
}
