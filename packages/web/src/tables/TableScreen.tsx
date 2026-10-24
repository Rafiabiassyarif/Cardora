// tables/TableScreen.tsx — kerangka meja: bar atas, felt, hasil, log, aturan, keluar/rematch, chat & BGM.
import { Suspense, useState, useEffect, useRef } from 'react';
import { lazyRetry } from '../lib/lazyRetry';
import { catalogById, type BaseView, AVATARS } from '@kuypoker/engine';
import { Modal, RulesModal, Countdown } from '../components/ui';
import { Confetti } from '../components/effects';
import { TableEmotes, type TableChatMessage } from '../components/gameModals';
import { useData, toggleBgm, getData, sendPushNotification } from '../lib/store';
import { useYouTubePlayer, openMusicModal } from '../lib/youtubePlayer';
import { useNet, sendRoomChat } from '../lib/net';
import { play, isBgmPlaying } from '../lib/sound';
import { IconHelp, IconList, IconMusic, IconX, IconLogOut, IconPlay } from '../components/icons';
import type { MatchSeries } from '../lib/localGame';

const HoldemTable = lazyRetry(() => import('./HoldemTable').then(m => ({ default: m.HoldemTable })));
const CangkulanTable = lazyRetry(() => import('./CangkulanTable').then(m => ({ default: m.CangkulanTable })));
const BlackjackTable = lazyRetry(() => import('./BlackjackTable').then(m => ({ default: m.BlackjackTable })));
const TongkronganTable = lazyRetry(() => import('./TongkronganTable').then(m => ({ default: m.TongkronganTable })));
const UniversalTable = lazyRetry(() => import('./UniversalTable').then(m => ({ default: m.UniversalTable })));

export interface TableProps {
  gameId: string;
  view: BaseView | null;
  error: string | null;
  act: (a: any) => void;
  onExit: () => void;
  onRematch?: () => void;
  onNextRound?: () => void;
  series?: MatchSeries;
  rematchLabel?: string;
  avatars?: string[];
  subtitle?: string;
  turnDeadline?: number | null;
  turnSeconds?: number;
}

const BOT_BANTER = [
  'Waduh santai bang, chip ku tipis nih wkwk 😅',
  'All-in? Berani adu kartu kita! 🔥',
  'Hoki pemula ini mah haha 🤣',
  'Nice play bro! 👏',
  'Jangan dipancing, nanti nyesel lho 😉',
  'Gas terus pantang mundur! ⚡',
  'Ampun sepuh, jangan dibantai 🙏',
  'Bentar lagi jackpot nih rasanya 🪙',
  'Waktunya balik modal! 🚀',
  'Santai dulu, masih banyak putaran ☕',
];

export function TableScreen(p: TableProps) {
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [bubble, setBubble] = useState<{ text: string; seat: number } | null>(null);
  const [localMessages, setLocalMessages] = useState<TableChatMessage[]>([]);
  const [confettiKey, setConfettiKey] = useState<number | null>(null);
  
  const feltTheme = useData(d => d.economy.feltTheme);
  const settings = useData(d => d.settings);
  const yt = useYouTubePlayer();
  const isMusicPlaying = yt.isPlaying;
  const profile = useData(d => d.profile);
  
  const onlineChats = useNet(s => s.chats);
  const isOnline = !!useNet(s => s.room);

  const entry = catalogById(p.gameId)!;
  const v = p.view as any;

  // Confetti saat kamu juara 1 di akhir ronde/permainan.
  const iWon = !!(v?.over && Array.isArray(v.results) && v.results.some((r: { seat: number; rank: number }) => r.seat === v.you && r.rank === 1));
  useEffect(() => { if (iWon) setConfettiKey(Date.now()); }, [iWon]);
  const names: string[] = v ? (v.names ?? v.seats?.map((s: any) => s.name) ?? []) : [];
  const avatars = p.avatars ?? names.map((_, i) => (i === 0 ? '🙂' : AVATARS[(i + 3) % AVATARS.length]));
  const myTurn = v && v.turn !== null && v.turn === v.you;

  // Notifikasi giliran bermain (audio & push notification)
  const prevTurnRef = useRef(false);
  const [turnFlash, setTurnFlash] = useState<number | null>(null);
  useEffect(() => {
    if (myTurn && !prevTurnRef.current) {
      setTurnFlash(Date.now());
      play('turn');
      sendPushNotification('Giliranmu Bermain! 🎯', `Sekarang giliranmu mengambil keputusan di meja ${entry.name}.`);
    }
    prevTurnRef.current = !!myTurn;
  }, [myTurn, entry.name]);

  // Sync online chats to bubble
  const prevChatLen = useRef(0);
  useEffect(() => {
    if (isOnline && onlineChats.length > prevChatLen.current) {
      const last = onlineChats[onlineChats.length - 1];
      if (last.seat !== null && last.seat !== undefined) {
        setBubble({ text: last.text, seat: last.seat });
        setTimeout(() => setBubble(prev => (prev?.text === last.text ? null : prev)), 3000);
      }
    }
    prevChatLen.current = onlineChats.length;
  }, [onlineChats, isOnline]);

  const handleSendEmote = (content: string) => {
    const seat = v?.you ?? 0;
    
    if (isOnline) {
      sendRoomChat(content).catch(() => {});
      setBubble({ text: content, seat });
      setTimeout(() => setBubble(prev => (prev?.text === content ? null : prev)), 3000);
      return;
    }

    // Local Play:
    const myMsg: TableChatMessage = {
      id: `${Date.now()}-me`,
      sender: profile.name,
      avatar: profile.avatar,
      seat,
      text: content,
      time: Date.now(),
    };
    setLocalMessages(prev => [...prev, myMsg].slice(-40));
    setBubble({ text: content, seat });
    setTimeout(() => setBubble(prev => (prev?.text === content ? null : prev)), 3000);

    // Bot random banter response
    if (names.length > 1 && Math.random() < 0.65) {
      const botSeat = 1 + Math.floor(Math.random() * (names.length - 1));
      const botName = names[botSeat] || `Bot ${botSeat}`;
      const botAvatar = avatars[botSeat] || '🤖';
      const banter = BOT_BANTER[Math.floor(Math.random() * BOT_BANTER.length)];

      const delay = 1200 + Math.floor(Math.random() * 1500);
      setTimeout(() => {
        const botMsg: TableChatMessage = {
          id: `${Date.now()}-bot-${botSeat}`,
          sender: botName,
          avatar: botAvatar,
          seat: botSeat,
          text: banter,
          time: Date.now(),
        };
        setLocalMessages(prev => [...prev, botMsg].slice(-40));
        setBubble({ text: banter, seat: botSeat });
        play('emote');
        setTimeout(() => setBubble(prev => (prev?.text === banter ? null : prev)), 3200);
      }, delay);
    }
  };

  const handleToggleBgm = () => {
    openMusicModal();
  };

  const activeMessages = isOnline ? onlineChats : localMessages;

  return (
    <div className="table-page">
      <div className="table-bar">
        <button className="btn icon-btn" aria-label="Keluar" title="Keluar dari meja" onClick={() => (v?.over ? p.onExit() : setConfirmExit(true))}><IconX size={18} /></button>
        <div className="title" title={entry.name}>
          <span className="title-icon">{entry.icon}</span>{' '}
          <span className="title-full">{entry.name}</span>
          <span className="title-short">{entry.name.replace(/^Poker\s+/i, '')}</span>
          {p.subtitle && <span className="muted small"> · {p.subtitle}</span>}
        </div>

        {/* Indikator Ronde Aktif & Klasemen */}
        {p.series && (
          <button 
            className="badge series-badge" 
            onClick={() => setShowSeriesModal(true)} 
            title="Klik untuk melihat papan klasemen ronde"
            style={{ 
              cursor: 'pointer', 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: 5,
              background: 'rgba(229, 178, 66, 0.16)',
              borderColor: 'var(--gold)',
              color: 'var(--gold-light)'
            }}
          >
            <span className="series-badge-full">🎯 Ronde {p.series.currentRound}{p.series.targetRounds > 0 ? ` / ${p.series.targetRounds}` : ''} 📊</span>
            <span className="series-badge-short">🎯 {p.series.currentRound}{p.series.targetRounds > 0 ? `/${p.series.targetRounds}` : ''} 📊</span>
          </button>
        )}

        {myTurn && <span className="badge ok">Giliranmu</span>}
        
        {/* Casino Lounge BGM Player */}
        <button 
          className={`btn icon-btn${isMusicPlaying ? ' on-bgm' : ''}`} 
          onClick={handleToggleBgm} 
          aria-label="Musik Kasino Santai" 
          title={isMusicPlaying ? `🎵 Memutar: ${yt.currentTitle || 'YouTube Playlist'} (Klik untuk kontrol)` : 'Buka Playlist Musik Kasino'}
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

        {/* Live Chat & Emote */}
        <TableEmotes onSend={handleSendEmote} messages={activeMessages} />
        
        <button className="btn icon-btn" aria-label="Riwayat aksi" title="Riwayat aksi" onClick={() => setShowLog(true)}><IconList size={18} /></button>
        <button className="btn icon-btn" aria-label="Aturan" title="Aturan permainan" onClick={() => setShowRules(true)}><IconHelp size={18} /></button>
      </div>

      {myTurn && <Countdown deadline={p.turnDeadline ?? null} total={p.turnSeconds ?? 30} />}
      
      <Confetti burstKey={confettiKey} />
      <main className="felt" data-theme={feltTheme}>
        {turnFlash && <div key={turnFlash} className="turn-flash" aria-hidden="true"><span>Giliranmu</span></div>}
        {!v ? <div className="center-area muted">Menyiapkan meja…</div> : (
          <Suspense fallback={<div className="center-area muted">Memuat…</div>}>
            {v.gameId === 'holdem' && <HoldemTable v={v} act={p.act} avatars={avatars} dock={dock} bubble={bubble} />}
            {v.gameId === 'cangkulan' && <CangkulanTable v={v} act={p.act} avatars={avatars} dock={dock} bubble={bubble} />}
            {v.gameId === 'blackjack' && <BlackjackTable v={v} act={p.act} avatars={avatars} dock={dock} bubble={bubble} />}
            {(v.gameId === 'tongkrongan' || v.gameId === 'capsa-banting') && <TongkronganTable v={v} act={p.act} avatars={avatars} dock={dock} bubble={bubble} />}
            {!['holdem', 'cangkulan', 'blackjack', 'tongkrongan', 'capsa-banting'].includes(v.gameId) && (
              <UniversalTable v={v} act={p.act} avatars={avatars} dock={dock} bubble={bubble} />
            )}
          </Suspense>
        )}
      </main>

      <div className="error-text center" role="alert">{p.error}</div>
      {/* Kontrol aksi dirender ke sini (portal) agar tidak menutupi meja di layar pendek. */}
      <div className="dock" ref={setDock} />

      {/* MODAL HASIL PERMAINAN / RONDE */}
      {v?.over && v.results && p.series ? (
        p.series.isSeriesOver ? (
          // MODAL AKHIR PERTANDINGAN (SELURUH RONDE SELESAI)
          <Modal title={`🏆 Pertandingan Selesai (${p.series.targetRounds} Ronde)`} onClose={p.onExit}>
            <div className="stack" style={{ gap: 14 }}>
              <p className="center muted small" style={{ margin: 0 }}>
                Seluruh {p.series.targetRounds} ronde pertandingan telah selesai. Berikut klasemen juara akhir akumulasi seluruh ronde:
              </p>
              
              <div className="stack" style={{ gap: 8 }}>
                {p.series.scores.slice().sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins).map((s, idx) => (
                  <div key={s.seat} className={`result-row${idx === 0 ? ' first' : ''}`} style={{ padding: '8px 12px', background: idx === 0 ? 'rgba(229, 178, 66, 0.15)' : 'rgba(255,255,255,0.03)', borderRadius: 12 }}>
                    <span className="rank">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4'}</span>
                    <span className="avatar">{avatars[s.seat]}</span>
                    <div className="grow stack" style={{ gap: 2 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>{s.name}{s.seat === v.you ? ' (kamu)' : ''}</b>
                        <span className="badge ok" style={{ fontSize: '0.75rem' }}>{s.totalPoints} Poin · {s.wins}x Menang</span>
                      </div>
                      <span className="muted small" style={{ fontSize: '0.72rem' }}>
                        Riwayat: {s.rounds.map(r => `R${r.round}: Posisi ${r.rank} (+${r.pointsEarned}pt)`).join(' · ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="winner-banner" style={{ margin: '8px auto 0' }}>
                {p.series.scores.slice().sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins)[0]?.seat === v.you 
                  ? '🎉 SELAMAT! Kamu keluar sebagai JUARA UMUM seri ini! 🏆' 
                  : `Pertandingan selesai! Juara umum seri: ${p.series.scores.slice().sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins)[0]?.name} 👏`}
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                {p.onRematch && (
                  <button className="btn btn-gold grow" onClick={p.onRematch}>
                    {p.rematchLabel ?? 'Mulai Seri Baru 🔄'}
                  </button>
                )}
                <button className="btn grow" onClick={p.onExit}>Kembali ke Menu</button>
              </div>
            </div>
          </Modal>
        ) : (
          // MODAL RONDE SELESAI (LANJUT KE RONDE BERIKUTNYA)
          <Modal title={`🔔 Ronde ${p.series.currentRound} Selesai!`} onClose={p.onExit}>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted small">Hasil Ronde {p.series.currentRound}</span>
                <span className="badge" style={{ color: 'var(--gold-light)' }}>
                  Ronde {p.series.currentRound} dari {p.series.targetRounds > 0 ? p.series.targetRounds : '∞'}
                </span>
              </div>

              {/* Rincian Hasil Ronde Ini */}
              <div>
                {v.results.slice().sort((a: any, b: any) => a.rank - b.rank).map((r: any) => {
                  const pts = r.rank === 1 ? Math.max(1, names.length - 1) : Math.max(0, names.length - r.rank);
                  return (
                    <div key={r.seat} className={`result-row${r.rank === 1 ? ' first' : ''}`}>
                      <span className="rank">{r.rank}</span>
                      <span className="avatar">{avatars[r.seat]}</span>
                      <span className="grow">{names[r.seat]}{r.seat === v.you ? ' (kamu)' : ''}</span>
                      <span className="badge ok" style={{ fontSize: '0.72rem' }}>+{pts} Poin</span>
                      {p.gameId === 'tongkrongan' && (
                        <span className="badge" style={{ fontSize: '0.72rem' }}>
                          {r.rank === 1 ? '🏆 Habis' : r.rank === 4 ? `💥 Kalah (${r.score} kartu)` : `${r.score} kartu`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Klasemen Sementara Seri */}
              <div className="card-box" style={{ padding: '10px 14px', background: 'var(--paper-2)' }}>
                <div className="row small" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <b>📊 Klasemen Sementara Seri</b>
                  <span className="muted">Total Poin</span>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  {p.series.scores.slice().sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins).map((s, idx) => (
                    <div key={s.seat} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--hair)', paddingBottom: 4 }}>
                      <span>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4.'} {avatars[s.seat]} {s.name}{s.seat === v.you ? ' (kamu)' : ''}</span>
                      <b style={{ color: 'var(--gold-light)' }}>{s.totalPoints} pt <span className="muted" style={{ fontWeight: 'normal' }}>({s.wins}x 🏆)</span></b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                {p.onNextRound && (
                  <button className="btn btn-gold btn-lg grow" onClick={p.onNextRound} style={{ boxShadow: '0 0 20px rgba(229, 178, 66, 0.4)', minWidth: 140 }}>
                    Lanjut ke Ronde {p.series.currentRound + 1} ➔
                  </button>
                )}
                <button className="btn grow" onClick={p.onExit} style={{ minWidth: 100 }}>Akhiri Seri</button>
              </div>
            </div>
          </Modal>
        )
      ) : (
        // Standard Single-game result modal (e.g. Online multiplayer room)
        v?.over && v.results && (
          <Modal title="Permainan selesai" onClose={p.onExit}>
            <div>
              {v.results.slice().sort((a: any, b: any) => a.rank - b.rank).map((r: any) => (
                <div key={r.seat} className={`result-row${r.rank === 1 ? ' first' : ''}`}>
                  <span className="rank">{r.rank}</span>
                  <span className="avatar">{avatars[r.seat]}</span>
                  <span className="grow">{names[r.seat]}{r.seat === v.you ? ' (kamu)' : ''}</span>

                  {p.gameId === 'tongkrongan' ? (
                    <span className="badge" style={{ fontSize: '0.75rem' }}>
                      {r.rank === 1 ? '🏆 Juara 1 (Habis)' : r.rank === 4 ? `💥 Kalah (${r.score} kartu)` : `Posisi ${r.rank} (${r.score} kartu)`}
                    </span>
                  ) : p.gameId !== 'cangkulan' && <b>{r.score}</b>}
                </div>
              ))}
            </div>
            <p className="center" style={{ fontSize: '1.2rem', margin: '14px 0' }}>
              {v.results.find((r: any) => r.seat === v.you)?.rank === 1 ? '🏆 Kamu juara!' : 'Coba lagi, pasti bisa!'}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {p.onRematch && <button className="btn btn-gold grow" onClick={p.onRematch} style={{ minWidth: 130 }}>{p.rematchLabel ?? 'Main lagi'}</button>}
              <button className="btn grow" onClick={p.onExit} style={{ minWidth: 100 }}>Kembali</button>
            </div>
          </Modal>
        )
      )}

      {/* MODAL KLASEMEN RONDE (Bisa dibuka kapan saja selama permainan) */}
      {showSeriesModal && p.series && (
        <Modal title="📊 Papan Klasemen Seri Ronde" onClose={() => setShowSeriesModal(false)}>
          <div className="stack" style={{ gap: 14 }}>
            <p className="muted small center" style={{ margin: 0 }}>
              Sedang berlangsung ronde <b>{p.series.currentRound}</b> dari <b>{p.series.targetRounds > 0 ? p.series.targetRounds : '∞'}</b> ronde.
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {p.series.scores.slice().sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins).map((s, idx) => (
                <div key={s.seat} className={`result-row${idx === 0 ? ' first' : ''}`} style={{ padding: '8px 12px', background: 'var(--paper-2)', borderRadius: 12 }}>
                  <span className="rank">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4'}</span>
                  <span className="avatar">{avatars[s.seat]}</span>
                  <div className="grow stack" style={{ gap: 2 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b>{s.name}{s.seat === v?.you ? ' (kamu)' : ''}</b>
                      <span className="badge ok" style={{ fontSize: '0.75rem' }}>{s.totalPoints} Poin ({s.wins}x Menang)</span>
                    </div>
                    {s.rounds.length > 0 && (
                      <span className="muted small" style={{ fontSize: '0.72rem' }}>
                        Riwayat: {s.rounds.map(r => `R${r.round}: #${r.rank} (+${r.pointsEarned}pt)`).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-gold grow" onClick={() => setShowSeriesModal(false)}>Tutup</button>
          </div>
        </Modal>
      )}

      {showRules && <RulesModal gameId={p.gameId} onClose={() => setShowRules(false)} />}
      
      {showLog && (
        <Modal title="Riwayat aksi" onClose={() => setShowLog(false)}>
          <div className="log">{(v?.log ?? []).slice().reverse().map((e: any, i: number) => <p key={i}>{e.text}</p>)}</div>
        </Modal>
      )}

      {confirmExit && (
        <Modal title="Keluar Dari Meja?" onClose={() => setConfirmExit(false)}>
          <div className="stack" style={{ gap: 16, textAlign: 'center', padding: '4px 2px' }}>
            {/* Top Emblem with Glow */}
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #FFF1F0 0%, #FEE2E2 100%)',
              border: '2px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              color: '#DC2626',
              boxShadow: '0 8px 24px rgba(239, 68, 68, 0.18)',
            }}>
              <IconLogOut size={28} />
            </div>

            {/* Game & Round Snapshot Preview */}
            <div style={{
              background: 'var(--paper-2)',
              border: '1px solid var(--hair)',
              borderRadius: 14,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{catalogById(p.gameId)?.icon ?? '🃏'}</span>
                <div>
                  <b style={{ fontSize: 14, color: 'var(--ink)' }}>{catalogById(p.gameId)?.name ?? 'Game Kartu'}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {p.series && p.series.targetRounds > 0 
                      ? `Ronde ${p.series.currentRound} dari ${p.series.targetRounds}` 
                      : isOnline ? 'Room Online' : 'Mode vs Bot'}
                  </div>
                </div>
              </div>
              <span className="badge" style={{ fontSize: 11, fontWeight: 700, background: 'var(--rose-soft)', color: 'var(--rose-text)' }}>
                Sedang Aktif
              </span>
            </div>

            {/* Warning Alert Box */}
            <div style={{
              background: '#FFF5F5',
              border: '1px solid #FED7D7',
              borderRadius: 14,
              padding: '12px 14px',
              textAlign: 'left',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 16, lineHeight: 1.2 }}>⚠️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13, color: '#C53030' }}>
                  {isOnline ? 'Pertandingan online belum selesai' : 'Pertandingan masih berlangsung'}
                </b>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                  {isOnline 
                    ? 'Jika keluar sekarang dari meja online, giliranmu otomatis di-fold dan posisimu keluar dari room.' 
                    : 'Pertandingan saat ini akan dihentikan dan dianggap selesai.'}
                </p>
              </div>
            </div>

            {/* Action Buttons: 2 Tombol Seimbang, Besar & Jelas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-gold btn-lg"
                onClick={() => setConfirmExit(false)}
                style={{
                  fontWeight: 800,
                  height: 48,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <IconPlay size={16} /> Tetap Main
              </button>

              <button
                type="button"
                className="btn btn-danger btn-lg"
                onClick={p.onExit}
                style={{
                  fontWeight: 800,
                  height: 48,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'linear-gradient(135deg, #E53E3E 0%, #C53030 100%)',
                  color: '#FFFFFF',
                  borderRadius: 14,
                  border: 'none',
                  boxShadow: '0 6px 18px rgba(197, 48, 48, 0.32)',
                  cursor: 'pointer',
                }}
              >
                <IconLogOut size={16} /> Ya, Keluar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
