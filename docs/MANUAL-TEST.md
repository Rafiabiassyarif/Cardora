# Checklist uji manual sebelum rilis

Jalankan: `npm run build && npm test`, lalu server production (`npm start -w @kuypoker/server` dengan WEB_DIST=../web/dist).

## Single-player
- [ ] Beranda → Main Cepat → meja Hold'em vs 3 bot muncul, kartu sendiri terbuka, kartu bot tertutup
- [ ] Fold / Check / Call / Raise (slider, Min, ½ Pot, Pot) / All-in berfungsi
- [ ] Mainkan ≥ 3 tangan; total chip semua pemain + pot selalu sama
- [ ] Pilih Game → Cangkulan & Blackjack vs bot sampai selesai, layar hasil muncul, "Main lagi" jalan
- [ ] Game "Segera hadir" tidak bisa dimulai
- [ ] Mode pesawat: single-player tetap jalan

## Online (2 perangkat / 2 browser berbeda)
- [ ] A: Buat Room → kode tampil, Salin/Bagikan jalan
- [ ] B: Gabung Room dengan kode → muncul di daftar A
- [ ] Kode salah → pesan jelas
- [ ] A tidak bisa mulai sebelum B siap
- [ ] Main 1 permainan penuh; kartu B tidak terlihat di A (cek juga DevTools → Network/WS)
- [ ] B refresh halaman di tengah permainan → kembali ke kursi yang sama dengan kartu yang sama
- [ ] B tutup tab saat gilirannya → timer habis, aksi otomatis, permainan lanjut
- [ ] A keluar → B menjadi host
- [ ] Rematch kembali ke lobby

## Tampilan
- [ ] HP kecil (360×640), iPhone, tablet, laptop, landscape — tidak ada tombol terpotong/teks bertumpuk
  (otomatis: /dev/layout-test.html di mode dev)
- [ ] Pengaturan suara/animasi tersimpan setelah reload

## Server
- [ ] GET /api/health → ok:true
- [ ] Restart server → klien menampilkan status terputus lalu tersambung lagi
