// tables/BlackjackTable.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlackjackView, BlackjackAction } from '@kuypoker/engine';
import { createPortal } from 'react-dom';
import { PlayingCard } from '../components/ui';
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';
import { flyChips, flyIn } from '../lib/flights';

import { trackAchievement } from '../lib/store';

const OUTCOME = { win: 'Menang', lose: 'Kalah', push: 'Seri', blackjack: 'Blackjack!' } as const;

export function BlackjackTable({ 
  v, 
  act, 
  avatars, 
  dock, 
  bubble 
}: { 
  v: BlackjackView; 
  act: (a: BlackjackAction) => void; 
  avatars: string[]; 
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you!;
  const l = v.legal;
  const [bet, setBet] = useState(v.minBet * 2);
  const mine = v.seats[me];
  const others = rotateSeats(v.seats.length, me).slice(1);

  // Track achievement safely in useEffect (bukan di render body)
  const trackedBjRef = useRef<string | null>(null);
  useEffect(() => {
    if (mine?.outcome === 'blackjack') {
      const key = `${v.round}-${mine.outcome}`;
      if (trackedBjRef.current !== key) {
        trackedBjRef.current = key;
        trackAchievement('blackjack_21', 1);
      }
    }
  }, [v.round, mine?.outcome]);

  // ---- Animasi: kartu baru meluncur dari sepatu (shoe) bandar; taruhan terbang ke kotak bandar ----
  const animRef = useRef<HTMLSpanElement>(null);
  const prevCards = useRef<string | null>(null);
  const prevBets = useRef<number[] | null>(null);
  useLayoutEffect(() => {
    const root = animRef.current?.closest('.felt');
    if (!root) return;
    const shoe = root.querySelector('.bj-shoe');
    const sig = (arr: (string | null)[]) => arr.length;
    const counts = [...v.seats.map(s => sig(s.hand)), sig(v.dealer)];
    if (prevCards.current) {
      const prev = prevCards.current.split(',').map(Number);
      let delay = 0;
      v.seats.forEach((s, i) => {
        for (let k = prev[i] ?? 0; k < s.hand.length; k++) {
          const el = root.querySelectorAll(`[data-seat="${i}"] .cards .pcard`)[k] ?? null;
          flyIn(el, shoe, { delay, rotate: 0, scale: 0.7, duration: 420 }); delay += 90;
        }
      });
      const dPrev = prev[v.seats.length] ?? 0;
      for (let k = dPrev; k < v.dealer.length; k++) {
        flyIn(root.querySelectorAll('.bj-dealer .pcard')[k] ?? null, shoe, { delay, rotate: 0, scale: 0.7, duration: 420 }); delay += 90;
      }
    }
    prevCards.current = counts.join(',');
    const bets = v.seats.map(s => s.bet);
    if (prevBets.current) bets.forEach((b, i) => { if (b > (prevBets.current![i] ?? 0)) flyChips(root.querySelector(`[data-seat="${i}"] .avatar`), root.querySelector('.bj-dealer'), 4); });
    prevBets.current = bets;
  });
  const sub = (i: number) => {
    const s = v.seats[i];
    if (s.out) return 'Chip habis';
    return `${s.chips}${s.bet ? ` · Bet ${s.bet}` : ''}`;
  };

  return (
    <>
      <Opponents>
        {others.map(i => {
          const s = v.seats[i];
          return (
            <SeatBadge 
              key={i} 
              seat={i}
              name={s.name} 
              avatar={avatars[i]} 
              turn={v.turn === i} 
              folded={s.out} 
              sub={sub(i)}
              gain={s.chips}
              bubble={bubble?.seat === i ? bubble.text : undefined}
              extra={<>
                <div className="cards overlap">{s.hand.map((c, k) => <PlayingCard key={k} small card={c} />)}</div>
                {s.hand.length > 0 && <span className="small">{s.total}{s.outcome ? ` · ${OUTCOME[s.outcome]}` : ''}</span>}
              </>} 
            />
          );
        })}
      </Opponents>

      <div className="center-area">
        <div className="muted small">Ronde {v.round}/{v.rounds} · Bandar</div>
        <span ref={animRef} hidden />
        <div className="bj-table">
          <div className="bj-shoe" aria-hidden="true"><PlayingCard card={null} /><PlayingCard card={null} /></div>
        <div className="cards bj-dealer">{v.dealer.length ? v.dealer.map((c, k) => <PlayingCard key={`${v.round}-${k}-${c ?? 'x'}`} card={c} delay={k * 120} />) : <span className="muted">Menunggu taruhan…</span>}</div>
        </div>
        {v.dealerTotal !== null && <div className="pot">Bandar {v.dealerTotal}</div>}
      </div>

      <div className="me-area">
        <SeatBadge 
          seat={me}
          name={`${mine.name} (kamu)`} 
          avatar={avatars[me]} 
          turn={v.turn === me} 
          folded={mine.out} 
          sub={sub(me)}
          gain={mine.chips}
          bubble={bubble?.seat === me ? bubble.text : undefined}
          extra={mine.hand.length > 0 && (
            <>
              <div className="cards">{mine.hand.map((c, k) => <PlayingCard key={k} card={c} delay={k * 100} />)}</div>
              <span>{mine.soft && mine.total < 21 ? `Soft ${mine.total}` : mine.total}{mine.outcome ? ` · ${OUTCOME[mine.outcome]}` : ''}</span>
            </>
          )} />
{dock && createPortal(<>        {l?.canBet && (
          <>
            <div className="raise-row">
              <input type="range" min={l.minBet} max={l.maxBet} value={Math.min(bet, l.maxBet)} aria-label="Taruhan" onChange={e => setBet(Number(e.target.value))} />
              <input className="input" style={{ width: 96 }} type="number" min={l.minBet} max={l.maxBet} value={Math.min(bet, l.maxBet)} aria-label="Taruhan" onChange={e => setBet(Number(e.target.value))} />
            </div>
            <div className="actions"><button className="btn btn-gold" onClick={() => { play('chip'); act({ type: 'bet', amount: Math.min(bet, l.maxBet) }); }}>Pasang {Math.min(bet, l.maxBet)}</button></div>
          </>
        )}
        {l && !l.canBet && (
          <div className="actions">
            <button className="btn btn-emerald" onClick={() => { play('card'); act({ type: 'hit' }); }}>Hit</button>
            <button className="btn" onClick={() => { play('click'); act({ type: 'stand' }); }}>Stand</button>
            {l.canDouble && <button className="btn btn-gold" onClick={() => { play('chip'); act({ type: 'double' }); }}>Double</button>}
          </div>
        )}</>, dock)}
      </div>
    </>
  );
}
