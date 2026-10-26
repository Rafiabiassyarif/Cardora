// catalog.ts — katalog game. Menambah game baru = tambah entri di sini
// (+ modul di registry jika sudah bisa dimainkan). UI & server membaca katalog ini.

export type Category = 'poker' | 'indonesia' | 'international';
export type Status = 'available' | 'coming_soon';

export interface CatalogEntry {
  id: string;
  name: string;
  category: Category;
  icon: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Estimasi menit per permainan. */
  duration: string;
  difficulty: 'Mudah' | 'Sedang' | 'Sulit';
  status: Status;
  /** Aturan ringkas (ditampilkan di "Lihat Aturan"). Hanya untuk game tersedia. */
  rules?: string[];
  /** Catatan variasi regional. */
  variantNote?: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  poker: 'Poker',
  indonesia: 'Kartu Indonesia',
  international: 'Internasional',
};

const soon = (id: string, name: string, category: Category, icon: string, description: string,
  minPlayers: number, maxPlayers: number, duration: string, difficulty: CatalogEntry['difficulty'], variantNote?: string): CatalogEntry =>
  ({ id, name, category, icon, description, minPlayers, maxPlayers, duration, difficulty, status: 'coming_soon', variantNote });

export const CATALOG: CatalogEntry[] = [
  {
    id: 'holdem', name: "Texas Hold'em", category: 'poker', icon: '♠',
    description: 'Poker paling populer. Dua kartu tangan + lima kartu komunitas.',
    minPlayers: 2, maxPlayers: 9, duration: '15–40 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Setiap pemain mendapat 2 kartu tertutup. Dealer button bergeser tiap tangan; dua pemain di kirinya memasang small blind dan big blind.',
      'Ronde taruhan: Pre-flop → Flop (3 kartu komunitas) → Turn (1) → River (1). Aksi: Check, Bet, Call, Raise, Fold, All-in.',
      'Raise minimum sebesar raise sebelumnya (minimal 1 big blind). All-in yang kurang dari raise penuh tidak membuka ulang aksi.',
      'Showdown: kombinasi 5 kartu terbaik dari 7 kartu menang. Urutan: Royal Flush, Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, One Pair, High Card.',
      'Seri dipecah dengan kicker; suit tidak dipakai. A-2-3-4-5 (wheel) adalah straight terendah. Pot dibagi rata jika tetap seri.',
      'Pemain all-in hanya bisa memenangkan pot sebesar kontribusinya (side pot). Taruhan yang tidak di-call dikembalikan.',
    ],
  },
  {
    id: 'cangkulan', name: 'Cangkulan', category: 'indonesia', icon: '⛏',
    description: 'Ikuti jenis kartu pembuka atau nyangkul dari tumpukan. Habiskan kartumu duluan!',
    minPlayers: 2, maxPlayers: 6, duration: '5–15 mnt', difficulty: 'Mudah', status: 'available',
    variantNote: 'Variasi "Standar Cardora". Opsi: jumlah kartu, As tinggi/rendah, kartu pembuka dari tumpukan.',
    rules: [
      'Deck 52 kartu tanpa joker. Setiap pemain mendapat 7 kartu (bisa diatur 5–7); sisanya menjadi tumpukan cangkulan.',
      'Trik pertama dibuka kartu teratas tumpukan (opsional). Setiap pemain wajib mengeluarkan kartu berjenis (♠♥♦♣) sama dengan kartu pembuka.',
      'Tidak punya jenis yang sama? Nyangkul: ambil kartu dari tumpukan satu per satu sampai dapat jenis yang sesuai, lalu keluarkan.',
      'Jika tumpukan habis dan tetap tidak punya, pemain lewat.',
      'Kartu tertinggi dari jenis pembuka memenangkan trik dan memimpin trik berikutnya dengan kartu bebas.',
      'Pemain yang kartunya habis duluan menang. Yang terakhir masih memegang kartu kalah.',
    ],
  },
  {
    id: 'blackjack', name: 'Blackjack', category: 'international', icon: '🂡',
    description: 'Kalahkan bandar tanpa melewati 21. Bisa sendiri atau bareng teman.',
    minPlayers: 1, maxPlayers: 4, duration: '5–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Setiap pemain bertaruh, lalu menerima 2 kartu terbuka. Bandar menerima 1 kartu terbuka dan 1 tertutup.',
      'Nilai: 2–10 sesuai angka, J/Q/K = 10, As = 1 atau 11.',
      'Hit = ambil kartu. Stand = berhenti. Double = gandakan taruhan, ambil tepat 1 kartu (hanya di 2 kartu awal).',
      'Lebih dari 21 = bust (kalah). Bandar wajib hit sampai minimal 17 (stand di soft 17, opsi H17).',
      'Blackjack (As + kartu bernilai 10 di 2 kartu awal) dibayar 3:2. Seri dengan bandar = push (taruhan kembali).',
      'Split, insurance, dan surrender belum tersedia.',
    ],
  },
  {
    id: 'tongkrongan', name: 'Poker Tongkrongan', category: 'indonesia', icon: '🍻',
    description: 'Shedding card game 4 pemain ala tongkrongan. Pemegang 3♠ main duluan, lalu habiskan kartumu dengan kombinasi poker!',
    minPlayers: 4, maxPlayers: 4, duration: '5–15 mnt', difficulty: 'Sedang', status: 'available',
    variantNote: 'Aturan Tiga Kali Skip & Timer 15 Detik real-time.',
    rules: [
      'Game dimainkan 4 pemain, masing-masing mendapat 13 kartu (semua 52 kartu terbagi habis).',
      'Tahap Buka Kartu 3: Di awal ronde 1, seluruh pemain yang memiliki kartu angka 3 wajib mengeluarkannya ke meja. Pemain yang mengeluarkan kartu 3 Sekop (3♠) berhak mulai main duluan!',
      'Angka 2 adalah kartu poker terbesar! Urutan nilai: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < As < 2. Lambang tertinggi Sekop ♠ > Hati ♥ > Keriting ♣ > Wajik ♦ (3♦ kartu terendah, 2♠ kartu terbesar).',
      'Pembuka ronde mengeluarkan kombinasi sah: Single (1), Pair (2), Three of a Kind (3), atau Kombinasi 5 Kartu (Straight, Flush, Full House, Four of a Kind, Straight Flush, Royal Flush).',
      'Pemain berikutnya wajib Melawan (mengeluarkan kombinasi sama banyak yang lebih tinggi) atau Skip.',
      'Aturan Tiga Kali Skip: jika semua pemain lain Skip berturut-turut, ronde selesai dan pemain terakhir yang mengeluarkan kartu berhak memimpin ronde baru dengan kombinasi bebas.',
      'Timer giliran 15 detik real-time. Jika waktu habis, sistem otomatis melakukan Skip (atau kartu terendah jika memimpin).',
      'Pemain yang kartunya habis keluar sebagai juara (1, 2, 3) dan tidak mendapat giliran lagi. Permainan lanjut hingga tersisa 1 pemain terakhir yang kalah.'
    ],
  },
  {
    id: 'omaha', name: 'Omaha Poker', category: 'poker', icon: '♣',
    description: 'Empat kartu tangan rahasia + 5 kartu komunitas. Wajib pakai tepat 2 kartu tangan!',
    minPlayers: 2, maxPlayers: 9, duration: '20–45 mnt', difficulty: 'Sulit', status: 'available',
    rules: [
      'Setiap pemain menerima 4 kartu tertutup (hole cards).',
      'Terdapat 5 kartu komunitas di meja (Flop 3 kartu, Turn 1 kartu, River 1 kartu).',
      'Aturan Mutlak: Kombinasi akhir wajib memakai tepat 2 kartu dari tangan dan 3 kartu dari komunitas meja.',
      'Ronde taruhan berlangsung sama dengan Texas Hold\'em (Pre-flop, Flop, Turn, River).',
      'Pot-Limit: bet atau raise maksimum sebesar pot (termasuk jumlah call Anda); all-in hanya boleh jika masih dalam batas pot.',
      'Pemain dengan kombinasi 5 kartu tertinggi pada showdown memenangkan pot.'
    ]
  },
  {
    id: 'short-deck', name: 'Short Deck Poker', category: 'poker', icon: '♥',
    description: "Hold'em aksi tinggi dengan deck 36 kartu (angka 2 sampai 5 dibuang).",
    minPlayers: 2, maxPlayers: 9, duration: '15–30 mnt', difficulty: 'Sulit', status: 'available',
    rules: [
      'Deck hanya berisi 36 kartu (kartu berangka 2, 3, 4, dan 5 dihilangkan dari deck).',
      'Kartu As (A) bisa berfungsi sebagai kartu tertinggi atau kartu terendah dalam Straight (A-6-7-8-9).',
      'Karena probabilitas berubah, Flush mengalahkan Full House!',
      'Three of a Kind mengalahkan Straight (aturan Triton).',
      'Taruhan No-Limit dengan Small Blind & Big Blind seperti Texas Hold\'em.',
      'Setiap pemain mendapat 2 kartu tangan dan berbagi 5 kartu komunitas.',
      'Showdown menentukan pemegang kombinasi 5 kartu terbaik sebagai pemenang.'
    ]
  },
  {
    id: 'five-card-draw', name: 'Five Card Draw', category: 'poker', icon: '🃏',
    description: 'Poker klasik otentik: 5 kartu di tangan dengan ronde tukar kartu (draw).',
    minPlayers: 2, maxPlayers: 6, duration: '10–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Setiap tangan semua pemain membayar ante, lalu menerima 5 kartu tertutup.',
      'Ronde taruhan pertama (No-Limit atau Pot-Limit) dimulai dari kiri dealer; bet minimum 2× ante.',
      'Fase Tukar: setiap pemain yang bertahan boleh membuang 0–3 kartu (4 kartu bila kartu yang disimpan adalah As) dan menerima pengganti.',
      'Ronde taruhan kedua, lalu showdown: 5 kartu terbaik memenangkan pot (side pot untuk pemain all-in, seri dibagi).',
      'Permainan berlanjut beberapa tangan; pemenang adalah pemilik chip terbanyak di akhir.'
    ]
  },
  {
    id: 'seven-card-stud', name: 'Seven Card Stud', category: 'poker', icon: '♦',
    description: 'Poker klasik tanpa kartu komunitas: 3 kartu tertutup dan 4 kartu terbuka.',
    minPlayers: 2, maxPlayers: 8, duration: '20–40 mnt', difficulty: 'Sulit', status: 'available',
    rules: [
      'Semua pemain membayar ante, lalu menerima 2 kartu tertutup dan 1 kartu terbuka (Third Street).',
      'Kartu terbuka terendah wajib bring-in (seri: ♣ < ♦ < ♥ < ♠) atau langsung melengkapi ke small bet.',
      'Fourth hingga Sixth Street masing-masing 1 kartu terbuka, Seventh Street 1 kartu tertutup; mulai Fourth Street pemain dengan kartu terbuka terbaik beraksi pertama.',
      'Fixed-Limit: small bet di street 3–4, big bet di street 5–7, maksimal 1 bet + 3 raise per street.',
      'Showdown: 5 kartu terbaik dari 7 kartu sendiri menang (bila deck kurang di Seventh Street, dipakai 1 kartu komunitas).'
    ]
  },
  {
    id: 'baccarat', name: 'Baccarat', category: 'international', icon: '🎴',
    description: 'Kasino klasik dunia: tebak kubu Player atau Banker yang kartunya paling dekat dengan angka 9.',
    minPlayers: 1, maxPlayers: 4, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Setiap ronde tiap pemain wajib bertaruh (min. 10 chip) pada Player, Banker, atau Seri.',
      'As = 1, 2–9 sesuai angka, 10/J/Q/K = 0; nilai tangan adalah digit satuan (7 + 8 = 5).',
      'Natural 8 atau 9 dari dua kartu langsung berhenti. Player menarik kartu ke-3 pada 0–5; Banker mengikuti tabel resmi.',
      'Pembayaran: Player 1:1, Banker 0,95:1, Seri 8:1. Jika Seri, taruhan Player/Banker dikembalikan.',
      'Pemain yang chipnya habis tersingkir; chip terbanyak setelah ronde terakhir menang.'
    ]
  },
  {
    id: 'war', name: 'Casino War', category: 'international', icon: '⚔',
    description: 'Duel adu kartu paling simpel dan menegangkan: kartu tertinggi langsung menang!',
    minPlayers: 2, maxPlayers: 2, duration: '5–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Kedua pemain bergiliran memasang taruhan tertutup (10–100 chip), lalu masing-masing dibuka 1 kartu.',
      'Urutan nilai: 2 terendah hingga As tertinggi; kartu lebih tinggi mengambil seluruh pot.',
      'Jika seri, tiap pemain memilih "Perang!" (tambah taruhan yang sama, 3 kartu dibakar, buka 1 kartu lagi) atau "Menyerah" (kehilangan separuh setoran ke lawan).',
      'Pemenang perang mengambil semua chip di pot; seri lagi berarti memilih lagi.',
      'Permainan selesai setelah ronde terakhir atau saat chip pemain habis; chip terbanyak menang.'
    ]
  },
  {
    id: '41', name: 'Kartu 41', category: 'indonesia', icon: '4️⃣',
    description: 'Game kartu khas Indonesia: kumpulkan 4 kartu berjenis sama hingga mendekati total 41 poin!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Tiap pemain memegang 4 kartu. Nilai: As = 11, K/Q/J/10 = 10, 2–9 sesuai angka.',
      'Nilai tangan = jumlah kartu satu lambang terbaik dikurangi jumlah kartu lambang lain.',
      'Tiap giliran: ambil 1 kartu (dari cangkulan atau buangan 1 orang sebelum dia), lalu buang 1 kartu (kembali tepat 4 kartu).',
      'Tepat 41 (As + tiga kartu bernilai 10 satu lambang) langsung menang deal seketika!',
      'Bila kartu cangkulan habis, semua kartu dibuka: pemain dengan poin tertinggi (maksimal 41) menang deal.',
      'Nilai tangan tiap deal ditambahkan ke skor; total tertinggi setelah semua deal menang.'
    ]
  },
  {
    id: 'samhong', name: 'Samhong', category: 'indonesia', icon: '🀄',
    description: 'Adu kartu sosial Indonesia: susun 3 kartu untuk mencapai nilai terbaik.',
    minPlayers: 2, maxPlayers: 6, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Tiap pemain dibagi 3 kartu tertutup. Nilai: As = 1, 2–9 sesuai angka, 10/J/Q/K = 0; poin = jumlah nilai, ambil angka terakhir (0–9).',
      'Urutan kekuatan: Tris (3 kartu sama) > Samhong (3 kartu gambar J/Q/K) > 9 poin > … > 0 poin; seri dipecah kartu tertinggi.',
      'Sekali per deal, bergiliran, pilih "Tahan" atau "Tukar 1" (buang 1 kartu, ambil 1 dari deck).',
      'Setelah semua memilih, kartu dibuka. Tiap pemain kalah membayar pemenang: ×3 untuk Tris, ×2 untuk Samhong, ×1 biasa.',
      'Total poin tertinggi setelah semua deal menang.'
    ]
  },
  {
    id: 'remi', name: 'Remi Indonesia', category: 'indonesia', icon: '🂮',
    description: 'Susun seri berurutan (run) dan kombinasi tiga jenis (set) dari kartu tanganmu.',
    minPlayers: 2, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Tiap pemain menerima 7 kartu; satu kartu dibuka sebagai buangan.',
      'Kombinasi sah: Set (3–4 kartu angka sama) atau Seri (3+ kartu berurutan selambang; As boleh A-2-3 atau Q-K-A, tidak memutar).',
      'Tiap giliran: ambil 1 kartu dari deck atau buangan teratas, lalu buang 1 kartu.',
      'Jika setelah membuang seluruh 7 kartumu tersusun jadi kombinasi sah, kamu otomatis "Tutup" dan menang deal (+50).',
      'Pemain lain dikurangi nilai kartu yang tidak masuk kombinasi (As 15, 10/J/Q/K 10, 2–9 5). Total tertinggi menang.'
    ]
  },
  {
    id: 'capsa-susun', name: 'Capsa Susun', category: 'indonesia', icon: '🀫',
    description: 'Susun 13 kartu menjadi 3 baris kombinasi poker (3 kartu atas, 5 kartu tengah, 5 kartu bawah).',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Tiap pemain menerima 13 kartu dan menyusunnya bergiliran secara tertutup.',
      'Susun 3 baris: Atas (3 kartu), Tengah (5 kartu), Bawah (5 kartu) — wajib Bawah ≥ Tengah ≥ Atas menurut ranking poker.',
      'Baris Atas hanya mengenal Three of a Kind, Pair, dan High Card. Susunan yang melanggar urutan dinyatakan "Mati" dan kalah semua baris.',
      'Kartu diadu per baris melawan tiap lawan: menang +1, kalah −1; sapu bersih ketiga baris = dobel (±6).',
      'Total poin tertinggi setelah semua deal menang.'
    ]
  },
  {
    id: 'tepok-nyamuk', name: 'Tepok Nyamuk', category: 'indonesia', icon: '🖐',
    description: 'Game adu refleks dan konsentrasi: tepuk tumpukan kartu saat angka kartu cocok dengan hitungan!',
    minPlayers: 2, maxPlayers: 6, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Semua kartu dibagi rata dalam keadaan tertutup — kamu pun tidak melihat kartumu.',
      'Bergiliran, buka kartu teratas ke tengah sambil menyebut urutan A, 2, 3, … J, Q, K, lalu kembali ke A.',
      'Jika kartu yang terbuka SAMA dengan angka yang disebut, semua pemain harus secepatnya menekan "Tepok!".',
      'Yang paling lambat (atau tidak menepuk) mengambil seluruh tumpukan; salah tepok saat tidak cocok juga wajib mengambil tumpukan.',
      'Pemain yang kartunya habis selamat; pemain terakhir yang masih memegang kartu kalah.'
    ]
  },
  {
    id: 'go-fish', name: 'Go Fish', category: 'international', icon: '🐟',
    description: 'Minta kartu ke pemain lain dan kumpulkan set lengkap 4 kartu berangka sama!',
    minPlayers: 2, maxPlayers: 6, duration: '10–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain mendapat 7 kartu (2–3 pemain) atau 5 kartu (4+ pemain); sisanya menjadi kolam.',
      'Pilih kartu di tanganmu dan seorang lawan untuk meminta semua kartu berangka sama.',
      'Jika lawan punya, ia wajib menyerahkan semuanya dan kamu jalan lagi.',
      'Jika tidak, "Go Fish!" — ambil 1 kartu dari kolam; bila angkanya sama dengan yang diminta, kamu jalan lagi.',
      '4 kartu berangka sama otomatis menjadi 1 Buku. Buku terbanyak setelah 13 buku lengkap menang!'
    ]
  },
  {
    id: 'old-maid', name: 'Old Maid', category: 'international', icon: '👵',
    description: 'Jodohkan pasangan kartu di tangan dan buang, tapi jangan sampai memegang kartu Old Maid terakhir!',
    minPlayers: 2, maxPlayers: 6, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Q♣ dikeluarkan sehingga tersisa satu Queen tanpa pasangan (Old Maid).',
      'Semua kartu dibagikan; pasangan berangka sama otomatis dibuang (opsi: harus sama warna).',
      'Bergiliran ambil 1 kartu tertutup dari pemain di sebelah kiri dengan memilih posisinya.',
      'Pasangan baru otomatis dibuang; pemain yang kartunya habis selamat sesuai urutan.',
      'Pemain terakhir yang memegang Old Maid kalah!'
    ]
  },
  {
    id: 'crazy-eights', name: 'Crazy Eights', category: 'international', icon: '8️⃣',
    description: 'Cocokkan lambang atau angka dengan kartu di meja. Angka 8 adalah kartu liar (wildcard)!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Setiap pemain dibagikan 7 kartu (opsi 5), 1 kartu dibuka di tengah meja sebagai tumpukan buangan.',
      'Pada giliranmu, keluarkan kartu yang memiliki angka SAMA atau lambang (suit) SAMA dengan kartu di atas meja.',
      'Kartu angka 8 adalah "Crazy Eight": dapat dikeluarkan kapan saja dan bebas mengganti lambang permainan!',
      'Tidak bisa main? Ambil 1 kartu — boleh langsung dimainkan bila cocok, jika tidak giliran lewat.',
      'Pemain yang menghabiskan kartunya duluan menang; sisanya diurutkan dari poin penalti kartu di tangan (8 = 50, gambar = 10).'
    ]
  },
  {
    id: 'mau-mau', name: 'Mau-Mau', category: 'international', icon: '🗣',
    description: 'Permainan shedding populer Eropa dengan kartu aksi: 7 membuat lawan draw 2, Jack merubah lambang!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Setiap pemain mendapat 5 kartu (deck 52 atau 32 kartu 7–A); satu kartu dibuka di tengah.',
      'Keluarkan kartu dengan lambang atau angka yang sama dengan kartu teratas.',
      'Angka 7: pemain berikutnya ambil 2 kartu, kecuali membalas dengan 7 (hukuman menumpuk +2).',
      'Angka 8 melompati pemain berikutnya; Jack adalah kartu bebas untuk meminta lambang baru (tidak boleh J di atas J).',
      'Tidak bisa main? Ambil 1 kartu — boleh langsung dimainkan bila cocok.',
      'Yang pertama menghabiskan kartu menang; sisanya diurutkan dari poin penalti kartu di tangan.'
    ]
  },
  {
    id: 'gin-rummy', name: 'Gin Rummy', category: 'international', icon: '🍸',
    description: 'Duel kartu 2 pemain: susun kartu menjadi set dan seri untuk meminimalisir kartu mati (deadwood).',
    minPlayers: 2, maxPlayers: 2, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Dua pemain masing-masing 10 kartu; non-dealer lalu dealer boleh mengambil kartu buka, jika keduanya lewat non-dealer mengambil dari stok.',
      'Tiap giliran ambil 1 kartu (stok/buangan) lalu buang 1; kartu yang baru diambil dari buangan tidak boleh langsung dibuang.',
      'Susun Set (3–4 kartu sama) dan Run (3+ kartu selambang berurutan, As rendah); sisanya deadwood (As=1, J/Q/K=10).',
      'Knock bila deadwood ≤ 10: lawan menempel kartu ke meld-mu dan pengetuk mendapat selisih deadwood; Undercut = lawan dapat selisih +25.',
      'Gin (deadwood 0) mendapat bonus 25 dan lawan tidak boleh menempel. Stok sisa 2 kartu = deal batal.',
      'Pemain pertama yang mencapai target poin (50/100) menang.'
    ]
  },
  {
    id: 'rummy', name: 'Classic Rummy', category: 'international', icon: '🂠',
    description: 'Permainan kartu keluarga klasik dunia untuk membentuk meld dan mengosongkan kartu tangan.',
    minPlayers: 2, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      '2 pemain mendapat 10 kartu, 3–4 pemain mendapat 7 kartu.',
      'Setiap giliran ambil 1 kartu dari stok atau kartu teratas buangan.',
      'Turunkan Set (3–4 kartu sama) atau Run (3+ selambang berurutan, As boleh A-2-3 atau Q-K-A) dan tempel kartu ke meld mana pun di meja.',
      'Akhiri giliran dengan membuang 1 kartu (bukan kartu yang baru diambil dari buangan).',
      'Pemain pertama yang kartunya habis memenangkan deal dan mendapat poin dari sisa kartu lawan (As=1, J/Q/K=10).',
      'Setelah semua deal selesai, poin terbanyak menjadi juara.'
    ]
  },
  {
    id: 'hearts', name: 'Hearts', category: 'international', icon: '♥',
    description: 'Permainan trik menghindari poin penalti: hindari mengambil kartu Hati dan Queen Sekop!',
    minPlayers: 4, maxPlayers: 4, duration: '20–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      '4 pemain masing-masing menerima 13 kartu; tiap deal oper 3 kartu bergantian ke kiri, kanan, seberang, lalu tanpa oper.',
      'Pemegang 2♣ membuka trik pertama; wajib mengikuti jenis kartu pembuka bila punya. Di trik pertama, Hati dan Q♠ tidak boleh dimainkan kecuali terpaksa.',
      'Hati tidak boleh dibuka sebelum "pecah" (ada Hati yang dibuang), kecuali tanganmu tinggal Hati.',
      'Setiap kartu Hati (♥) = 1 poin penalti; Queen Sekop (Q♠) = 13 poin penalti!',
      '"Shoot the Moon": ambil SEMUA Hati dan Q♠ → kamu 0, semua lawan +26.',
      'Permainan selesai saat ada yang mencapai target (50/100); poin terendah menang.'
    ]
  },
  {
    id: 'spades', name: 'Spades', category: 'international', icon: '♠',
    description: 'Permainan trik berpasangan legendaris di mana lambang Sekop selalu menjadi truf penakluk!',
    minPlayers: 4, maxPlayers: 4, duration: '20–40 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Berpasangan: seat 1 & 3 melawan seat 2 & 4. Tiap pemain menawar (bid) 0–13 trik; bid 0 = "Nil".',
      'Kartu Sekop (♠) adalah truf. Wajib mengikuti jenis kartu pembuka; Sekop tidak boleh dibuka sebelum pecah (kecuali tinggal Sekop).',
      'Kontrak tim tercapai: 10 × bid + 1 poin per trik lebih (bag). Gagal: −10 × bid.',
      'Nil berhasil (0 trik) = +100, gagal = −100. Setiap 10 bag terkumpul = −100.',
      'Tim pertama yang mencapai target (200/300) menang; permainan juga berhenti setelah batas deal.'
    ]
  },
  {
    id: 'euchre', name: 'Euchre', category: 'international', icon: '🃎',
    description: 'Permainan trik cepat dengan deck 24 kartu (angka 9 hingga As).',
    minPlayers: 4, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Hanya 24 kartu (9, 10, J, Q, K, A); tiap pemain 5 kartu dan 1 kartu dibuka. Berpasangan: seat 1 & 3 melawan seat 2 & 4.',
      'Ronde 1: tiap pemain boleh "Pesan" suit kartu terbuka sebagai truf (dealer mengambilnya lalu membuang 1 kartu) atau Lewat. Ronde 2: sebut suit lain atau Lewat — dealer wajib memilih.',
      'J suit truf = "Right Bower" (terkuat), J sewarna = "Left Bower" (kedua terkuat, dianggap truf). Wajib mengikuti jenis kartu pembuka.',
      'Tim pemesan menang 3–4 trik = 1 poin, sapu bersih 5 trik = 2 poin; bila gagal (euchre) lawan mendapat 2 poin.',
      'Tim pertama yang mencapai target (5/10 poin) keluar sebagai juara.'
    ]
  },
  {
    id: 'durak', name: 'Durak', category: 'international', icon: '🛡',
    description: 'Permainan kartu bertahan Rusia: serang lawan dengan kartu sama dan tangkis agar tidak menjadi Durak!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Deck 36 kartu (6–A), tiap pemain 6 kartu; kartu terbawah stok dibuka sebagai truf.',
      'Penyerang melempar kartu; bertahan menangkis dengan kartu sejenis lebih tinggi atau truf.',
      'Setelah tiap tangkisan, penyerang boleh menambah kartu berangka sama dengan kartu di meja, atau menyatakan Bito.',
      'Gagal/tidak mau menangkis? Bertahan wajib mengambil semua kartu di meja.',
      'Tangan diisi kembali sampai 6 dari stok. Pemain terakhir yang masih memegang kartu adalah "Durak"!'
    ]
  },
  {
    id: 'president', name: 'President / Daifugo', category: 'international', icon: '👑',
    description: 'Permainan shedding adu kasta: pemain yang habis duluan menjadi Presiden, yang terakhir jadi Scum!',
    minPlayers: 3, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Semua kartu dibagikan. Urutan kekuatan: 3 terendah … K, A, dan 2 tertinggi.',
      'Buka dengan single, pair, triple, atau 4 kartu sama; pemain berikutnya wajib melempar jumlah sama yang lebih tinggi, atau Pass.',
      'Jika semua pass, meja dibersihkan dan pelempar terakhir membuka lagi.',
      'Urutan habis kartu: Presiden, Wakil Presiden, (Rakyat/Wakil Scum), Scum — mendapat poin sesuai gelar.',
      'Ronde berikutnya: Scum menyerahkan 2 kartu terbaik ke Presiden, Presiden mengembalikan 2 kartu pilihannya.',
      'Setelah beberapa ronde (default 3), total poin tertinggi menang.'
    ]
  },
  {
    id: 'domino-gaple', name: 'Domino Gaple', category: 'indonesia', icon: '🁢',
    description: 'Domino blok khas Indonesia: sambung angka di ujung rantai, habiskan kartu atau menangkan Gaple dengan titik terkecil.',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Set domino balak 6 (28 kartu), tiap pemain 7 kartu; bila kurang dari 4 pemain, sisa kartu "tidur" dan tidak dipakai (tanpa ambil kartu).',
      'Deal pertama dibuka oleh pemegang balak tertinggi (6|6, 5|5, …) dengan balak itu; deal berikutnya dibuka bebas oleh pemenang deal sebelumnya.',
      'Pasang kartu yang cocok dengan ujung kiri atau kanan rantai (pilih ujungnya); Lewat hanya boleh bila tidak punya kartu yang cocok.',
      'Deal selesai bila ada yang habis kartu, atau Gaple! (buntu, tak ada yang bisa pasang) — pemenangnya pemain dengan total titik terkecil.',
      'Pemenang deal mendapat total titik kartu lawan yang tersisa; bonus +10 bila menutup dengan balak.',
      'Main beberapa deal sampai ada yang mencapai target skor (50/100/150, default 100); skor tertinggi menang.'
    ]
  },
  {
    id: 'kartu-warna', name: 'Kartu Warna', category: 'international', icon: '🌈',
    description: 'Game buang kartu seru: cocokkan warna atau angka, jebak lawan dengan +2 & +4, dan jangan lupa bilang "Satu Kartu!"',
    minPlayers: 2, maxPlayers: 8, duration: '5–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Tiap pemain dapat 7 kartu. Mainkan kartu yang sama warna dengan warna aktif, atau sama angka/simbol dengan kartu teratas.',
      'Lewati = pemain berikutnya kehilangan giliran; Balik = arah berbalik (2 pemain = Lewati); +2 = pemain berikutnya ambil 2 & dilewati.',
      'Wild bebas dimainkan lalu pilih warna. Wild +4 hanya boleh jika kamu tidak punya kartu berwarna aktif; pemain berikutnya ambil 4 & dilewati. (Opsi: tumpuk +2/+4.)',
      'Tidak bisa/tidak mau main: ambil 1 kartu; jika cocok boleh langsung dimainkan, jika tidak giliran lewat.',
      'Saat tinggal 1 kartu, pakai tombol "Mainkan + Satu Kartu!". Lupa? Otomatis ambil 2 kartu penalti.',
      'Yang pertama habis kartunya menang deal dan dapat poin dari kartu lawan (angka = nominal, aksi = 20, Wild = 50). Main 1/3/5 deal atau sampai target skor.'
    ]
  },
  {
    id: 'bohong', name: 'Bohong!', category: 'indonesia', icon: '🤥',
    description: 'Taruh kartu tertutup, akui angkanya — jujur atau bohong? Teriak "Bohong!" kalau curiga.',
    minPlayers: 3, maxPlayers: 8, duration: '10–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Satu deck 52 kartu dibagi habis. Pemegang A♠ mulai; angka wajib berputar A, 2, 3, … K, lalu kembali ke A.',
      'Saat giliranmu, taruh 1–4 kartu tertutup dan akui semuanya sebagai angka wajib — boleh jujur, boleh bohong.',
      'Setelah kartu ditaruh, pemain lain punya ±3 detik untuk teriak "Bohong!". Penuduh tercepat yang berhak.',
      'Kartu dibuka: ada satu saja yang bukan angka wajib → penaruh ambil seluruh tumpukan; semuanya jujur → penuduh yang ambil.',
      'Kartu habis = menang, asal taruhan terakhirmu tidak ketahuan bohong.',
      'Default: permainan selesai saat pemain pertama habis kartu, sisanya diperingkat dari kartu paling sedikit (opsi: lanjut sampai tersisa satu pemain).'
    ]
  },
];

export const catalogById = (id: string) => CATALOG.find(g => g.id === id);
