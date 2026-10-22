// rng.ts — sumber angka acak.
//  - cryptoRng: dipakai server (multiplayer) & single-player. Rejection sampling → tanpa bias modulo.
//  - seededRng: deterministik, HANYA untuk unit test dan replay.

export interface Rng {
  /** Bilangan bulat seragam di [0, n). */
  int(n: number): number;
  /** Float di [0, 1). */
  float(): number;
}

export function cryptoRng(): Rng {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues tidak tersedia');
  const buf = new Uint32Array(1);
  const u32 = () => { c.getRandomValues(buf); return buf[0]; };
  return {
    int(n: number) {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`int(n) butuh n > 0, dapat ${n}`);
      const limit = 0x100000000 - (0x100000000 % n);
      let x: number;
      do { x = u32(); } while (x >= limit);
      return x % n;
    },
    float() { return u32() / 0x100000000; },
  };
}

/** mulberry32 — PRNG kecil, deterministik. Jangan dipakai untuk permainan online. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(n: number) { return Math.floor(next() * n); },
    float: next,
  };
}
