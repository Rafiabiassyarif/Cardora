// tables/TongkronganTable.tsx — UI meja Poker Tongkrongan 4 pemain (Shedding game).
import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';import { 
  type TongkronganView, 
  type TongkronganAction, 
  type Card, 
  OPENING_CARD,
  evaluateCombo, 
  comboBeats, 
  cardLabel,
  rankOf 
} from '@kuypoker/engine';
import { createPortal } from 'react-dom';
import { PlayingCard } from '../components/ui';
import { PlayerHand } from '../components/hand';

/** Urutan Tongkrongan: 3 terendah … As, lalu 2 tertinggi. */
const bigTwoRank = (c: Card) => (rankOf(c) === 2 ? 15 : rankOf(c));
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';
import { IconX } from '../components/icons';
import { flyIn } from '../lib/flights';

export function TongkronganTable({
  v,
  act,
  avatars,
  dock,
  bubble,
}: {
  v: TongkronganView;
  act: (a: TongkronganAction) => void;
  avatars: string[];
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you ?? 0;
  const isMyTurn = v.turn !== null && v.turn === me && !v.over;
  const l = v.legal;

  // Multi-select kartu yang ingin dimainkan
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  // Layar privasi Operan HP jika mode Pass & Play aktif
  const [revealed, setRevealed] = useState(!v.passAndPlay);
  const [lastTurn, setLastTurn] = useState<number | null>(null);

  // ---- Animasi: kombinasi yang baru dikeluarkan meluncur dari kursi pemainnya ----
  const animRef = useRef<HTMLSpanElement>(null);
  const prevCombo = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = animRef.current?.closest('.felt');
    const sig = v.currentCombo ? `${v.lastPlaySeat}-${v.currentCombo.cards.join('')}` : null;
    if (root && sig && prevCombo.current !== null && sig !== prevCombo.current) {
      const from = v.lastPlaySeat === me ? root.querySelector('.player-hand') : root.querySelector(`[data-seat="${v.lastPlaySeat}"]`);
      root.querySelectorAll('.combo-cards .pcard').forEach((el, i) => flyIn(el, from, { delay: i * 60, duration: 440 }));
    }
    prevCombo.current = sig ?? '';
  });

  // Saat giliran berpindah di mode Pass & Play, pasang tirai privasi
  useEffect(() => {
    if (v.passAndPlay && v.turn !== null && v.turn !== lastTurn) {
      setRevealed(false);
      setLastTurn(v.turn);
      setSelectedCards([]);
    }
  }, [v.turn, v.passAndPlay, lastTurn]);

  // Reset pilihan kartu bila kartu yang dipilih sudah tidak ada di tangan
  useEffect(() => {
    setSelectedCards(prev => prev.filter(c => v.hand.includes(c)));
  }, [v.hand]);

  const others = rotateSeats(4, me).slice(1);
  const myThrees = useMemo(() => v.hand.filter(c => rankOf(c) === 3), [v.hand]);

  // Evaluasi kombinasi kartu yang sedang dipilih pemain
  const selectedCombo = useMemo(() => {
    if (selectedCards.length === 0) return null;
    return evaluateCombo(selectedCards);
  }, [selectedCards]);

  // Validasi apakah kombinasi yang dipilih bisa dimainkan saat ini
  const canPlaySelected = useMemo(() => {
    if (!isMyTurn || !selectedCombo || v.phase !== 'play') return false;
    if (!v.currentCombo) return true;
    return comboBeats(selectedCombo, v.currentCombo);
  }, [isMyTurn, selectedCombo, v.currentCombo, v.phase]);

  // Cek apakah aksi saat ini akan meledakkan kartu Single 2 dengan Bom
  const isBombingTwo = useMemo(() => {
    return Boolean(
      v.currentCombo?.type === 'single' &&
      rankOf(v.currentCombo.cards[0]) === 2 &&
      selectedCombo?.type === 'bomb'
    );
  }, [v.currentCombo, selectedCombo]);

  // Cek apakah aksi saat ini akan menghabiskan kartu tangan menggunakan kartu angka 2 (hukuman kalah posisi 4)
  const willCloseWithTwo = useMemo(() => {
    return Boolean(
      selectedCards.length > 0 &&
      selectedCards.length === v.hand.length &&
      selectedCards.some(c => rankOf(c) === 2)
    );
  }, [selectedCards, v.hand]);

  // Alasan tombol Mainkan belum bisa ditekan (ditampilkan di dock).
  const blockReason = !isMyTurn ? null
    : selectedCards.length > 0 && !selectedCombo ? 'Bukan kombinasi sah'
    : null;

  // Pengumuman kartu pembuka 3♠: muncul sekali di awal ronde 1 saat seluruh 3 selesai keluar
  const [revealOpening, setRevealOpening] = useState<TongkronganView['opening']>(null);
  const openingSeen = useRef<string | null>(null);
  const openingKey = v.opening ? `${v.opening.seat}-${v.opening.card}` : null;
  useEffect(() => {
    if (!v.opening || openingKey === openingSeen.current) return;
    openingSeen.current = openingKey;
    setRevealOpening(v.opening);
  }, [openingKey, v.opening]);

  // Timer sembunyi terpisah untuk banner pembuka
  useEffect(() => {
    if (!revealOpening) return;
    const t = setTimeout(() => setRevealOpening(null), 6000);
    return () => clearTimeout(t);
  }, [revealOpening]);

  const toggleSelectCard = (card: Card) => {
    play('card');
    setSelectedCards(prev => 
      prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card]
    );
  };

  const handleDiscard3 = () => {
    if (!isMyTurn || v.phase !== 'discard3') return;
    play('card');
    act({ type: 'discard3' });
    setSelectedCards([]);
  };

  const handlePlay = () => {
    if (!canPlaySelected || selectedCards.length === 0) return;
    if (isBombingTwo) {
      play('allin');
    } else {
      play('card');
    }
    act({ type: 'play', cards: selectedCards });
    setSelectedCards([]);
  };

  const handleSkip = () => {
    if (!isMyTurn || !v.currentCombo) return;
    play('click');
    act({ type: 'skip' });
    setSelectedCards([]);
  };

  const rankBadgeText = (seat: number) => {
    if (v.penalizedRank4?.includes(seat)) {
      return 'Kalah (Tutup 2 ⚠️)';
    }
    const idx = v.finished.indexOf(seat);
    if (idx === 0) return 'Juara 1';
    if (idx === 1) return 'Juara 2';
    if (idx === 2) return 'Juara 3';
    if (idx === 3) return 'Posisi 4';
    return `${v.handCounts[seat]} kartu`;
  };

  return (
    <>
      {/* Layar Operan HP (Pass & Play Privacy Veil) */}
      {v.passAndPlay && !revealed && isMyTurn && (
        <div className="pass-play-overlay">
          <div className="card-box stack center" style={{ padding: '26px 20px', maxWidth: 380, animation: 'fadeIn 0.25s' }}>
            <h2 style={{ margin: '4px 0 4px', color: 'var(--gold-light)' }}>Giliran {v.names[me]}</h2>
            <p className="muted small center" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
              Jaga kerahasiaan kartumu. Pemain lain dilarang mengintip layar ini.
            </p>
            <button 
              className="btn btn-gold btn-lg" 
              style={{ width: '100%', fontSize: '1rem', padding: '12px' }}
              onClick={() => { setRevealed(true); play('turn'); }}
            >
              Buka Kartu & Ambil Giliran
            </button>
          </div>
        </div>
      )}

      <span ref={animRef} hidden />
      {/* 3 Pemain Lawan di Meja */}
      <Opponents>
        {others.map(seat => {
          const finished = v.finished.includes(seat);
          return (
            <SeatBadge
              key={seat}
              seat={seat}
              name={v.names[seat]}
              avatar={avatars[seat]}
              turn={v.turn === seat}
              folded={finished}
              sub={rankBadgeText(seat)}
              bubble={bubble?.seat === seat ? bubble.text : undefined}
              extra={
                !finished && (
                  <div className="cards overlap">
                    {Array.from({ length: Math.min(v.handCounts[seat], 6) }, (_, k) => (
                      <PlayingCard key={k} small card={null} />
                    ))}
                  </div>
                )
              }
            />
          );
        })}
      </Opponents>

      {/* Pengumuman pembuka ronde 1 3♠ */}
      {revealOpening && (
        <div className="opening-reveal" role="status" aria-live="polite">
          <div className="opening-card" aria-hidden="true">
            <PlayingCard card={revealOpening.card} />
          </div>
          <div className="opening-text">
            <b>
              {revealOpening.seat === me
                ? 'Kamu mengeluarkan 3♠ — kamu main duluan!'
                : `${v.names[revealOpening.seat]} mengeluarkan 3♠ — main duluan!`}
            </b>
            <span>
              Seluruh kartu 3 telah keluar. {revealOpening.seat === me ? 'Kamu memimpin ronde pertama!' : `${v.names[revealOpening.seat]} memimpin ronde pertama.`}
            </span>
          </div>
          <button className="opening-close" onClick={() => setRevealOpening(null)} aria-label="Tutup pengumuman pembuka">
            <IconX size={16} />
          </button>
        </div>
      )}

      {/* Area Tengah Meja: Tahap Discard 3 / Kombinasi Meja / Info Ronde */}
      <div className="center-area">
        {v.phase === 'discard3' ? (
          <div className="stack center" style={{ gap: 8, padding: '12px 18px', background: 'rgba(255,253,249,0.85)', borderRadius: 12, border: '1px solid var(--hair)' }}>
            <b style={{ color: 'var(--gold-light)', fontSize: '1.05rem' }}>🃏 Tahap Buka Kartu 3 (Ronde 1)</b>
            <span className="muted small center">
              {isMyTurn ? 'Giliranmu mengeluarkan kartu angka 3 ke meja!' : `Menunggu ${v.names[v.turn ?? 0]} mengeluarkan kartu angka 3…`}
            </span>
            {v.discards3.length > 0 && (
              <div className="stack center" style={{ gap: 6, width: '100%', marginTop: 4 }}>
                <span className="small muted" style={{ fontSize: '0.78rem' }}>Kartu 3 yang sudah keluar ke meja:</span>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {v.discards3.map(d => (
                    <div key={d.seat} className="row small" style={{ alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.06)', padding: '2px 8px', borderRadius: 8 }}>
                      <span style={{ fontWeight: 600 }}>{d.seat === me ? 'Kamu' : v.names[d.seat]}:</span>
                      <div className="cards" style={{ gap: 2 }}>
                        {d.cards.map((c, idx) => (
                          <PlayingCard key={idx} card={c} small />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : v.currentCombo ? (
          <div className="stack center" style={{ gap: 6, animation: 'popIn 0.25s ease-out' }}>
            <span className="small muted">
              Kombinasi meja (oleh <b>{v.names[v.lastPlaySeat ?? 0]}</b>):
            </span>
            <div className="cards combo-cards" style={{ justifyContent: 'center' }}>
              {v.currentCombo.cards.map((c, i) => (
                <PlayingCard key={`${c}-${i}`} card={c} delay={i * 60} />
              ))}
            </div>
            <div className="pot" style={{ fontSize: '0.92rem', padding: '4px 14px' }}>
              {v.currentCombo.description}
            </div>
            {v.currentCombo.type === 'single' && rankOf(v.currentCombo.cards[0]) === 2 && (
              <div 
                className="badge warn small" 
                style={{ fontSize: '0.74rem', padding: '2px 8px', animation: 'pulse 1.5s infinite', border: '1px solid rgba(229, 62, 62, 0.4)' }}
              >
                💣 Kartu 2 tertinggi ini bisa dilawan dengan Bom 4 kartu untuk restart ronde!
              </div>
            )}
            <div className="row small" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted">Aturan Tiga Kali Skip:</span>
              <span className="badge" style={{ color: 'var(--gold-light)' }}>
                {v.consecutiveSkips} / {v.skipsNeeded} Skip
              </span>
            </div>
          </div>
        ) : v.round > 1 && !v.lastPlaySeat ? (
          <div className="stack center" style={{ gap: 6, padding: '12px 18px', background: 'rgba(255,253,249,0.85)', borderRadius: 12, border: '1px solid var(--hair)' }}>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '1.1rem' }}>👑</span>
              <b style={{ color: 'var(--gold-light)', fontSize: '1rem' }}>
                Ronde {v.round}: Dipimpin {v.turn === me ? 'Kamu' : v.names[v.turn ?? 0]} (Pemenang Ronde Sebelumnya)
              </b>
            </div>
            <span className="muted small center" style={{ maxWidth: 360, lineHeight: 1.4 }}>
              {isMyTurn
                ? 'Kamu memenangkan ronde sebelumnya! Bebas keluarkan Single, Pair, Triple, atau 5 Kartu Poker tanpa tahap buka kartu 3.'
                : `Menunggu ${v.names[v.turn ?? 0]} (pemenang ronde sebelumnya) memulai permainan…`}
            </span>
          </div>
        ) : (
          <div className="stack center" style={{ gap: 6, padding: '12px 18px', background: 'rgba(255,253,249,0.78)', borderRadius: 12 }}>
            <b style={{ color: 'var(--gold-light)', fontSize: '1rem' }}>Ronde Baru (Bebas Memimpin)</b>
            <span className="muted small center">
              {isMyTurn ? 'Kamu memimpin! Bebas keluarkan Single, Pair, Triple, atau 5 Kartu Poker.' : `Menunggu ${v.names[v.turn ?? 0]} memulai ronde baru…`}
            </span>
          </div>
        )}
      </div>

      {/* Area Kartu Pemain di Bagian Bawah */}
      <div className="me-area">
        <SeatBadge
          seat={me}
          name={`${v.names[me]} (kamu)`}
          avatar={avatars[me]}
          turn={isMyTurn}
          folded={v.finished.includes(me)}
          sub={rankBadgeText(me)}
          bubble={bubble?.seat === me ? bubble.text : undefined}
        />

        {/* Hand Cards Horizontal Scroll */}
        <PlayerHand
          cards={v.hand}
          rankValue={bigTwoRank}
          myTurn={isMyTurn}
          state={c => ({
            playable: isMyTurn && (v.phase === 'play' || (v.phase === 'discard3' && rankOf(c) === 3)),
            selected: selectedCards.includes(c),
            onClick: () => toggleSelectCard(c),
          })}
        />

        {/* Tombol Aksi di Dock */}
        {dock && createPortal(
          <>
            {v.phase === 'discard3' ? (
              <div className="actions" style={{ justifyContent: 'center', gap: 8 }}>
                {isMyTurn && myThrees.length > 0 ? (
                  <button
                    className="btn btn-gold btn-lg"
                    onClick={handleDiscard3}
                    style={{ boxShadow: '0 0 16px rgba(229, 178, 66, 0.4)' }}
                  >
                    🃏 Keluarkan Kartu 3 ({myThrees.map(cardLabel).join(', ')})
                  </button>
                ) : (
                  <span className="badge" style={{ padding: '8px 16px', fontSize: '0.88rem' }}>
                    {myThrees.length === 0 ? 'Kamu tidak memiliki kartu angka 3' : 'Menunggu giliran buang 3…'}
                  </span>
                )}
              </div>
            ) : (
              <>
                {/* Status seleksi kartu (di dock agar tidak menambah tinggi area meja) */}
                {selectedCards.length > 0 && (
                  <div className="row small" style={{ justifyContent: 'center', gap: 8, flexDirection: 'column', alignItems: 'center' }}>
                    <div className="row small" style={{ justifyContent: 'center', gap: 8 }}>
                      <span className={`badge${selectedCombo && canPlaySelected ? ' ok' : ' warn'}`}>
                        {selectedCards.length} kartu dipilih: {selectedCombo ? selectedCombo.description : 'Bukan kombinasi sah'}
                        {!canPlaySelected && blockReason && blockReason !== 'Bukan kombinasi sah' ? ` · ${blockReason}` : ''}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedCards([])}
                        style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                      >
                        ✕ Batal Pilih
                      </button>
                    </div>
                    {willCloseWithTwo && canPlaySelected && (
                      <div 
                        className="badge warn" 
                        style={{ 
                          color: '#fff', 
                          background: 'rgba(229, 62, 62, 0.85)', 
                          border: '1px solid #feb2b2', 
                          fontSize: '0.78rem', 
                          padding: '3px 10px',
                          boxShadow: '0 0 10px rgba(229, 62, 62, 0.4)'
                        }}
                      >
                        ⚠️ AWAS: Menghabiskan kartu dengan kartu 2 akan langsung membuatmu KALAH di Peringkat ke-4!
                      </div>
                    )}
                  </div>
                )}
                <div className="actions" style={{ justifyContent: 'center', gap: 8 }}>
                  <button
                    className={`btn btn-lg ${canPlaySelected ? 'btn-gold' : ''}`}
                    disabled={!canPlaySelected}
                    onClick={handlePlay}
                    style={
                      willCloseWithTwo && canPlaySelected
                        ? {
                            background: 'linear-gradient(135deg, #c53030, #9b2c2c)',
                            color: '#ffffff',
                            borderColor: '#feb2b2',
                            boxShadow: '0 0 16px rgba(197, 48, 48, 0.6)',
                            fontWeight: 700,
                          }
                        : isBombingTwo
                        ? {
                            background: 'linear-gradient(135deg, #e53e3e, #dd6b20)',
                            color: '#ffffff',
                            borderColor: '#fc8181',
                            boxShadow: '0 0 18px rgba(229, 62, 62, 0.65)',
                            fontWeight: 700,
                          }
                        : undefined
                    }
                  >
                    {willCloseWithTwo && canPlaySelected
                      ? `⚠️ Mainkan (Penalti Kalah Peringkat 4)`
                      : isBombingTwo
                      ? `💣 NGEBOM KARTU 2! (${selectedCombo?.description})`
                      : v.currentCombo
                      ? 'Lawan Meja'
                      : 'Mainkan Kartu'}
                    {!isBombingTwo && !willCloseWithTwo && selectedCombo && canPlaySelected ? ` (${selectedCombo.description})` : ''}
                  </button>

                  {v.currentCombo !== null && (
                    <button
                      className="btn btn-lg"
                      disabled={!isMyTurn}
                      onClick={handleSkip}
                      title="Lewati giliran ini tanpa melempar kartu"
                    >
                      Skip Giliran
                    </button>
                  )}
                </div>
              </>
            )}
          </>,
          dock
        )}
      </div>
    </>
  );
}
