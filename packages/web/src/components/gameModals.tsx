// gameModals.tsx — Fitur game interaktif: Roda Hoki (Lucky Spin), Misi Harian (Quests),
// Papan Peringkat (Leaderboard), Toko & Bank Chip Gratis (Store), dan Emote Meja.
import { useState, useEffect, useRef } from 'react';
import { Modal } from './ui';
import { 
  useData, 
  claimDailyBonus, 
  claimHourlyBonus, 
  spinLuckyWheel, 
  claimQuest, 
  claimBankruptcyRefill,
  BANKRUPT_LIMIT,
  refillsLeftToday,
  claimAchievement,
  rebuyChips,
  trackAchievement,
  getData,
  exportProgressBackup,
  importProgressBackup,
  downloadBackupFile,
  setFeltTheme,
  setCardTheme,
  type FeltTheme,
  type CardTheme,
  type Achievement,
} from '../lib/store';
import { play } from '../lib/sound';
import { useFriends, searchUsers, addFriendById, removeFriendById, fetchLeaderboard, type FriendRow, type SearchRow, type RankRow } from '../lib/friends';
import { AnimatedNumber } from './effects';
import { IconChat,
  IconCheck,
  IconCopy,
  IconDownload,
  IconPlus,
  IconSave,
  IconSearch,
  IconUsers,
  IconUserPlus,
  IconX,
} from './icons';

/* ==========================================================================
   1. Wallet Header Pill & Quick Icons
   ========================================================================== */
export function WalletHeaderPill({ onOpenStore }: { onOpenStore: () => void }) {
  const eco = useData(d => d.economy);
  return (
    <button className="wallet-pill" onClick={onOpenStore} aria-label="Buka Toko & Bank Chip">
      <span className="chip-icon">🪙</span>
      <span className="chip-amount"><AnimatedNumber value={eco.chips} duration={900} /></span>
      <span className="wallet-add-btn" aria-hidden="true">+</span>
    </button>
  );
}

/* ==========================================================================
   2. Lucky Wheel (Roda Keberuntungan / Spin Harian)
   ========================================================================== */
const WHEEL_REWARDS = [
  { label: '500', value: 500, color: '#F6E3D8' },
  { label: '1.000', value: 1000, color: '#E2EEE4' },
  { label: '2.500', value: 2500, color: '#F5E3BC' },
  { label: '5.000', value: 5000, color: '#E3ECF4' },
  { label: '1.500', value: 1500, color: '#F7E2DF' },
  { label: '10.000', value: 10000, color: '#E8F0DC' },
  { label: '2.000', value: 2000, color: '#EFE7DA' },
  { label: '25.000 ★', value: 25000, color: '#F3D9C4' },
];

/** Sektor roda tepat 360/N derajat (conic-gradient) — mulai dari arah jam 12, searah jarum jam.
 *  Sektor i berpusat di i*slice + slice/2, sama dengan rumus target rotasi di spin(). */
const WHEEL_SLICE = 360 / WHEEL_REWARDS.length;
const WHEEL_BG = `conic-gradient(from 0deg, ${WHEEL_REWARDS.map((r, i) => `${r.color} ${i * WHEEL_SLICE}deg ${(i + 1) * WHEEL_SLICE}deg`).join(', ')})`;

export function LuckyWheelModal({ onClose }: { onClose: () => void }) {
  const eco = useData(d => d.economy);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [won, setWon] = useState<number | null>(null);
  
  const now = Date.now();
  const cooldown = 12 * 60 * 60 * 1000;
  const nextSpin = eco.lastSpinTime + cooldown;
  const canSpin = now >= nextSpin || eco.lastSpinTime === 0;

  const spin = () => {
    if (spinning || !canSpin) return;
    setSpinning(true);
    setWon(null);
    play('chip');

    // Random prize index
    const prizeIndex = Math.floor(Math.random() * WHEEL_REWARDS.length);
    const sliceAngle = 360 / WHEEL_REWARDS.length;
    // Rotate 5 to 7 full circles + slice offset
    const extraRotations = (5 + Math.floor(Math.random() * 3)) * 360;
    const targetRotation = rotation + extraRotations + (360 - (prizeIndex * sliceAngle + sliceAngle / 2));
    
    setRotation(targetRotation);

    setTimeout(() => {
      const prize = WHEEL_REWARDS[prizeIndex].value;
      setWon(prize);
      spinLuckyWheel(prize);
      setSpinning(false);
      play('win');
    }, 4000);
  };

  return (
    <Modal title="Roda Keberuntungan Harian" onClose={onClose}>
      <div className="wheel-modal-content">
        <p className="muted small center" style={{ margin: '0 0 16px' }}>
          Putar roda hoki setiap 12 jam untuk memenangkan hingga <b>25.000 Chip</b> & XP!
        </p>

        <div className="wheel-container">
          <div className="wheel-pointer" />
          <div 
            className="wheel-disc" 
            style={{ 
              background: WHEEL_BG,
              transform: `rotate(${rotation}deg)`, 
              transition: spinning ? 'transform 4s cubic-bezier(0.15, 0.9, 0.2, 1)' : 'none' 
            }}
          >
            {WHEEL_REWARDS.map((r, i) => (
              <div key={i} className="wheel-label" style={{ transform: `rotate(${i * WHEEL_SLICE + WHEEL_SLICE / 2}deg)` }}>
                <span className="slice-text">{r.label}</span>
              </div>
            ))}
          </div>
          <button className="wheel-hub" onClick={spin} disabled={spinning || !canSpin}>
            {spinning ? '…' : 'SPIN!'}
          </button>
        </div>

        {won !== null && (
          <div className="winner-banner" style={{ margin: '18px auto 0' }}>
            🎉 Selamat! Kamu mendapatkan <b>+{won.toLocaleString('id-ID')} Chip</b> & +50 XP!
          </div>
        )}

        <div className="row" style={{ marginTop: 20, justifyContent: 'center' }}>
          <button 
            className="btn btn-gold btn-lg grow" 
            onClick={spin} 
            disabled={spinning || !canSpin}
          >
            {spinning ? 'Memutar…' : canSpin ? '🎡 Putar Roda Sekarang (Gratis)' : 'Tunggu Putaran Berikutnya'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   3. Quests & Daily Missions Modal
   ========================================================================== */
export function QuestsModal({ onClose }: { onClose: () => void }) {
  const quests = useData(d => d.economy.quests);
  const eco = useData(d => d.economy);

  const handleClaim = (id: string) => {
    const ok = claimQuest(id);
    if (ok) play('win');
  };

  const completedCount = quests.filter(q => q.completed && !q.claimed).length;

  return (
    <Modal title="📜 Misi & Tugas Harian" onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">Tingkatkan Level & Raih Hadiah</span>
          <span className="badge ok">Level {eco.level} · {eco.vipTier} VIP</span>
        </div>

        {/* Level XP Bar */}
        <div className="card-box stack" style={{ padding: '12px 16px', gap: 6 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span><b>Level {eco.level}</b> ({eco.vipTier})</span>
            <span className="muted">{eco.xp} / {eco.level * 300} XP</span>
          </div>
          <div className="xp-bar">
            <i style={{ width: `${Math.min(100, (eco.xp / (eco.level * 300)) * 100)}%` }} />
          </div>
        </div>

        {/* Quests List */}
        <div className="stack" style={{ gap: 10 }}>
          {quests.map(q => {
            const pct = Math.min(100, (q.current / q.target) * 100);
            return (
              <div key={q.id} className="quest-card">
                <div className="quest-icon">{q.icon}</div>
                <div className="grow stack" style={{ gap: 4 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{q.title}</b>
                    <span className="small muted font-display">{q.current}/{q.target}</span>
                  </div>
                  <span className="small muted">{q.desc}</span>
                  <div className="quest-progress-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="row small" style={{ gap: 8, marginTop: 2 }}>
                    <span className="reward-tag">🪙 +{q.rewardChips.toLocaleString('id-ID')}</span>
                    <span className="reward-tag">⭐ +{q.rewardXp} XP</span>
                  </div>
                </div>

                <div className="quest-action">
                  {q.claimed ? (
                    <span className="badge soon">✓ Diklaim</span>
                  ) : q.completed ? (
                    <button className="btn btn-gold" onClick={() => handleClaim(q.id)}>
                      Klaim
                    </button>
                  ) : (
                    <span className="badge soon">{Math.round(pct)}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   4. Leaderboard Modal — dari pertandingan online yang tercatat di server
   ========================================================================== */
export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const session = useData(d => d.session);
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchLeaderboard().then(setRows).catch(e => setErr((e as Error).message)); }, []);

  return (
    <Modal title="🏆 Papan Peringkat" onClose={onClose}>
      <div className="stack">
        <p className="muted small center" style={{ margin: '0 0 10px' }}>
          Peringkat pemain terdaftar berdasarkan kemenangan di meja online.
        </p>
        {err && <span className="error-text center">{err}</span>}
        {!rows && !err && <span className="muted small center">Memuat peringkat…</span>}
        {rows && rows.length === 0 && (
          <div className="card-box stack center" style={{ padding: '22px 18px' }}>
            <span className="muted small">Belum ada pertandingan online yang tercatat.</span>
            <span className="muted small">Main di room online dengan akun terdaftar untuk masuk peringkat.</span>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="stack" style={{ gap: 8, maxHeight: '55vh', overflowY: 'auto' }}>
            {rows.map(p => {
              const me = p.username === session.username;
              return (
                <div key={p.id} className={`result-row${p.rank === 1 ? ' first' : ''}`}
                  style={{ padding: '8px 12px', background: me ? 'var(--terra-soft)' : 'var(--paper-2)', borderRadius: 12 }}>
                  <span className="rank">{p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</span>
                  <span className="avatar">{p.avatar}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{p.displayName}{me ? ' (kamu)' : ''}</b>
                    <div className="small muted">@{p.username}</div>
                  </div>
                  <span className="small" style={{ fontWeight: 800 }}>{p.wins} menang / {p.played} main</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ==========================================================================
   5. Virtual Chip Store & Bank Modal
   ========================================================================== */
export function StoreModal({ onClose }: { onClose: () => void }) {
  const eco = useData(d => d.economy);
  const [msg, setMsg] = useState<string | null>(null);
  // Detik berjalan agar label hitung mundur ikut diperbarui.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const dailyLeft = Math.max(0, eco.lastDailyClaim + 24 * 3600 * 1000 - now);
  const hourlyLeft = Math.max(0, eco.lastHourlyClaim + 3600 * 1000 - now);
  const refills = refillsLeftToday(eco);
  const broke = eco.chips < BANKRUPT_LIMIT;
  const fmtLeft = (ms: number) => {
    const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h > 0 ? `${h}j ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
  };

  const handleDaily = () => {
    const res = claimDailyBonus();
    if (res.ok) {
      setMsg(`🎉 Berhasil klaim +${res.chips.toLocaleString('id-ID')} Chip bonus harian!`);
      play('win');
    }
  };

  const handleHourly = () => {
    const res = claimHourlyBonus();
    if (res.ok) {
      setMsg(`🎉 Berhasil klaim +${res.chips.toLocaleString('id-ID')} Chip bonus berkala!`);
      play('chip');
    }
  };

  const handleBankruptcy = () => {
    const res = claimBankruptcyRefill();
    if (res.ok) {
      setMsg(`🛡️ Bantuan Kebangkrutan: +${res.chips.toLocaleString('id-ID')} Chip ditambahkan! Sisa hari ini: ${Math.max(0, refills - 1)}x.`);
      play('chip');
    } else if (res.reason === 'not_broke') {
      setMsg(`Bantuan hanya untuk saldo di bawah ${BANKRUPT_LIMIT.toLocaleString('id-ID')} chip.`);
    } else {
      setMsg('Kuota bantuan kebangkrutan hari ini sudah habis (maks. 3x sehari).');
    }
  };

  return (
    <Modal title="🪙 Bank & Toko Chip Virtual" onClose={onClose}>
      <div className="stack">
        <div className="card-box row" style={{ justifyContent: 'space-between', background: 'linear-gradient(135deg, var(--terra-soft) 0%, var(--sage-soft) 100%)' }}>
          <div>
            <span className="small muted">Saldo Chip Kamu:</span>
            <div className="font-display" style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--gold-light)' }}>
              🪙 {eco.chips.toLocaleString('id-ID')}
            </div>
          </div>
          <span className="badge ok">{eco.vipTier} VIP</span>
        </div>

        {msg && <div className="winner-banner center">{msg}</div>}

        <h3 className="section-title">Klaim Gratis Harian</h3>
        <div className="grid">
          <div className="card-box stack">
            <div className="row">
              <span style={{ fontSize: '1.6rem' }}>🎁</span>
              <div className="grow">
                <b>Bonus Harian</b><br />
                <span className="small muted">+3.000 s/d 10.000 Chip</span>
              </div>
            </div>
            <button className="btn btn-gold" onClick={handleDaily} disabled={dailyLeft > 0}>
              {dailyLeft > 0 ? `Tersedia lagi ${fmtLeft(dailyLeft)}` : 'Klaim Bonus'}
            </button>
          </div>

          <div className="card-box stack">
            <div className="row">
              <span style={{ fontSize: '1.6rem' }}>⏰</span>
              <div className="grow">
                <b>Bonus Tiap Jam</b><br />
                <span className="small muted">+600 Chip setiap 60 menit</span>
              </div>
            </div>
            <button className="btn btn-emerald" onClick={handleHourly} disabled={hourlyLeft > 0}>
              {hourlyLeft > 0 ? `Tersedia lagi ${fmtLeft(hourlyLeft)}` : 'Ambil Chip'}
            </button>
          </div>
        </div>

        <h3 className="section-title">Bantuan Darurat</h3>
        <div className="card-box stack">
          <div className="row">
            <span style={{ fontSize: '1.6rem' }}>🛡️</span>
            <div className="grow">
              <b>Bantuan Kebangkrutan</b><br />
              <span className="small muted">Untuk saldo di bawah {BANKRUPT_LIMIT.toLocaleString('id-ID')} chip: ambil +2.500 Chip gratis (sisa {refills}x hari ini).</span>
            </div>
          </div>
          <button className="btn btn-danger" onClick={handleBankruptcy} disabled={refills <= 0 || !broke}>
            {refills <= 0 ? 'Kuota hari ini habis' : broke ? 'Ambil Bantuan Bank (+2.500 Chip)' : 'Saldo masih cukup'}
          </button>
        </div>

        <p className="muted small center" style={{ marginTop: 12 }}>
          Cardora bersifat 100% hiburan & permainan santai. Seluruh chip adalah chip virtual tanpa uang sungguhan.
        </p>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   6. In-Game Table Emotes & Live Chat
   ========================================================================== */
export interface TableChatMessage {
  id: string;
  sender: string;
  avatar: string;
  text: string;
  seat?: number | null;
  time?: number;
}

const QUICK_EMOTES = ['😎', '🤑', '🤣', '🔥', '💸', '☕', '🃏', '👑', '😱', '😭', '🤡', '🚀'];
const QUICK_CHATS = [
  'All-in nih bos! 🔥',
  'Nice hand bro! 👏',
  'Santai dulu gak sih? ☕',
  'Waduh kena jebakan! 😭',
  'Hoki parah wkwk 🤣',
  'Bluff ya tadi? 😏',
  'Gas all-in atau pulang! ⚡',
  'Good game semuanya! 🤝',
];

export function TableEmotes({ 
  onSend, 
  messages = [] 
}: { 
  onSend: (content: string) => void;
  messages?: TableChatMessage[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'quick' | 'chat'>('quick');
  const [text, setText] = useState('');
  const [hasNew, setHasNew] = useState(false);
  const prevLen = useRef(messages.length);

  useEffect(() => {
    if (messages.length > prevLen.current && !open) {
      setHasNew(true);
    }
    prevLen.current = messages.length;
  }, [messages.length, open]);

  const handleOpen = () => {
    setOpen(!open);
    if (!open) setHasNew(false);
  };

  const handleSendCustom = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    play('emote');
    trackAchievement('social_chatter', 1);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button 
        className={`btn icon-btn${hasNew ? ' has-new' : ''}`} 
        onClick={handleOpen} 
        aria-label="Obrolan Meja & Emote"
        title="Obrolan Meja & Emote"
        style={{ position: 'relative' }}
      >
        <IconChat size={18} />
        {hasNew && (
          <span className="dot" style={{ position: 'absolute', top: 5, right: 5, background: 'var(--gold)' }} />
        )}
      </button>

      {open && (
        <div className="emote-popover">
          <div className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 6 }}>
              <button 
                className={`chip${tab === 'quick' ? ' on' : ''}`} 
                onClick={() => setTab('quick')}
                style={{ padding: '3px 10px', fontSize: '0.8rem' }}
              >
                ⚡ Cepat & Emote
              </button>
              <button 
                className={`chip${tab === 'chat' ? ' on' : ''}`} 
                onClick={() => setTab('chat')}
                style={{ padding: '3px 10px', fontSize: '0.8rem' }}
              >
                💬 Obrolan ({messages.length})
              </button>
            </div>
            <button className="btn icon-btn btn-ghost" style={{ padding: 2, height: 24, width: 24 }} onClick={() => setOpen(false)} aria-label="Tutup">
              <IconX size={14} />
            </button>
          </div>

          {tab === 'quick' ? (
            <>
              <div className="emote-grid">
                {QUICK_EMOTES.map(e => (
                  <button 
                    key={e} 
                    className="emote-btn" 
                    onClick={() => { onSend(e); setOpen(false); play('emote'); trackAchievement('social_chatter', 1); }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="quick-chat-list">
                {QUICK_CHATS.map(msg => (
                  <button 
                    key={msg} 
                    className="chat-pill" 
                    onClick={() => { onSend(msg); setOpen(false); play('click'); trackAchievement('social_chatter', 1); }}
                  >
                    {msg}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="table-chat-box">
              <div className="table-chat-messages">
                {messages.length === 0 ? (
                  <p className="muted small center" style={{ margin: '20px 0' }}>Belum ada pesan di meja ini. Sapa lawan mainmu!</p>
                ) : (
                  messages.map(m => (
                    <div key={m.id} className="table-chat-item">
                      <span className="avatar sm">{m.avatar}</span>
                      <div className="table-chat-bubble">
                        <b className="chat-sender">{m.sender}</b>
                        <span className="chat-text">{m.text}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Input text pesan kustom */}
          <form className="row" onSubmit={handleSendCustom} style={{ marginTop: 8, gap: 6 }}>
            <input 
              className="input grow" 
              style={{ padding: '6px 10px', fontSize: '0.85rem' }} 
              placeholder="Ketik obrolan meja..." 
              value={text} 
              maxLength={70}
              onChange={e => setText(e.target.value)} 
            />
            <button className="btn btn-gold" type="submit" disabled={!text.trim()} style={{ padding: '6px 12px' }}>
              Kirim
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   7. Achievements Modal (Papan Lencana & Pencapaian)
   ========================================================================== */
export function AchievementsModal({ onClose }: { onClose: () => void }) {
  const eco = useData(d => d.economy);
  const achievements = eco.achievements;
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  return (
    <Modal title={`🏆 Pencapaian & Lencana (${unlockedCount}/${achievements.length})`} onClose={onClose}>
      <div className="stack" style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
        <p className="muted small" style={{ margin: '0 0 10px' }}>
          Selesaikan tantangan di setiap permainan untuk meraih chip gratis, XP prestise, dan gelar VIP Sultan!
        </p>

        <div className="stack" style={{ gap: 10 }}>
          {achievements.map(a => {
            const pct = Math.min(100, Math.round((a.current / a.target) * 100));
            return (
              <div 
                key={a.id} 
                className={`card-box row${a.unlocked ? ' active-card' : ''}`}
                style={{ 
                  justifyContent: 'space-between',
                  border: a.unlocked ? '1px solid var(--line-gold)' : undefined,
                  background: a.unlocked ? 'rgba(229,178,66,0.06)' : undefined,
                  padding: '12px 14px'
                }}
              >
                <div className="row" style={{ gap: 12, flex: 1, minWidth: 0 }}>
                  <div 
                    style={{ 
                      fontSize: '2rem', 
                      width: 48, 
                      height: 48, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      background: 'var(--paper-2)',
                      borderRadius: 12
                    }}
                  >
                    {a.icon}
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: '1rem' }}>{a.title}</b>
                      {a.claimed && <span className="badge ok">Selesai</span>}
                      {a.unlocked && !a.claimed && <span className="badge warn">Siap Klaim</span>}
                    </div>
                    <p className="small muted" style={{ margin: '2px 0 6px' }}>{a.desc}</p>
                    
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <div className="xp-bar" style={{ flex: 1, height: 6 }}>
                        <i style={{ width: `${pct}%`, background: a.unlocked ? 'var(--gold)' : undefined }} />
                      </div>
                      <span className="small muted" style={{ minWidth: 45, textAlign: 'right', fontSize: '0.75rem' }}>
                        {a.current.toLocaleString('id-ID')} / {a.target.toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="row small" style={{ gap: 10, marginTop: 4 }}>
                      <span style={{ color: 'var(--gold-light)' }}>🪙 +{a.rewardChips.toLocaleString('id-ID')} Chip</span>
                      <span style={{ color: 'var(--sage-text)' }}>⚡ +{a.rewardXp} XP</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginLeft: 10 }}>
                  {a.claimed ? (
                    <span className="small muted">Terklaim ✓</span>
                  ) : a.unlocked ? (
                    <button 
                      className="btn btn-gold btn-sm" 
                      onClick={() => claimAchievement(a.id)}
                    >
                      Klaim Hadiah
                    </button>
                  ) : (
                    <span className="badge soon" style={{ fontSize: '0.75rem' }}>Terkunci</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   8. Hand Rankings Modal (Buku Panduan Kombinasi Kartu Poker)
   ========================================================================== */
const POKER_HANDS = [
  { rank: 1, name: 'Royal Flush', desc: 'A-K-Q-J-10 berurutan dengan bunga sama persis (Spade/Heart/Club/Diamond).', odds: '1 dalam 649.740', cards: '🂡 🂮 🂭 🂫 🂪' },
  { rank: 2, name: 'Straight Flush', desc: '5 kartu berurutan dengan bunga yang sama (misal 9-8-7-6-5 Hati).', odds: '1 dalam 72.193', cards: '🂹 🂸 🂷 🂶 🂵' },
  { rank: 3, name: 'Four of a Kind', desc: '4 kartu bernilai sama + 1 kicker (misal A-A-A-A-K).', odds: '1 dalam 4.165', cards: '🂡 🂱 🃁 🃑 🂮' },
  { rank: 4, name: 'Full House', desc: 'Kombinasi Three of a Kind + One Pair (misal K-K-K-8-8).', odds: '1 dalam 694', cards: '🂮 🂾 🃎 🂸 🂨' },
  { rank: 5, name: 'Flush', desc: '5 kartu apa saja dengan bunga yang sama (tidak berurutan).', odds: '1 dalam 508', cards: '🂡 🂪 🂧 🂤 🂢' },
  { rank: 6, name: 'Straight', desc: '5 kartu berurutan nilai tapi berbeda bunga (misal 5-6-7-8-9).', odds: '1 dalam 254', cards: '🂩 🂸 🃗 🃖 🂵' },
  { rank: 7, name: 'Three of a Kind', desc: '3 kartu bernilai sama + 2 kartu acak (misal Q-Q-Q-7-2).', odds: '1 dalam 47', cards: '🂭 🂽 🃍 🂷 🂲' },
  { rank: 8, name: 'Two Pair', desc: 'Dua pasang kartu bernilai sama + 1 kicker (misal J-J dan 9-9).', odds: '1 dalam 21', cards: '🂫 🂻 🂩 🂹 🂴' },
  { rank: 9, name: 'One Pair', desc: 'Satu pasang kartu dengan nilai sama (misal 10-10-A-8-4).', odds: '1 dalam 2,4', cards: '🂪 🂺 🂡 🂸 🂤' },
  { rank: 10, name: 'High Card', desc: 'Tidak ada kombinasi yang terbentuk, ditentukan kartu tertinggi.', odds: 'Paling sering', cards: '🂡 🂮 🂹 🂷 🂲' },
];

/** Short Deck (aturan Triton): Flush > Full House, Three of a Kind > Straight, straight terendah A-6-7-8-9. */
const SHORT_DECK_ORDER = ['Royal Flush', 'Straight Flush', 'Four of a Kind', 'Flush', 'Full House', 'Three of a Kind', 'Straight', 'Two Pair', 'One Pair', 'High Card'];
const SHORT_DECK_HANDS = SHORT_DECK_ORDER.map((name, i) => {
  const h = POKER_HANDS.find(x => x.name === name)!;
  const desc = name === 'Straight' ? '5 kartu berurutan beda bunga; As bisa rendah: A-6-7-8-9 (straight terendah).' : h.desc;
  return { ...h, rank: i + 1, desc, odds: '' };
});

export function HandRankingsModal({ onClose, variant = 'holdem' }: { onClose: () => void; variant?: string }) {
  const title = variant === 'omaha' ? 'Omaha' : variant === 'short-deck' ? 'Short Deck' : "Texas Hold'em";
  const hands = variant === 'short-deck' ? SHORT_DECK_HANDS : POKER_HANDS;
  return (
    <Modal title={`🃏 Urutan Kombinasi Kartu ${title}`} onClose={onClose}>
      <div className="stack" style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
        <p className="muted small" style={{ margin: '0 0 10px' }}>
          Urutan dari terkuat (Royal Flush) hingga terlemah (High Card). Evaluator Cardora memilih otomatis 5 kartu terbaik Anda.
          {variant === 'omaha' && ' Di Omaha, kombinasi WAJIB memakai tepat 2 dari 4 kartu tangan + tepat 3 kartu meja.'}
          {variant === 'short-deck' && ' Short Deck (deck 36 kartu): Flush mengalahkan Full House dan Three of a Kind mengalahkan Straight.'}
        </p>

        <div className="stack" style={{ gap: 8 }}>
          {hands.map(h => (
            <div key={h.rank} className="card-box" style={{ padding: '10px 14px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="font-display" style={{ fontWeight: 800 }}>
                  <span className="badge" style={{ marginRight: 8, background: h.rank <= 3 ? 'var(--gold)' : undefined, color: h.rank <= 3 ? '#000' : undefined }}>#{h.rank}</span>
                  {h.name}
                </span>
                {h.odds && <span className="small muted">{h.odds}</span>}
              </div>
              <p className="small muted" style={{ margin: '4px 0 6px' }}>{h.desc}</p>
              <div style={{ fontSize: '1.4rem', letterSpacing: 3 }}>{h.cards}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   9. Rebuy & Top-up Modal (Isi Ulang Chip Meja)
   ========================================================================== */
export function RebuyModal({ 
  onClose, 
  currentStack = 0,
  onRebuySuccess
}: { 
  onClose: () => void; 
  currentStack?: number;
  onRebuySuccess?: (added: number) => void;
}) {
  const eco = useData(d => d.economy);
  const options = [5000, 10000, 25000, 50000];

  const handleRebuy = (amount: number) => {
    if (eco.chips < amount) {
      // Wallet kurangan, beri bonus darurat jika benar-benar habis
      rebuyChips(amount);
    } else {
      rebuyChips(amount);
    }
    onRebuySuccess?.(amount);
    onClose();
  };

  const handleFreeRefill = () => {
    claimBankruptcyRefill();
    onRebuySuccess?.(2500);
    onClose();
  };

  return (
    <Modal title="🪙 Isi Ulang Chip di Meja (Rebuy)" onClose={onClose}>
      <div className="stack">
        <div className="card-box row" style={{ justifyContent: 'space-between', background: 'rgba(229,178,66,0.1)' }}>
          <div>
            <span className="small muted">Chip di Tangan Sekarang:</span>
            <div className="font-display" style={{ fontSize: '1.2rem', fontWeight: 800 }}>{currentStack.toLocaleString('id-ID')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="small muted">Saldo Dompet Utama:</span>
            <div className="font-display" style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--gold-light)' }}>
              🪙 {eco.chips.toLocaleString('id-ID')}
            </div>
          </div>
        </div>

        <p className="muted small" style={{ margin: '10px 0 4px' }}>
          Pilih nominal chip tambahan yang ingin Anda bawa ke meja:
        </p>

        <div className="grid-2">
          {options.map(amt => (
            <button 
              key={amt} 
              className="btn btn-gold" 
              onClick={() => handleRebuy(amt)}
              style={{ padding: '12px 10px' }}
            >
              + {amt.toLocaleString('id-ID')} Chip
            </button>
          ))}
        </div>

        {eco.freeRefillsToday > 0 && (
          <div className="card-box stack" style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">Sisa Bantuan Darurat: {eco.freeRefillsToday}x</span>
              <button className="btn btn-sm btn-emerald" onClick={handleFreeRefill}>
                Ambil Bantuan (+2.500 Chip Gratis)
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ==========================================================================
   10. Last Hand Reviewer Modal (Rangkuman Ronde Terakhir)
   ========================================================================== */
export function LastHandModal({ 
  lastHand, 
  seats, 
  avatars, 
  onClose 
}: { 
  lastHand: any; 
  seats: any[]; 
  avatars: string[]; 
  onClose: () => void; 
}) {
  if (!lastHand) return null;

  return (
    <Modal title="🔍 Review Tangan Terakhir (Showdown)" onClose={onClose}>
      <div className="stack">
        <div className="card-box" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'var(--emerald)' }}>
          <b style={{ color: 'var(--emerald-light)' }}>🏆 Pemenang Pot:</b>
          <div className="stack" style={{ marginTop: 6, gap: 6 }}>
            {lastHand.winners.map((w: any, idx: number) => {
              const s = seats[w.seat];
              return (
                <div key={idx} className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="avatar sm">{avatars[w.seat]}</span>
                    <b>{s?.name ?? `Kursi ${w.seat + 1}`}</b>
                    {w.hand && <span className="badge ok">{w.hand}</span>}
                  </div>
                  <b style={{ color: 'var(--gold-light)' }}>+{w.amount.toLocaleString('id-ID')} Chip</b>
                </div>
              );
            })}
          </div>
        </div>

        {lastHand.cards && lastHand.cards.length > 0 && (
          <div className="stack" style={{ marginTop: 8 }}>
            <span className="small muted">Kartu Komunitas (Board):</span>
            <div className="row" style={{ gap: 6 }}>
              {lastHand.cards.map((c: string, i: number) => (
                <span key={i} className="chip on" style={{ fontSize: '1rem', padding: '6px 10px' }}>{c}</span>
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-gold" onClick={onClose} style={{ marginTop: 14 }}>
          Tutup & Lanjutkan Main
        </button>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   11. Friends Modal — akun terdaftar sungguhan (cari, tambah, hapus, ajak)
   ========================================================================== */
export function FriendsModal({
  onClose,
  onCreateRoom,
  activeRoomCode,
  inviteUrl,
}: {
  onClose: () => void;
  /** Dipanggil bila belum ada room: buat room dulu, lalu bagikan kodenya. */
  onCreateRoom?: () => void;
  activeRoomCode?: string;
  inviteUrl?: string;
}) {
  const session = useData(d => d.session);
  const { friends, needsAccount, error } = useFriends();
  const [tab, setTab] = useState<'list' | 'add'>('list');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const onlineCount = friends.filter(f => f.status !== 'offline').length;

  const say = (t: string) => { setNotice(t); setTimeout(() => setNotice(null), 3500); };

  const copyUsername = async () => {
    if (!session.username) return;
    try { await navigator.clipboard.writeText(session.username); say('Username disalin.'); play('click'); }
    catch { prompt('Username kamu:', session.username); }
  };

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setResults(await searchUsers(q)); }
    catch (err) { say((err as Error).message); }
    finally { setBusy(false); }
  };

  const add = async (u: SearchRow) => {
    try { await addFriendById(u); setResults(r => r?.map(x => (x.id === u.id ? { ...x, isFriend: true } : x)) ?? null); }
    catch (err) { say((err as Error).message); }
  };

  const remove = async (f: FriendRow) => {
    try { await removeFriendById(f); } catch (err) { say((err as Error).message); }
  };

  const invite = async (f: FriendRow) => {
    if (activeRoomCode) {
      const text = `Ayo main Cardora bareng! Kode room: ${activeRoomCode}${inviteUrl ? `\n${inviteUrl}` : ''}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Cardora', text });
        else { await navigator.clipboard.writeText(text); say(`Undangan disalin — kirim ke ${f.displayName} lewat chat.`); }
      } catch { say(`Kode room: ${activeRoomCode} — kirim kode ini ke ${f.displayName}.`); }
      return;
    }
    if (onCreateRoom) { onCreateRoom(); onClose(); return; }
    say('Buat room dulu dari beranda, lalu ajak teman dengan kode room-nya.');
  };

  const statusText = { online: 'Online', playing: 'Sedang bermain', offline: 'Offline' } as const;

  if (needsAccount) {
    return (
      <Modal title="Teman" onClose={onClose}>
        <div className="card-box stack center" style={{ padding: '26px 20px' }}>
          <span className="dash-list-icon tone-butter" style={{ margin: '0 auto', width: 44, height: 44 }}><IconUsers size={22} /></span>
          <p className="muted small center" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
            Fitur teman butuh akun terdaftar, supaya temanmu bisa menemukanmu lewat username.<br />
            Masuk atau daftar dari halaman Profil.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Teman (${onlineCount} online)`} onClose={onClose}>
      <div className="stack" style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 4, gap: 14 }}>
        <div className="friends-id-card">
          <div className="friends-id-body">
            <span className="avatar sm">{getData().profile.avatar}</span>
            <div>
              <div className="friends-id-kicker">Username kamu</div>
              <div className="friends-id-code">@{session.username}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-gold" onClick={copyUsername}><IconCopy size={14} /> Salin</button>
        </div>

        <div className="segmented-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'list'} className={`segmented-tab ${tab === 'list' ? 'is-active' : ''}`} onClick={() => setTab('list')}>
            <IconUsers size={16} /> Daftar Teman ({friends.length})
          </button>
          <button role="tab" aria-selected={tab === 'add'} className={`segmented-tab ${tab === 'add' ? 'is-active' : ''}`} onClick={() => setTab('add')}>
            <IconUserPlus size={16} /> Tambah Teman
          </button>
        </div>

        {(notice || error) && (
          <div className="small center" style={{ color: 'var(--terra-text)', fontWeight: 700 }}>{notice || error}</div>
        )}

        {tab === 'list' ? (
          <div className="stack" style={{ gap: 10 }}>
            {friends.length === 0 ? (
              <div className="card-box stack center" style={{ padding: '28px 20px', borderRadius: 18 }}>
                <p className="muted small center" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                  Belum ada teman. Cari temanmu dengan username mereka.
                </p>
                <button className="btn btn-gold btn-sm" onClick={() => setTab('add')}><IconUserPlus size={15} /> Tambah Teman</button>
              </div>
            ) : friends.map(f => (
              <div key={f.id} className="friend-card">
                <div className="friend-info">
                  <div className="friend-avatar-wrap">
                    <span className="avatar">{f.avatar}</span>
                    <span className={`friend-status-dot ${f.status}`} />
                  </div>
                  <div className="friend-details">
                    <div className="friend-header-row"><span className="friend-name">{f.displayName}</span></div>
                    <div className="friend-meta-row">
                      <span>@{f.username}</span><span>·</span>
                      <span className={`status-badge ${f.status}`}>{statusText[f.status]}</span>
                      {f.played > 0 && <><span>·</span><span>{f.wins}/{f.played} menang</span></>}
                    </div>
                  </div>
                </div>
                <div className="friend-actions">
                  <button className="btn btn-sm btn-gold" onClick={() => invite(f)}>{activeRoomCode ? 'Salin Undangan' : 'Ajak Main'}</button>
                  <button className="friend-remove-btn" onClick={() => remove(f)} aria-label={`Hapus ${f.displayName} dari teman`}><IconX size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <form className="card-box stack" onSubmit={doSearch} style={{ borderRadius: 18, padding: 16 }}>
              <b>Cari pemain</b>
              <span className="small muted">Ketik username atau nama temanmu (minimal 2 huruf).</span>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <input className="input grow" placeholder="Username teman" value={q} maxLength={20}
                  onChange={e => setQ(e.target.value)} aria-label="Cari username" autoComplete="off" />
                <button className="btn btn-gold" type="submit" disabled={busy || q.trim().length < 2}><IconSearch size={16} /> Cari</button>
              </div>
            </form>
            {results && results.length === 0 && (
              <div className="card-box center"><span className="muted small">Tidak ada pemain dengan nama "<b>{q.trim()}</b>".</span></div>
            )}
            {results?.map(u => (
              <div key={u.id} className="friend-card">
                <div className="friend-info">
                  <span className="avatar sm">{u.avatar}</span>
                  <div className="friend-details">
                    <div className="friend-header-row"><span className="friend-name">{u.displayName}</span></div>
                    <div className="friend-meta-row"><span>@{u.username}</span></div>
                  </div>
                </div>
                <div className="friend-actions">
                  {u.isFriend
                    ? <span className="friend-already-badge"><IconCheck size={14} /> Teman</span>
                    : <button className="btn btn-gold btn-sm" onClick={() => add(u)}><IconUserPlus size={15} /> Tambah</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ==========================================================================
   8. Backup & Restore Modal (Simpan Progres Mandiri)
   ========================================================================== */
export function BackupRestoreModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'backup' | 'restore'>('backup');
  const [copied, setCopied] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const eco = useData(d => d.economy);
  const session = useData(d => d.session);
  const backupCode = exportProgressBackup();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(backupCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      play('click');
    } catch {
      prompt('Salin Kunci Cadangan Anda:', backupCode);
    }
  };

  const handleRestore = () => {
    if (!inputKey.trim()) return;
    const res = importProgressBackup(inputKey);
    setResultMsg({ ok: res.ok, text: res.message });
    if (res.ok) {
      setTimeout(() => {
        onClose();
      }, 1500);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = String(evt.target?.result || '');
      setInputKey(text);
      const res = importProgressBackup(text);
      setResultMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="💾 Cadangkan & Pulihkan Progres" onClose={onClose}>
      <div className="stack" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {/* Status Mode Akun */}
        <div className="card-box row" style={{ justifyContent: 'space-between', alignItems: 'center', background: session.username ? 'rgba(16,185,129,0.1)' : 'rgba(229,178,66,0.1)' }}>
          <div>
            <span className="small muted">Mode Akun Saat Ini:</span>
            <div className="font-display" style={{ fontSize: '1.1rem', fontWeight: 800 }}>
              {session.username ? `👤 Akun Terhubung (@${session.username})` : '🎭 Mode Tamu (Lokal)'}
            </div>
          </div>
          <span className={`badge${session.username ? ' ok' : ''}`}>
            {session.username ? 'Akun + Perangkat' : 'Perangkat Ini'}
          </span>
        </div>

        {/* Tab Selection */}
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button 
            className={`chip grow${tab === 'backup' ? ' on' : ''}`}
            onClick={() => { setTab('backup'); setResultMsg(null); }}
          >
            📤 Cadangkan Progres
          </button>
          <button 
            className={`chip grow${tab === 'restore' ? ' on' : ''}`}
            onClick={() => { setTab('restore'); setResultMsg(null); }}
          >
            📥 Pulihkan Progres
          </button>
        </div>

        {resultMsg && (
          <div className="small center" style={{ color: resultMsg.ok ? '#10B981' : '#EF4444', padding: '6px 0', fontWeight: 600 }}>
            {resultMsg.text}
          </div>
        )}

        {tab === 'backup' ? (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Kunci cadangan ini berisi data lengkap saldo <b>{eco.chips.toLocaleString('id-ID')} Chip</b>, <b>Level {eco.level}</b>, lencana pencapaian, dan riwayat permainanmu. Simpan kode ini atau unduh filenya jika ingin pindah HP atau mengamankan data!
            </p>

            <div className="card-box stack" style={{ gap: 6 }}>
              <label className="small muted">Kunci Cadangan Progres (Recovery Key):</label>
              <textarea 
                className="input" 
                readOnly 
                value={backupCode} 
                rows={3}
                style={{ fontSize: '0.78rem', wordBreak: 'break-all', resize: 'none', background: 'var(--paper-2)' }}
                onClick={e => (e.target as HTMLTextAreaElement).select()}
              />
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <button className="btn btn-gold grow" onClick={handleCopy}>
                  {copied ? <><IconCheck size={14} /> Kunci Tersalin!</> : <><IconCopy size={14} /> Salin Kunci</>}
                </button>
                <button className="btn grow" onClick={downloadBackupFile}>
                  <IconDownload size={14} /> Unduh File .json
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Punya Kunci Cadangan atau file <code>cardora-backup.json</code> dari HP/browser sebelumnya? Tempelkan kodenya di bawah untuk memulihkan seluruh progresmu secara instan.
            </p>

            <div className="card-box stack" style={{ gap: 8 }}>
              <label className="small muted">Tempel Kunci Cadangan di sini:</label>
              <textarea 
                className="input" 
                placeholder="Tempelkan kode CARDORA-BACKUP-xxxx (atau KUY-BACKUP-xxxx) di sini..." 
                value={inputKey} 
                onChange={e => setInputKey(e.target.value)} 
                rows={3}
                style={{ fontSize: '0.78rem', resize: 'vertical' }}
              />
              <button 
                className="btn btn-gold btn-lg" 
                onClick={handleRestore} 
                disabled={!inputKey.trim()}
              >
                ⚡ Pulihkan Progres Sekarang
              </button>
            </div>

            <div className="card-box stack center" style={{ gap: 6 }}>
              <span className="small muted">Atau unggah file cadangan dari perangkat:</span>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                📂 Pilih File Backup (.json)
                <input 
                  type="file" 
                  accept=".json,text/plain" 
                  style={{ display: 'none' }} 
                  onChange={handleFileUpload} 
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}



