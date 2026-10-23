import { describe, expect, it } from 'vitest';
import { omahaGame, heartsGame, GAMES, catalogById, seededRng, RuleError } from '../src';
import { simulate, seats } from './helpers';

const r = () => seededRng(7);

describe('Game umum (allGames): validasi kartu', () => {
  it('menolak kartu yang tidak ada di tangan pemain', () => {
    const s = omahaGame.setup(seats(2), omahaGame.sanitizeOptions({}), r());
    const notMine = s.hands[1][0];
    expect(() => omahaGame.apply(s, 0, { type: 'play', cards: [notMine] }, r())).toThrow(RuleError);
    expect(() => omahaGame.apply(s, 0, { type: 'play', cards: ['AS', 'AH', 'AD', 'AC'].filter(c => !s.hands[0].includes(c)) }, r())).toThrow(RuleError);
  });

  it('menolak kartu yang sama dikirim dua kali', () => {
    const s = omahaGame.setup(seats(2), omahaGame.sanitizeOptions({}), r());
    const c = s.hands[0][0];
    expect(() => omahaGame.apply(s, 0, { type: 'play', cards: [c, c] }, r())).toThrow(RuleError);
  });

  it('kartu sah dibuang dari tangan dan poin bertambah', () => {
    const s = heartsGame.setup(seats(4), heartsGame.sanitizeOptions({}), r());
    const c = s.hands[0][0];
    const s2 = heartsGame.apply(s, 0, { type: 'play', cards: [c] }, r());
    expect(s2.hands[0]).not.toContain(c);
    expect(s2.hands[0]).toHaveLength(s.hands[0].length - 1);
    expect(s2.scores[0]).toBeGreaterThan(0);
  });

  it('semua game di registry tercatat "available" di katalog dan selesai saat dimainkan bot', () => {
    for (const [id, game] of Object.entries(GAMES)) {
      expect(catalogById(id)?.status, id).toBe('available');
      const s = simulate(game, game.minPlayers, 3);
      expect(game.isOver(s), id).toBe(true);
    }
  });
});
