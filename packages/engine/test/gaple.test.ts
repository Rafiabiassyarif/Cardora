import { describe, expect, it } from 'vitest';
import { seededRng, RuleError, dominoCanon, dominoSet } from '../src';
import { gaple, chainEnds, type GapleState } from '../src/games/gaple';
import { seats } from './helpers';
import { fuzzGeneric } from './genericHelpers';

const r = () => seededRng(7);
const act = (id: string, cards?: string[]) => ({ type: 'act' as const, id, ...(cards ? { cards } : {}) });

/** Rantai 3 pemain: kiri 3, kanan 5 (rantai "d:34","d:45"). */
function rigged(): GapleState {
  const s = gaple.setup(seats(3), gaple.sanitizeOptions({}), r());
  s.chain = ['d:34', 'd:45'];
  s.hands = [['d:35', 'd:01', 'd:66'], ['d:12', 'd:02'], ['d:13', 'd:56', 'd:26']];
  s.sleeping = dominoSet().filter(t => !s.hands.flat().includes(t) && !['d:34', 'd:45'].includes(t)).slice(0, 7);
  s.mustOpen = null; s.turn = 0; s.lastPlayer = 2; s.passes = 0; s.phase = 'play';
  return s;
}

describe('Domino Gaple', () => {
  it('deal pertama: pemegang balak tertinggi membuka dengan balak itu', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = gaple.setup(seats(4), gaple.sanitizeOptions({}), seededRng(seed));
      expect(s.mustOpen).toBe('d:66');
      expect(s.hands[s.turn!]).toContain('d:66');
      const other = s.hands[s.turn!].find(t => t !== 'd:66')!;
      expect(() => gaple.apply(s, s.turn!, act('play', [other]), r())).toThrow(RuleError);
      const s2 = gaple.apply(s, s.turn!, act('play', ['d:66']), r());
      expect(s2.chain).toEqual(['d:66']);
    }
    // 2 pemain: balak tertinggi yang ada di tangan.
    const s = gaple.setup(seats(2), gaple.sanitizeOptions({}), seededRng(3));
    const all = s.hands.flat();
    const top = [6, 5, 4, 3, 2, 1, 0].map(v => `d:${v}${v}`).find(t => all.includes(t));
    expect(s.mustOpen).toBe(top);
  });

  it('memilih ujung: Pasang Kiri / Kanan dan validasi sisi', () => {
    const s = rigged();
    const v = gaple.view(s, 0);
    expect(v.actions.map(a => a.id).sort()).toEqual(['left', 'right']);
    expect(v.badges).toContain('Ujung: 3 · 5');
    // d:35 cocok di kedua ujung, hasil berbeda.
    const L = gaple.apply(s, 0, act('left', ['d:35']), r());
    expect(L.chain[0]).toBe('d:53');
    expect(chainEnds(L.chain)).toEqual([5, 5]);
    const R = gaple.apply(s, 0, act('right', ['d:35']), r());
    expect(R.chain.at(-1)).toBe('d:53');
    expect(chainEnds(R.chain)).toEqual([3, 3]);
    // Kartu tidak cocok di sisi yang dipilih.
    const s2 = rigged(); s2.turn = 2;
    expect(() => gaple.apply(s2, 2, act('right', ['d:13']), r())).toThrow(RuleError);
    expect(() => gaple.apply(s2, 2, act('left', ['d:26']), r())).toThrow(RuleError);
    const ok = gaple.apply(s2, 2, act('right', ['d:56']), r());
    expect(ok.chain.at(-1)).toBe('d:56');
    expect(ok.chain.map(dominoCanon)).toEqual(['d:34', 'd:45', 'd:56']);
  });

  it('hanya menawarkan sisi yang punya kartu cocok; lewat hanya bila buntu', () => {
    const s = rigged(); s.turn = 2; s.hands[2] = ['d:13', 'd:26'];
    expect(gaple.view(s, 2).actions.map(a => a.id)).toEqual(['left']);
    expect(() => gaple.apply(s, 2, act('pass'), r())).toThrow(RuleError);
    const s1 = rigged(); s1.turn = 1;
    expect(gaple.view(s1, 1).actions.map(a => a.id)).toEqual(['pass']);
    const p = gaple.apply(s1, 1, act('pass'), r());
    expect(p.turn).toBe(2);
    expect(gaple.view(p, 0).players[1].status).toBe('Lewat di 3·5');
  });

  it('kartu habis menang deal: skor = titik lawan (+10 bila balak terakhir)', () => {
    const s = rigged(); s.hands[0] = ['d:35'];
    const s2 = gaple.apply(s, 0, act('left', ['d:35']), r());
    expect(s2.phase).toBe('dealEnd');
    expect(s2.dealWinner).toBe(0);
    expect(s2.scores).toEqual([(1 + 2) + (0 + 2) + (1 + 3) + (5 + 6) + (2 + 6), 0, 0]);
    expect(gaple.currentSeat(s2)).toBeNull();
    expect(gaple.autoDelay(s2)).not.toBeNull();
    // Balak terakhir.
    const b = rigged(); b.chain = ['d:36', 'd:66']; b.hands[0] = ['d:66'.replace('66', '33')];
    const b2 = gaple.apply(b, 0, act('left', ['d:33']), r());
    expect(b2.scores[0]).toBe(3 + 2 + 4 + 11 + 8 + 10);
    // Deal berikutnya: pemenang membuka bebas.
    const n = gaple.advance(s2, seededRng(2));
    expect(n.dealNo).toBe(2);
    expect(n.turn).toBe(0);
    expect(n.mustOpen).toBeNull();
    expect(n.phase).toBe('play');
  });

  it('Gaple! buntu dideteksi; pemenang titik terkecil (seri: urutan dari pemain terakhir)', () => {
    // Ujung 3 & 5; semua kartu 3/5 lain sudah di rantai atau tidur.
    const s = gaple.setup(seats(3), gaple.sanitizeOptions({}), r());
    s.chain = ['d:33', 'd:34'];
    s.hands = [['d:35', 'd:00'], ['d:11', 'd:12'], ['d:02', 'd:01']];
    s.sleeping = dominoSet().filter(t => !s.hands.flat().includes(t) && !['d:33', 'd:34'].includes(t));
    s.turn = 0; s.mustOpen = null; s.lastPlayer = 2;
    // Seat 0 memasang 3|5 di kiri → ujung 5 & 4. Tak ada yang punya 4/5 → buntu.
    const s2 = gaple.apply(s, 0, act('left', ['d:35']), r());
    expect(s2.phase).toBe('dealEnd');
    // Titik: seat0 = 0, seat1 = 2+3 = 5, seat2 = 2+1 = 3 → seat 0 menang, +8.
    expect(s2.dealWinner).toBe(0);
    expect(s2.scores[0]).toBe(8);
    expect(s2.banner).toContain('Gaple!');
  });

  it('seri titik saat buntu: yang paling awal dari pemain terakhir memasang', () => {
    const s = gaple.setup(seats(3), gaple.sanitizeOptions({}), r());
    s.chain = ['d:33', 'd:34'];
    s.hands = [['d:35', 'd:02'], ['d:11'], ['d:01', 'd:01'.replace('01', '00')]];
    s.turn = 0; s.mustOpen = null; s.lastPlayer = 2;
    // Setelah seat 0 memasang: seat0 = 2, seat1 = 2, seat2 = 1 → seat 2 menang (terkecil).
    let s2 = gaple.apply(s, 0, act('left', ['d:35']), r());
    expect(s2.dealWinner).toBe(2);
    // Seri: seat0 = 2, seat1 = 2 (seat2 = 3) → urutan dari seat 0 (terakhir memasang) → seat 0.
    const t = gaple.setup(seats(3), gaple.sanitizeOptions({}), r());
    t.chain = ['d:33', 'd:34'];
    t.hands = [['d:35', 'd:02'], ['d:11'], ['d:12']];
    t.turn = 0; t.mustOpen = null; t.lastPlayer = 1;
    s2 = gaple.apply(t, 0, act('left', ['d:35']), r());
    expect(s2.dealWinner).toBe(0);
  });

  it('permainan selesai saat target tercapai; peringkat dari skor', () => {
    const s = rigged(); s.hands[0] = ['d:35']; s.scores = [90, 40, 10];
    const s2 = gaple.apply(s, 0, act('left', ['d:35']), r());
    expect(s2.over).toBe(true);
    expect(gaple.autoDelay(s2)).toBeNull();
    expect(gaple.results(s2)![0]).toMatchObject({ seat: 0, rank: 1 });
  });

  it('opsi disanitasi', () => {
    expect(gaple.sanitizeOptions({ target: 150, junk: 1, round: 3 }).target).toBe(150);
    expect(gaple.sanitizeOptions({ target: 'x' }).target).toBe(100);
    expect(gaple.sanitizeOptions(null).turnSeconds).toBe(25);
  });

  it('view tidak membocorkan kartu lawan atau kartu tidur', () => {
    for (const n of [2, 3, 4]) {
      const s = gaple.setup(seats(n), gaple.sanitizeOptions({}), seededRng(n));
      for (let me = 0; me < n; me++) {
        const v = JSON.stringify(gaple.view(s, me));
        const hidden = [...s.hands.filter((_, i) => i !== me).flat(), ...s.sleeping];
        for (const t of hidden) expect(v.includes(`"${t}"`), `${t} bocor`).toBe(false);
      }
      const spec = JSON.stringify(gaple.view(s, null));
      for (const t of [...s.hands.flat(), ...s.sleeping]) expect(spec.includes(`"${t}"`)).toBe(false);
      expect(gaple.view(s, 0).badges).toContain(`Tidur: ${28 - 7 * n}`);
    }
  });

  for (const n of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      fuzzGeneric(gaple, { players: n, seed, check: (s: GapleState) => {
        const all = [...s.hands.flat(), ...s.chain.map(dominoCanon), ...s.sleeping];
        expect(all.length).toBe(28);
        expect(new Set(all).size).toBe(28);
        for (let i = 1; i < s.chain.length; i++) expect(s.chain[i - 1][3]).toBe(s.chain[i][2]);
      } });
    });
  }
});
