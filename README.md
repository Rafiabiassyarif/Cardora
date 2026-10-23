# Cardora

Platform game kartu multiplayer — web (PWA), Android, dan iOS dari satu kode.
Main sendiri melawan bot (offline) atau online bersama teman lewat kode room.

Semua 27 game di katalog bisa dimainkan.

Dengan aturan lengkap sesuai game aslinya:
- Texas Hold'em (2–9 pemain, no-limit, side pot, showdown, equity HUD)
- Cangkulan (2–6 pemain, permainan kartu Indonesia)
- Blackjack (1–4 pemain vs bandar)
- Poker Tongkrongan (4 pemain, shedding 13 kartu, Pass & Play / vs bot)
- Capsa Banting (memakai mesin Poker Tongkrongan)

Dengan aturan umum yang disederhanakan (`packages/engine/src/allGames.ts`):
Omaha, Short Deck, Five Card Draw, Seven Card Stud, Baccarat, Casino War, 41, Samhong,
Remi, Capsa Susun, Tepok Nyamuk, Go Fish, Old Maid, Crazy Eights, Mau-Mau, Gin Rummy,
Rummy, Hearts, Spades, Euchre, Durak, President. Pemain bergantian main/ambil/lewat,
skor dari nilai kartu; aturan khas tiap game belum diterapkan.

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

    npm test               # 135 tes: evaluator poker, fuzz Hold'em (konservasi chip), semua game, multiplayer socket nyata
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
