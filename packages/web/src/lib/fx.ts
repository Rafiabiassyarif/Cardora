// fx.ts — interaksi halus global (tanpa dependensi):
//  1. Riak lembut dari titik sentuh pada tombol (.btn, .lbtn, .chip).
//  2. Kemiringan paralaks pelan untuk elemen [data-tilt] (ilustrasi landing) — hanya pointer mouse.
// Dimatikan otomatis bila pengaturan animasi 'off'/'reduced'.

const motionFull = () => (document.documentElement.dataset.motion || 'full') === 'full';

function ripple(e: PointerEvent) {
  if (!motionFull() || e.button !== 0) return;
  const el = (e.target as Element | null)?.closest<HTMLElement>('.btn, .lbtn, .chip');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  // Wadah terpisah (overflow:hidden) agar badge/anak tombol yang menjorok keluar tidak ikut terpotong.
  const wrap = document.createElement('span');
  wrap.className = 'fx-ripple-wrap';
  const dot = document.createElement('span');
  dot.className = 'fx-ripple';
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${e.clientX - r.left - size / 2}px`;
  dot.style.top = `${e.clientY - r.top - size / 2}px`;
  wrap.appendChild(dot);
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(wrap);
  dot.addEventListener('animationend', () => wrap.remove(), { once: true });
  setTimeout(() => wrap.remove(), 900);
}

let tiltEl: HTMLElement | null = null;
let frame = 0;
function tilt(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || !motionFull()) return;
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null;
  if (tiltEl && tiltEl !== el) { tiltEl.style.removeProperty('--tilt-x'); tiltEl.style.removeProperty('--tilt-y'); }
  tiltEl = el;
  if (!el) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--tilt-x', (x * 6).toFixed(2));
    el.style.setProperty('--tilt-y', (y * -5).toFixed(2));
  });
}

let installed = false;
export function installFx() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', ripple, { passive: true });
  window.addEventListener('pointermove', tilt, { passive: true });
}
