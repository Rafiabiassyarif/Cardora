import { describe, expect, it } from 'vitest';
import { seededRng, RuleError } from '../src';
import { bohong, decideCall, callChance, type BohongState, type BohongView } from '../src/games/bohong';
import { seats } from './helpers';
import { fuzzGeneric, expectNoLeak } from './genericHelpers';

const r = () => seededRng(21);
const act = (id: string, cards?: string[]) => ({ type: 'act' as const, id, ...(cards ? { cards } : {}) });

/** 3 pemain manusia (bots=false) atau seat 1..n bot. */
function rigged(n = 3, bots = false): BohongState {
  const s = bohong.setup(seats(n).map((p, i) => ({ ...p, isBot: bots && i > 0 })), bohong.sanitizeOptions({ junk: 1, round: 3, targetRounds: 2, endMode: 'semua' }), r());
  const hands = [['AS', 'AH', '5D', '9C'], ['2H', '7C', 'KD'], ['3C', '4D', '6H', 'QS'], ['8S', '8H'], ['TC'], ['JD'], ['JS'], ['TD']];
  s.hands = hands.slice(0, n);
  s.pile = []; s.required = 0; s.turn = 0; s.plays = 0; s.finished = [];
  return s;
}

describe('Bohong!', () => {
  it('default: permainan selesai saat pemain pertama habis kartu (mode cepat)', () => {
    expect(bohong.sanitizeOptions({}).endMode).toBe('pertama');
  });

  it('setup: 52 kartu dibagi habis, pemegang A♠ mulai dengan A', () => {
    for (const n of [3, 4, 7, 8]) {
      const s = bohong.setup(seats(n), bohong.sanitizeOptions({}), seededRng(n));
      const all = s.hands.flat();
      expect(new Set(all).size).toBe(52);
      const sizes = s.hands.map(h => h.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(s.hands[s.turn!]).toContain('AS');
      expect(s.required).toBe(0);
    }
  });

  it('taruh membuka jendela; tak ada tuduhan → giliran & angka wajib maju (A → 2 → 3)', () => {
    let s = rigged();
    expect(() => bohong.apply(s, 1, act('taruh', ['2H']), r())).toThrow(RuleError);
    expect(() => bohong.apply(s, 0, act('taruh', ['AS', 'AH', '5D', '9C', 'AS']), r())).toThrow(RuleError);
    s = bohong.apply(s, 0, act('taruh', ['AS', 'AH']), r());
    expect(s.phase).toBe('window');
    expect(bohong.currentSeat(s)).toBeNull();
    const d = bohong.autoDelay(s)!;
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThanOrEqual(3000);
    expect(bohong.view(s, 1).banner).toBe("P0 menaruh 2 kartu: '2 buah A'");
    expect(bohong.view(s, 0).actions).toEqual([]);
    expect(bohong.view(s, 1).actions.map(a => a.id)).toEqual(['bohong', 'percaya']);
    s = bohong.advance(s, r());
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
    expect(s.required).toBe(1);
    expect(s.pile).toHaveLength(2);
    s = bohong.apply(s, 1, act('taruh', ['2H']), r());
    s = bohong.advance(s, r());
    expect(s.turn).toBe(2);
    expect(s.required).toBe(2);
    // K → A
    s.required = 12;
    s = bohong.apply(s, 2, act('taruh', ['QS']), r());
    s = bohong.advance(s, r());
    expect(s.required).toBe(0);
  });

  it('semua manusia percaya → jendela langsung tertutup', () => {
    let s = bohong.apply(rigged(), 0, act('taruh', ['AS']), r());
    s = bohong.apply(s, 1, act('percaya'), r());
    expect(s.phase).toBe('window');
    expect(() => bohong.apply(s, 1, act('bohong'), r())).toThrow(RuleError);
    s = bohong.apply(s, 2, act('percaya'), r());
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
  });

  it('tuduhan benar: pembohong mengambil seluruh tumpukan', () => {
    let s = rigged();
    s.pile = ['TH', 'TS'];
    s = bohong.apply(s, 0, act('taruh', ['AS', '5D']), r());
    s = bohong.apply(s, 2, act('bohong'), r());
    expect(s.pile).toEqual([]);
    expect(s.hands[0].sort()).toEqual(['5D', '9C', 'AH', 'AS', 'TH', 'TS'].sort());
    expect(s.reveal).toMatchObject({ seat: 0, caller: 2, lie: true, cards: ['AS', '5D'] });
    expect(s.phase).toBe('reveal');
    const v = bohong.view(s, 1);
    expect(v.piles.find(p => p.id === 'reveal')!.cards).toEqual(['AS', '5D']);
    expect(bohong.autoDelay(s)).toBeGreaterThan(0);
    s = bohong.advance(s, r());
    expect(s.turn).toBe(1); // giliran tetap ke pemain sesudah penaruh
    expect(s.required).toBe(1);
  });

  it('tuduhan salah: penuduh mengambil seluruh tumpukan', () => {
    let s = rigged();
    s.pile = ['TH'];
    s = bohong.apply(s, 0, act('taruh', ['AS', 'AH']), r());
    s = bohong.apply(s, 1, act('bohong'), r());
    expect(s.hands[1].sort()).toEqual(['2H', '7C', 'KD', 'TH', 'AS', 'AH'].sort());
    expect(s.hands[0].sort()).toEqual(['5D', '9C']);
    expect(s.reveal!.lie).toBe(false);
  });

  it('kartu terakhir: lolos = selesai; ketahuan bohong = ambil tumpukan & lanjut', () => {
    // lolos
    let s = rigged(4);
    s.hands[0] = ['AS'];
    s = bohong.apply(s, 0, act('taruh', ['AS']), r());
    expect(s.finished).toEqual([]);
    s = bohong.advance(s, r());
    expect(s.finished).toEqual([0]);
    expect(s.turn).toBe(1);
    // jujur tapi dituduh → tetap selesai, penuduh ambil
    s = rigged(4);
    s.hands[0] = ['AS'];
    s = bohong.apply(s, 0, act('taruh', ['AS']), r());
    s = bohong.apply(s, 3, act('bohong'), r());
    expect(s.finished).toEqual([0]);
    expect(s.hands[3]).toContain('AS');
    // bohong di kartu terakhir → ketahuan, ambil & masih main
    s = rigged(4);
    s.hands[0] = ['5D'];
    s = bohong.apply(s, 0, act('taruh', ['5D']), r());
    s = bohong.apply(s, 2, act('bohong'), r());
    expect(s.finished).toEqual([]);
    expect(s.hands[0]).toEqual(['5D']);
  });

  it('permainan berakhir saat tinggal satu pemain; urutan selesai = peringkat', () => {
    let s = rigged(3);
    s.finished = [2];
    s.hands[2] = [];
    s.hands[0] = ['AS'];
    s = bohong.apply(s, 0, act('taruh', ['AS']), r());
    s = bohong.advance(s, r());
    expect(s.over).toBe(true);
    expect(bohong.results(s)).toEqual([
      { seat: 2, rank: 1, score: 0 }, { seat: 0, rank: 2, score: 0 }, { seat: 1, rank: 3, score: 3 },
    ]);
  });

  it('batas taruhan mengakhiri permainan (sisa diperingkat dari kartu paling sedikit)', () => {
    let s = rigged(3);
    s.plays = s.options.maxPlays - 1;
    s = bohong.apply(s, 0, act('taruh', ['AS']), r());
    s = bohong.advance(s, r());
    expect(s.over).toBe(true);
    const res = bohong.results(s)!;
    expect(res).toEqual([{ seat: 0, rank: 1, score: 3 }, { seat: 1, rank: 1, score: 3 }, { seat: 2, rank: 3, score: 4 }]);
  });

  it('bot menuduh lebih dulu bila waktunya sudah lewat; autoDelay mengikuti tuduhan bot', () => {
    let s = rigged(3, true);
    s.bots = [false, true, false];
    s = bohong.apply(s, 0, act('taruh', ['AS', '5D']), r());
    s.window!.botCalls = [null, 800, null];
    const d = bohong.autoDelay(s)!;
    expect(d).toBeLessThanOrEqual(800);
    // manusia seat 2 menekan "setelah" bot (jam dimundurkan) → bot yang berhak
    s.window!.openedAt -= 2000;
    const s2 = bohong.apply(s, 2, act('bohong'), r());
    expect(s2.reveal!.caller).toBe(1);
    // advance memakai keputusan bot
    const s3 = bohong.advance(s, r());
    expect(s3.reveal!.caller).toBe(1);
    expect(s3.hands[0]).toContain('5D');
  });

  it('keputusan bot hanya dari view sendiri: isi taruhan tersembunyi tidak berpengaruh', () => {
    // Versi jujur vs bohong dengan jumlah kartu tangan sama.
    let honest = rigged(3, true); honest.hands[0] = ['AS', '5D', '9C'];
    let liar = rigged(3, true); liar.hands[0] = ['AS', '5D', '9C'];
    honest = bohong.apply(honest, 0, act('taruh', ['AS']), seededRng(9));
    liar = bohong.apply(liar, 0, act('taruh', ['5D']), seededRng(9));
    const vh = bohong.view(honest, 1) as BohongView, vl = bohong.view(liar, 1) as BohongView;
    const strip = (v: BohongView) => JSON.stringify({ ...v, log: v.log.map(l => l.text) });
    expect(strip(vh)).toBe(strip(vl));
    expect(honest.window!.botCalls).toEqual(liar.window!.botCalls);
    expect(decideCall(vh, 3000, seededRng(4))).toBe(decideCall(vl, 3000, seededRng(4)));
  });

  it('bot yang memegang 3 kartu angka itu tahu klaim 2 buah pasti bohong', () => {
    let s = rigged(3, true);
    s.hands[1] = ['7C', '7D', '7H', 'KD'];
    s.hands[0] = ['7S', '2C', '9C'];
    s.required = 6; // angka 7
    s = bohong.apply(s, 0, act('taruh', ['7S', '2C']), r());
    const v = bohong.view(s, 1) as BohongView;
    expect(callChance(v)).toBeGreaterThanOrEqual(0.97);
    // klaim yang masih mungkin → peluang kecil
    const v2 = bohong.view(s, 2) as BohongView;
    expect(callChance(v2)).toBeLessThan(0.5);
  });

  it('bot jujur bila punya angka wajib; bila tidak, bluff 1–2 kartu', () => {
    const s = rigged(3, true);
    s.turn = 1; s.required = 1; s.hands[1] = ['2H', '2S', '7C', 'KD', '9D'];
    const v = bohong.view(s, 1);
    const a = bohong.bot(v, 'normal', r());
    expect(a.cards!.sort()).toEqual(['2H', '2S']);
    s.required = 3;
    const b = bohong.bot(bohong.view(s, 1), 'hard', r());
    expect(b.cards!.length).toBeGreaterThanOrEqual(1);
    expect(b.cards!.length).toBeLessThanOrEqual(2);
    for (const d of ['easy', 'normal', 'hard'] as const) {
      expect(() => bohong.apply(s, 1, bohong.bot(bohong.view(s, 1), d, r()), r())).not.toThrow();
    }
  });

  it('view tidak membocorkan tumpukan maupun kartu tangan lawan', () => {
    let s = rigged(4);
    s.pile = ['TH', 'TS', 'QD'];
    s = bohong.apply(s, 0, act('taruh', ['AS', '5D']), r());
    for (const seat of [1, 2, 3]) {
      const others = s.hands.filter((_, i) => i !== seat);
      expectNoLeak(bohong, s, seat, [...others, s.pile]);
    }
    expectNoLeak(bohong, s, 0, [s.hands[1], s.hands[2], s.hands[3], ['TH', 'TS', 'QD']]);
    const spectator = JSON.stringify(bohong.view(s, null));
    for (const c of s.hands.flat().concat(s.pile)) expect(spectator).not.toContain(`"${c}"`);
  });

  it('mode "pemain pertama habis" langsung mengakhiri permainan', () => {
    let s = rigged(4);
    s.options = bohong.sanitizeOptions({ endMode: 'pertama' });
    s.hands[0] = ['AS'];
    s = bohong.apply(s, 0, act('taruh', ['AS']), r());
    s = bohong.advance(s, r());
    expect(s.over).toBe(true);
    expect(bohong.results(s)!.map(x => [x.seat, x.rank])).toEqual([[0, 1], [3, 2], [1, 3], [2, 4]]);
  });

  it('timeoutAction selalu sah', () => {
    let s = rigged();
    s = bohong.apply(s, 0, bohong.timeoutAction(s, 0), r());
    s = bohong.apply(s, 1, bohong.timeoutAction(s, 1), r());
    expect(s.window!.passed).toEqual([1]);
  });

  for (const n of [3, 4, 5, 6, 7, 8]) for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`fuzz ${n} pemain seed ${seed}`, () => {
      const options = { botStyle: (['polos', 'normal', 'curiga'] as const)[seed % 3], endMode: seed === 6 ? 'pertama' : 'semua' };
      const { state } = fuzzGeneric(bohong, { players: n, seed, options, check: (s: BohongState) => {
        const all = s.hands.flat().concat(s.pile);
        expect(all.length).toBe(52);
        expect(new Set(all).size).toBe(52);
        if (!s.over) expect(s.phase !== 'play' || bohong.currentSeat(s) !== null).toBe(true);
      } });
      expect(state.over).toBe(true);
    });
  }
});
