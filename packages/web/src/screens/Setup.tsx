// screens/Setup.tsx — pilih mode (vs Bot / Online), jumlah pemain, kesulitan bot, opsi game.
import { useState } from 'react';
import { catalogById, getGame, CATEGORY_LABEL } from '@kuypoker/engine';
import type { Nav } from '../App';
import { useData, update } from '../lib/store';
import { OptionsForm, RulesModal, TopBar } from '../components/ui';
import {
  IconBook,
  IconPlay,
  IconUsers,
  IconClock,
  IconAward,
  IconCheck,
  IconShield,
  IconSparkles,
  IconTrophy,
} from '../components/icons';

const ROUND_FORMATS = [
  { count: 1, label: '1 Ronde', desc: 'Kilat & Cepat Selesai', icon: '⚡', tag: null },
  { count: 3, label: '3 Ronde', desc: 'Best of 3 (Seimbang)', icon: '🏆', tag: 'Populer' },
  { count: 5, label: '5 Ronde', desc: 'Seri Kompetitif', icon: '🎖️', tag: null },
  { count: 7, label: '7 Ronde', desc: 'Turnamen Penuh', icon: '👑', tag: null },
  { count: 0, label: 'Bebas', desc: 'Tanpa Batas Ronde', icon: '♾️', tag: 'Santai' },
];

const BOT_DIFFICULTIES = [
  {
    id: 'easy' as const,
    title: 'Mudah',
    badge: 'Santai',
    dotColor: '#22C55E',
    desc: 'Bermain aman, jarang gertak (bluff). Pas untuk pemula & belajar alur.',
  },
  {
    id: 'normal' as const,
    title: 'Normal',
    badge: 'Disarankan',
    dotColor: '#F59E0B',
    desc: 'Strategi standar kasino, membaca situasi meja dengan logis & terukur.',
  },
  {
    id: 'hard' as const,
    title: 'Sulit',
    badge: 'Pro / Master',
    dotColor: '#EF4444',
    desc: 'Agresif, kalkulasi pot odds tajam, lihai memancing perangkap & bluff.',
  },
];

export default function Setup({ nav, gameId }: { nav: Nav; gameId: string }) {
  const entry = catalogById(gameId)!;
  const mod = getGame(gameId)!;
  const difficulty = useData(d => d.settings.botDifficulty);
  const minSeats = Math.max(2, mod.minPlayers);
  const maxSeats = mod.maxPlayers;
  const [players, setPlayers] = useState(Math.min(4, maxSeats));
  const [options, setOptions] = useState<Record<string, unknown>>({ ...mod.defaultOptions });
  const [targetRounds, setTargetRounds] = useState<number>(3);
  const [rules, setRules] = useState(false);
  const counts = Array.from({ length: maxSeats - minSeats + 1 }, (_, i) => minSeats + i);
  if (mod.minPlayers === 1) counts.unshift(1);
  const label = (n: number) => (n === 1 ? 'Solo' : n === 2 ? 'Duo' : n === 3 ? 'Trio' : `${n} Pemain`);

  const isHoldem = gameId === 'holdem';
  const currentStack = Number(options.startingStack ?? 1000);
  const currentBB = Number(options.bigBlind ?? 20);
  const activePreset = isHoldem
    ? currentStack === 500 && currentBB === 10
      ? 'casual'
      : currentStack === 1000 && currentBB === 20
        ? 'standard'
        : currentStack === 5000 && currentBB === 100
          ? 'highroller'
          : null
    : null;

  const applyPreset = (preset: 'casual' | 'standard' | 'highroller') => {
    if (preset === 'casual') {
      setOptions(o => ({ ...o, startingStack: 500, bigBlind: 10 }));
    } else if (preset === 'standard') {
      setOptions(o => ({ ...o, startingStack: 1000, bigBlind: 20 }));
    } else if (preset === 'highroller') {
      setOptions(o => ({ ...o, startingStack: 5000, bigBlind: 100 }));
    }
  };

  const botCount = Math.max(0, players - 1);

  return (
    <div className="page" style={{ maxWidth: 700 }}>
      <TopBar
        title={entry.name}
        onBack={() => nav({ name: 'catalog' })}
        right={
          <button className="btn btn-sm" onClick={() => setRules(true)}>
            <IconBook size={15} /> Aturan
          </button>
        }
      />

      {/* 1. Game Overview Hero Card */}
      <div className="setup-hero-card">
        <div className="setup-hero-emblem" aria-hidden="true">
          {entry.icon}
        </div>
        <div className="setup-hero-body">
          <div className="setup-hero-title-row">
            <h1 className="setup-hero-title">{entry.name}</h1>
            <div className="setup-hero-badges">
              <span className="setup-hero-badge category">
                {CATEGORY_LABEL[entry.category] ?? 'Game Kartu'}
              </span>
              <span className="setup-hero-badge">
                <IconClock size={12} /> {entry.duration}
              </span>
              <span className="setup-hero-badge">
                <IconAward size={12} /> {entry.difficulty}
              </span>
            </div>
          </div>
          <p className="setup-hero-desc">{entry.description}</p>
        </div>
      </div>

      {/* 2. Format Pertandingan (Sistem Ronde) */}
      <div className="setup-section">
        <div className="setup-section-head">
          <h2 className="setup-section-title">
            <IconTrophy size={16} /> Format Pertandingan (Sistem Ronde)
          </h2>
          <span className="setup-section-subtitle">Tentukan target kemenangan</span>
        </div>
        <div className="setup-round-grid">
          {ROUND_FORMATS.map(r => {
            const isActive = targetRounds === r.count;
            return (
              <button
                key={r.count}
                type="button"
                className={`setup-round-card ${isActive ? 'is-active' : ''}`}
                onClick={() => setTargetRounds(r.count)}
                aria-pressed={isActive}
              >
                {r.tag && <span className="setup-round-tag">{r.tag}</span>}
                <span className="setup-round-icon">{r.icon}</span>
                <span className="setup-round-title">{r.label}</span>
                <span className="setup-round-desc">{r.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Jumlah Pemain (Kamu + Bot) */}
      <div className="setup-section">
        <div className="setup-section-head">
          <h2 className="setup-section-title">
            <IconUsers size={16} /> Jumlah Pemain di Meja
          </h2>
          <span className="setup-section-subtitle">Total kursi aktif (Kamu + Bot AI)</span>
        </div>
        <div className="setup-seat-grid">
          {counts.map(n => {
            const isActive = players === n;
            return (
              <button
                key={n}
                type="button"
                className={`setup-seat-card ${isActive ? 'is-active' : ''}`}
                onClick={() => setPlayers(n)}
                aria-pressed={isActive}
              >
                <span className="setup-seat-num">{n}</span>
                <span className="setup-seat-label">{label(n)}</span>
              </button>
            );
          })}
        </div>

        {/* Visual Composition Indicator */}
        <div className="setup-seat-roster">
          <div className="setup-seat-roster-left">
            <span>Komposisi Meja:</span>
            <span style={{ color: '#9A4325' }}>
              1 Kamu + {botCount > 0 ? `${botCount} Lawan Bot AI` : 'Main Sendiri'}
            </span>
          </div>
          <div className="setup-seat-roster-icons">
            <span title="Kamu (Pemain)">👤</span>
            {Array.from({ length: botCount }).map((_, i) => (
              <span key={i} title={`Bot Lawan ${i + 1}`}>🤖</span>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Kesulitan Bot AI */}
      <div className="setup-section">
        <div className="setup-section-head">
          <h2 className="setup-section-title">
            <IconShield size={16} /> Tingkat Kesulitan Bot AI
          </h2>
          <span className="setup-section-subtitle">Kecerdasan & gaya bermain bot</span>
        </div>
        <div className="setup-bot-grid">
          {BOT_DIFFICULTIES.map(d => {
            const isActive = difficulty === d.id;
            return (
              <button
                key={d.id}
                type="button"
                className={`setup-bot-card ${isActive ? 'is-active' : ''}`}
                onClick={() => update(x => { x.settings.botDifficulty = d.id; })}
                aria-pressed={isActive}
              >
                <div className="setup-bot-head">
                  <div className="setup-bot-title-wrap">
                    <span
                      className="setup-bot-dot"
                      style={{ background: d.dotColor, boxShadow: `0 0 0 2px ${d.dotColor}33` }}
                    />
                    <span className="setup-bot-title">{d.title}</span>
                  </div>
                  <span className="setup-bot-badge">{d.badge}</span>
                </div>
                <p className="setup-bot-desc">{d.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Pengaturan Permainan */}
      {mod.options.length > 0 && (
        <div className="setup-section">
          <div className="setup-section-head">
            <h2 className="setup-section-title">
              <IconSparkles size={16} /> Pengaturan Taruhan & Aturan
            </h2>
            <span className="setup-section-subtitle">Sesuaikan chip & limit meja</span>
          </div>
          <div className="card-box" style={{ borderRadius: 18, padding: 18 }}>
            {/* Quick Presets for Poker / Hold'em */}
            {isHoldem && (
              <div className="setup-preset-row">
                <span className="small muted" style={{ fontWeight: 700 }}>Preset Cepat:</span>
                <button
                  type="button"
                  className={`setup-preset-pill ${activePreset === 'casual' ? 'is-active' : ''}`}
                  onClick={() => applyPreset('casual')}
                >
                  ☕ Santai (500 Chip / BB 10)
                </button>
                <button
                  type="button"
                  className={`setup-preset-pill ${activePreset === 'standard' ? 'is-active' : ''}`}
                  onClick={() => applyPreset('standard')}
                >
                  ⚖️ Standar (1.000 Chip / BB 20)
                </button>
                <button
                  type="button"
                  className={`setup-preset-pill ${activePreset === 'highroller' ? 'is-active' : ''}`}
                  onClick={() => applyPreset('highroller')}
                >
                  💎 High Roller (5.000 Chip / BB 100)
                </button>
              </div>
            )}

            <OptionsForm
              specs={mod.options}
              values={options}
              onChange={(k, v) => setOptions(o => ({ ...o, [k]: v }))}
            />
          </div>
        </div>
      )}

      {/* 6. Launch Actions */}
      <div className="setup-launch-box">
        <div className="setup-summary-bar">
          <div className="setup-summary-title">
            Siap bermain: <b>{entry.name}</b> · {label(players)} · {targetRounds === 0 ? 'Tanpa Batas' : `${targetRounds} Ronde`}
          </div>
          <div className="setup-summary-meta">
            Bot {difficulty === 'easy' ? 'Mudah' : difficulty === 'normal' ? 'Normal' : 'Sulit'}
          </div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <button
            className="btn btn-gold btn-lg btn-block"
            onClick={() => nav({ name: 'local', gameId, players, options: { ...mod.sanitizeOptions(options), targetRounds } })}
          >
            <IconPlay size={18} />
            {options.passAndPlay
              ? `Mulai Game (Operan HP · ${targetRounds === 0 ? 'Tanpa Batas' : `${targetRounds} Ronde`})`
              : `Main vs Bot Sekarang (${label(players)} · ${targetRounds === 0 ? 'Tanpa Batas' : `${targetRounds} Ronde`})`}
          </button>
          <button
            className="btn btn-emerald btn-lg btn-block"
            onClick={() => nav({ name: 'online', create: gameId })}
          >
            <IconUsers size={18} /> Main Bareng Teman (Buat Room Online)
          </button>
        </div>
      </div>

      {rules && <RulesModal gameId={gameId} onClose={() => setRules(false)} />}
    </div>
  );
}
