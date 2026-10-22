// Helper bersama untuk test (bukan file test).
import { seededRng, type GameModule } from '../src';

export const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** Simulasi penuh: bot vs bot sampai selesai. Melempar jika bot memilih aksi ilegal. */
export function simulate(game: GameModule, n: number, seed: number, maxSteps = 20000) {
  const r = seededRng(seed);
  let s = game.setup(seats(n).map(p => ({ ...p, isBot: true })), game.sanitizeOptions({}), r);
  for (let step = 0; step < maxSteps && !game.isOver(s); step++) {
    const seat = game.currentSeat(s);
    if (seat === null) { s = game.advance(s, r); continue; }
    s = game.apply(s, seat, game.bot(game.view(s, seat), 'normal', r), r);
  }
  return s;
}
