import { useEffect, useState } from 'react';
import { AVATARS, catalogById } from '@kuypoker/engine';
import { useData, update, statsFor } from '../lib/store';
import { refreshIdentity } from '../lib/net';
import { api } from '../lib/auth';
import { TopBar } from '../components/ui';
import { AchievementsModal, FriendsModal, BackupRestoreModal } from '../components/gameModals';
import {
  IconAward,
  IconCopy,
  IconGift,
  IconLogOut,
  IconSave,
  IconShield,
  IconSparkles,
  IconUsers,
} from '../components/icons';

export default function Profile({ onBack, onLogout, onLinkAccount }: { onBack: () => void; onLogout: () => void; onLinkAccount: () => void }) {
  const profile = useData(d => d.profile);
  const history = useData(d => d.history);
  const session = useData(d => d.session);
  const friends = useData(d => d.friends);
  const [name, setName] = useState(profile.name);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const s = statsFor(history);

  const save = (patch: Partial<typeof profile>) => {
    update(d => { Object.assign(d.profile, patch); });
    refreshIdentity();
    if (session.authToken) api('/me', { method: 'PATCH', body: JSON.stringify({ displayName: patch.name, avatar: patch.avatar }) }).catch(() => { });
  };

  const eco = useData(d => d.economy);
  const unlockedCount = eco.achievements.filter(a => a.unlocked).length;

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <TopBar title="Profil & Keanggotaan" onBack={onBack} />

      {/* Account Mode Status Banner */}
      <div
        className="card-box row"
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          background: session.username ? 'var(--sage-soft)' : 'var(--butter)',
          border: session.username ? '1px solid var(--sage-line)' : '1px solid var(--butter-line)',
          marginBottom: 10
        }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="dash-list-icon" style={{ background: session.username ? 'var(--sage)' : 'var(--butter-line)', color: '#fff' }}>
            <IconShield size={18} />
          </span>
          <div>
            <div style={{ fontWeight: 800 }}>
              {session.username ? `Akun Terhubung: @${session.username}` : 'Mode Tamu (Guest Mode)'}
            </div>
            <span className="small muted">
              {session.username ? 'Nama, avatar & statistik online tersimpan di server' : 'Progres tersimpan di perangkat ini'}
            </span>
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setBackupOpen(true)} title="Cadangkan atau pulihkan data secara mandiri">
          <IconSave size={14} /> Cadangkan Progres
        </button>
      </div>

      {/* VIP Player Card */}
      <div className="card-box stack" style={{ background: 'linear-gradient(135deg, var(--terra-soft) 0%, var(--sage-soft) 100%)', border: '1px solid var(--line-gold)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="small muted">CARDORA CLUB MEMBER</span>
            <div className="font-display" style={{ fontSize: '1.4rem', fontWeight: 900 }}>
              {profile.name} <span className="badge ok">{eco.vipTier} VIP</span>
            </div>
          </div>
          <div className="center">
            <span className="small muted">Saldo Chip</span>
            <div className="font-display" style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--gold-light)' }}>
              🪙 {eco.chips.toLocaleString('id-ID')}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 4, marginTop: 4 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span>Level {eco.level}</span>
            <span className="muted">{eco.xp} / {eco.level * 300} XP menuju Level {eco.level + 1}</span>
          </div>
          <div className="xp-bar">
            <i style={{ width: `${Math.min(100, (eco.xp / (eco.level * 300)) * 100)}%` }} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--hair)' }}>
          <span className="small muted">ID Teman: <b style={{ color: 'var(--gold-light)' }}>{profile.friendCode}</b></span>
          <button className="btn btn-sm btn-gold" onClick={() => setFriendsOpen(true)}>
            <IconUsers size={14} /> Daftar Teman ({friends.length})
          </button>
        </div>
      </div>

      <div className="card-box stack" style={{ marginTop: 14 }}>
        <div className="row">
          <span className="avatar lg">{profile.avatar}</span>
          <form className="grow row" onSubmit={e => { e.preventDefault(); save({ name: name.trim().slice(0, 20) || profile.name }); }}>
            <input className="input grow" value={name} maxLength={20} onChange={e => setName(e.target.value)} aria-label="Nama pemain" />
            <button className="btn btn-gold" disabled={!name.trim() || name === profile.name}>
              <IconSave size={15} /> Simpan
            </button>
          </form>
        </div>
        <span className="small muted">Pilih Avatar Keberuntungan:</span>
        <div className="filters" role="radiogroup" aria-label="Pilih avatar">
          {AVATARS.map(a => (
            <button key={a} role="radio" aria-checked={a === profile.avatar} className={`chip${a === profile.avatar ? ' on' : ''}`} style={{ fontSize: '1.3rem' }} onClick={() => save({ avatar: a })}>{a}</button>
          ))}
        </div>
      </div>

      <h2 className="section-title">Statistik (perangkat ini)</h2>
      <div className="stat-grid">
        <div className="stat"><b>{s.played}</b><span className="small muted">Permainan</span></div>
        <div className="stat"><b>{s.wins}</b><span className="small muted">Menang</span></div>
        <div className="stat"><b>{s.rate}%</b><span className="small muted">Rasio menang</span></div>
      </div>
      <div className="card-box stack" style={{ marginTop: 10 }}>
        {[...s.by.entries()].map(([id, x]) => (
          <div key={id} className="row"><span className="grow">{catalogById(id)?.icon} {catalogById(id)?.name}</span><span className="muted small">{x.wins}/{x.played} menang</span></div>
        ))}
        {!s.by.size && <span className="muted small">Belum ada data.</span>}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Lencana & Pencapaian</h2>
        <button className="btn btn-sm btn-gold" onClick={() => setAchievementsOpen(true)}>
          <IconAward size={14} /> Lihat Semua ({unlockedCount}/{eco.achievements.length})
        </button>
      </div>
      <div className="card-box stack" style={{ marginTop: 8 }}>
        <div className="grid-2" style={{ gap: 8 }}>
          {eco.achievements.map(a => (
            <div
              key={a.id}
              className="row small"
              style={{
                gap: 8,
                padding: '8px 10px',
                background: a.unlocked ? 'var(--butter)' : 'var(--cream-2)',
                borderRadius: 12,
                border: a.unlocked ? '1px solid var(--butter-line)' : '1px solid var(--hair)'
              }}
            >
              <span style={{ fontSize: '1.4rem' }}>{a.icon}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{a.title}</b>
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  {a.claimed ? 'Terklaim ✓' : a.unlocked ? 'Siap Klaim' : `${a.current.toLocaleString('id-ID')}/${a.target.toLocaleString('id-ID')}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {achievementsOpen && <AchievementsModal onClose={() => setAchievementsOpen(false)} />}
      {friendsOpen && <FriendsModal onClose={() => setFriendsOpen(false)} />}
      {backupOpen && <BackupRestoreModal onClose={() => setBackupOpen(false)} />}

      <h2 className="section-title">Akun & Penyimpanan Progres</h2>
      <Account onLogout={onLogout} onLinkAccount={onLinkAccount} onOpenBackup={() => setBackupOpen(true)} />
    </div>
  );
}

function Account({ onOpenBackup, onLogout, onLinkAccount }: { onOpenBackup: () => void; onLogout: () => void; onLinkAccount: () => void }) {
  const session = useData(d => d.session);
  const [msg, setMsg] = useState<string | null>(null);
  const [online, setOnline] = useState<{ stats: any[]; history: any[] } | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  useEffect(() => {
    if (!session.authToken) return;
    api('/me').then(setOnline).catch(e => setMsg(e.message));
  }, [session.authToken]);

  return (
    <>
      {session.authToken ? (
        <div className="card-box stack">
          <div className="row" style={{ alignItems: 'center' }}>
            <div className="grow">
              <b>@{session.username}</b>
              <div className="small muted">{session.provider === 'google' ? 'Masuk dengan Google · ' : ''}Akun terhubung & progres tersimpan aman</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={onOpenBackup}>
                <IconSave size={14} /> Cadangkan
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmOut(true)}>
                <IconLogOut size={14} /> Keluar
              </button>
            </div>
          </div>
          {online?.stats.map(x => <div key={x.game_id} className="row small"><span className="grow">{catalogById(x.game_id)?.name}</span><span>{x.wins}/{x.played} menang (online)</span></div>)}
          {online && !online.stats.length && <span className="muted small">Belum ada pertandingan online tercatat.</span>}
          {msg && <span className="error-text">{msg}</span>}
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="card-box row" style={{ alignItems: 'center', gap: 12 }}>
            <span className="dash-list-icon tone-butter">
              <IconGift size={20} />
            </span>
            <div className="grow">
              <b>Lindungi Progres & Dapatkan +25.000 Chip!</b>
              <div className="small muted">Kamu main sebagai tamu. Tautkan akun (username atau Google) agar level & chip tidak hilang saat ganti perangkat.</div>
            </div>
          </div>
          <div className="card-box stack" style={{ gap: 10, padding: '16px 18px' }}>
            <button className="btn btn-gold btn-block btn-lg" onClick={onLinkAccount}>
              <IconSparkles size={18} /> Tautkan Akun / Masuk (+25.000 Chip)
            </button>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn grow" onClick={onOpenBackup}>
                <IconSave size={16} /> Cadangkan Data
              </button>
              <button className="btn btn-danger" onClick={() => setConfirmOut(true)}>
                <IconLogOut size={16} /> Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Konfirmasi Keluar yang Menarik & Interaktif */}
      <LogoutConfirmModal
        isOpen={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={() => {
          setConfirmOut(false);
          onLogout();
        }}
        onLinkAccount={onLinkAccount}
      />
    </>
  );
}

function LogoutConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  onLinkAccount
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onLinkAccount: () => void;
}) {
  const profile = useData(d => d.profile);
  const eco = useData(d => d.economy);
  const session = useData(d => d.session);
  const isGuest = !session.authToken;

  if (!isOpen) return null;

  return (
    <div
      className="modal-back"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 1200 }}
    >
      <div
        className="modal"
        style={{
          maxWidth: 420,
          padding: '26px 22px 22px 22px',
          textAlign: 'center',
          borderRadius: 24,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--paper)',
          boxShadow: '0 28px 70px rgba(0,0,0,0.35)',
        }}
      >
        {/* Soft Background Accent Glow */}
        <div style={{
          position: 'absolute',
          top: -40,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239, 68, 68, 0.16) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Top Icon Badge */}
        <div style={{
          width: 68,
          height: 68,
          borderRadius: '50%',
          background: 'linear-gradient(145deg, rgba(254, 226, 226, 0.9) 0%, rgba(254, 202, 202, 0.6) 100%)',
          border: '2px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto',
          boxShadow: '0 8px 24px rgba(239, 68, 68, 0.18)',
          fontSize: 30,
        }}>
          🚪
        </div>

        <h2 style={{ margin: '0 0 6px 0', fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>
          Yakin Ingin Keluar?
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
          {isGuest
            ? 'Kamu sedang bermain sebagai tamu. Data akunmu tetap aman tersimpan di perangkat ini.'
            : 'Sesi akunmu akan ditutup dan kamu bisa masuk kembali kapan saja.'}
        </p>

        {/* Player Snapshot Preview Card */}
        <div style={{
          background: 'var(--paper-2)',
          border: '1px solid var(--hair)',
          borderRadius: 16,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          textAlign: 'left',
        }}>
          <div style={{
            fontSize: 28,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            border: '1px solid var(--hair)',
            flexShrink: 0,
          }}>
            {profile.avatar}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {session.username ? `@${session.username}` : profile.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ color: '#d47234', fontWeight: 700 }}>
                🪙 {eco.chips.toLocaleString('id-ID')} Chip
              </span>
              <span>•</span>
              <span>Level {eco.level}</span>
            </div>
          </div>
          <span className="badge" style={{ fontSize: 10, fontWeight: 700 }}>
            {isGuest ? 'Akun Tamu' : 'Tersimpan'}
          </span>
        </div>

        {/* Safe Data Info Banner */}
        <div style={{
          background: isGuest ? 'var(--butter)' : 'var(--sage-soft)',
          border: isGuest ? '1px solid var(--butter-line)' : '1px solid var(--sage-line)',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--ink)',
          textAlign: 'left',
          marginBottom: 18,
          display: 'flex',
          gap: 9,
          alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>🛡️</span>
          <div style={{ flex: 1, lineHeight: 1.4 }}>
            {isGuest ? (
              <>
                <b>Data Kamu Aman:</b> Saldo chip, level, dan progres misi tetap tersimpan di browser ini.
              </>
            ) : (
              <>
                <b>Akun tersimpan di server:</b> nama, avatar, dan statistik pertandingan online. Saldo chip, level, dan misi disimpan di perangkat ini — gunakan Cadangkan Progres untuk memindahkannya.
              </>
            )}
          </div>
        </div>

        {/* Guest Incentive Card */}
        {isGuest && (
          <button
            type="button"
            onClick={() => { onClose(); onLinkAccount(); }}
            style={{
              background: 'linear-gradient(135deg, rgba(212, 114, 52, 0.08) 0%, rgba(244, 162, 97, 0.16) 100%)',
              border: '1.5px dashed var(--gold)',
              borderRadius: 14,
              padding: '10px 14px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              marginBottom: 16,
              textAlign: 'left',
              transition: 'transform 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ fontSize: 20 }}>✨</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--gold-dark)' }}>
                  Tautkan Akun Dulu (+25.000 Chip)
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Dapat chip gratis & simpan progres ke cloud
                </div>
              </div>
            </div>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              background: 'var(--gold)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(212, 114, 52, 0.3)',
            }}>
              Tautkan
            </span>
          </button>
        )}

        {/* Action Buttons: 2 Tombol Seimbang, Besar & Jelas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button
            type="button"
            className="btn btn-lg"
            onClick={onClose}
            style={{
              fontWeight: 800,
              justifyContent: 'center',
              height: 48,
              fontSize: 14,
              background: 'var(--cream-2)',
              border: '1px solid var(--hair)',
              color: 'var(--ink)',
              borderRadius: 14,
              cursor: 'pointer',
            }}
          >
            Batal
          </button>

          <button
            type="button"
            className="btn btn-danger btn-lg"
            onClick={onConfirm}
            style={{
              fontWeight: 800,
              justifyContent: 'center',
              height: 48,
              fontSize: 14,
              background: 'linear-gradient(135deg, #e63946 0%, #c1121f 100%)',
              color: '#fff',
              borderRadius: 14,
              boxShadow: '0 6px 20px rgba(193, 18, 31, 0.35)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <IconLogOut size={16} /> Ya, Keluar
          </button>
        </div>
      </div>
    </div>
  );
}
