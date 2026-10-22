// tables/common.tsx
import { Children, type CSSProperties, type ReactNode } from 'react';
import { GainFloat } from '../components/effects';

/** Baris lawan yang melengkung mengikuti bentuk meja oval (kursi samping lebih rendah). */
export function Opponents({ children }: { children: ReactNode }) {
  const kids = Children.toArray(children);
  const n = kids.length;
  return (
    <div className="opponents arc" data-n={n}>
      {kids.map((k, i) => {
        // 0 = kursi paling atas (tengah), 1 = kursi paling pinggir (dinormalisasi).
        const edge = 1 - Math.sin(Math.PI / (n + 1));
        const drop = n <= 1 ? 0 : (1 - Math.sin((Math.PI * (i + 1)) / (n + 1))) / edge;
        return <div key={i} className="opp-slot" style={{ '--drop': drop.toFixed(3) } as CSSProperties}>{k}</div>;
      })}
    </div>
  );
}

/** Urutan seat mulai dari viewer (viewer di bawah, lawan searah jarum jam). */
export function rotateSeats(n: number, me: number): number[] {
  return Array.from({ length: n }, (_, k) => (me + k) % n);
}

export function SeatBadge({ name, avatar, turn, folded, sub, tag, extra, bubble, gain, seat }: {
  name: string; avatar: string; turn: boolean; folded?: boolean; sub?: ReactNode; tag?: string; extra?: ReactNode; bubble?: string | null;
  /** Jumlah chip saat ini — bila bertambah, muncul pil "+selisih" yang naik pelan. */
  gain?: number;
  /** Indeks kursi — dipakai animasi kartu/chip untuk menemukan posisi kursi di layar. */
  seat?: number;
}) {
  return (
    <div className={`seat${turn ? ' turn' : ''}${folded ? ' folded' : ''}`} aria-current={turn ? 'true' : undefined} data-seat={seat} style={{ position: 'relative' }}>
      {bubble && <div className="floating-bubble" aria-live="polite">{bubble}</div>}
      {gain !== undefined && <GainFloat value={gain} />}
      <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
        <div className={`avatar${turn ? ' turn' : ''}`}>{avatar}</div>
        {tag && <span className="seat-tag">{tag}</span>}
      </div>
      <div className="seat-text">
        <div className="seat-name" title={name}>{name}</div>
        {sub && <div className="seat-sub">{sub}</div>}
      </div>
      {extra}
    </div>
  );
}
