# Status fitur

Legenda: [x] selesai & diuji · [~] ada, terbatas · [ ] belum

## Gameplay
- [x] Texas Hold'em: blind, min-raise, all-in, side pot, split pot, showdown, evaluator 7 kartu (tes + fuzz konservasi chip)
- [x] Poker Live Hand Analyzer & Win Equity HUD: indikator kombinasi kartu, % peluang menang realtime (Monte Carlo), kalkulator pot odds
- [x] Cangkulan: ikut warna, cangkul dari deck, pemenang trik memimpin, deck habis
- [x] Blackjack: taruhan, hit/stand/double, bandar hit sampai 17, blackjack 3:2
- [x] Poker Tongkrongan (4 Pemain): shedding card game, 52 kartu dibagikan habis (13 kartu/pemain), Single, Pair, Triple, Straight, Flush, Full House, Four of a Kind, Straight Flush, Royal Flush; aturan 3x Skip berturut-turut untuk reset & ganti ronde; batas waktu giliran 15 detik dengan auto-skip; mode Operan HP (Pass & Play dengan privacy veil) & vs 3 Bot; penentuan Juara 1 s.d. Kalah Terakhir
- [x] Sistem Pertandingan Berkelanjutan (Multi-Round Match Series): pilihan format 1 Ronde (Cepat), 3 Ronde (Best of 3 ⭐), 5 Ronde (Seri), 7 Ronde (Turnamen), atau ∞ Tanpa Batas; indikator ronde aktif 🎯 di meja; modal klasemen seri sementara; tombol "Lanjut ke Ronde Berikutnya ➔"; dan podium Juara Umum di akhir seri untuk seluruh game
- [x] Bot 3 tingkat (mudah/normal/sulit) untuk semua game + interaksi banter chat lokal
- [x] RNG kriptografis (crypto.getRandomValues) untuk kocok kartu
- [x] Rebuy & Top-up chip instan langsung di meja saat saldo chip habis
- [x] Game pesta (ramai-ramai): Domino Gaple (balak 6, pilih ujung, Gaple/buntu), Kartu Warna (2–8 pemain, Lewati/Balik/+2/Wild +4, "Satu Kartu!"), Bohong! (3–8 pemain, tuduh real-time)
- [x] Token non-remi (`tokens.ts`): domino & Kartu Warna digambar oleh meja universal; kipas kartu tangan otomatis muat di layar (30+ kartu)
- [x] Omaha (Pot-Limit, wajib 2 kartu tangan) & Short Deck (36 kartu, Flush > Full House, Trips > Straight) di mesin Hold'em
- [x] Five Card Draw (ante, NL/PL, tukar 0–3/4 dengan As) & Seven Card Stud (bring-in, fixed-limit, kartu terbuka)
- [x] Kartu Indonesia: Kartu 41 (ketuk), Remi (tutup otomatis), Samhong (tahan/tukar), Capsa Susun (3 baris, susun otomatis), Tepok Nyamuk (tepok real-time)
- [x] Internasional: Baccarat (tabel kartu ke-3 resmi), Casino War (perang/menyerah), Crazy Eights, Mau-Mau, Go Fish, Old Maid, Gin Rummy (knock/gin/undercut), Classic Rummy, Hearts (oper kartu, shoot the moon), Spades (bid, nil, bag), Euchre (bower), Durak, President (tukar kartu antar-deal)
- [x] Meja universal (`GenericView` + `UniversalTable`): engine menentukan tumpukan, kartu terbuka, meld, dan tombol aksi (pilih kartu / angka / lawan)
- [x] Setiap game: validasi aksi di server, bot 3 tingkat, tes aturan + fuzz (bot + aksi acak, konservasi kartu/chip, anti bocor kartu)
- [~] Penyederhanaan yang disengaja: tanpa "go alone" (Euchre), blind nil (Spades), kartu spesial President, Dragon (Capsa Susun); Durak hanya penyerang utama yang boleh menambah kartu

## Multiplayer online & Komunikasi
- [x] Room dengan kode 6 karakter (tanpa karakter ambigu), salin & bagikan
- [x] Live Room & Table Chat: chat pesan teks bebas, quick phrases kasino, dan emote interaktif
- [x] Balon kata (speech bubble) mengambang di atas kursi pemain & bot
- [x] Host: pilih game, kursi, pengaturan, tambah/hapus bot, mulai; host pindah otomatis saat keluar
- [x] Siap/belum siap; mulai hanya jika semua siap
- [x] Server authoritative: kartu lawan tidak pernah dikirim ke klien (dites)
- [x] Reconnect dengan token sesi (kursi & kartu kembali), batas waktu tunggu 60 dtk
- [x] Timer giliran; pemain terputus/AFK → aksi otomatis, meja tidak macet
- [x] Rematch kembali ke lobby
- [x] Rate limit: aksi per socket, buat room & tebak kode per IP
- [~] Satu proses server (room di memori) — belum horizontal scaling

## Akun, Gamifikasi & Data
- [x] Main sebagai tamu tanpa daftar
- [x] Sistem Pencapaian (12 Lencana Prestise dengan hadiah chip & XP)
- [x] Roda Keberuntungan Harian (Lucky Spin) & Misi Harian (Daily Quests)
- [x] Toko chip gratis, bank darurat, dan tingkatan VIP
- [x] Mode Tamu & Mode Akun Online: main langsung tanpa daftar (mode tamu), daftar/masuk akun online (didukung local JSON file store otomatis & PostgreSQL), bonus pendaftaran +25.000 Chip & +200 XP
- [x] Simpan Progres Mandiri: cadangkan & pulihkan dengan Kunci Pemulihan (Recovery Key) atau unduh file kuypoker-backup.json untuk pindah HP/browser secara mandiri
- [x] Profil lokal, riwayat & favorit di perangkat

## Aplikasi & Audio
- [x] UI responsif: 21/21 kombinasi (3 meja × 7 ukuran layar) lolos cek tumpang tindih
- [x] Casino Lounge BGM: musik latar piano jazz sintetis WebAudio (100% offline tanpa unduh audio eksternal)
- [x] Efek suara WebAudio kaya (knock check, shuffle deal, all-in gong, achievement fanfare, chip clinking)
- [x] Panduan kombinasi kartu poker (Hand Rankings Cheat Sheet) & Showdown Replayer
- [x] PWA (manifest, ikon)
- [x] Panduan, aturan per game, pengaturan (suara, animasi, URL server, reset data lokal)
- [~] Capacitor Android/iOS: konfigurasi & aset ikon ada; lihat MOBILE.md
- [x] Sistem Teman & Relasi: daftar teman, ID pemain unik (KUY-XXXX), status kehadiran (online / di meja / offline), 1-klik ajak main room, cari & tambah teman
- [x] Notifikasi Web & Push: izin browser, pengingat giliran bermain meja, pemberitahuan ajakan room teman, & bonus harian
- [ ] Monetisasi — sengaja tidak ada (lihat catatan hukum di README)
