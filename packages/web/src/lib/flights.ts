// flights.ts — animasi "terbang" kartu/chip antar posisi meja memakai Web Animations API.
// Murni dekoratif: tidak mengubah state React; elemen bayangan (ghost) dibuat di <body> lalu dihapus.
// Dimatikan bila pengaturan animasi bukan 'full'.

export const motionFull = () => (document.documentElement.dataset.motion || 'full') === 'full';

const EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Animasikan elemen yang SUDAH ada di posisi akhirnya seolah datang dari `from`. */
export function flyIn(el: Element | null, from: Element | DOMRect | null, opts: { duration?: number; delay?: number; scale?: number; rotate?: number } = {}) {
  if (!el || !from || !motionFull()) return;
  const a = el.getBoundingClientRect();
  const b = from instanceof DOMRect ? from : from.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const ca = center(a), cb = center(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const { duration = 480, delay = 0, scale = 0.72, rotate = dx > 0 ? 14 : -14 } = opts;
  (el as HTMLElement).animate(
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg) scale(${scale})`, opacity: 0.4 },
      { opacity: 1, offset: 0.35 },
      { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
    ],
    { duration, delay, easing: EASE, fill: 'backwards' },
  );
}

/** Buat salinan `source` di posisinya lalu terbangkan ke `to` (lalu dihapus). */
export function flyGhost(source: Element | null, to: Element | DOMRect | null, opts: { duration?: number; delay?: number; scaleTo?: number; html?: string; className?: string } = {}) {
  if (!source || !to || !motionFull()) return;
  const a = source.getBoundingClientRect();
  const b = to instanceof DOMRect ? to : to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const ghost = opts.html !== undefined ? document.createElement('div') : (source.cloneNode(true) as HTMLElement);
  if (opts.html !== undefined) { ghost.className = opts.className ?? ''; ghost.innerHTML = opts.html; }
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    margin: '0', zIndex: '250', pointerEvents: 'none', animation: 'none',
  });
  document.body.appendChild(ghost);
  const ca = center(a), cb = center(b);
  const { duration = 520, delay = 0, scaleTo = 0.6 } = opts;
  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { opacity: 1, offset: 0.75 },
      { transform: `translate(${cb.x - ca.x}px, ${cb.y - ca.y}px) scale(${scaleTo}) rotate(${cb.x > ca.x ? 10 : -10}deg)`, opacity: 0 },
    ],
    { duration, delay, easing: EASE, fill: 'both' },
  );
  const done = () => ghost.remove();
  anim.onfinish = done;
  anim.oncancel = done;
  setTimeout(done, duration + delay + 200);
}

/** Terbangkan beberapa chip kecil dari `from` ke `to`. */
export function flyChips(from: Element | null, to: Element | null, count = 4, opts: { delay?: number } = {}) {
  if (!from || !to || !motionFull()) return;
  const a = from.getBoundingClientRect();
  const size = 16;
  for (let i = 0; i < count; i++) {
    const src = new DOMRect(a.left + a.width / 2 - size / 2 + (Math.random() - 0.5) * 18, a.top + a.height / 2 - size / 2 + (Math.random() - 0.5) * 10, size, size);
    const dummy = { getBoundingClientRect: () => src } as unknown as Element;
    flyGhost(dummy, to, {
      html: '',
      className: 'fly-chip',
      duration: 560,
      delay: (opts.delay ?? 0) + i * 70,
      scaleTo: 0.9,
    });
  }
}

/** Kartu "melompat" kecil (mis. kartu yang bisa dimainkan saat giliranmu tiba). */
export function hop(els: Iterable<Element>, stagger = 40) {
  if (!motionFull()) return;
  let i = 0;
  for (const el of els) {
    (el as HTMLElement).animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
      { duration: 420, delay: i++ * stagger, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
    );
  }
}

/** Kumpulkan kartu trik ke arah pemenang lalu memudar (fill forwards). */
export function collectTo(els: Element[], to: Element | null, delay = 900) {
  if (!to || !motionFull()) return;
  const b = center(to.getBoundingClientRect());
  els.forEach((el, i) => {
    const a = center(el.getBoundingClientRect());
    (el as HTMLElement).animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${(b.x - a.x) * 0.9}px, ${(b.y - a.y) * 0.9}px) scale(0.45)`, opacity: 0 },
      ],
      { duration: 520, delay: delay + i * 50, easing: 'cubic-bezier(0.5, 0, 0.75, 0.3)', fill: 'forwards' },
    );
  });
}
