// screens/Home.tsx — dashboard lobby (tata letak profesional: nav atas, hero, aksi, katalog ringkas, sidebar).
import { useState } from 'react';
import { CATALOG, catalogById } from '@kuypoker/engine';
import type { Nav } from '../App';
import { useData, statsFor } from '../lib/store';
import { useYouTubePlayer, openMusicModal } from '../lib/youtubePlayer';
import { Modal } from '../components/ui';
import {
  WalletHeaderPill,
  LuckyWheelModal,
  QuestsModal,
  LeaderboardModal,
  StoreModal,
  AchievementsModal,
  FriendsModal,
  BackupRestoreModal,
} from '../components/gameModals';
import { MobileCompileModal } from '../components/MobileCompileModal';
import { AnimatedNumber } from '../components/effects';
import {
  IconPlay, IconGrid, IconPlus, IconLogIn, IconGift, IconTarget, IconAward, IconTrophy, IconUsers,
  IconMusic, IconHelp, IconSettings, IconChevron, IconShield, IconClock, IconStar,
} from '../components/icons';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function timeAgo(ts?: number) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export default function Home({ nav }: { nav: Nav }) {
  const profile = useData(d => d.profile);
  const favorites = useData(d => d.favorites);
  const history = useData(d => d.history);
  const eco = useData(d => d.economy);
  const friends = useData(d => d.friends);
  const session = useData(d => d.session);
  const settings = useData(d => d.settings);
  const yt = useYouTubePlayer();
  const isMusicPlaying = yt.isPlaying;

  const [joinOpen, setJoinOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [compileOpen, setCompileOpen] = useState(false);
  const [code, setCode] = useState('');

  const s = statsFor(history);
  const available = CATALOG.filter(g => g.status === 'available');
  // Favorit tampil lebih dulu, sisanya mengikuti urutan katalog.
  const games = [...available].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const pendingQuests = eco.quests.filter(q => q.completed && !q.claimed).length;
  const pendingAchievements = eco.achievements.filter(a => a.unlocked && !a.claimed).length;
  const onlineFriends = friends.filter(f => f.status !== 'offline').length;
  const xpNeed = eco.level * 300;
  const xpPct = Math.min(100, Math.round((eco.xp / xpNeed) * 100));
  // Sama dengan cooldown di LuckyWheelModal (12 jam).
  const spinReady = eco.lastSpinTime === 0 || Date.now() >= eco.lastSpinTime + 12 * 60 * 60 * 1000;

  // Main Cepat: Hold'em lawan 3 bot dengan pengaturan default.
  const quick = () => nav({ name: 'local', gameId: 'holdem', players: 4, options: {} });

  const activities = [
    { key: 'compile', icon: <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>📱</span>, tone: 'sky', title: 'Download & Pasang App', sub: 'APK Android & iPhone Ready', badge: 'Download APK', onClick: () => setCompileOpen(true) },
    { key: 'wheel', icon: <IconGift />, tone: 'terra', title: 'Roda Harian', sub: spinReady ? 'Siap diputar hari ini' : 'Sudah diputar · tunggu 12 jam', badge: spinReady ? 'Siap' : null, onClick: () => setWheelOpen(true) },
    { key: 'quest', icon: <IconTarget />, tone: 'sage', title: 'Misi Harian', sub: `${eco.quests.filter(q => q.completed).length}/${eco.quests.length} selesai`, badge: pendingQuests ? `${pendingQuests} hadiah` : null, onClick: () => setQuestsOpen(true) },
    { key: 'ach', icon: <IconAward />, tone: 'butter', title: 'Pencapaian', sub: `${eco.achievements.filter(a => a.unlocked).length}/${eco.achievements.length} terbuka`, badge: pendingAchievements ? `${pendingAchievements} baru` : null, onClick: () => setAchievementsOpen(true) },
    { key: 'rank', icon: <IconTrophy />, tone: 'sky', title: 'Peringkat', sub: 'Lihat posisi teratas', badge: null, onClick: () => setLeaderboardOpen(true) },
    { key: 'friends', icon: <IconUsers />, tone: 'sage', title: 'Teman', sub: `${onlineFriends} sedang online`, badge: null, onClick: () => setFriendsOpen(true) },
  ];

  return (
    <div className="dash">
      {/* ---------- Navigasi atas ---------- */}
      <header className="dash-nav">
        <div className="dash-brand">
          <img src="/favicon.svg" alt="" width={34} height={34} />
          <span>Card<b>ora</b></span>
        </div>

        <div className="dash-nav-right">
          <WalletHeaderPill onOpenStore={() => setStoreOpen(true)} />
          <div className="dash-iconbar" role="group" aria-label="Pintasan">
            <button 
              className="dash-iconbtn" 
              onClick={() => setCompileOpen(true)}
              aria-label="Download & Pasang Aplikasi" 
              title="📱 Download APK Android & Pasang di iPhone"
            >
              <span style={{ fontSize: 16 }}>📱</span>
            </button>
            <button 
              className={`dash-iconbtn${isMusicPlaying ? ' is-on' : ''}`} 
              onClick={() => openMusicModal()}
              aria-label="Pemutar Musik Kasino" 
              title={isMusicPlaying ? `🎵 Memutar: ${yt.currentTitle || 'YouTube Playlist'} (Klik untuk buka player)` : 'Buka Playlist Musik Kasino'}
            >
              <IconMusic size={18} />
              {isMusicPlaying && (
                <span className="music-playing-badge" aria-hidden="true" style={{ marginLeft: 3 }}>
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </button>
            <button className="dash-iconbtn" onClick={() => nav({ name: 'guide' })} aria-label="Panduan bermain" title="Panduan">
              <IconHelp size={18} />
            </button>
            <button className="dash-iconbtn" onClick={() => nav({ name: 'settings' })} aria-label="Pengaturan" title="Pengaturan">
              <IconSettings size={18} />
            </button>
          </div>
          <button className="dash-user" onClick={() => nav({ name: 'profile' })} aria-label="Profil & Level">
            <span className="avatar">{profile.avatar}</span>
            <span className="dash-user-text">
              <b>{profile.name}</b>
              <small>Level {eco.level} · {session.username ? 'Akun' : 'Tamu'}</small>
            </span>
          </button>
        </div>
      </header>

      <main className="dash-grid">
        {/* ---------- Kolom utama ---------- */}
        <div className="dash-main">
          <section className="dash-hero">
            <div className="dash-hero-copy">
              <span className="dash-eyebrow">{greeting()}, {profile.name}</span>
              <h1>Siap duduk di meja?</h1>
              <p>Lawan bot kapan saja, atau ajak teman bermain online dengan kode room. Chip virtual, tanpa uang asli.</p>
              <div className="dash-hero-actions">
                <button className="btn btn-gold btn-lg dash-cta" onClick={quick}>
                  <IconPlay size={18} /> Main Cepat
                  <small>Texas Hold'em · 4 pemain</small>
                </button>
                <button className="btn btn-lg" onClick={() => nav({ name: 'catalog' })}>
                  <IconGrid size={18} /> Semua Game ({available.length})
                </button>
                <button 
                  className="btn btn-lg" 
                  onClick={() => setCompileOpen(true)}
                  style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'var(--hair)' }}
                  title="Compile project ke aplikasi Android (APK) atau iOS (IPA)"
                >
                  <span style={{ fontSize: 16 }}>📱</span> Compile ke HP
                </button>
              </div>
            </div>
            <div className="dash-hero-art" aria-hidden="true">
              <div className="dash-fan">
                <span className="dash-card">A<i>♠</i></span>
                <span className="dash-card red">K<i>♥</i></span>
                <span className="dash-card">Q<i>♣</i></span>
              </div>
            </div>
          </section>

          <section className="dash-section">
            <div className="dash-section-head">
              <h2>Main bersama teman</h2>
              <span>Room privat dengan kode 6 karakter</span>
            </div>
            <div className="dash-two">
              <button className="dash-tile" onClick={() => nav({ name: 'online', create: 'holdem' })}>
                <span className="dash-tile-icon tone-terra"><IconPlus /></span>
                <span className="dash-tile-text"><b>Buat Room</b><small>Jadi host, atur game & undang teman</small></span>
                <IconChevron className="dash-chev" size={18} />
              </button>
              <button className="dash-tile" onClick={() => setJoinOpen(true)}>
                <span className="dash-tile-icon tone-sky"><IconLogIn /></span>
                <span className="dash-tile-text"><b>Gabung Room</b><small>Masukkan kode dari temanmu</small></span>
                <IconChevron className="dash-chev" size={18} />
              </button>
            </div>
          </section>

          <section className="dash-section">
            <div className="dash-section-head">
              <h2>Game tersedia</h2>
              <button className="dash-link" onClick={() => nav({ name: 'catalog' })}>Lihat katalog <IconChevron size={14} /></button>
            </div>
            <div className="dash-games">
              {games.map(g => (
                <button key={g.id} className="dash-game" onClick={() => nav({ name: 'setup', gameId: g.id })}>
                  <span className="dash-game-icon">{g.icon}</span>
                  <span className="dash-game-body">
                    <b>{g.name}{favorites.includes(g.id) && <IconStar className="dash-fav" size={13} />}</b>
                    <small>{g.minPlayers}–{g.maxPlayers} pemain · {g.duration}</small>
                  </span>
                  <span className="dash-game-tag">{g.difficulty}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* ---------- Sidebar ---------- */}
        <aside className="dash-side">
          <section className="dash-card-box">
            <div className="dash-level">
              <div>
                <small>Level</small>
                <b>{eco.level}</b>
              </div>
              <div className="dash-level-bar">
                <div className="xp-bar"><i style={{ width: `${xpPct}%` }} /></div>
                <small>{eco.xp.toLocaleString('id-ID')} / {xpNeed.toLocaleString('id-ID')} XP</small>
              </div>
            </div>
            <div className="dash-stats">
              <div><b><AnimatedNumber value={s.played} /></b><small>Permainan</small></div>
              <div><b><AnimatedNumber value={s.wins} /></b><small>Juara 1</small></div>
              <div><b>{s.rate}%</b><small>Rasio menang</small></div>
            </div>
          </section>

          <section className="dash-card-box dash-pad0">
            <h3 className="dash-box-title">Hadiah & aktivitas</h3>
            <ul className="dash-list">
              {activities.map(a => (
                <li key={a.key}>
                  <button onClick={a.onClick}>
                    <span className={`dash-list-icon tone-${a.tone}`}>{a.icon}</span>
                    <span className="dash-list-text"><b>{a.title}</b><small>{a.sub}</small></span>
                    {a.badge && <span className="dash-pill">{a.badge}</span>}
                    <IconChevron className="dash-chev" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {!session.username ? (
            <section className="dash-card-box dash-note">
              <span className="dash-list-icon tone-butter"><IconShield /></span>
              <div>
                <b>Kamu bermain sebagai tamu</b>
                <p>Tautkan akun agar progres aman di semua perangkat, plus bonus 25.000 chip.</p>
                <button className="btn btn-sm" onClick={() => nav({ name: 'auth', mode: 'register' })}>Tautkan akun</button>
              </div>
            </section>
          ) : (
            <section className="dash-card-box dash-note">
              <span className="dash-list-icon tone-sage"><IconShield /></span>
              <div>
                <b>Akun {session.username}</b>
                <p>Simpan cadangan progres secara mandiri kapan saja.</p>
                <button className="btn btn-sm" onClick={() => setBackupOpen(true)}>Cadangkan</button>
              </div>
            </section>
          )}

          <section className="dash-card-box dash-pad0">
            <h3 className="dash-box-title">Riwayat terakhir</h3>
            {history.length ? (
              <ul className="dash-history">
                {history.slice(0, 5).map((h, i) => (
                  <li key={i}>
                    <span className="dash-hist-icon">{catalogById(h.gameId)?.icon}</span>
                    <span className="dash-list-text">
                      <b>{catalogById(h.gameId)?.name}</b>
                      <small>{h.mode === 'bot' ? 'vs Bot' : 'Online'} · {h.players} pemain{h.at ? ` · ${timeAgo(h.at)}` : ''}</small>
                    </span>
                    <span className={`dash-rank${h.rank === 1 ? ' win' : ''}`}>{h.rank === 1 ? 'Juara' : `#${h.rank}`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dash-empty">
                <IconClock size={22} />
                <p>Belum ada pertandingan.</p>
                <button className="dash-link" onClick={quick}>Mulai Main Cepat <IconChevron size={14} /></button>
              </div>
            )}
          </section>
        </aside>
      </main>

      <footer className="dash-foot">{available.length} game aktif · Chip virtual tanpa nilai uang</footer>

      {/* Join Room Modal */}
      {joinOpen && (
        <Modal title="Gabung Room Teman" onClose={() => setJoinOpen(false)}>
          <form className="stack" onSubmit={e => { e.preventDefault(); if (code.length === 6) nav({ name: 'online', join: code }); }}>
            <label className="muted small" htmlFor="code">Masukkan 6 karakter kode undangan dari temanmu</label>
            <input
              id="code"
              className="input code-input"
              autoFocus
              maxLength={6}
              autoComplete="off"
              inputMode="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="ABC123"
            />
            <button className="btn btn-gold btn-lg" disabled={code.length !== 6}>Gabung Meja</button>
          </form>
        </Modal>
      )}

      {wheelOpen && <LuckyWheelModal onClose={() => setWheelOpen(false)} />}
      {questsOpen && <QuestsModal onClose={() => setQuestsOpen(false)} />}
      {friendsOpen && (
        <FriendsModal
          onClose={() => setFriendsOpen(false)}
          onCreateRoom={() => nav({ name: 'online', create: 'holdem' })}
        />
      )}
      {achievementsOpen && <AchievementsModal onClose={() => setAchievementsOpen(false)} />}
      {leaderboardOpen && <LeaderboardModal onClose={() => setLeaderboardOpen(false)} />}
      {storeOpen && <StoreModal onClose={() => setStoreOpen(false)} />}
      {backupOpen && <BackupRestoreModal onClose={() => setBackupOpen(false)} />}
      {compileOpen && <MobileCompileModal onClose={() => setCompileOpen(false)} />}
    </div>
  );
}
