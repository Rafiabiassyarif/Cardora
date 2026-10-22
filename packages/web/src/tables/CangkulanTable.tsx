// tables/CangkulanTable.tsx
import { useLayoutEffect, useRef } from 'react';
import { type CangkulanView, type CangkulanAction, rankOf } from '@kuypoker/engine';
import { createPortal } from 'react-dom';
import { PlayingCard } from '../components/ui';
import { PlayerHand, DeckStack } from '../components/hand';
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';
import { collectTo, flyGhost, flyIn } from '../lib/flights';

const SUIT = { S: '♠ Sekop', H: '♥ Hati', D: '♦ Wajik', C: '♣ Keriting' } as const;

export function CangkulanTable({ 
  v, 
  act, 
  avatars, 
  dock, 
  bubble 
}: { 
  v: CangkulanView; 
  act: (a: CangkulanAction) => void; 
  avatars: string[]; 
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you!;
  const l = v.legal;
  const trick = v.trick.length ? v.trick : v.lastTrick?.plays ?? [];
  const showingLast = !v.trick.length && !!v.lastTrick;
  const rankValue = (c: string) => (rankOf(c) === 14 && !v.aceHigh ? 1 : rankOf(c));
  const others = rotateSeats(v.names.length, me).slice(1);
  const place = (i: number) => (v.finished.includes(i) ? `Selesai #${v.finished.indexOf(i) + 1}` : `${v.handCounts[i]} kartu`);

  // ---- Animasi: kartu dimainkan terbang dari kursi, nyangkul terbang dari dek, trik dikumpulkan ke pemenang ----
  const rootRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const prevCounts = useRef<number[] | null>(null);
  const prevHand = useRef<string[] | null>(null);
  const collected = useRef<string | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current?.closest('.felt') ?? document;
    const seatEl = (s: number | null) => (s === null ? root.querySelector('[data-deck]') : root.querySelector(`[data-seat="${s}"]`));
    const deck = root.querySelector('[data-deck]');

    // 1) Kartu baru di area trik → terbang dari kursi pemainnya (atau dari dek untuk kartu pembuka).
    const keys = trick.map((p, k) => `${k}-${p.card}`);
    if (seen.current) {
      trick.forEach((p, k) => {
        const key = keys[k];
        if (seen.current!.has(key)) return;
        const el = root.querySelector(`[data-trick="${key}"] .pcard`);
        const from = p.seat === me ? root.querySelector('.player-hand') : seatEl(p.seat);
        flyIn(el, from, { duration: 460 });
      });
    }
    seen.current = new Set(keys);

    // 2) Trik selesai → kartu menyala di pemenang lalu dikumpulkan ke kursinya.
    const trickId = v.lastTrick ? v.lastTrick.plays.map(p => p.card).join('') : null;
    if (showingLast && trickId && collected.current !== trickId) {
      collected.current = trickId;
      const w = v.lastTrick!.winner;
      const target = w === me ? root.querySelector('.me-area .seat') : seatEl(w);
      collectTo(Array.from(root.querySelectorAll('[data-trick] .pcard')), target, 1100);
    }

    // 3) Nyangkul: jumlah kartu lawan bertambah → kartu tertutup terbang dari dek ke kursinya.
    if (prevCounts.current && deck) {
      v.handCounts.forEach((n, s) => {
        const diff = n - (prevCounts.current![s] ?? n);
        if (s === me || diff <= 0) return;
        const src = deck.querySelector('.pcard');
        for (let i = 0; i < Math.min(diff, 3); i++) flyGhost(src, seatEl(s), { delay: i * 110, scaleTo: 0.55 });
      });
    }
    prevCounts.current = v.handCounts.slice();

    // 4) Kartu baru di tanganku (hasil nyangkul) → terbang dari dek ke tangan.
    if (prevHand.current && deck) {
      const added = v.hand.filter(c => !prevHand.current!.includes(c));
      if (added.length && added.length < v.hand.length) {
        added.slice(0, 3).forEach((c, i) => flyIn(root.querySelector(`.hand-slot[data-card="${c}"] .pcard`), deck, { delay: i * 110, rotate: 0, scale: 0.8 }));
      }
    }
    prevHand.current = v.hand.slice();
  });

  const draw = () => { play('card'); act({ type: 'draw' }); };

  return (
    <>
      <span ref={rootRef} hidden />
      <Opponents>
        {others.map(i => (
          <SeatBadge 
            key={i} 
            seat={i}
            name={v.names[i]} 
            avatar={avatars[i]} 
            turn={v.turn === i} 
            folded={v.finished.includes(i)} 
            sub={place(i)}
            bubble={bubble?.seat === i ? bubble.text : undefined}
            extra={<div className="cards overlap">{Array.from({ length: Math.min(v.handCounts[i], 6) }, (_, k) => <PlayingCard key={k} small card={null} />)}</div>} 
          />
        ))}
      </Opponents>

      <div className="center-area">
        <div className="trick-board">
          <DeckStack count={v.deckCount} label={`Tumpukan ${v.deckCount} kartu`} onDraw={l?.canDraw ? draw : undefined} />
          <div className="trick-zone">
            <div className="trick-cards">
              {trick.length ? trick.map((p, k) => (
                <div key={`${k}-${p.card}`} data-trick={`${k}-${p.card}`} className="trick-play">
                  <PlayingCard card={p.card} win={showingLast && v.lastTrick?.winner === p.seat && p.seat !== null} />
                  <span className="trick-name">{p.seat === null ? 'Pembuka' : p.seat === me ? 'Kamu' : v.names[p.seat].slice(0, 10)}</span>
                </div>
              )) : <span className="trick-empty">Menunggu kartu pembuka…</span>}
            </div>
            <span className="trick-status">
              {v.leadSuit
                ? <>Jenis wajib <b>{SUIT[v.leadSuit]}</b></>
                : showingLast
                  ? <><b>{v.lastTrick!.winner === me ? 'Kamu' : v.names[v.lastTrick!.winner ?? 0]}</b> menang trik</>
                  : 'Kartu bebas'}
            </span>
          </div>
        </div>
      </div>

      <div className="me-area">
        <SeatBadge 
          seat={me}
          name={`${v.names[me]} (kamu)`} 
          avatar={avatars[me]} 
          turn={v.turn === me} 
          sub={place(me)} 
          bubble={bubble?.seat === me ? bubble.text : undefined}
        />
        <PlayerHand
          cards={v.hand}
          rankValue={rankValue}
          myTurn={v.turn === me && !!l?.playable.length}
          state={c => {
            const ok = !!l?.playable.includes(c);
            return { playable: ok, disabled: !!l && !ok, onClick: ok ? () => { play('card'); act({ type: 'play', card: c }); } : undefined };
          }}
        />
{dock && createPortal(<>        {l && (
          <div className="actions">
            {l.canDraw && <button className="btn btn-gold" onClick={draw}>⛏ Nyangkul</button>}
            {l.canPass && <button className="btn" onClick={() => { play('click'); act({ type: 'pass' }); }}>Lewat</button>}
            {!l.canDraw && !l.canPass && <span className="dock-hint">{v.leadSuit ? <>Pilih kartu <b>{SUIT[v.leadSuit]}</b> dari tanganmu</> : 'Kamu memimpin — pilih kartu apa saja'}</span>}
          </div>
        )}
        {!l && v.turn !== null && v.turn !== me && !v.over && (
          <span className="dock-hint muted-hint">Menunggu {v.names[v.turn]}…</span>
        )}</>, dock)}
      </div>
    </>
  );
}
