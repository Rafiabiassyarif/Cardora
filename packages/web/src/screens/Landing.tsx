// screens/Landing.tsx — halaman pembuka: kenalkan game, lalu Masuk / Daftar / Google / Tamu.
import { useState, type CSSProperties } from 'react';
import { CATALOG } from '@kuypoker/engine';
import type { Nav, Route } from '../App';
import { GoogleButton } from '../components/GoogleButton';
import { MobileCompileModal } from '../components/MobileCompileModal';
import { continueAsGuest } from '../lib/auth';
import { play } from '../lib/sound';
import { IconLogIn, IconPlay, IconSparkles } from '../components/icons';

const FEATURES = [
  { icon: '🤖', title: 'Lawan Bot Pintar', text: 'Main offline kapan saja dengan 3 tingkat kesulitan.' },
  { icon: '👥', title: 'Room Bareng Teman', text: 'Buat room, bagikan kode, main real-time online.' },
  { icon: '🎡', title: 'Roda Hoki Harian', text: 'Putar gratis tiap 12 jam, menangkan sampai 25.000 chip.' },
  { icon: '🏆', title: 'Misi & Lencana', text: 'Naik level, buka lencana, dan puncaki papan peringkat.' },
];

const HERO_CARDS = [
  { r: 'A', s: '♠', red: false, rot: -18, x: -88, y: 14, d: 0 },
  { r: 'K', s: '♥', red: true, rot: -6, x: -30, y: -6, d: 0.4 },
  { r: 'Q', s: '♦', red: true, rot: 7, x: 30, y: -6, d: 0.8 },
  { r: 'J', s: '♣', red: false, rot: 19, x: 88, y: 14, d: 1.2 },
];

export default function Landing({ nav, next }: { nav: Nav; next?: Route }) {
  const games = CATALOG.filter(g => g.status === 'available');
  const goNext = () => nav(next ?? { name: 'home' });
  const guest = () => { play('click'); continueAsGuest(); goNext(); };
  // Pasang app di HP (APK Android / iPhone) — dipindah dari beranda ke landing.
  const [compileOpen, setCompileOpen] = useState(false);
  const openCompile = () => { play('click'); setCompileOpen(true); };

  return (
    <div className="landing">
      <div className="landing-glow" aria-hidden="true" />

      <header className="landing-nav">
        <div className="landing-brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>Card<b>ora</b></span>
        </div>
        <div className="landing-nav-actions">
          <button className="lbtn lbtn-ghost" onClick={openCompile} title="Download APK Android & pasang di iPhone">
            📱 Pasang di HP
          </button>
          <button className="lbtn lbtn-ghost" onClick={() => nav({ name: 'auth', mode: 'login', next })}>Masuk</button>
          <button className="lbtn lbtn-gold" onClick={() => nav({ name: 'auth', mode: 'register', next })}>Daftar</button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="hero-copy">
            <div className="hero-kicker-wrap">
              <span className="hero-kicker">
                <span className="kicker-dot" /> Gratis · Chip virtual · Tanpa uang asli
              </span>
              <span className="hero-tag-free">100% BEBAS TARUHAN</span>
            </div>
            <h1>
              Pilih Kartumu.<br />
              <span className="hero-accent">Ajak Tim.</span> Mulai Main!
            </h1>
            <p className="hero-sub">
              Texas Hold'em, Poker Tongkrongan, Cangkulan, Blackjack dan lainnya — lawan bot atau tantang temanmu secara online.
            </p>

            <div className="hero-auth" role="group" aria-label="Pilih cara masuk">
              <GoogleButton onSuccess={goNext} label="Lanjut dengan Google" />
              <div className="hero-auth-row">
                <button className="lbtn lbtn-blue lbtn-lg" onClick={() => nav({ name: 'auth', mode: 'login', next })}>
                  <IconLogIn size={18} /> Masuk
                </button>
                <button className="lbtn lbtn-green lbtn-lg" onClick={() => nav({ name: 'auth', mode: 'register', next })}>
                  <IconSparkles size={18} /> Daftar
                </button>
              </div>
              <div className="or-sep"><span>atau</span></div>
              <button className="lbtn lbtn-gold lbtn-lg lbtn-block" onClick={guest}>
                <IconPlay size={20} /> Main sebagai Tamu
              </button>
              <button className="lbtn hero-app-btn lbtn-block" onClick={openCompile} title="Download APK Android & pasang di iPhone">
                <span className="hero-app-btn-icon">📲</span>
                <div className="hero-app-btn-text">
                  <b>Pasang Aplikasi di HP</b>
                  <small>Download APK Android & iPhone</small>
                </div>
                <span className="hero-app-badge">GRATIS</span>
              </button>
              <p className="hero-note">Tamu: progres tersimpan di perangkat ini. Tautkan akun kapan saja agar aman.</p>
            </div>
          </div>

          <div className="hero-art" aria-hidden="true" data-tilt>
            <div className="hero-badge-float top-left">
              <span className="hbf-icon">👑</span>
              <div className="hbf-text">
                <b>VIP Lounge</b>
                <small>Fair play & real-time</small>
              </div>
            </div>

            <div className="hero-table">
              {HERO_CARDS.map((c, i) => (
                <div key={i} className={`hero-card${c.red ? ' red' : ''}`}
                  style={{ '--rot': `${c.rot}deg`, '--x': `${c.x}px`, '--y': `${c.y}px`, '--d': `${c.d}s` } as CSSProperties}>
                  <span className="hc-r">{c.r}</span>
                  <span className="hc-s">{c.s}</span>
                  <span className="hc-big">{c.s}</span>
                </div>
              ))}
              <div className="hero-chips">
                <i className="chip-c red">500</i>
                <i className="chip-c blue">100</i>
                <i className="chip-c gold">1K</i>
              </div>
            </div>

            <div className="hero-badge-float bottom-right">
              <span className="hbf-icon">🛡️</span>
              <div className="hbf-text">
                <b>100% Hiburan</b>
                <small>Tanpa deposit uang asli</small>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="games-title">
          <h2 id="games-title">Game yang bisa dimainkan</h2>
          <div className="landing-games">
            {games.map(g => (
              <article key={g.id} className="lgame">
                <div className="lgame-icon">{g.icon}</div>
                <div className="lgame-body">
                  <b>{g.name}</b>
                  <span>{g.description}</span>
                  <div className="lgame-meta">
                    <em>👥 {g.minPlayers === g.maxPlayers ? g.minPlayers : `${g.minPlayers}–${g.maxPlayers}`}</em>
                    <em>⏱ {g.duration}</em>
                    <em>📊 {g.difficulty}</em>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="feat-title">
          <h2 id="feat-title">Kenapa Cardora?</h2>
          <div className="landing-features">
            {FEATURES.map(f => (
              <div key={f.title} className="lfeat">
                <span className="lfeat-icon">{f.icon}</span>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-cta">
          <h2>Siap ke meja?</h2>
          <button className="lbtn lbtn-gold lbtn-lg" onClick={guest}>🎮 Main Sekarang</button>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Cardora</span>
        <span>Hanya hiburan — chip virtual tidak bisa ditukar uang.</span>
      </footer>

      {compileOpen && <MobileCompileModal onClose={() => setCompileOpen(false)} />}
    </div>
  );
}
