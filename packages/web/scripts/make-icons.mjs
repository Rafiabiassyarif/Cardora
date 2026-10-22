// make-icons.mjs — gambar ikon PNG KUYPOKER tanpa dependensi (encoder PNG + supersampling).
// Output: public/icons/icon-{192,512}.png, icon-512-maskable.png, resources/icon.png (1024),
// resources/splash.png (2732). `npm run icons` dari root.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// Tema soft light: latar terracotta, kartu krem, garis kartu kedua krem pucat, sekop warna tinta.
// (Nama kunci dipertahankan agar fungsi gambar di bawah tidak berubah.)
const C = { emerald: hex('#C2694A'), navy: hex('#3A332B'), gold: hex('#F6E3D8'), white: hex('#FFFDF9'), cream: hex('#F6F0E6') };

// Bentuk dalam koordinat 0..64 (sama dengan favicon.svg).
function roundRect(x, y, cx, cy, w, h, r, angleDeg) {
  const a = (-angleDeg * Math.PI) / 180;
  const dx = x - 32, dy = y - 30;
  const rx = dx * Math.cos(a) - dy * Math.sin(a) + 32, ry = dx * Math.sin(a) + dy * Math.cos(a) + 30;
  const qx = Math.abs(rx - cx) - (w / 2 - r), qy = Math.abs(ry - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; // SDF
}
function spade(x, y) {
  // Hati terbalik: dua lingkaran + segitiga yang tidak melewati lingkaran (tepi mulus), plus batang.
  const inCircle = (cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;
  const top = y >= 15 && y <= 29.5 && Math.abs(x - 32) <= (y - 15) * 0.78;
  const lobes = inCircle(26.6, 30.5, 6.3) || inCircle(37.4, 30.5, 6.3);
  const stem = y >= 33 && y <= 44 && Math.abs(x - 32) <= 1.1 + (y - 33) * 0.2;
  return top || lobes || stem;
}

function shade(x, y, { bg = true } = {}) {
  let col = null;
  const bgSdf = roundRect(x, y, 32, 32, 64, 64, 14, 0);
  if (bg && roundRect(x + 0, y + 0, 32, 30, 64, 64, 14, 0) <= 0 && bgSdf <= 0) col = C.emerald;
  if (!bg) col = C.emerald;
  if (roundRect(x, y, 32, 30, 30, 42, 5, -8) <= 0) col = C.white;
  const g = roundRect(x, y, 32, 30, 30, 42, 5, 8);
  if (g <= 1.25 && g >= -1.25) col = C.gold;
  if (spade(x, y)) col = C.navy;
  return col;
}

function render(size, { scale = 1, bg = true, full = null } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const u = ((px + (sx + 0.5) / ss) / size - 0.5) / scale * 64 + 32;
        const v = ((py + (sy + 0.5) / ss) / size - 0.5) / scale * 64 + 32;
        let col = (u >= 0 && u <= 64 && v >= 0 && v <= 64) ? shade(u, v, { bg }) : null;
        if (!col && full) col = full;
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
      }
      const n = ss * ss, i = (py * size + px) * 4;
      const alpha = a / n;
      buf[i] = alpha ? r / (a / 255) : 0; buf[i + 1] = alpha ? g / (a / 255) : 0; buf[i + 2] = alpha ? b / (a / 255) : 0; buf[i + 3] = alpha;
    }
  }
  return png(size, size, buf);
}

const out = (p, data) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), data); console.log('wrote', p, data.length, 'bytes'); };
// Sudut ikon PWA mengikuti favicon.svg (rx 16).
out('public/icons/icon-192.png', render(192));
out('public/icons/icon-512.png', render(512));
out('public/icons/icon-512-maskable.png', render(512, { scale: 0.72, bg: false, full: C.emerald }));
out('resources/icon.png', render(1024, { scale: 1, bg: false, full: C.emerald }));
out('resources/icon-foreground.png', render(1024, { scale: 0.6, bg: false }));
out('resources/splash.png', render(2732, { scale: 0.18, bg: true, full: C.cream }));
