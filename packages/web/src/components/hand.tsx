// hand.tsx — kartu tangan pemain: tata letak kipas, urutkan (angka/jenis), dan susun manual (drag).
//
// - Urutan "manual" disimpan per sesi tangan: kartu yang masih ada mempertahankan posisinya,
//   kartu baru ditambahkan di ujung kanan.
// - Drag memakai Pointer Events (mouse + sentuh). Gerakan < 8px tetap dianggap klik.
// - Efek hover/angkat diletakkan pada kartu di dalam slot, BUKAN pada slot, sehingga area hover
//   tidak ikut bergeser (mencegah kartu bergetar saat kursor di tepi bawah).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { type Card, rankOf, suitOf } from '@kuypoker/engine';
import { PlayingCard } from './ui';
import { play } from '../lib/sound';
import { hop } from '../lib/flights';

export type SortMode = 'rank' | 'suit' | 'manual';

export interface HandCardState {
  playable?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

const SORT_KEY = 'cardora.handSort';
const SUIT_ORDER = 'SHCD';

function loadMode(): SortMode {
  try {
    const m = localStorage.getItem(SORT_KEY) || localStorage.getItem('kuypoker.handSort');
    if (m === 'rank' || m === 'suit' || m === 'manual') return m;
  } catch { /* storage tidak tersedia */ }
  return 'suit';
}

/** Nilai default: As tinggi. Game dengan urutan khusus (mis. 2 tertinggi) memberi `rankValue` sendiri. */
const defaultRank = (c: Card) => rankOf(c);

export function PlayerHand({
  cards,
  state,
  rankValue = defaultRank,
  label = 'Kartu tanganmu',
  myTurn = false,
}: {
  /** true saat giliranmu — kartu yang bisa dimainkan melompat kecil sekali sebagai petunjuk. */
  myTurn?: boolean;
  cards: Card[];
  state?: (card: Card) => HandCardState;
  rankValue?: (card: Card) => number;
  label?: string;
}) {
  const [mode, setMode] = useState<SortMode>(loadMode);
  const [manual, setManual] = useState<Card[]>(cards);
  const [dragging, setDragging] = useState<Card | null>(null);
  const drag = useRef<{ card: Card; x: number; y: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, mode); } catch { /* abaikan */ }
  }, [mode]);

  // Petunjuk giliran: kartu yang bisa dimainkan melompat kecil (sekali, bergiliran).
  useEffect(() => {
    if (!myTurn || !rowRef.current) return;
    const t = setTimeout(() => hop(rowRef.current?.querySelectorAll('.hand-slot.can .pcard') ?? []), 250);
    return () => clearTimeout(t);
  }, [myTurn]);

  // Selaraskan urutan manual dengan isi tangan (pertahankan posisi kartu lama, kartu baru di ujung).
  useEffect(() => {
    setManual(prev => {
      const kept = prev.filter(c => cards.includes(c));
      const added = cards.filter(c => !kept.includes(c));
      const next = [...kept, ...added];
      return next.length === prev.length && next.every((c, i) => c === prev[i]) ? prev : next;
    });
  }, [cards]);

  const sorted = useMemo(() => {
    if (mode === 'manual') {
      const known = manual.filter(c => cards.includes(c));
      return [...known, ...cards.filter(c => !known.includes(c))];
    }
    const bySuit = (c: Card) => SUIT_ORDER.indexOf(suitOf(c));
    return [...cards].sort((a, b) =>
      mode === 'rank'
        ? rankValue(a) - rankValue(b) || bySuit(a) - bySuit(b)
        : bySuit(a) - bySuit(b) || rankValue(a) - rankValue(b));
  }, [cards, manual, mode, rankValue]);

  const n = sorted.length;
  // Kipas melebar untuk sedikit kartu, merapat untuk banyak kartu (responsif ponsel).
  const step = n <= 1 ? 0 : Math.min(3.8, 24 / (n - 1));
  const half = Math.max(1, (n - 1) / 2);
  const arc = 9 / (half * half); // ujung kipas turun maksimal ±9px agar tidak menyentuh tepi felt
  const overlap = n >= 20 ? 0.68 : n >= 14 ? 0.62 : n >= 10 ? 0.58 : n >= 7 ? 0.44 : n >= 4 ? 0.32 : 0.12;

  const onPointerDown = (e: React.PointerEvent, card: Card) => {
    if (e.button !== 0) return;
    drag.current = { card, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
      d.moved = true;
      setDragging(d.card);
      if (mode !== 'manual') { setManual(sorted); setMode('manual'); }
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    }
    // Cari slot di bawah pointer berdasarkan titik tengah horizontal.
    const row = rowRef.current;
    if (!row) return;
    const slots = Array.from(row.querySelectorAll<HTMLElement>('[data-card]'));
    let target = slots.length; // default: di ujung kanan
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { target = i; break; }
    }
    setManual(prev => {
      const base = prev.filter(c => cards.includes(c));
      const from = base.indexOf(d.card);
      if (from < 0) return prev;
      const to = Math.max(0, Math.min(base.length - 1, target > from ? target - 1 : target));
      if (to === from) return prev;
      const next = base.slice();
      next.splice(from, 1);
      next.splice(to, 0, d.card);
      return next;
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.moved) {
      // Telan klik yang langsung menyusul drag saja; reset di task berikutnya supaya klik
      // normal setelahnya tidak ikut tertelan (mis. drag dilepas di luar area kartu).
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      play('card');
    }
    drag.current = null;
    setDragging(null);
  };

  const choose = (m: SortMode) => { play('click'); setMode(m); };

  if (!cards.length) return null;

  return (
    <div className="player-hand">
      <div className="hand-toolbar" role="toolbar" aria-label="Susun kartu">
        <button type="button" className={`chip${mode === 'rank' ? ' on' : ''}`} aria-pressed={mode === 'rank'} onClick={() => choose('rank')} title="Urutkan berdasarkan angka" aria-label="Urutkan berdasarkan angka">123</button>
        <button type="button" className={`chip${mode === 'suit' ? ' on' : ''}`} aria-pressed={mode === 'suit'} onClick={() => choose('suit')} title="Urutkan berdasarkan jenis" aria-label="Urutkan berdasarkan jenis">♠♥</button>
        <button type="button" className={`chip${mode === 'manual' ? ' on' : ''}`} aria-pressed={mode === 'manual'} onClick={() => choose('manual')} title="Susun manual — geser kartu" aria-label="Susun manual, geser kartu"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>
      </div>
      <div
        ref={rowRef}
        className={`hand-fan${dragging ? ' is-dragging' : ''}`}
        role="list"
        aria-label={label}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={e => { if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); e.preventDefault(); } }}
      >
        {sorted.map((c, i) => {
          const off = i - (n - 1) / 2;
          const st = state?.(c) ?? {};
          const style = {
            '--rot': `${off * step}deg`,
            '--dy': `${off * off * arc}px`,
            '--ov': overlap,
            zIndex: dragging === c ? 50 : i + 1,
          } as CSSProperties;
          return (
            <div
              key={c}
              data-card={c}
              role="listitem"
              className={`hand-slot${st.selected ? ' selected' : ''}${dragging === c ? ' dragging' : ''}${st.playable ? ' can' : ''}`}
              style={style}
              onPointerDown={e => onPointerDown(e, c)}
            >
              <PlayingCard card={c} playable={!!st.playable} disabled={st.disabled} onClick={st.onClick} delay={Math.min(i, 12) * 35} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tumpukan dek bertingkat di tengah meja. Bila `onDraw` diberikan, dek bisa diketuk untuk mengambil kartu. */
export function DeckStack({ count, label, onDraw }: { count: number; label?: string; onDraw?: () => void }) {
  const layers = Math.max(1, Math.min(4, Math.ceil(count / 8)));
  const body = (
    <>
      <div className="deck-layers">
        {count > 0
          ? Array.from({ length: layers }, (_, k) => (
            <div key={k} className="deck-layer" style={{ '--k': k } as CSSProperties}><PlayingCard card={null} /></div>
          ))
          : <div className="pcard slot"><div className="slot-inner" /></div>}
      </div>
      <span className="deck-count">{onDraw ? 'Ambil' : count}</span>
    </>
  );
  return onDraw
    ? <button type="button" className="deck-stack can-draw" data-deck onClick={onDraw} aria-label={`Ambil kartu dari tumpukan (${count} tersisa)`} title="Ketuk untuk mengambil kartu">{body}</button>
    : <div className="deck-stack" data-deck aria-label={label ?? `Tumpukan ${count} kartu`}>{body}</div>;
}
