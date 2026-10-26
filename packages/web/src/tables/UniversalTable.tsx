// tables/UniversalTable.tsx — meja serbaguna untuk semua game berprotokol GenericView.
//
// Meja ini tidak tahu aturan game apa pun: ia hanya menggambar view dari engine
// (pemain, tumpukan di tengah, kartu tangan) dan menampilkan tombol untuk setiap aksi
// sah di `v.actions`. Aksi yang butuh kartu memakai kartu yang dipilih di tangan;
// aksi yang butuh angka menampilkan pengatur angka; aksi yang butuh lawan menampilkan pilihan pemain.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card, GActionSpec, GenericView, GPile, GPlayer } from '@kuypoker/engine';
import { PlayingCard } from '../components/ui';
import { PlayerHand } from '../components/hand';
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';

function playerSub(p: GPlayer): string {
  const text = [p.score, p.status].filter(Boolean).join(' · ');
  // Game boleh sudah menyebut jumlah kartu/skor di status; hindari info dobel.
  const parts = text ? text.split(' · ') : [];
  if (!/kartu/.test(text)) parts.push(`${p.count} kartu`);
  return [...new Set(parts)].join(' · ');
}

function SmallCards({ cards, max = 7 }: { cards: (Card | null)[]; max?: number }) {
  if (!cards.length) return null;
  const shown = cards.slice(-max);
  return (
    <div className="cards overlap">
      {shown.map((c, k) => <PlayingCard key={`${k}-${c ?? 'x'}`} small card={c} />)}
    </div>
  );
}

function Melds({ melds }: { melds?: Card[][] }) {
  if (!melds?.length) return null;
  return (
    <div className="gx-melds">
      {melds.map((m, i) => <SmallCards key={i} cards={m} max={13} />)}
    </div>
  );
}

function Pile({ pile }: { pile: GPile }) {
  const count = pile.count ?? pile.cards.length;
  // Rantai domino digambar MENDATAR dengan penanda ujung, supaya arah rantai jelas.
  const isChain = !!pile.chain;
  return (
    <div className={`gx-pile${pile.highlight ? ' hl' : ''}${isChain ? ' gx-pile-chain' : ''}`}>
      <span className="gx-pile-label">{pile.label}{pile.count !== undefined ? ` · ${count}` : ''}</span>
      {pile.cards.length === 0 ? (
        <div className="gx-empty">Kosong</div>
      ) : isChain ? (
        <div className="gx-chain">
          <span className="gx-end left" title="Ujung kiri rantai">
            <i aria-hidden="true">◀</i> {pile.chain!.left}
          </span>
          <div className="gx-chain-track">
            {pile.cards.map((c, k) => (
              <PlayingCard key={`${k}-${c ?? 'x'}`} card={c} landscape />
            ))}
          </div>
          <span className="gx-end right" title="Ujung kanan rantai">
            {pile.chain!.right} <i aria-hidden="true">▶</i>
          </span>
        </div>
      ) : pile.spread ? (
        <div className="gx-spread">
          {pile.cards.map((c, k) => <PlayingCard key={`${k}-${c ?? 'x'}`} small={pile.cards.length > 5} card={c} />)}
        </div>
      ) : (
        <PlayingCard card={pile.cards[pile.cards.length - 1]} />
      )}
      {pile.caption && <span className="gx-caption">{pile.caption}</span>}
    </div>
  );
}

export function UniversalTable({
  v,
  act,
  avatars,
  dock,
  bubble,
}: {
  v: GenericView;
  act: (a: unknown) => void;
  avatars: string[];
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you ?? 0;
  const meP = v.players[me];
  const isMyTurn = v.turn !== null && v.turn === v.you && !v.over;
  const [selected, setSelected] = useState<Card[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [pickTarget, setPickTarget] = useState<GActionSpec | null>(null);

  // Buang pilihan kartu yang sudah tidak ada di tangan.
  useEffect(() => {
    setSelected(prev => {
      const next = prev.filter(c => v.hand.includes(c));
      return next.length === prev.length ? prev : next;
    });
  }, [v.hand]);

  // Tutup pemilih lawan bila aksinya sudah tidak tersedia.
  useEffect(() => {
    if (pickTarget && !v.actions.some(a => a.id === pickTarget.id)) setPickTarget(null);
  }, [v.actions, pickTarget]);

  const cardActions = v.actions.filter(a => a.cards);
  const canSelect = cardActions.length > 0;
  const maxSelect = Math.max(0, ...cardActions.map(a => a.cards!.max));
  const playable = useMemo(() => new Set(v.playable ?? []), [v.playable]);

  const toggle = (c: Card) => {
    if (!canSelect) return;
    play('card');
    setSelected(prev => {
      if (prev.includes(c)) return prev.filter(x => x !== c);
      if (maxSelect === 1) return [c];
      return prev.length >= maxSelect ? prev : [...prev, c];
    });
  };

  const amountOf = (a: GActionSpec) => {
    const s = a.amount!;
    const raw = amounts[a.id] ?? s.default ?? s.min;
    return Math.min(s.max, Math.max(s.min, raw));
  };

  const send = (a: GActionSpec, target?: number) => {
    const msg: Record<string, unknown> = { type: 'act', id: a.id };
    if (a.cards) msg.cards = selected;
    if (a.amount) msg.amount = amountOf(a);
    if (target !== undefined) msg.target = target;
    play(a.style === 'danger' ? 'click' : 'card');
    act(msg);
    setSelected([]);
    setPickTarget(null);
  };

  const press = (a: GActionSpec) => {
    if (a.targets && a.targets.length > 1) { setPickTarget(a); return; }
    send(a, a.targets?.[0]);
  };

  const enabled = (a: GActionSpec) => !a.cards || (selected.length >= a.cards.min && selected.length <= a.cards.max);

  const others = rotateSeats(v.players.length, me).slice(1);
  const amountActions = v.actions.filter(a => a.amount);

  return (
    <>
      <Opponents>
        {others.map(seat => {
          const p = v.players[seat];
          const faceUp = p.faceUp ?? [];
          return (
            <SeatBadge
              key={seat}
              seat={seat}
              name={p.name}
              avatar={avatars[seat]}
              turn={v.turn === seat}
              folded={p.out}
              tag={p.tag}
              sub={playerSub(p)}
              bubble={bubble && bubble.seat === seat ? bubble.text : undefined}
              extra={
                <>
                  {faceUp.length > 0
                    ? <SmallCards cards={faceUp} />
                    : p.count > 0 && !p.out && <SmallCards cards={Array.from({ length: Math.min(p.count, 5) }, () => null)} />}
                  <Melds melds={p.melds} />
                </>
              }
            />
          );
        })}
      </Opponents>

      <div className="center-area">
        <div className="gx-center">
          {v.badges.length > 0 && (
            <div className="gx-badges">
              {v.badges.map((b, i) => <span key={i} className="badge">{b}</span>)}
            </div>
          )}
          {v.piles.length > 0 && (
            <div className="gx-piles">
              {v.piles.map(p => <Pile key={p.id} pile={p} />)}
            </div>
          )}
          {v.banner && <div className="gx-banner">{v.banner}</div>}
          <span className="muted small center">{v.prompt}</span>
        </div>
      </div>

      <div className="me-area">
        {meP && (
          <SeatBadge
            seat={me}
            name={`${meP.name} (kamu)`}
            avatar={avatars[me]}
            turn={isMyTurn}
            folded={meP.out}
            tag={meP.tag}
            sub={playerSub({ ...meP, count: v.hand.length || meP.count })}
            bubble={bubble && bubble.seat === me ? bubble.text : undefined}
            extra={
              <>
                {meP.faceUp && meP.faceUp.length > 0 && <SmallCards cards={meP.faceUp} />}
                <Melds melds={meP.melds} />
              </>
            }
          />
        )}

        {v.hand.length > 0 && (
          <PlayerHand
            cards={v.hand}
            myTurn={isMyTurn && canSelect}
            state={c => ({
              playable: canSelect && (playable.size === 0 || playable.has(c)),
              selected: selected.includes(c),
              onClick: canSelect ? () => toggle(c) : undefined,
            })}
          />
        )}

        {dock && v.actions.length > 0 && createPortal(
          <>
            {selected.length > 0 && (
              <div className="hand-selection-bar">
                <div className={`hand-selection-pill ${cardActions.some(enabled) ? 'is-valid' : 'is-invalid'}`}>
                  <span className="hand-selection-text"><b>{selected.length} kartu dipilih</b></span>
                  <button
                    type="button"
                    className="hand-selection-cancel"
                    onClick={() => setSelected([])}
                    title="Batal pilih kartu"
                    aria-label="Batal pilih kartu"
                  >
                    ✕ Batal
                  </button>
                </div>
              </div>
            )}
            {amountActions.map(a => {
              const s = a.amount!;
              const val = amountOf(a);
              return (
                <div key={`amt-${a.id}`} className="raise-row" aria-label={a.label}>
                  {s.max > s.min && (
                    <input type="range" min={s.min} max={s.max} step={s.step} value={val}
                      aria-label={`${a.label} — jumlah`}
                      onChange={e => setAmounts(m => ({ ...m, [a.id]: Number(e.target.value) }))} />
                  )}
                  <input className="input" style={{ width: 84 }} type="number" min={s.min} max={s.max} step={s.step} value={val}
                    aria-label={`${a.label} — angka`}
                    onChange={e => setAmounts(m => ({ ...m, [a.id]: Number(e.target.value) }))} />
                </div>
              );
            })}

            {pickTarget ? (
              <div className="actions">
                <span className="muted small" style={{ width: '100%', textAlign: 'center' }}>{pickTarget.label}: pilih pemain</span>
                {pickTarget.targets!.map(t => (
                  <button key={t} className="btn btn-gold" onClick={() => send(pickTarget, t)}>{v.players[t]?.name ?? `Kursi ${t + 1}`}</button>
                ))}
                <button className="btn" onClick={() => setPickTarget(null)}>Batal</button>
              </div>
            ) : (
              <div className="actions">
                {v.actions.map(a => {
                  const ok = enabled(a);
                  const suffix = a.cards ? ` (${selected.length})` : a.amount ? ` ${amountOf(a)}` : '';
                  return (
                    <button
                      key={a.id}
                      className={`btn btn-lg${a.style === 'primary' ? ' btn-gold' : ''}${a.style === 'danger' ? ' btn-danger' : ''}`}
                      disabled={!ok}
                      title={a.hint ?? (a.cards && !ok ? (a.cards.min === a.cards.max ? `Pilih ${a.cards.min} kartu` : `Pilih ${a.cards.min}–${a.cards.max} kartu`) : undefined)}
                      onClick={() => press(a)}
                    >
                      {a.label}{suffix}
                    </button>
                  );
                })}
              </div>
            )}
          </>,
          dock
        )}
      </div>
    </>
  );
}
