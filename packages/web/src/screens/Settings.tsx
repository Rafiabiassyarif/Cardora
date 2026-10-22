import { useState } from 'react';
import { useData, update, resetLocal, setBgmVolume, requestNotificationPermission } from '../lib/store';
import { resetConnection, serverUrl } from '../lib/net';
import { Switch, TopBar, Modal } from '../components/ui';
import { BackupRestoreModal } from '../components/gameModals';
import { openMusicModal } from '../lib/youtubePlayer';
import { play, startBgm, stopBgm } from '../lib/sound';
import { IconSave } from '../components/icons';

export default function Settings({ onBack }: { onBack: () => void }) {
  const s = useData(d => d.settings);
  const eco = useData(d => d.economy);
  const [server, setServer] = useState(s.serverUrl);
  const [confirm, setConfirm] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <TopBar title="Pengaturan" onBack={onBack} />
      <div className="card-box stack">
        <div className="row">
          <span className="grow">Efek suara<br /><span className="muted small">Kartu, giliran, chip, knock, kemenangan</span></span>
          <Switch on={s.sound} label="Efek suara" onChange={v => { update(d => { d.settings.sound = v; }); if (v) play('turn'); }} />
        </div>

        <div className="row">
          <span className="grow">
            Musik Kasino Santai (BGM)<br />
            <span className="muted small">Harmoni piano jazz sintetis WebAudio (santai & elegan)</span>
          </span>
          <Switch 
            on={s.bgm} 
            label="Musik Kasino Santai" 
            onChange={v => {
              update(d => { d.settings.bgm = v; });
              if (v) startBgm();
              else stopBgm();
            }} 
          />
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          <span className="grow">
            Playlist Musik Kasino<br />
            <span className="muted small">
              Sumber: {s.music?.mode === 'synth' ? '🎹 Synthesizer Offline' : '🔴 YouTube Playlist'} · {s.music?.youtubeTitle || 'Smooth Jazz Lounge'}
            </span>
          </span>
          <button 
            type="button"
            className="btn btn-sm" 
            onClick={() => openMusicModal()}
            style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            🎵 Buka Pemutar Playlist
          </button>
        </div>

        {s.bgm && (
          <div className="row" style={{ gap: 12, alignItems: 'center', padding: '4px 0' }}>
            <span className="small muted">Volume Musik:</span>
            <input 
              type="range" 
              min={0.05} 
              max={1} 
              step={0.05} 
              value={s.bgmVolume} 
              onChange={e => setBgmVolume(Number(e.target.value))} 
              style={{ flex: 1 }}
            />
            <span className="small muted" style={{ minWidth: 35 }}>{Math.round(s.bgmVolume * 100)}%</span>
          </div>
        )}

        <div className="row">
          <span className="grow">
            Notifikasi Web & Push<br />
            <span className="muted small">Pemberitahuan giliran meja, ajakan room teman, & bonus harian</span>
          </span>
          <Switch 
            on={s.notifications} 
            label="Notifikasi Web & Push" 
            onChange={async v => {
              if (v) {
                await requestNotificationPermission();
              } else {
                update(d => { d.settings.notifications = false; });
              }
            }} 
          />
        </div>

        <div className="row"><span className="grow">Animasi<br /><span className="muted small">Mengikuti "kurangi gerakan" dari sistem bila diaktifkan</span></span></div>
        <div className="filters">
          {(['full', 'reduced', 'off'] as const).map(a => (
            <button key={a} className={`chip${s.animations === a ? ' on' : ''}`} onClick={() => update(d => { d.settings.animations = a; })}>
              {a === 'full' ? 'Penuh' : a === 'reduced' ? 'Dikurangi' : 'Mati'}
            </button>
          ))}
        </div>
      </div>

      <h2 className="section-title">Tema & Tampilan Meja</h2>
      <div className="card-box stack">
        <span className="muted small">Warna karpet felt meja kasino:</span>
        <div className="filters">
          {[
            { id: 'emerald', label: 'Hijau Sage', dot: '#A8CEB4' },
            { id: 'sapphire', label: 'Biru Kabut', dot: '#B2CBDD' },
            { id: 'crimson', label: 'Mawar Lembut', dot: '#E2BBB1' },
            { id: 'obsidian', label: 'Pasir Hangat', dot: '#CFC4B5' },
          ].map(t => (
            <button 
              key={t.id} 
              className={`chip${eco.feltTheme === t.id ? ' on' : ''}`}
              onClick={() => { update(d => { d.economy.feltTheme = t.id as any; }); play('click'); }}
            >
              <span className="felt-dot" style={{ background: t.dot }} aria-hidden="true" />{t.label}
            </button>
          ))}
        </div>
      </div>

      <h2 className="section-title">Server multiplayer</h2>
      <form className="card-box stack" onSubmit={e => { e.preventDefault(); update(d => { d.settings.serverUrl = server.trim(); }); resetConnection(); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
        <span className="muted small">Kosongkan untuk memakai server bawaan: <b>{serverUrl()}</b></span>
        <input className="input" type="url" placeholder="https://cardora.contoh.com" value={server} onChange={e => setServer(e.target.value)} aria-label="URL server" />
        <button className="btn">{saved ? '✓ Tersimpan' : 'Simpan server'}</button>
      </form>

      <h2 className="section-title">Data & Keamanan Progres</h2>
      <div className="card-box stack">
        <span className="muted small">Amankan saldo chip, level, dan riwayat permainanmu secara mandiri.</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-gold grow" onClick={() => setBackupOpen(true)}>
            <IconSave size={16} /> Cadangkan & Pulihkan Progres
          </button>
          <button className="btn btn-danger" onClick={() => setConfirm(true)}>
            Reset data lokal
          </button>
        </div>
      </div>
      <p className="muted small center" style={{ marginTop: 24 }}>Cardora v0.1.0 · Chip virtual, tanpa uang sungguhan.</p>
      {backupOpen && <BackupRestoreModal onClose={() => setBackupOpen(false)} />}
      {confirm && (
        <Modal title="Reset Seluruh Data Lokal?" onClose={() => setConfirm(false)}>
          <div className="stack" style={{ gap: 16, textAlign: 'center', padding: '8px 4px' }}>
            <div style={{
              width: 58,
              height: 58,
              borderRadius: '50%',
              background: 'linear-gradient(145deg, rgba(254, 226, 226, 0.9) 0%, rgba(254, 202, 202, 0.5) 100%)',
              border: '2px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              fontSize: 26,
              boxShadow: '0 8px 20px rgba(239, 68, 68, 0.18)',
            }}>
              ⚠️
            </div>

            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 14,
              padding: '12px 14px',
              textAlign: 'left',
              fontSize: 13,
              color: 'var(--ink)',
              lineHeight: 1.45,
            }}>
              <b>Tindakan ini tidak dapat dibatalkan:</b>
              <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, color: 'var(--muted)' }}>
                <li>Riwayat pertandingan & statistik offline</li>
                <li>Saldo chip lokal tamu & misi lokal</li>
                <li>Pengaturan audio & tema meja kasino</li>
              </ul>
              <span className="small muted" style={{ display: 'block', marginTop: 6 }}>
                Akun online yang telah ditautkan tidak akan terpengaruh.
              </span>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-gold grow" onClick={() => setConfirm(false)} style={{ fontWeight: 800 }}>
                Batal (Amankan Data)
              </button>
              <button 
                className="btn btn-danger" 
                onClick={() => { resetLocal(); setConfirm(false); }}
                style={{ padding: '0 18px', fontWeight: 700 }}
              >
                Hapus Data
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
