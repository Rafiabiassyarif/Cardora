# Cardora

Platform game kartu multiplayer — web (PWA), Android, dan iOS dari satu kode.
Main sendiri melawan bot (offline) atau online bersama teman lewat kode room.

Game yang sudah bisa dimainkan:
- Texas Hold'em (2–9 pemain, no-limit, side pot, showdown)
- Cangkulan (2–6 pemain, permainan kartu Indonesia)
- Blackjack (1–4 pemain vs bandar)

23 game lain tampil di katalog sebagai "Segera hadir" dan tidak bisa dimulai (ditolak juga oleh server).

## Struktur

    packages/engine   Aturan game murni (TypeScript, tanpa I/O) + bot + RNG kripto. Dipakai web DAN server.
    packages/server   Express + Socket.IO. Server authoritative: kocok kartu, validasi giliran, sembunyikan kartu lawan.
                      Akun/statistik opsional via PostgreSQL.
    packages/web      React + Vite. PWA + Capacitor (Android/iOS).

## Menjalankan (development)

Butuh Node 20+ (diuji di Node 22.12).

    npm install
    npm run dev            # server :3000 + web :5173 (Vite proxy ke server)

Buka http://localhost:5173. Single-player jalan tanpa server; multiplayer butuh server.

## Build & jalankan production (satu port)

    npm run build
    cd packages/server
    cp .env.example .env   # isi seperlunya
    npm start              # http://localhost:3000 → web + API + Socket.IO

Health check: GET /api/health → {"ok":true,"db":false|true,"games":[...]}

Akun (opsional): isi DATABASE_URL + JWT_SECRET, lalu `npm run db:migrate:prod -w @kuypoker/server`.
Tanpa database semua pemain bermain sebagai tamu.

## Tes

    npm test               # 86 tes: evaluator poker, fuzz Hold'em (konservasi chip), 3 game, multiplayer socket nyata
    npm run typecheck

Uji layout lintas perangkat (dev): jalankan `npm run dev`, buka
http://localhost:5173/dev/layout-test.html — merender ketiga meja di 7 ukuran layar dan
memeriksa tumpang tindih, tombol keluar layar, dan scroll horizontal.

Klien "teman" untuk uji multiplayer manual:

    node packages/server/scripts/friend-bot.mjs <KODE_ROOM> [http://127.0.0.1:3000]

## Dokumen lain

- docs/DEPLOY.md         Deploy ke VPS (PM2 + Nginx + HTTPS)
- docs/MOBILE.md         Build Android (APK) & iOS (butuh Mac/Xcode)
- docs/FEATURE-STATUS.md Apa yang sudah jadi, apa yang belum
- docs/MANUAL-TEST.md    Checklist uji manual sebelum rilis

## Catatan penting

Ini game kartu hiburan dengan chip virtual tanpa nilai uang. Tidak ada pembelian chip,
taruhan uang asli, atau penukaran hadiah. Jika fitur seperti itu ditambahkan, wajib tinjauan
hukum (judi daring dilarang di Indonesia) dan kebijakan toko aplikasi.
