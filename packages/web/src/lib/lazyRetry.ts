import { lazy } from 'react';

// Tab lama setelah deploy baru meminta chunk ber-hash lama yang sudah dihapus (404) →
// lazy import gagal dan layar jadi kosong. Muat ulang halaman SEKALI agar index.html terbaru dipakai.
// ponytail: guard 10 detik via sessionStorage; tambah ErrorBoundary bila butuh pesan error per layar.
export const lazyRetry: typeof lazy = (load) => lazy(() => load().catch(async (e) => {
  const last = Number(sessionStorage.getItem('chunk-reload') || 0);
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem('chunk-reload', String(Date.now()));
    // Cache service worker bisa masih menyimpan index-*.js lama yang menunjuk chunk terhapus.
    try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch { /* tanpa SW */ }
    location.reload();
    return new Promise<never>(() => { });
  }
  throw e;
}));
