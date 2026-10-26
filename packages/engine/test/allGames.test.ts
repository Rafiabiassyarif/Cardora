import { describe, expect, it } from 'vitest';
import { GAMES, CATALOG, catalogById, getGame, seededRng } from '../src';
import { simulate, seats } from './helpers';

describe('Registry game', () => {
  it('setiap game "available" di katalog punya modul, dan sebaliknya', () => {
    for (const g of CATALOG.filter(c => c.status === 'available')) {
      expect(getGame(g.id), g.id).toBeDefined();
    }
    for (const id of Object.keys(GAMES)) expect(catalogById(id)?.status, id).toBe('available');
  });

  it('jumlah pemain modul sesuai katalog', () => {
    for (const [id, game] of Object.entries(GAMES)) {
      const c = catalogById(id)!;
      expect([game.minPlayers, game.maxPlayers], id).toEqual([c.minPlayers, c.maxPlayers]);
    }
  });

  it('view memakai gameId yang sama dengan id modul', () => {
    for (const [id, game] of Object.entries(GAMES)) {
      const s = game.setup(seats(game.minPlayers), game.sanitizeOptions({ round: 2, previousWinner: 1, targetRounds: 3, junk: 'x' }), seededRng(1));
      expect(game.view(s, 0).gameId, id).toBe(game.id);
    }
  });

  it('semua game selesai saat dimainkan bot (jumlah pemain minimum & maksimum)', () => {
    for (const [id, game] of Object.entries(GAMES)) {
      for (const n of new Set([game.minPlayers, game.maxPlayers])) {
        const s = simulate(game, n, 3);
        expect(game.isOver(s), `${id} ${n} pemain`).toBe(true);
        expect(game.results(s), id).toHaveLength(n);
      }
    }
  }, 120_000);
});
