// effects.tsx — efek visual halus (konfeti kertas, chip mengalir, angka berjalan, selisih chip).
// Prinsip: kalem & elegan — palet tema, gerak pelan, tanpa emoji/warna pelangi.
// Semua efek murni dekoratif: disembunyikan / langsung ke nilai akhir bila animasi 'off' / 'reduced'.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/** Palet tema soft light: terracotta, mentega, sage, biru kabut, krem. */
const PALETTE = ['#C2694A', '#E2BE7A', '#8DB89A', '#9DB8CF', '#F2D7C9', '#D9A48E'];

const motion = () => (typeof document !== 'undefined' ? document.documentElement.dataset.motion : 'full') || 'full';

/** Hujan kertas tipis yang bergoyang pelan saat kamu juara. Ganti `burstKey` untuk memicu ulang. */
export function Confetti({ burstKey, pieces = 44, duration = 3800 }: { burstKey: string | number | null; pieces?: number; duration?: number }) {
  const [active, setActive] = useState<string | number | null>(null);

  useEffect(() => {
    if (burstKey === null) return;
    setActive(burstKey);
    const t = setTimeout(() => setActive(null), duration + 900);
    return () => clearTimeout(t);
  }, [burstKey, duration]);

  const bits = useMemo(() => Array.from({ length: pieces }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 900,
    dur: duration * (0.7 + Math.random() * 0.4),
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() - 0.5) * 540,
    sway: 0.8 + Math.random() * 0.8,
    w: 5 + Math.random() * 4,
    h: 10 + Math.random() * 8,
    color: PALETTE[i % PALETTE.length],
  })), [active, pieces, duration]);

  if (active === null) return null;
  return (
    <div className="confetti" aria-hidden="true">
      <div className="confetti-glow" />
      {bits.map((b, i) => (
        <i key={i} style={{
          left: `${b.left}%`,
          width: b.w,
          height: b.h,
          background: b.color,
          animationDelay: `${b.delay}ms`,
          animationDuration: `${b.dur}ms`,
          '--drift': `${b.drift}px`,
          '--spin': `${b.spin}deg`,
          '--sway': `${b.sway}s`,
        } as CSSProperties} />
      ))}
    </div>
  );
}

/** Chip kasino (lingkaran bergaris) yang mengalir keluar dari pot + label "+jumlah". */
export function ChipBurst({ burstKey, amount, chips = 10 }: { burstKey: string | number | null; amount?: number; chips?: number }) {
  const [active, setActive] = useState<string | number | null>(null);
  useEffect(() => {
    if (burstKey === null) return;
    setActive(burstKey);
    const t = setTimeout(() => setActive(null), 1900);
    return () => clearTimeout(t);
  }, [burstKey]);

  const bits = useMemo(() => Array.from({ length: chips }, (_, i) => {
    const a = (i / chips) * Math.PI * 2 + Math.random() * 0.35;
    const r = 52 + Math.random() * 56;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 - 18, d: Math.random() * 160, c: PALETTE[i % 3] };
  }), [active, chips]);

  if (active === null) return null;
  return (
    <div className="chip-burst" aria-hidden="true">
      <span className="chip-burst-ring" />
      {bits.map((b, i) => (
        <i key={i} className="chip-disc" style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--c': b.c, animationDelay: `${b.d}ms` } as CSSProperties} />
      ))}
      {amount !== undefined && <b className="chip-burst-label">+{amount.toLocaleString('id-ID')}</b>}
    </div>
  );
}

/** Angka yang "berjalan" halus ke nilai baru (ease-out). Teks akhir selalu tepat. */
export function AnimatedNumber({ value, duration = 650, format = (n: number) => n.toLocaleString('id-ID') }: {
  value: number; duration?: number; format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value || motion() !== 'full') { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const n = Math.round(start + (value - start) * eased);
      from.current = n;
      setShown(n);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <span className="num-anim">{format(shown)}</span>;
}

/** Pil "+jumlah" yang naik pelan di atas kursi saat chip pemain BERTAMBAH (menang pot).
 *  Pengurangan (taruhan) sengaja tidak ditampilkan agar meja tidak ramai. */
export function GainFloat({ value }: { value: number }) {
  const prev = useRef(value);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);

  useEffect(() => {
    const diff = value - prev.current;
    prev.current = value;
    if (diff <= 0) return;
    setGain({ id: Date.now(), amount: diff });
    const t = setTimeout(() => setGain(null), 1800);
    return () => clearTimeout(t);
  }, [value]);

  if (!gain) return null;
  return <span key={gain.id} className="gain-float" aria-hidden="true">+{gain.amount.toLocaleString('id-ID')}</span>;
}
