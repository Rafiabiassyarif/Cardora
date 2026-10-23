// packages/engine/test/tongkrongan.test.ts — pengujian lengkap Poker Tongkrongan.
import { describe, expect, it } from 'vitest';
import { 
  tongkrongan, 
  evaluateCombo, 
  comboBeats, 
  sortCards, 
  OPENING_CARD,
  type TongkronganState 
} from '../src/tongkrongan';
import { cryptoRng } from '../src/rng';
import { rankOf } from '../src/cards';
import { RuleError } from '../src/types';

describe('Poker Tongkrongan', () => {
  const rng = cryptoRng();
  const seats = [
    { id: '1', name: 'Pemain 1' },
    { id: '2', name: 'Pemain 2', isBot: true },
    { id: '3', name: 'Pemain 3', isBot: true },
    { id: '4', name: 'Pemain 4', isBot: true },
  ];

  it('1. Pembagian kartu: 13 kartu per pemain, semua kartu 3 tetap di tangan (52 kartu utuh)', () => {
    const s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng);
    expect(s.hands.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(s.hands[i].length).toBe(13);
    }
    expect(s.hands.flat().length).toBe(52);
    // Kartu 3 tetap ada di tangan para pemain
    const threes = s.hands.flat().filter(c => rankOf(c) === 3);
    expect(threes.length).toBe(4);
    expect(threes.sort()).toEqual(['3C', '3D', '3H', '3S']);
  });

  it('2. Tidak ada kartu duplikat dalam satu dek', () => {
    const s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng);
    const allCards = s.hands.flat();
    expect(allCards.length).toBe(52);
    const unique = new Set(allCards);
    expect(unique.size).toBe(52);
  });

  describe('3. Evaluasi Kombinasi Kartu', () => {
    it('Single dievaluasi dengan benar', () => {
      const c = evaluateCombo(['AS']);
      expect(c).not.toBeNull();
      expect(c?.type).toBe('single');
      expect(c?.count).toBe(1);
    });

    it('Pair dievaluasi dengan benar', () => {
      const pair = evaluateCombo(['KD', 'KS']);
      expect(pair).not.toBeNull();
      expect(pair?.type).toBe('pair');
      expect(pair?.count).toBe(2);

      const invalidPair = evaluateCombo(['KD', 'QS']);
      expect(invalidPair).toBeNull();
    });

    it('Three of a Kind dievaluasi dengan benar', () => {
      const trip = evaluateCombo(['9S', '9H', '9C']);
      expect(trip).not.toBeNull();
      expect(trip?.type).toBe('triple');
      expect(trip?.count).toBe(3);

      const invalidTrip = evaluateCombo(['9S', '9H', '8C']);
      expect(invalidTrip).toBeNull();
    });

    it('Straight normal dan Straight Wheel (A-2-3-4-5) dievaluasi dengan benar', () => {
      // Normal Straight: 8-9-T-J-Q
      const straight = evaluateCombo(['8S', '9H', 'TC', 'JD', 'QH']);
      expect(straight).not.toBeNull();
      expect(straight?.type).toBe('straight');

      // Wheel Straight: A-2-3-4-5
      const wheel = evaluateCombo(['AS', '2H', '3C', '4D', '5H']);
      expect(wheel).not.toBeNull();
      expect(wheel?.type).toBe('straight');
    });

    it('Flush dievaluasi dengan benar', () => {
      const flush = evaluateCombo(['2S', '5S', '8S', 'JS', 'AS']);
      expect(flush).not.toBeNull();
      expect(flush?.type).toBe('flush');
      expect(flush?.count).toBe(5);
    });

    it('Full House dievaluasi dengan benar', () => {
      const fh = evaluateCombo(['JS', 'JH', 'JC', '4D', '4S']);
      expect(fh).not.toBeNull();
      expect(fh?.type).toBe('fullhouse');
    });

    it('Four of a Kind dievaluasi dengan benar', () => {
      const quads = evaluateCombo(['7S', '7H', '7C', '7D', 'KH']);
      expect(quads).not.toBeNull();
      expect(quads?.type).toBe('quads');
    });

    it('Bom (4 kartu kembar murni) dievaluasi dengan benar', () => {
      const bomb6 = evaluateCombo(['6S', '6H', '6C', '6D']);
      expect(bomb6).not.toBeNull();
      expect(bomb6?.type).toBe('bomb');
      expect(bomb6?.count).toBe(4);
      expect(bomb6?.description).toContain('Bom 4 Kartu 6');

      const bombAce = evaluateCombo(['AS', 'AH', 'AC', 'AD']);
      expect(bombAce).not.toBeNull();
      expect(bombAce?.type).toBe('bomb');
      expect(bombAce?.count).toBe(4);
      expect(bombAce?.description).toContain('Bom 4 Kartu As');

      const invalid4 = evaluateCombo(['6S', '6H', '6C', '7D']);
      expect(invalid4).toBeNull();
    });

    it('Straight Flush dan Royal Flush dievaluasi dengan benar', () => {
      const sf = evaluateCombo(['5H', '6H', '7H', '8H', '9H']);
      expect(sf).not.toBeNull();
      expect(sf?.type).toBe('straightflush');

      const rf = evaluateCombo(['TH', 'JH', 'QH', 'KH', 'AH']);
      expect(rf).not.toBeNull();
      expect(rf?.type).toBe('royalflush');
    });
  });

  describe('4. Perbandingan Kekuatan Kombinasi (Lawan / Beating)', () => {
    it('Single lebih tinggi mengalahkan Single lebih rendah', () => {
      const low = evaluateCombo(['9S'])!;
      const high = evaluateCombo(['TS'])!;
      expect(comboBeats(high, low)).toBe(true);
      expect(comboBeats(low, high)).toBe(false);

      // Seri rank: Sekop mengalahkan Wajik
      const spadeAce = evaluateCombo(['AS'])!;
      const diamondAce = evaluateCombo(['AD'])!;
      expect(comboBeats(spadeAce, diamondAce)).toBe(true);
      expect(comboBeats(diamondAce, spadeAce)).toBe(false);
    });

    it('Pair lebih tinggi mengalahkan Pair lebih rendah', () => {
      const lowPair = evaluateCombo(['9S', '9H'])!;
      const highPair = evaluateCombo(['TS', 'TH'])!;
      expect(comboBeats(highPair, lowPair)).toBe(true);
      expect(comboBeats(lowPair, highPair)).toBe(false);
    });

    it('Kombinasi 5 kartu: Kategori lebih tinggi mengalahkan kategori lebih rendah', () => {
      const straight = evaluateCombo(['8S', '9H', 'TC', 'JD', 'QH'])!;
      const flush = evaluateCombo(['2S', '5S', '8S', 'JS', 'AS'])!;
      const fullHouse = evaluateCombo(['JS', 'JH', 'JC', '4D', '4S'])!;
      const quads = evaluateCombo(['7S', '7H', '7C', '7D', 'KH'])!;
      const sf = evaluateCombo(['5H', '6H', '7H', '8H', '9H'])!;
      const rf = evaluateCombo(['TH', 'JH', 'QH', 'KH', 'AH'])!;

      expect(comboBeats(flush, straight)).toBe(true);
      expect(comboBeats(straight, flush)).toBe(false);

      expect(comboBeats(fullHouse, flush)).toBe(true);
      expect(comboBeats(quads, fullHouse)).toBe(true);
      expect(comboBeats(sf, quads)).toBe(true);
      expect(comboBeats(rf, sf)).toBe(true);
    });

    it('Kartu angka 2 adalah kartu poker terbesar (Single 2 mengalahkan As, dan 2♠ adalah kartu tertinggi)', () => {
      const spade2 = evaluateCombo(['2S'])!;
      const heart2 = evaluateCombo(['2H'])!;
      const club2 = evaluateCombo(['2C'])!;
      const diamond2 = evaluateCombo(['2D'])!;
      const spadeAce = evaluateCombo(['AS'])!;
      const kingSpade = evaluateCombo(['KS'])!;
      const diamond3 = evaluateCombo(['3D'])!;

      // 2 mengalahkan As & King
      expect(comboBeats(diamond2, spadeAce)).toBe(true);
      expect(comboBeats(spade2, kingSpade)).toBe(true);
      expect(comboBeats(spadeAce, diamond2)).toBe(false);

      // Hierarki suit sesama kartu 2: Sekop > Hati > Keriting > Wajik
      expect(comboBeats(spade2, heart2)).toBe(true);
      expect(comboBeats(heart2, club2)).toBe(true);
      expect(comboBeats(club2, diamond2)).toBe(true);
      expect(comboBeats(diamond2, spade2)).toBe(false);

      // 3♦ adalah kartu terendah dalam deck
      expect(comboBeats(diamond2, diamond3)).toBe(true);
      expect(comboBeats(diamond3, diamond2)).toBe(false);
    });

    it('Pair 2 mengalahkan Pair As, dan Triple 2 mengalahkan Triple As', () => {
      const pair2 = evaluateCombo(['2S', '2H'])!;
      const pairAce = evaluateCombo(['AS', 'AH'])!;
      expect(comboBeats(pair2, pairAce)).toBe(true);
      expect(comboBeats(pairAce, pair2)).toBe(false);

      const trip2 = evaluateCombo(['2S', '2H', '2C'])!;
      const tripAce = evaluateCombo(['AS', 'AH', 'AC'])!;
      expect(comboBeats(trip2, tripAce)).toBe(true);
      expect(comboBeats(tripAce, trip2)).toBe(false);
    });

    it('Four of a Kind 2 mengalahkan Four of a Kind As, dan Full House 2 mengalahkan Full House As', () => {
      const quads2 = evaluateCombo(['2S', '2H', '2C', '2D', '3H'])!;
      const quadsAce = evaluateCombo(['AS', 'AH', 'AC', 'AD', 'KH'])!;
      expect(comboBeats(quads2, quadsAce)).toBe(true);
      expect(comboBeats(quadsAce, quads2)).toBe(false);

      const fh2 = evaluateCombo(['2S', '2H', '2C', '3D', '3S'])!;
      const fhAce = evaluateCombo(['AS', 'AH', 'AC', 'KD', 'KS'])!;
      expect(comboBeats(fh2, fhAce)).toBe(true);
      expect(comboBeats(fhAce, fh2)).toBe(false);
    });

    it('Straight dengan ujung 2 (J-Q-K-A-2) mengalahkan Straight (10-J-Q-K-A)', () => {
      const straight2 = evaluateCombo(['JS', 'QH', 'KC', 'AD', '2S'])!;
      const straightAce = evaluateCombo(['TS', 'JH', 'QC', 'KD', 'AS'])!;
      expect(straight2).not.toBeNull();
      expect(straight2.type).toBe('straight');
      expect(comboBeats(straight2, straightAce)).toBe(true);
      expect(comboBeats(straightAce, straight2)).toBe(false);
    });

    it('Jumlah kartu berbeda ditolak saat melawan (kecuali Bom 4 kartu melawan Single 2)', () => {
      const single = evaluateCombo(['AS'])!;
      const pair = evaluateCombo(['KS', 'KH'])!;
      expect(comboBeats(pair, single)).toBe(false);
    });

    it('Bom 4 kartu mengalahkan Single 2, tetapi tidak mengalahkan Single non-2', () => {
      const bomb6 = evaluateCombo(['6S', '6H', '6C', '6D'])!;
      const single2 = evaluateCombo(['2S'])!;
      const singleAce = evaluateCombo(['AS'])!;
      const singleKing = evaluateCombo(['KS'])!;

      // Bom 4 kartu mengalahkan Single 2
      expect(comboBeats(bomb6, single2)).toBe(true);

      // Bom 4 kartu TIDAK mengalahkan Single non-2
      expect(comboBeats(bomb6, singleAce)).toBe(false);
      expect(comboBeats(bomb6, singleKing)).toBe(false);

      // Kartu non-bom tidak bisa mengalahkan Bom
      expect(comboBeats(single2, bomb6)).toBe(false);
      expect(comboBeats(singleAce, bomb6)).toBe(false);
    });

    it('Bom nilai lebih tinggi mengalahkan Bom nilai lebih rendah', () => {
      const bomb6 = evaluateCombo(['6S', '6H', '6C', '6D'])!;
      const bomb8 = evaluateCombo(['8S', '8H', '8C', '8D'])!;
      const bombAce = evaluateCombo(['AS', 'AH', 'AC', 'AD'])!;
      const bomb2 = evaluateCombo(['2S', '2H', '2C', '2D'])!;

      expect(comboBeats(bomb8, bomb6)).toBe(true);
      expect(comboBeats(bomb6, bomb8)).toBe(false);

      expect(comboBeats(bombAce, bomb8)).toBe(true);
      expect(comboBeats(bomb2, bombAce)).toBe(true); // Bom 2 adalah bom tertinggi
    });
  });

  function finishDiscard3(state: TongkronganState): TongkronganState {
    let s = state;
    while (s.phase === 'discard3') {
      s = tongkrongan.apply(s, s.turn!, { type: 'discard3' }, rng);
    }
    return s;
  }

  describe('5. Aturan Tiga Kali Skip & Alur Giliran', () => {
    it('Tiga Skip berturut-turut membersihkan meja dan mengembalikan hak memimpin kepada pemain pemenang ronde', () => {
      let s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      const leadSeat = s.turn!;

      // Pemimpin ronde pertama mengeluarkan kartu pertama
      const leadCard = s.hands[leadSeat][0];
      s = tongkrongan.apply(s, leadSeat, { type: 'play', cards: [leadCard] }, rng);
      expect(s.currentCombo).not.toBeNull();
      expect(s.lastPlaySeat).toBe(leadSeat);
      expect(s.consecutiveSkips).toBe(0);

      // 3 pemain berikutnya Skip berturut-turut
      for (let i = 0; i < 3; i++) {
        const curTurn = s.turn!;
        expect(curTurn).not.toBe(leadSeat);
        s = tongkrongan.apply(s, curTurn, { type: 'skip' }, rng);
      }

      // Setelah 3 skip, meja harus bersih (currentCombo === null) dan giliran kembali ke leadSeat (pemenang trik sebelumnya)!
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(leadSeat);
      expect(s.consecutiveSkips).toBe(0);
    });

    it('Skip ditolak jika meja kosong (pemimpin ronde baru wajib bermain)', () => {
      const s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      expect(s.currentCombo).toBeNull();
      expect(() => tongkrongan.apply(s, s.turn!, { type: 'skip' }, rng)).toThrow(RuleError);
    });
  });

  describe('5b. Aturan Kartu Angka 3: Hanya di Ronde 1, Selanjutnya Memakai Pemenang Ronde Sebelumnya', () => {
    it('Ronde 1: Game dimulai di tahap discard3, semua yang memegang kartu 3 mengeluarkannya ke meja', () => {
      const s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      expect(s.phase).toBe('discard3');
      expect(s.round).toBe(1);
      expect(s.pendingDiscard3.length).toBeGreaterThan(0);
      expect(s.discards3).toEqual([]);

      // Seluruh kartu 3 awalnya ada di tangan pemain
      const threesInHands = s.hands.flat().filter(c => rankOf(c) === 3);
      expect(threesInHands.length).toBe(4);
    });

    it('Ronde 1: Pemain mengeluarkan kartu 3 mereka, lalu pemegang 3♠ mulai main duluan', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      const spade3Holder = s.hands.findIndex(h => h.includes(OPENING_CARD));
      expect(spade3Holder).toBeGreaterThanOrEqual(0);

      // Selesaikan seluruh pengeluaran kartu 3
      s = finishDiscard3(s);

      // Fase berpindah ke 'play' dan starter ronde 1 adalah pemegang 3♠
      expect(s.phase).toBe('play');
      expect(s.pendingDiscard3.length).toBe(0);
      expect(s.turn).toBe(spade3Holder);
      expect(s.opening).not.toBeNull();
      expect(s.opening!.seat).toBe(spade3Holder);
      expect(s.opening!.card).toBe(OPENING_CARD);

      // Pemain bisa langsung memimpin ronde dengan kartu bebas
      const leadCard = s.hands[spade3Holder][0];
      const next = tongkrongan.apply(s, spade3Holder, { type: 'play', cards: [leadCard] }, rng);
      expect(next.currentCombo).not.toBeNull();
      expect(next.lastPlaySeat).toBe(spade3Holder);
    });

    it('Ronde Selanjutnya (round > 1): Tidak ada tahap buka kartu 3, langsung dipimpin oleh pemenang ronde sebelumnya', () => {
      // Simulasikan Pemain 2 menang di ronde 1, lanjut ke ronde 2
      const s2 = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 2, previousWinner: 2 }, rng);

      // Langsung tahap 'play', TIDAK ADA discard3
      expect(s2.phase).toBe('play');
      expect(s2.round).toBe(2);
      expect(s2.pendingDiscard3).toEqual([]);
      expect(s2.discards3).toEqual([]);
      expect(s2.turn).toBe(2); // dipimpin pemenang ronde sebelumnya!

      // Seluruh 13 kartu remi utuh di tangan (kartu 3 tidak dikeluarkan)
      for (let i = 0; i < 4; i++) {
        expect(s2.hands[i].length).toBe(13);
      }
      expect(s2.hands.flat().filter(c => rankOf(c) === 3).length).toBe(4);

      // Pemain 2 bebas mengeluarkan kartu apa saja tanpa syarat angka 3
      const anyCard = s2.hands[2][0];
      const next = tongkrongan.apply(s2, 2, { type: 'play', cards: [anyCard] }, rng);
      expect(next.currentCombo).not.toBeNull();
      expect(next.lastPlaySeat).toBe(2);
    });

    it('Bot di tahap discard3 ronde 1 otomatis mengeluarkan kartu 3', () => {
      const s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      const v = tongkrongan.view(s, s.turn!);
      expect(v.phase).toBe('discard3');
      const action = tongkrongan.bot(v, 'normal', rng);
      expect(action).toEqual({ type: 'discard3' });
    });
  });

  describe('6. Aturan Skip Saat Pemain Berkurang', () => {
    it('Jika pemain aktif tinggal 3 orang, 2 skip berturut-turut mengakhiri ronde', () => {
      let s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      // Simulasikan pemain 3 sudah habis kartunya (keluar)
      s.finished.push(3);
      s.hands[3] = [];

      // Pemain 0 melempar kartu
      s.turn = 0;
      s.lastPlaySeat = 2;
      s.opening = null;
      s = tongkrongan.apply(s, 0, { type: 'play', cards: [s.hands[0][0]] }, rng);
      expect(s.turn).toBe(1);

      // Pemain 1 skip (1 skip)
      s = tongkrongan.apply(s, 1, { type: 'skip' }, rng);
      expect(s.turn).toBe(2);

      // Pemain 2 skip (2 skip) -> karena aktif cuma 0, 1, 2 (3 pemain), 2 skip sudah cukup!
      s = tongkrongan.apply(s, 2, { type: 'skip' }, rng);

      // Ronde berakhir dan kembali ke Pemain 0!
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(0);
    });
  });

  describe('7. Timeout Action', () => {
    it('Saat di tahap discard3 ronde 1, timeout menjalankan discard3', () => {
      const s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      expect(s.phase).toBe('discard3');
      const action = tongkrongan.timeoutAction(s, s.turn!);
      expect(action).toEqual({ type: 'discard3' });
    });

    it('Saat meja ada kombinasi di tahap play, timeout menjalankan skip', () => {
      let s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      s = tongkrongan.apply(s, s.turn!, { type: 'play', cards: [s.hands[s.turn!][0]] }, rng);

      const action = tongkrongan.timeoutAction(s, s.turn!);
      expect(action).toEqual({ type: 'skip' });
    });

    it('Saat meja kosong di tahap play, timeout memainkan kartu terendah pemain', () => {
      const s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      const action = tongkrongan.timeoutAction(s, s.turn!);
      expect(action.type).toBe('play');
      if (action.type === 'play') {
        expect(action.cards.length).toBe(1);
      }
    });
  });

  describe('8. Pemain Selesai, Juara, dan Akhir Pertandingan', () => {
    it('Permainan selesai dan mencatat juara 1 sampai 4 ketika hanya tersisa 1 pemain', () => {
      let s = finishDiscard3(tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15 }, rng));
      // Simulasikan kartu hampir habis di tahap play
      s.hands[0] = ['AS'];
      s.hands[1] = ['KS'];
      s.hands[2] = ['QS'];
      s.hands[3] = ['2D', '4D']; // Pemain 4 memiliki 2 kartu
      s.currentCombo = null;
      s.opening = null;
      s.turn = 0;

      // Pemain 0 lempar kartu terakhir -> Juara 1
      s = tongkrongan.apply(s, 0, { type: 'play', cards: ['AS'] }, rng);
      expect(s.finished).toContain(0);
      expect(s.over).toBe(false);

      // Pemain 1 skip, Pemain 2 skip, Pemain 3 skip -> ronde selesai
      // (Aktif tersisa 1, 2, 3 -> butuh 2 skip)
      s = tongkrongan.apply(s, 1, { type: 'skip' }, rng);
      s = tongkrongan.apply(s, 2, { type: 'skip' }, rng);

      // Ronde bersih, giliran pindah ke pemain aktif berikutnya (Pemain 1)
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(1);

      // Pemain 1 lempar KS -> Juara 2
      s = tongkrongan.apply(s, 1, { type: 'play', cards: ['KS'] }, rng);
      expect(s.finished).toContain(1);

      // Pemain 2 skip, Pemain 3 skip -> ronde selesai
      s = tongkrongan.apply(s, 2, { type: 'skip' }, rng);
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(2);

      // Pemain 2 lempar QS -> Juara 3
      s = tongkrongan.apply(s, 2, { type: 'play', cards: ['QS'] }, rng);
      expect(s.finished).toContain(2);

      // Sekarang hanya tersisa Pemain 3! Pertandingan harus langsung selesai (over = true)!
      expect(s.over).toBe(true);
      expect(s.finished).toEqual([0, 1, 2, 3]);

      const res = tongkrongan.results(s);
      expect(res).not.toBeNull();
      expect(res?.length).toBe(4);
      expect(res?.find(r => r.seat === 0)?.rank).toBe(1); // Juara 1
      expect(res?.find(r => r.seat === 1)?.rank).toBe(2); // Juara 2
      expect(res?.find(r => r.seat === 2)?.rank).toBe(3); // Juara 3
      expect(res?.find(r => r.seat === 3)?.rank).toBe(4); // Kalah (posisi 4)
    });
  });

  it('9. Simulasi Permainan Otomatis Bot sampai Selesai', () => {
    let s = tongkrongan.setup(
      [
        { id: '1', name: 'Bot 1', isBot: true },
        { id: '2', name: 'Bot 2', isBot: true },
        { id: '3', name: 'Bot 3', isBot: true },
        { id: '4', name: 'Bot 4', isBot: true },
      ],
      { passAndPlay: false, turnSeconds: 15 },
      rng
    );

    let maxSteps = 300;
    while (!s.over && maxSteps > 0) {
      maxSteps--;
      const curSeat = s.turn!;
      const view = tongkrongan.view(s, curSeat);
      const action = tongkrongan.bot(view, 'normal', rng);
      s = tongkrongan.apply(s, curSeat, action, rng);
    }

    expect(s.over).toBe(true);
    expect(s.finished.length + s.penalizedRank4.length).toBe(4);
    const res = tongkrongan.results(s);
    expect(res).not.toBeNull();
    expect(res?.length).toBe(4);
  });

  describe('10. Fitur Bom 4 Kartu & Restart Ronde', () => {
    it('Ngebom Single 2 di Ronde 1 me-restart Ronde 1 dari awal (fase discard3 ulang & kartu baru)', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      s = finishDiscard3(s);

      const starter = s.turn!;
      const nextSeat = (starter + 1) % 4;

      // Berikan starter kartu 2S dan pemain berikutnya Bom 6 ('6S', '6H', '6C', '6D')
      s.hands[starter].push('2S');
      s.hands[nextSeat].push('6S', '6H', '6C', '6D');

      // Starter lempar Single 2S
      s = tongkrongan.apply(s, starter, { type: 'play', cards: ['2S'] }, rng);
      expect(s.currentCombo?.type).toBe('single');
      expect(s.currentCombo?.cards).toEqual(['2S']);
      expect(s.turn).toBe(nextSeat);

      // Pemain berikutnya ngebom dengan 4 kartu 6!
      s = tongkrongan.apply(s, nextSeat, { type: 'play', cards: ['6S', '6H', '6C', '6D'] }, rng);

      // Game HARUS me-restart Ronde 1 dari awal!
      expect(s.round).toBe(1);
      expect(s.phase).toBe('discard3');
      expect(s.hands.every(h => h.length === 13)).toBe(true);
      expect(s.log.some(l => l.text.includes('💣💥 BOOM!') && l.text.includes('Bom 4 Kartu 6'))).toBe(true);
      expect(s.log.some(l => l.text.includes('Ronde 1 di-restart dari awal'))).toBe(true);
    });

    it('Ngebom Single 2 di Ronde 2 me-restart Ronde 2 dari awal (fase play ulang, dipimpin pemenang ronde sebelumnya)', () => {
      // Ronde 2 dengan previousWinner = 2
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 2, previousWinner: 2 }, rng);
      expect(s.phase).toBe('play');
      expect(s.round).toBe(2);
      expect(s.previousWinner).toBe(2);
      expect(s.turn).toBe(2);

      const leader = 2;
      const opponent = (leader + 1) % 4;

      // Siapkan kartu
      s.hands[leader].push('2D');
      s.hands[opponent].push('9S', '9H', '9C', '9D');

      // Leader lempar Single 2D
      s = tongkrongan.apply(s, leader, { type: 'play', cards: ['2D'] }, rng);
      expect(s.currentCombo?.type).toBe('single');
      expect(s.turn).toBe(opponent);

      // Lawan ngebom dengan 4 kartu 9!
      s = tongkrongan.apply(s, opponent, { type: 'play', cards: ['9S', '9H', '9C', '9D'] }, rng);

      // Game HARUS me-restart Ronde 2 dari awal!
      expect(s.round).toBe(2);
      expect(s.previousWinner).toBe(2);
      expect(s.phase).toBe('play');
      expect(s.turn).toBe(2); // Tetap dipimpin pemenang ronde sebelumnya
      expect(s.hands.every(h => h.length === 13)).toBe(true);
      expect(s.log.some(l => l.text.includes('💣💥 BOOM!') && l.text.includes('Bom 4 Kartu 9'))).toBe(true);
      expect(s.log.some(l => l.text.includes('Ronde 2 di-restart dari awal'))).toBe(true);
    });

    it('Bot yang menghadapi Single 2 dan memegang Bom 4 kartu akan otomatis mengeluarkan Bom', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      s = finishDiscard3(s);

      const starter = s.turn!;
      const botSeat = (starter + 1) % 4;

      // Pastikan kartu uji coba tidak terduplikasi dari pembagian awal
      const testCards: Card[] = ['2S', '6S', '6H', '6C', '6D'];
      for (let i = 0; i < 4; i++) {
        s.hands[i] = s.hands[i].filter(c => !testCards.includes(c));
      }
      s.hands[starter].push('2S');
      s.hands[botSeat].push('6S', '6H', '6C', '6D');

      // Starter lempar Single 2S
      s = tongkrongan.apply(s, starter, { type: 'play', cards: ['2S'] }, rng);

      // Cek respon bot
      const view = tongkrongan.view(s, botSeat);
      const action = tongkrongan.bot(view, 'normal', rng);

      expect(action.type).toBe('play');
      if (action.type === 'play') {
        const combo = evaluateCombo(action.cards);
        expect(combo?.type).toBe('bomb');
        expect(combo?.count).toBe(4);
      }
    });
  });

  describe('11. Aturan Penalti Kartu Poker (Kartu 2) di Akhir', () => {
    it('Pemain yang menutup kartunya dengan Single 2 otomatis dihukum KALAH sebagai Peringkat 4', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      s = finishDiscard3(s);

      const leader = s.turn!;
      // Atur tangan leader hanya tersisa 1 kartu: 2S
      s.hands[leader] = ['2S'];

      // Leader memimpin dan menghabiskan kartunya dengan Single 2S
      s = tongkrongan.apply(s, leader, { type: 'play', cards: ['2S'] }, rng);

      // Leader kartunya habis tapi TIDAK masuk s.finished (bukan Juara 1)
      expect(s.hands[leader].length).toBe(0);
      expect(s.finished).not.toContain(leader);
      expect(s.penalizedRank4).toContain(leader);
      expect(s.log.some(l => l.text.includes('HUKUMAN TUTUP POKER') && l.text.includes('Peringkat ke-4'))).toBe(true);

      // Permainan belum selesai karena masih ada 3 pemain aktif
      expect(s.over).toBe(false);
    });

    it('Pemain yang menutup kartunya dengan Pair 2 otomatis dihukum KALAH sebagai Peringkat 4', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      s = finishDiscard3(s);

      const leader = s.turn!;
      // Atur tangan leader hanya tersisa 2 kartu: Pair 2 ('2S', '2H')
      s.hands[leader] = ['2S', '2H'];

      // Leader memimpin dan menghabiskan kartunya dengan Pair 2
      s = tongkrongan.apply(s, leader, { type: 'play', cards: ['2S', '2H'] }, rng);

      expect(s.hands[leader].length).toBe(0);
      expect(s.finished).not.toContain(leader);
      expect(s.penalizedRank4).toContain(leader);
      expect(s.over).toBe(false);
    });

    it('Pemain lain tetap memperebutkan Juara 1, 2, 3 dan pemain penutup 2 fix Peringkat 4', () => {
      let s = tongkrongan.setup(seats, { passAndPlay: false, turnSeconds: 15, round: 1 }, rng);
      s = finishDiscard3(s);

      // Atur tangan khusus:
      // Pemain 0 sisa 2S (akan menutup dengan 2 -> Kalah Rank 4)
      // Pemain 1 sisa AS (akan Juara 1)
      // Pemain 2 sisa KS (akan Juara 2)
      // Pemain 3 sisa QS (akan Juara 3)
      s.turn = 0;
      s.currentCombo = null;
      s.hands[0] = ['2S'];
      s.hands[1] = ['AS'];
      s.hands[2] = ['KS'];
      s.hands[3] = ['QS'];

      // Pemain 0 melempar 2S -> Dihukum Rank 4
      s = tongkrongan.apply(s, 0, { type: 'play', cards: ['2S'] }, rng);
      expect(s.penalizedRank4).toEqual([0]);

      // Ada 3 pemain aktif (1, 2, 3) -> butuh 2 skip untuk membersihkan meja
      s = tongkrongan.apply(s, 1, { type: 'skip' }, rng);
      s = tongkrongan.apply(s, 2, { type: 'skip' }, rng);

      // Trik selesai, meja bersih, giliran ke Pemain 1
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(1);

      // Pemain 1 melempar AS -> Juara 1
      s = tongkrongan.apply(s, 1, { type: 'play', cards: ['AS'] }, rng);
      expect(s.finished).toEqual([1]);

      // Tersisa 2 pemain aktif (2, 3) -> butuh 1 skip untuk membersihkan meja
      expect(s.turn).toBe(2);
      s = tongkrongan.apply(s, 2, { type: 'skip' }, rng);

      // Meja bersih, giliran kembali ke Pemain 2
      expect(s.currentCombo).toBeNull();
      expect(s.turn).toBe(2);

      // Pemain 2 melempar KS -> Juara 2
      s = tongkrongan.apply(s, 2, { type: 'play', cards: ['KS'] }, rng);
      expect(s.finished).toEqual([1, 2, 3]);

      // Sekarang hanya tersisa Pemain 3 aktif! Pertandingan selesai!
      expect(s.over).toBe(true);

      const res = tongkrongan.results(s);
      expect(res).not.toBeNull();
      expect(res?.find(r => r.seat === 1)?.rank).toBe(1); // Pemain 1 -> Juara 1
      expect(res?.find(r => r.seat === 2)?.rank).toBe(2); // Pemain 2 -> Juara 2
      expect(res?.find(r => r.seat === 3)?.rank).toBe(3); // Pemain 3 -> Juara 3
      expect(res?.find(r => r.seat === 0)?.rank).toBe(4); // Pemain 0 -> Peringkat 4 (Hukuman tutup 2)!
    });
  });
});
