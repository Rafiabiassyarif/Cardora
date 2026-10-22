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
    id: 'capsa-banting', name: 'Capsa Banting', category: 'indonesia', icon: '💥',
    description: 'Habiskan kartu dengan kombinasi lebih tinggi. Angka 2 adalah kartu terkuat!',
    minPlayers: 4, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Setiap pemain mendapat 13 kartu remi (52 kartu habis dibagikan ke 4 pemain).',
      'Pemain yang memiliki kartu 3 mengeluarkannya ke meja di awal permainan. Pemegang 3♠ mulai jalan duluan!',
      'Keluarkan kombinasi Single, Pair, Triple, atau 5 Kartu Poker (Straight, Flush, Full House, Quads, Straight Flush).',
      'Pemain berikutnya harus mengeluarkan kombinasi sejenis yang bernilai lebih tinggi atau melakukan Skip.',
      'Jika semua pemain lain Skip berturut-turut, meja dibersihkan dan pemimpin baru bebas mengeluarkan kombinasi apa saja.',
      'Pemain pertama yang kartunya habis menang sebagai Juara 1!'
    ]
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
      'Setiap pemain mendapat 2 kartu tangan dan berbagi 5 kartu komunitas.',
      'Showdown menentukan pemegang kombinasi 5 kartu terbaik sebagai pemenang.'
    ]
  },
  {
    id: 'five-card-draw', name: 'Five Card Draw', category: 'poker', icon: '🃏',
    description: 'Poker klasik otentik: 5 kartu di tangan dengan ronde tukar kartu (draw).',
    minPlayers: 2, maxPlayers: 6, duration: '10–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Setiap pemain dibagikan 5 kartu tertutup.',
      'Ronde taruhan pertama dilakukan setelah melihat kartu tangan masing-masing.',
      'Fase Draw: Setiap pemain yang bertahan berhak menukar 0 hingga 3 kartu (atau 4 jika memegang As) dari deck.',
      'Ronde taruhan kedua dilakukan setelah penukaran kartu selesai.',
      'Pemain dengan 5 kartu terbaik di showdown memenangkan seluruh pot.'
    ]
  },
  {
    id: 'seven-card-stud', name: 'Seven Card Stud', category: 'poker', icon: '♦',
    description: 'Poker klasik tanpa kartu komunitas: 3 kartu tertutup dan 4 kartu terbuka.',
    minPlayers: 2, maxPlayers: 8, duration: '20–40 mnt', difficulty: 'Sulit', status: 'available',
    rules: [
      'Setiap pemain menerima total 7 kartu secara bertahap (3 kartu tertutup, 4 kartu terbuka).',
      'Tidak ada kartu komunitas di tengah meja; setiap pemain hanya memakai kartunya sendiri.',
      'Terdapat beberapa ronde taruhan: Third Street, Fourth Street, Fifth Street, Sixth Street, dan River (Seventh Street).',
      'Pemain menyusun kombinasi 5 kartu terbaik dari 7 kartu miliknya untuk memenangkan pot.'
    ]
  },
  {
    id: 'baccarat', name: 'Baccarat', category: 'international', icon: '🎴',
    description: 'Kasino klasik dunia: tebak kubu Player atau Banker yang kartunya paling dekat dengan angka 9.',
    minPlayers: 1, maxPlayers: 4, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain memilih memasang taruhan pada Player, Banker, atau Tie (Seri).',
      'Dua kartu dibagikan ke sisi Player dan Banker. Angka 10, J, Q, K bernilai 0; As bernilai 1; angka 2–9 bernilai nominal.',
      'Total nilai dihitung dari digit satuan (misal 7 + 8 = 15 -> bernilai 5).',
      'Nilai maksimal adalah 9 (Natural 8 atau 9 langsung menang tanpa kartu tambahan).',
      'Kubu yang mendekati 9 memenangkan ronde dan membayar taruhan pemenang.'
    ]
  },
  {
    id: 'war', name: 'Casino War', category: 'international', icon: '⚔',
    description: 'Duel adu kartu paling simpel dan menegangkan: kartu tertinggi langsung menang!',
    minPlayers: 2, maxPlayers: 2, duration: '5–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain dan lawan masing-masing membuka 1 kartu sekaligus.',
      'Urutan nilai kartu: 2 terendah hingga As (A) tertinggi.',
      'Pemain dengan nilai kartu lebih tinggi memenangkan ronde dan mendapatkan poin.',
      'Jika kartu bernilai sama, terjadi "War" (perang): kartu tambahan dibuka untuk menentukan pemenang!',
      'Pemain yang mengumpulkan skor terbanyak di akhir ronde keluar sebagai pemenang.'
    ]
  },
  {
    id: '41', name: 'Kartu 41', category: 'indonesia', icon: '4️⃣',
    description: 'Game kartu khas Indonesia: kumpulkan 4 kartu berjenis sama hingga mendekati total 41 poin!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Masing-masing pemain memegang 4 kartu di tangan.',
      'Nilai kartu: As = 11 poin, K/Q/J/10 = 10 poin, angka 2–9 sesuai nominal.',
      'Pemain fokus mengumpulkan 4 kartu dengan lambang (suit) yang sama.',
      'Setiap giliran, pemain mengambil 1 kartu dari deck atau tumpukan buangan, lalu membuang 1 kartu yang tidak diinginkan.',
      'Pemain yang berhasil mencapai total 41 poin dapat langsung mengetuk meja ("Buka / Knock").'
    ]
  },
  {
    id: 'samhong', name: 'Samhong', category: 'indonesia', icon: '🀄',
    description: 'Adu kartu sosial Indonesia: susun 3 kartu untuk mencapai nilai terbaik.',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Setiap pemain dibagikan 3 kartu tertutup.',
      'Pemain mengkombinasikan dan menghitung total poin dari ketiga kartu tersebut.',
      'Kombinasi spesial seperti Tris (tiga kartu bernilai sama) dan Kartu Bergambar memiliki ranking tersendiri.',
      'Pemain dengan kombinasi terkuat memenangkan putaran.'
    ]
  },
  {
    id: 'remi', name: 'Remi Indonesia', category: 'indonesia', icon: '🂮',
    description: 'Susun seri berurutan (run) dan kombinasi tiga jenis (set) dari kartu tanganmu.',
    minPlayers: 2, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Pemain menerima 7 kartu di tangan.',
      'Bentuk kombinasi "Set" (kartu angka sama beda lambang) atau "Run/Seri" (kartu berurutan selambang).',
      'Pada setiap giliran: ambil kartu dari tumpukan atau buangan, susun kartu di tangan, lalu buang 1 kartu.',
      'Pemain pertama yang berhasil menyusun seluruh kartunya menjadi kombinasi sah keluar sebagai pemenang.'
    ]
  },
  {
    id: 'capsa-susun', name: 'Capsa Susun', category: 'indonesia', icon: '🀫',
    description: 'Susun 13 kartu menjadi 3 baris kombinasi poker (3 kartu atas, 5 kartu tengah, 5 kartu bawah).',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Masing-masing pemain menerima 13 kartu.',
      'Susun 13 kartu ke dalam 3 susunan: Baris Atas (3 kartu), Baris Tengah (5 kartu), dan Baris Bawah (5 kartu).',
      'Aturan Kekuatan: Baris Bawah harus lebih kuat dari Baris Tengah, dan Baris Tengah harus lebih kuat dari Baris Atas!',
      'Setelah semua pemain selesai menyusun, kartu diadu per baris antar pemain.',
      'Kemenangan tiap baris menghasilkan poin; sapu bersih (menang ketiga baris) menghasilkan bonus poin besar!'
    ]
  },
  {
    id: 'tepok-nyamuk', name: 'Tepok Nyamuk', category: 'indonesia', icon: '🖐',
    description: 'Game adu refleks dan konsentrasi: tepuk tumpukan kartu saat angka kartu cocok dengan hitungan!',
    minPlayers: 2, maxPlayers: 6, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Kartu dibagikan rata ke semua pemain dalam keadaan tertutup.',
      'Secara bergantian, pemain membuka kartu teratas ke tengah meja sambil menyebut urutan: As, 2, 3, ... King.',
      'Jika kartu yang terbuka COCOK dengan angka yang disebutkan (atau kartu As terbuka), semua pemain harus secepat mungkin menepuk tumpukan kartu!',
      'Pemain paling lambat menepuk harus mengambil seluruh tumpukan kartu di meja.',
      'Pemain yang berhasil menghabiskan seluruh kartunya adalah pemenang!'
    ]
  },
  {
    id: 'go-fish', name: 'Go Fish', category: 'international', icon: '🐟',
    description: 'Minta kartu ke pemain lain dan kumpulkan set lengkap 4 kartu berangka sama!',
    minPlayers: 2, maxPlayers: 6, duration: '10–15 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain dibagikan kartu awal dan sisa kartu diletakkan di tengah sebagai "kolam ikan" (fish pond).',
      'Pada giliranmu, tanyakan pemain lain apakah mereka memiliki kartu dengan angka tertentu (kamu wajib memiliki minimal 1 kartu angka tersebut).',
      'Jika mereka punya, mereka wajib menyerahkan semua kartu berangka tersebut kepadamu.',
      'Jika mereka tidak punya, mereka akan berteriak "Go Fish!", dan kamu harus mengambil 1 kartu dari kolam.',
      'Kumpulkan 4 kartu bernilai sama untuk membentuk 1 "Buku". Pemain dengan buku terbanyak menang!'
    ]
  },
  {
    id: 'old-maid', name: 'Old Maid', category: 'international', icon: '👵',
    description: 'Jodohkan pasangan kartu di tangan dan buang, tapi jangan sampai memegang kartu Old Maid terakhir!',
    minPlayers: 2, maxPlayers: 6, duration: '5–10 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Satu kartu Queen dikeluarkan dari deck sehingga tersisa tepat satu Queen yang tidak memiliki pasangan (Old Maid).',
      'Semua kartu dibagikan habis ke pemain. Setiap pemain langsung membuang pasangan kartu (pair) dari tangannya.',
      'Pemain secara bergantian mengambil satu kartu secara acak dari tangan pemain di sebelahnya.',
      'Jika kartu yang diambil membentuk pasangan baru, buang pasangan tersebut.',
      'Pemain yang kartunya habis selamat. Pemain yang memegang kartu Old Maid terakhir dinyatakan kalah!'
    ]
  },
  {
    id: 'crazy-eights', name: 'Crazy Eights', category: 'international', icon: '8️⃣',
    description: 'Cocokkan lambang atau angka dengan kartu di meja. Angka 8 adalah kartu liar (wildcard)!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Setiap pemain dibagikan 7 kartu, 1 kartu dibuka di tengah meja sebagai tumpukan buangan.',
      'Pada giliranmu, keluarkan kartu yang memiliki angka SAMA atau lambang (suit) SAMA dengan kartu di atas meja.',
      'Kartu angka 8 adalah "Crazy Eight": dapat dikeluarkan kapan saja dan bebas mengganti lambang permainan!',
      'Jika tidak bisa mengeluarkan kartu, pemain wajib mengambil kartu dari deck.',
      'Pemain yang menghabiskan kartunya duluan memenangkan ronde!'
    ]
  },
  {
    id: 'mau-mau', name: 'Mau-Mau', category: 'international', icon: '🗣',
    description: 'Permainan shedding populer Eropa dengan kartu aksi: 7 membuat lawan draw 2, Jack merubah lambang!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain mencocokkan kartu di tangan dengan kartu teratas meja berdasarkan suit atau rank.',
      'Kartu spesial memiliki efek dinamis: Angka 7 membuat pemain berikutnya draw 2 kartu, Angka 8 melompati (skip) pemain berikutnya, Jack bisa merubah jenis lambang kartu.',
      'Pemain pertama yang berhasil membuang seluruh kartunya memenangkan permainan.'
    ]
  },
  {
    id: 'gin-rummy', name: 'Gin Rummy', category: 'international', icon: '🍸',
    description: 'Duel kartu 2 pemain: susun kartu menjadi set dan seri untuk meminimalisir kartu mati (deadwood).',
    minPlayers: 2, maxPlayers: 2, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Dua pemain masing-masing memegang 10 kartu.',
      'Susun kartu menjadi Set (3 atau 4 kartu bernilai sama) dan Run (3+ kartu berurutan selambang).',
      'Kartu yang tidak masuk dalam kombinasi disebut "deadwood".',
      'Pemain dapat melakukan "Knock" jika deadwood bernilai 10 poin atau kurang, atau "Gin" jika deadwood bernilai 0.',
      'Pemain dengan skor deadwood terendah memenangkan poin selisih.'
    ]
  },
  {
    id: 'rummy', name: 'Classic Rummy', category: 'international', icon: '🂠',
    description: 'Permainan kartu keluarga klasik dunia untuk membentuk meld dan mengosongkan kartu tangan.',
    minPlayers: 2, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Pemain mengambil kartu dari deck atau discard pile setiap giliran.',
      'Letakkan kombinasi sah (Set dan Run) ke meja.',
      'Buang satu kartu ke tumpukan buangan di setiap akhir giliran.',
      'Pemain pertama yang kartunya habis keluar sebagai juara.'
    ]
  },
  {
    id: 'hearts', name: 'Hearts', category: 'international', icon: '♥',
    description: 'Permainan trik menghindari poin penalti: hindari mengambil kartu Hati dan Queen Sekop!',
    minPlayers: 4, maxPlayers: 4, duration: '20–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      '4 pemain masing-masing menerima 13 kartu.',
      'Setiap kartu Hati (♥) bernilai 1 poin penalti; Queen Sekop (Q♠) bernilai 13 poin penalti!',
      'Pemain wajib mengikuti jenis kartu pembuka jika memiliki jenis tersebut.',
      'Pemain dengan poin penalti terendah di akhir pertandingan adalah pemenang.',
      'Aturan Khusus "Shoot the Moon": jika berhasil mengambil SEMUA kartu hati dan Q♠, kamu mendapat 0 dan semua lawan mendapat 26 poin!'
    ]
  },
  {
    id: 'spades', name: 'Spades', category: 'international', icon: '♠',
    description: 'Permainan trik berpasangan legendaris di mana lambang Sekop selalu menjadi truf penakluk!',
    minPlayers: 4, maxPlayers: 4, duration: '20–40 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Sebelum bermain, pemain memprediksi (bid) berapa banyak trik yang akan dimenangkan.',
      'Kartu Sekop (♠) adalah kartu truf (mengalahkan semua jenis kartu lainnya).',
      'Pemain wajib mengikuti jenis kartu pembuka jika memiliki jenis tersebut.',
      'Capai atau lewati target bid untuk mendapatkan poin; gagal mencapai bid menghasilkan poin minus.'
    ]
  },
  {
    id: 'euchre', name: 'Euchre', category: 'international', icon: '🃎',
    description: 'Permainan trik cepat dengan deck 24 kartu (angka 9 hingga As).',
    minPlayers: 4, maxPlayers: 4, duration: '15–30 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Hanya menggunakan 24 kartu (angka 9, 10, J, Q, K, A dari tiap lambang).',
      'Jack dari suit truf menjadi "Right Bower" (kartu terkuat di game), dan Jack dengan warna sama menjadi "Left Bower".',
      'Tim berusaha memenangkan minimal 3 dari 5 trik yang ada untuk mendapatkan poin.',
      'Tim pertama yang mengumpulkan 10 poin keluar sebagai juara.'
    ]
  },
  {
    id: 'durak', name: 'Durak', category: 'international', icon: '🛡',
    description: 'Permainan kartu bertahan Rusia: serang lawan dengan kartu sama dan tangkis agar tidak menjadi Durak!',
    minPlayers: 2, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Sedang', status: 'available',
    rules: [
      'Satu kartu dibuka untuk menentukan jenis truf (trump suit).',
      'Pemain penyerang melempar kartu, pemain bertahan harus menangkis dengan kartu sejenis bernilai lebih tinggi atau kartu truf.',
      'Jika penangkis gagal, ia wajib mengambil seluruh kartu di meja.',
      'Tujuan permainan adalah menghabiskan seluruh kartu di tangan. Pemain terakhir yang masih memegang kartu adalah "Durak" (si pecundang).'
    ]
  },
  {
    id: 'president', name: 'President / Daifugo', category: 'international', icon: '👑',
    description: 'Permainan shedding adu kasta: pemain yang habis duluan menjadi Presiden, yang terakhir jadi Scum!',
    minPlayers: 3, maxPlayers: 4, duration: '10–20 mnt', difficulty: 'Mudah', status: 'available',
    rules: [
      'Pemain melempar kombinasi kartu (single, pair, triple) yang lebih tinggi dari kartu di meja.',
      'Pemain yang habis kartunya pertama menjadi Presiden (Pres).',
      'Pemain kedua menjadi Wakil Presiden, dan pemain terakhir menjadi Scum.',
      'Di ronde berikutnya, Presiden berhak menukar kartu terburuknya dengan kartu terbaik milik Scum!'
    ]
  },
  soon('domino-gaple', 'Domino Gaple', 'indonesia', '🁢', 'Permainan kartu domino balak khas Indonesia.', 2, 4, '10–20 mnt', 'Mudah')
];

export const catalogById = (id: string) => CATALOG.find(g => g.id === id);
