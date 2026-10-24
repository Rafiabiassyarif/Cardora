// tables/UniversalTable.tsx — UI meja serbaguna untuk seluruh varian game kartu di Cardora.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '@kuypoker/engine';
import { PlayingCard } from '../components/ui';
import { PlayerHand } from '../components/hand';
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';
import { IconPlay, IconPlus } from '../components/icons';

export function UniversalTable({
  v,
  act,
  avatars,
  dock,
  bubble,
}: {
  v: any;
  act: (a: any) => void;
  avatars: string[];
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you ?? 0;
  const isMyTurn = v.turn !== null && v.turn === me && !v.over;
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  useEffect(() => {
    setSelectedCards(prev => prev.filter(c => v.hand?.includes(c)));
  }, [v.hand]);

  const others = rotateSeats(v.names.length, me).slice(1);

  const toggleSelectCard = (card: Card) => {
    play('card');
    setSelectedCards(prev =>
      prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card]
    );
  };

  const handlePlay = () => {
    if (!isMyTurn || selectedCards.length === 0) return;
    play('card');
    act({ type: 'play', cards: selectedCards });
    setSelectedCards([]);
  };

  const handleDraw = () => {
    if (!isMyTurn) return;
    play('card');
    act({ type: 'draw' });
    setSelectedCards([]);
  };

  const handlePass = () => {
    if (!isMyTurn) return;
    play('click');
    act({ type: 'pass' });
    setSelectedCards([]);
  };

  return (
    <>
      {/* Pemain Lawan di Sekeliling Meja */}
      <Opponents>
        {others.map(seat => {
          const finished = v.finished ? v.finished.includes(seat) : false;
          return (
            <SeatBadge
              key={seat}
              seat={seat}
              name={v.names[seat]}
              avatar={avatars[seat]}
              turn={v.turn === seat}
              folded={finished}
              sub={v.scores ? `${v.scores[seat]} pt` : `${v.handCounts[seat]} kartu`}
              bubble={bubble && bubble.seat === seat ? bubble.text : undefined}
              extra={
                !finished && (
                  <div className="cards overlap">
                    {Array.from({ length: Math.min(v.handCounts[seat] ?? 5, 5) }, (_, k) => (
                      <PlayingCard key={k} small card={null} />
                    ))}
                  </div>
                )
              }
            />
          );
        })}
      </Opponents>

      {/* Area Tengah Meja: Tumpukan Kartu, Buangan, & Info Ronde */}
      <div className="center-area">
        <div className="stack center" style={{ gap: 10, padding: '14px 22px', background: 'rgba(255,253,249,0.85)', borderRadius: 14, border: '1px solid var(--hair)' }}>
          <div className="row small" style={{ justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <b style={{ color: 'var(--gold-light)' }}>
              {v.round ? `🎯 Ronde ${v.round} / ${v.maxRounds ?? 3}` : '🃏 Meja Kartu'}
            </b>
            <span className="badge" style={{ fontSize: '0.75rem' }}>
              Deck: {v.deckCount ?? 0} kartu
            </span>
          </div>

          {/* Area Kartu di Meja */}
          <div className="row" style={{ gap: 16, alignItems: 'center', justifyContent: 'center' }}>
            {/* Tumpukan Ambil (Deck) */}
            <div className="stack center" style={{ gap: 4 }}>
              <span className="small muted" style={{ fontSize: '0.72rem' }}>Deck</span>
              <PlayingCard card={null} />
            </div>

            {/* Tumpukan Buang (Discard Pile) */}
            <div className="stack center" style={{ gap: 4 }}>
              <span className="small muted" style={{ fontSize: '0.72rem' }}>Terbuka</span>
              {v.topDiscard ? (
                <PlayingCard card={v.topDiscard} />
              ) : (
                <div style={{ width: 54, height: 78, border: '2px dashed var(--hair)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.75rem' }}>
                  Kosong
                </div>
              )}
            </div>
          </div>

          <span className="muted small center">
            {isMyTurn ? 'Giliranmu! Pilih kartu di tanganmu untuk dimainkan atau ambil dari deck.' : `Menunggu giliran ${v.names[v.turn ?? 0]}…`}
          </span>
        </div>
      </div>

      {/* Area Pemain (Bawah Meja) */}
      <div className="me-area">
        <SeatBadge
          seat={me}
          name={`${v.names[me]} (kamu)`}
          avatar={avatars[me]}
          turn={isMyTurn}
          sub={v.scores ? `${v.scores[me]} pt · ${v.hand?.length ?? 0} kartu` : `${v.hand?.length ?? 0} kartu`}
          bubble={bubble && bubble.seat === me ? bubble.text : undefined}
        />

        {/* Hand Cards */}
        <PlayerHand
          cards={v.hand ?? []}
          myTurn={isMyTurn}
          state={c => ({
            playable: isMyTurn,
            selected: selectedCards.includes(c),
            onClick: () => toggleSelectCard(c),
          })}
        />

        {/* Tombol Aksi di Dock */}
        {dock && createPortal(
          <>
            {selectedCards.length > 0 && (
              <div className="hand-selection-bar">
                <div className="hand-selection-pill is-valid">
                  <span className="hand-selection-text">
                    <b>{selectedCards.length} kartu dipilih</b>
                  </span>
                  <button
                    type="button"
                    className="hand-selection-cancel"
                    onClick={() => setSelectedCards([])}
                    title="Batal pilih kartu"
                    aria-label="Batal pilih kartu"
                  >
                    ✕ Batal
                  </button>
                </div>
              </div>
            )}
            <div className="actions" style={{ justifyContent: 'center', gap: 10 }}>
              {selectedCards.length > 0 && (
                <button
                  className="btn btn-gold btn-lg"
                  onClick={handlePlay}
                  style={{ boxShadow: '0 0 16px rgba(229, 178, 66, 0.4)' }}
                >
                  <IconPlay size={16} /> Mainkan ({selectedCards.length})
                </button>
              )}

              {v.legal?.canDraw !== false && (
                <button
                  className="btn btn-lg"
                  disabled={!isMyTurn}
                  onClick={handleDraw}
                  title="Ambil 1 kartu dari deck"
                >
                  <IconPlus size={16} /> Ambil Kartu
                </button>
              )}

              {v.legal?.canPass !== false && (
                <button
                  className="btn btn-lg"
                  disabled={!isMyTurn}
                  onClick={handlePass}
                  title="Lewati giliran ini"
                >
                  Lewati
                </button>
              )}
            </div>
          </>,
          dock
        )}
      </div>
    </>
  );
}
