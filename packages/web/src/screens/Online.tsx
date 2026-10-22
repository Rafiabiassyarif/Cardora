// screens/Online.tsx — room online: buat/gabung, lobby (kode, anggota, siap, pengaturan), meja.
import { useEffect, useRef, useState } from 'react';
import { CATALOG, catalogById, getGame, type RoomView } from '@kuypoker/engine';
import type { Nav } from '../App';
import { connect, emit, useNet, serverUrl, clearClosed, sendRoomChat } from '../lib/net';
import { getData, setLastRoom } from '../lib/store';
import { CustomSelect, OptionsForm, RulesModal, TopBar } from '../components/ui';
import {
  IconCheck,
  IconCopy,
  IconLogIn,
  IconPlus,
  IconShare,
  IconUsers,
  IconX,
} from '../components/icons';
import { TableScreen } from '../tables/TableScreen';
import { FriendsModal } from '../components/gameModals';
import { play } from '../lib/sound';

export default function Online({ nav, join, create }: { nav: Nav; join?: string; create?: string }) {
  const status = useNet(s => s.status);
  const room = useNet(s => s.room);
  const view = useNet(s => s.view);
  const closedReason = useNet(s => s.closedReason);
  const lastError = useNet(s => s.lastError);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); play('error'); } finally { setBusy(false); }
  };

  // Hubungkan lalu jalankan intent (buat / gabung) sekali.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    clearClosed();
    run(async () => {
      await connect();
      if (join) await emit('room:join', { code: join });
      else if (create) await emit('room:create', { gameId: create, maxPlayers: 4 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = async () => { try { await emit('room:leave'); } catch { /* sudah keluar */ } setLastRoom(null); nav({ name: 'home' }); };
  // Buka layar online tanpa intent (mis. setelah reload): bila kursi di server sudah tidak ada, beri tahu sekali.
  const restoring = !join && !create && !!getData().session.lastRoom;

  if (room && (room.status === 'playing' || (room.status === 'finished' && view))) {
    const me = room.members.find(m => m.isYou);
    const avatars = seatAvatars(room);
    return (
      <TableScreen gameId={room.gameId} view={view} error={error} subtitle={`Room ${room.code}`}
        act={a => run(() => emit('game:action', { action: a }))}
        onExit={leave}
        onRematch={me?.isHost ? () => run(() => emit('room:rematch')) : undefined}
        rematchLabel="Rematch (kembali ke lobby)"
        avatars={avatars} turnDeadline={room.turnDeadline} turnSeconds={room.turnSeconds} />
    );
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <TopBar title={room ? 'Room' : 'Main Online'} onBack={room ? leave : () => nav({ name: 'home' })}
        right={<span className={`badge${status === 'online' ? ' ok' : ' warn'}`}>{status === 'online' ? 'Terhubung' : status === 'connecting' ? 'Menghubungkan…' : 'Offline'}</span>} />
      {closedReason && <p className="badge warn">{closedReason}</p>}
      {restoring && status === 'online' && !room && (
        <p className="badge warn">Room sebelumnya sudah tidak tersedia di server (mungkin server di-restart). Buat atau gabung room baru.</p>
      )}
      {status === 'offline' && !room && (
        <div className="card-box stack">
          <b>Tidak bisa terhubung ke server multiplayer</b>
          <span className="muted small">{lastError ?? `Server: ${serverUrl()}`}</span>
          <span className="muted small">Mode vs Bot tetap bisa dimainkan tanpa internet. Atur alamat server di Pengaturan.</span>
          <div className="row">
            <button className="btn btn-gold" onClick={() => location.reload()}>Coba lagi</button>
            <button className="btn" onClick={() => nav({ name: 'settings' })}>Pengaturan</button>
          </div>
        </div>
      )}
      {room ? <Lobby room={room} run={run} busy={busy} /> : status === 'online' && <JoinOrCreate run={run} busy={busy} />}
      <p className="error-text" role="alert">{error}</p>
    </div>
  );
}

function seatAvatars(room: RoomView): string[] {
  return (room.seatSlots ?? []).map(slot => room.members.find(m => m.slot === slot)?.avatar ?? '🙂');
}

function JoinOrCreate({ run, busy }: { run: (f: () => Promise<unknown>) => void; busy: boolean }) {
  const [code, setCode] = useState('');
  const [gameId, setGameId] = useState('holdem');
  const playable = CATALOG.filter(g => g.status === 'available');
  return (
    <div className="stack">
      <div className="card-box stack">
        <b>Gabung dengan kode</b>
        <form className="stack" onSubmit={e => { e.preventDefault(); run(() => emit('room:join', { code })); }}>
          <input className="input code-input" maxLength={6} value={code} placeholder="ABC123" aria-label="Kode room" autoComplete="off"
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <button className="btn btn-gold" disabled={busy || code.length !== 6}>
            <IconLogIn size={16} /> Gabung
          </button>
        </form>
      </div>
      <div className="card-box stack">
        <b>Buat room baru</b>
        <CustomSelect
          value={gameId}
          options={playable.map(g => ({
            value: g.id,
            label: g.name,
            icon: g.icon,
            hint: `${g.minPlayers}–${g.maxPlayers} pemain · ${g.duration}`,
          }))}
          onChange={setGameId}
          ariaLabel="Pilih game"
        />
        <button className="btn btn-emerald" disabled={busy} onClick={() => run(() => emit('room:create', { gameId, maxPlayers: 4 }))}>
          <IconPlus size={16} /> Buat Room
        </button>
      </div>
    </div>
  );
}

function Lobby({ room, run, busy }: { room: any; run: (f: () => Promise<unknown>) => void; busy: boolean }) {
  const me = room.members.find((m: any) => m.isYou);
  const isHost = !!me?.isHost;
  const mod = getGame(room.gameId)!;
  const entry = catalogById(room.gameId)!;
  const [copied, setCopied] = useState(false);
  const [rules, setRules] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const inviteUrl = `${serverUrl()}/#join=${room.code}`;
  const empty = room.maxPlayers - room.members.length;
  const humansNotReady = room.members.filter((m: any) => !m.isBot && !m.isHost && !m.ready);
  const enough = room.members.length >= Math.max(2, mod.minPlayers);
  const gameMax = mod.maxPlayers;
  // Boleh tambah slot hanya bila game mendukung > 4 pemain (misal Hold'em 9, Cangkulan 6) dan kursi belum capai gameMax
  const canAddSlot = isHost && gameMax > 4 && room.maxPlayers < gameMax;
  const canReduceSlot = isHost && room.maxPlayers > Math.max(2, mod.minPlayers) && room.maxPlayers > room.members.length;

  const handleAddBot = async () => {
    if (empty === 0 && canAddSlot) {
      await emit('room:configure', { maxPlayers: room.maxPlayers + 1 });
    }
    await emit('room:addBot');
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(room.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { prompt('Salin kode room:', room.code); }
  };
  const share = async () => {
    const text = `Ayo main ${entry.name} di Cardora! Kode room: ${room.code}`;
    if (navigator.share) { try { await navigator.share({ title: 'Cardora', text, url: inviteUrl }); } catch { /* dibatalkan */ } }
    else { try { await navigator.clipboard.writeText(`${text}\n${inviteUrl}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt('Salin undangan:', `${text}\n${inviteUrl}`); } }
  };

  return (
    <div className="stack">
      <div className="card-box stack center">
        <span className="muted small">Kode undangan</span>
        <div className="room-code" aria-label={`Kode room ${room.code.split('').join(' ')}`}>{room.code}</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={copy}>
            {copied ? <><IconCheck size={16} /> Tersalin</> : <><IconCopy size={16} /> Salin Kode</>}
          </button>
          <button className="btn" onClick={share}>
            <IconShare size={16} /> Bagikan
          </button>
        </div>
      </div>

      <div className="card-box stack">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b className="grow">
            Pemain ({room.members.length}/{room.maxPlayers})
            {gameMax > 4 && <span className="small muted" style={{ fontWeight: 'normal', marginLeft: 6 }}>(Maks. {gameMax})</span>}
          </b>
          <button className="btn btn-sm btn-gold" onClick={() => setFriendsOpen(true)}>
            <IconUsers size={15} /> Ajak Teman
          </button>
          {canAddSlot && (
            <button 
              className="btn btn-sm btn-gold" 
              disabled={busy} 
              onClick={() => run(() => emit('room:configure', { maxPlayers: room.maxPlayers + 1 }))}
              title={`Tambah 1 slot kursi lagi (Maksimal ${gameMax} pemain)`}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <IconPlus size={14} /> Tambah Slot
            </button>
          )}
          {isHost && (empty > 0 || canAddSlot) && (
            <button className="btn btn-sm" disabled={busy} onClick={() => run(handleAddBot)}>
              + Bot
            </button>
          )}
        </div>
        {room.members.map((m: any) => (
          <div key={m.slot} className="member">
            <span className="avatar">{m.avatar}</span>
            <span className="grow">
              <b>{m.name}</b>{m.isYou && ' (kamu)'}<br />
              <span className="small muted"><span className={`dot${m.connected ? '' : ' off'}`} /> {m.isHost ? 'Host' : m.isBot ? 'Bot' : m.connected ? 'Online' : 'Terputus'}</span>
            </span>
            {m.isHost ? <span className="badge">Host</span> : <span className={`badge${m.ready ? ' ok' : ' soon'}`}>{m.ready ? 'Siap' : 'Belum siap'}</span>}
            {isHost && m.isBot && (
              <button className="btn icon-btn btn-ghost" aria-label={`Hapus ${m.name}`} onClick={() => run(() => emit('room:removeBot', { slot: m.slot }))}>
                <IconX size={15} />
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`e${i}`} className="member empty small" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Slot kosong — bagikan kode atau undang teman</span>
            {canReduceSlot && i === empty - 1 && (
              <button
                className="btn icon-btn btn-ghost"
                title="Tutup slot kosong ini"
                style={{ padding: '2px 6px', fontSize: 11 }}
                disabled={busy}
                onClick={() => run(() => emit('room:configure', { maxPlayers: room.maxPlayers - 1 }))}
              >
                <IconX size={13} />
              </button>
            )}
          </div>
        ))}
        {canAddSlot && (
          <button
            type="button"
            className="member empty"
            style={{
              cursor: 'pointer',
              border: '1.5px dashed rgba(220, 140, 90, 0.45)',
              background: 'rgba(212, 114, 52, 0.06)',
              color: '#d47234',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 14,
              width: '100%',
              transition: 'all 0.2s ease',
            }}
            disabled={busy}
            onClick={() => run(() => emit('room:configure', { maxPlayers: room.maxPlayers + 1 }))}
            title={`Buka slot kursi baru (Maksimal ${gameMax} pemain)`}
          >
            <IconPlus size={16} /> Buka Slot Kursi Baru ({room.maxPlayers + 1}/{gameMax} Pemain)
          </button>
        )}
      </div>

      <div className="card-box stack">
        <div className="row"><b className="grow">Game & pengaturan</b><button className="btn" onClick={() => setRules(true)}>Aturan</button></div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="grow">Game</span>
          <CustomSelect
            style={{ minWidth: 200 }}
            disabled={!isHost || busy}
            value={room.gameId}
            options={CATALOG.filter(g => g.status === 'available').map(g => ({
              value: g.id,
              label: g.name,
              icon: g.icon,
            }))}
            onChange={val => run(() => emit('room:configure', { gameId: String(val) }))}
            ariaLabel="Pilih game"
          />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="grow">Jumlah kursi</span>
          <CustomSelect
            style={{ minWidth: 160 }}
            disabled={!isHost || busy}
            value={room.maxPlayers}
            options={Array.from({ length: mod.maxPlayers - Math.max(2, mod.minPlayers) + 1 }, (_, i) => i + Math.max(2, mod.minPlayers)).map(n => ({
              value: n,
              label: `${n} pemain`,
            }))}
            onChange={val => run(() => emit('room:configure', { maxPlayers: Number(val) }))}
            ariaLabel="Jumlah kursi"
          />
        </div>
        <OptionsForm specs={mod.options} values={room.options} disabled={!isHost || busy}
          onChange={(k, v) => run(() => emit('room:configure', { options: { [k]: v } }))} />
        {!isHost && <span className="muted small">Hanya host yang dapat mengubah pengaturan.</span>}
      </div>

      <LobbyChat />

      {isHost ? (
        <>
          <button className="btn btn-gold btn-lg" disabled={busy || !enough || humansNotReady.length > 0} onClick={() => run(() => emit('room:start'))}>
            Mulai Permainan
          </button>
          <span className="muted small center">
            {!enough ? `Butuh minimal ${Math.max(2, mod.minPlayers)} pemain (tambahkan bot atau ajak teman).`
              : humansNotReady.length ? `Menunggu: ${humansNotReady.map((m: any) => m.name).join(', ')}` : 'Semua siap!'}
          </span>
        </>
      ) : (
        <button className={`btn btn-lg ${me?.ready ? '' : 'btn-gold'}`} disabled={busy} onClick={() => run(() => emit('room:ready', { ready: !me?.ready }))}>
          {me?.ready ? 'Batal Siap' : 'Siap!'}
        </button>
      )}
      {rules && <RulesModal gameId={room.gameId} onClose={() => setRules(false)} />}
      {friendsOpen && <FriendsModal onClose={() => setFriendsOpen(false)} activeRoomCode={room.code} inviteUrl={inviteUrl} />}
    </div>
  );
}

function LobbyChat() {
  const chats = useNet(s => s.chats);
  const [msg, setMsg] = useState('');
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = msg.trim();
    if (!t) return;
    try {
      await sendRoomChat(t);
      setMsg('');
    } catch {}
  };
  return (
    <div className="card-box stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>💬 Obrolan Room ({chats.length})</b>
        <span className="small muted">Bicara dengan sesama pemain</span>
      </div>
      <div className="lobby-chat-messages" style={{ maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0' }}>
        {chats.length === 0 ? (
          <p className="muted small center" style={{ margin: '8px 0' }}>Belum ada pesan. Sapa teman-temanmu!</p>
        ) : (
          chats.map(c => (
            <div key={c.id} className="row small" style={{ gap: 6, alignItems: 'baseline' }}>
              <span className="avatar sm" style={{ fontSize: '1rem', width: 22, height: 22 }}>{c.avatar}</span>
              <b style={{ color: 'var(--gold-light)' }}>{c.sender}:</b>
              <span className="grow" style={{ wordBreak: 'break-word' }}>{c.text}</span>
            </div>
          ))
        )}
      </div>
      <form className="row" onSubmit={handleSend} style={{ gap: 6 }}>
        <input 
          className="input grow" 
          placeholder="Ketik pesan untuk room..." 
          value={msg} 
          maxLength={70}
          onChange={e => setMsg(e.target.value)} 
        />
        <button className="btn btn-gold" type="submit" disabled={!msg.trim()}>Kirim</button>
      </form>
    </div>
  );
}
