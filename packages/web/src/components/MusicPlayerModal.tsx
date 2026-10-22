// MusicPlayerModal.tsx — Luxury KUY Music Lounge Player & YouTube Playlist Selector
import React, { useState } from 'react';
import {
  useYouTubePlayer,
  useMusicModal,
  closeMusicModal,
  toggleYouTubePlay,
  playPlaylist,
  playSingleVideo,
  nextYouTubeTrack,
  prevYouTubeTrack,
  setYouTubeVolume,
  toggleYouTubeMute,
  toggleYouTubeShuffle,
  parseYouTubeInput,
  PRESET_PLAYLISTS,
  type PresetPlaylist,
  initYouTubePlayer,
  openMusicModal,
  buildEmbedUrl,
  toggleVideoDock,
  playPreset,
  dismissFloatingPill,
} from '../lib/youtubePlayer';
import { useData, update, emitNotice } from '../lib/store';
import { startBgm, stopBgm } from '../lib/sound';
import {
  IconPlay,
  IconPause,
  IconSkipBack,
  IconSkipForward,
  IconShuffle,
  IconVolume2,
  IconVolumeX,
  IconRadio,
  IconLink,
  IconX,
} from './icons';

export const MusicPlayerModal: React.FC = () => {
  const isOpen = useMusicModal();
  const yt = useYouTubePlayer();
  const settings = useData(d => d.settings);
  const musicMode = settings.music?.mode ?? 'youtube';

  const [customInput, setCustomInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isPlaying = yt.isPlaying;

  const handleTogglePlay = () => {
    toggleYouTubePlay();
  };

  const handleSelectPreset = (pl: PresetPlaylist) => {
    playPreset(pl);
    emitNotice('success', `Memutar: ${pl.name}`);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInputError(null);
    const parsed = parseYouTubeInput(customInput);
    if (!parsed) {
      setInputError('Link tidak valid. Masukkan URL playlist/video YouTube atau Playlist ID.');
      return;
    }

    if (musicMode !== 'youtube') {
      update(d => {
        if (!d.settings.music) {
          d.settings.music = { mode: 'youtube', youtubePlaylistId: parsed.id, youtubeTitle: 'Custom Playlist' };
        } else {
          d.settings.music.mode = 'youtube';
        }
      });
      stopBgm();
    }

    if (parsed.type === 'playlist') {
      playPlaylist(parsed.id, 'Custom Playlist', 'playlist');
      emitNotice('success', 'Memuat playlist YouTube pilihanmu...');
    } else {
      playSingleVideo(parsed.id, 'Custom Video Track');
      emitNotice('success', 'Memuat video YouTube pilihanmu...');
    }
    setCustomInput('');
  };

  const handleSwitchMode = (mode: 'youtube' | 'synth') => {
    if (mode === musicMode) return;
    update(d => {
      if (!d.settings.music) {
        d.settings.music = {
          mode,
          youtubePlaylistId: yt.playlistId,
          youtubeTitle: yt.currentTitle,
        };
      } else {
        d.settings.music.mode = mode;
      }
    });

    if (mode === 'synth') {
      if (yt.isPlaying) toggleYouTubePlay();
      if (settings.bgm) startBgm();
    } else {
      stopBgm();
      if (settings.bgm && !yt.isPlaying) toggleYouTubePlay();
    }
  };

  return (
    <div 
      className="modal-back" 
      onClick={e => e.target === e.currentTarget && closeMusicModal()} 
      role="dialog" 
      aria-modal="true" 
      aria-label="Pemutar Musik Kasino"
      style={{ zIndex: 1200 }}
    >
      <div 
        className="kuy-music-modal" 
        onClick={e => e.stopPropagation()}
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(212, 114, 52, 0.16) 0%, rgba(24, 18, 16, 0.98) 65%), #140f0d',
          border: '1px solid rgba(220, 150, 90, 0.3)',
          boxShadow: '0 32px 80px rgba(0, 0, 0, 0.8), 0 0 60px rgba(212, 114, 52, 0.15)',
          borderRadius: 24,
          padding: 24,
          width: '92%',
          maxWidth: 520,
          color: '#fdf6ee',
          maxHeight: '88vh',
          overflowY: 'auto',
          position: 'relative',
          margin: 'auto',
        }}
      >
        {/* Header Modal (Sticky) */}
        <div style={{ 
          position: 'sticky', 
          top: -24, 
          zIndex: 25, 
          background: 'linear-gradient(180deg, #1b1412 85%, rgba(27, 20, 18, 0.85))', 
          backdropFilter: 'blur(12px)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          marginBottom: 20, 
          borderBottom: '1px solid rgba(255,255,255,0.08)', 
          padding: '16px 24px',
          margin: '-24px -24px 20px -24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ 
              background: 'linear-gradient(135deg, #e63946 0%, #c1121f 100%)', 
              color: '#fff', 
              fontSize: 10, 
              fontWeight: 800, 
              padding: '4px 9px', 
              borderRadius: 6, 
              letterSpacing: 0.8,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              boxShadow: '0 2px 10px rgba(230, 57, 70, 0.4)'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: isPlaying ? 'pulse 1.2s infinite' : 'none' }} />
              LIVE RADIO
            </span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: '#fff' }}>
                Cardora Music Lounge
              </h2>
              <span style={{ fontSize: 11, color: '#a89a8f' }}>Suasana Kasino Mewah & Chill</span>
            </div>
          </div>
          <button 
            className="btn btn-sm" 
            onClick={closeMusicModal}
            aria-label="Tutup pemutar musik"
            style={{ 
              background: 'rgba(255,255,255,0.08)', 
              border: '1px solid rgba(255,255,255,0.12)', 
              color: '#d4c5b9', 
              borderRadius: '50%', 
              width: 34, 
              height: 34, 
              padding: 0,
              cursor: 'pointer',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <IconX size={16} />
          </button>
        </div>

        {/* Hero Card: Audio Deck & Now Playing */}
        <div style={{
          background: 'linear-gradient(160deg, rgba(212, 114, 52, 0.14) 0%, rgba(35, 25, 22, 0.75) 40%, rgba(20, 15, 14, 0.95) 100%)',
          border: '1px solid rgba(220, 140, 90, 0.35)',
          borderRadius: 20,
          padding: 20,
          marginBottom: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 12px 30px rgba(0,0,0,0.4)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Ambient Corner Glow */}
          <div style={{
            position: 'absolute',
            top: -30,
            right: -30,
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(212, 114, 52, 0.25) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* Photorealistic Spinning Vinyl Disc */}
            <div style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #2c2522 18%, #141110 32%, #2c2522 42%, #141110 58%, #2c2522 72%, #141110 85%)',
              border: '3px solid #3d302a',
              boxShadow: isPlaying 
                ? '0 0 24px rgba(212, 114, 52, 0.55), 0 6px 18px rgba(0,0,0,0.8)' 
                : '0 6px 18px rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              animation: isPlaying ? 'spin-vinyl 5s linear infinite' : 'none',
              flexShrink: 0,
            }}>
              {/* Gold Spindle Center */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #e76f51 0%, #d47234 50%, #f4a261 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.5), 0 2px 5px rgba(0,0,0,0.5)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 900,
              }}>
                ♠
              </div>
              {/* Spindle hole */}
              <div style={{
                position: 'absolute',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#140f0d',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9)',
              }} />
            </div>

            {/* Song Information */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ 
                  fontSize: 10, 
                  textTransform: 'uppercase', 
                  letterSpacing: 1.2, 
                  color: isPlaying ? '#ff9f55' : '#8e8178',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: isPlaying ? 'rgba(212, 114, 52, 0.18)' : 'rgba(255,255,255,0.06)',
                  padding: '3px 8px',
                  borderRadius: 20,
                  border: isPlaying ? '1px solid rgba(212, 114, 52, 0.35)' : '1px solid rgba(255,255,255,0.08)',
                }}>
                  {isPlaying ? (
                    <>
                      <span className="equalizer-bars" style={{ display: 'inline-flex', gap: 2, alignItems: 'flex-end', height: 11 }}>
                        <span style={{ width: 2, background: '#ff9f55', height: 7, animation: 'eq1 0.6s ease infinite alternate' }} />
                        <span style={{ width: 2, background: '#ff9f55', height: 11, animation: 'eq2 0.8s ease infinite alternate' }} />
                        <span style={{ width: 2, background: '#ff9f55', height: 5, animation: 'eq3 0.5s ease infinite alternate' }} />
                      </span>
                      MEMUTAR
                    </>
                  ) : (
                    'DIJEDA'
                  )}
                </span>
                {yt.isBuffering && (
                  <span style={{ fontSize: 10, color: '#f4a261', background: 'rgba(244,162,97,0.18)', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
                    Memuat...
                  </span>
                )}
              </div>

              <div style={{ 
                fontSize: 16, 
                fontWeight: 800, 
                color: '#fff', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                marginBottom: 3,
                letterSpacing: -0.2,
              }}>
                {yt.currentTitle || 'Chill Lofi Poker Beats'}
              </div>

              <div style={{ fontSize: 12, color: '#a89a8f', display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconRadio size={13} style={{ color: '#d47234' }} />
                <span>{yt.currentAuthor || 'Cardora Lounge Radio'}</span>
              </div>
            </div>
          </div>

          {/* Master Deck Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 4 }}>
            <button 
              onClick={toggleYouTubeShuffle}
              title="Acak Urutan (Shuffle)"
              style={{
                background: yt.isShuffle ? 'rgba(212, 114, 52, 0.35)' : 'rgba(255,255,255,0.06)',
                border: yt.isShuffle ? '1px solid rgba(212, 114, 52, 0.7)' : '1px solid rgba(255,255,255,0.1)',
                color: yt.isShuffle ? '#ffaa66' : '#b2a59a',
                width: 38,
                height: 38,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <IconShuffle size={16} />
            </button>

            <button 
              onClick={prevYouTubeTrack}
              title="Lagu Sebelumnya"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff',
                width: 44,
                height: 44,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, background 0.15s ease',
              }}
            >
              <IconSkipBack size={18} />
            </button>

            {/* Glowing Master Play/Pause Dial */}
            <button 
              onClick={handleTogglePlay}
              title={isPlaying ? 'Jeda Musik' : 'Putar Musik'}
              style={{
                background: isPlaying 
                  ? 'linear-gradient(145deg, #e76f51 0%, #d47234 50%, #ba581c 100%)' 
                  : 'linear-gradient(145deg, #f4a261 0%, #e76f51 50%, #d47234 100%)',
                border: '2px solid rgba(255,255,255,0.25)',
                color: '#fff',
                width: 58,
                height: 58,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: isPlaying 
                  ? '0 8px 25px rgba(212, 114, 52, 0.55), inset 0 2px 3px rgba(255,255,255,0.5), inset 0 -2px 5px rgba(0,0,0,0.4)'
                  : '0 6px 18px rgba(0,0,0,0.5), inset 0 2px 3px rgba(255,255,255,0.4)',
                transform: 'scale(1)',
                transition: 'transform 0.15s ease, box-shadow 0.2s ease',
              }}
            >
              {isPlaying ? <IconPause size={24} /> : <IconPlay size={24} style={{ marginLeft: 2 }} />}
            </button>

            <button 
              onClick={nextYouTubeTrack}
              title="Lagu Berikutnya"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff',
                width: 44,
                height: 44,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'transform 0.15s ease, background 0.15s ease',
              }}
            >
              <IconSkipForward size={18} />
            </button>
          </div>

          {/* Luxury Volume Bar */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            background: 'rgba(0,0,0,0.25)', 
            padding: '8px 14px', 
            borderRadius: 30,
            border: '1px solid rgba(255,255,255,0.06)' 
          }}>
            <button 
              onClick={toggleYouTubeMute}
              style={{
                background: 'none',
                border: 'none',
                color: yt.isMuted ? '#8e8178' : '#e09867',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 0,
              }}
              title={yt.isMuted ? 'Nyalakan Suara' : 'Bisukan'}
            >
              {yt.isMuted || yt.volume === 0 ? <IconVolumeX size={18} /> : <IconVolume2 size={18} />}
            </button>
            <input 
              type="range"
              min={0}
              max={100}
              value={yt.isMuted ? 0 : yt.volume}
              onChange={e => setYouTubeVolume(Number(e.target.value))}
              className="music-vol-slider"
              style={{
                flex: 1,
              }}
            />
            <span style={{ 
              fontSize: 11, 
              color: '#d4c5b9', 
              minWidth: 38, 
              textAlign: 'center', 
              fontWeight: 800,
              background: 'rgba(255,255,255,0.08)',
              padding: '2px 6px',
              borderRadius: 10,
            }}>
              {yt.isMuted ? '0%' : `${yt.volume}%`}
            </span>
          </div>
        </div>

        {/* Curated Playlist Choices (The Lounge Collection) */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#f0e6dd', letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🎼</span> KOLEKSI PLAYLIST KASINO
            </span>
            <span style={{ fontSize: 11, color: '#ff9f55', fontWeight: 600 }}>1-Klik langsung berganti</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 11 }}>
            {PRESET_PLAYLISTS.map((pl) => {
              const isActive = yt.playlistId === pl.id;
              return (
                <button
                  key={pl.id}
                  onClick={() => handleSelectPreset(pl)}
                  style={{
                    background: isActive 
                      ? 'linear-gradient(145deg, rgba(212, 114, 52, 0.25) 0%, rgba(35, 25, 22, 0.85) 100%)' 
                      : 'linear-gradient(145deg, rgba(255, 255, 255, 0.05) 0%, rgba(20, 16, 15, 0.6) 100%)',
                    border: isActive 
                      ? '1.5px solid #d47234' 
                      : '1px solid rgba(255, 255, 255, 0.09)',
                    boxShadow: isActive 
                      ? '0 6px 20px rgba(212, 114, 52, 0.25), inset 0 1px 2px rgba(255,255,255,0.15)' 
                      : '0 4px 12px rgba(0,0,0,0.3)',
                    borderRadius: 16,
                    padding: '14px 14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    position: 'relative',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div style={{ 
                    fontSize: 22, 
                    lineHeight: 1, 
                    background: isActive ? 'rgba(212, 114, 52, 0.3)' : 'rgba(255,255,255,0.07)', 
                    padding: 8, 
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    flexShrink: 0,
                  }}>
                    {pl.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: isActive ? '#ffaa66' : '#fff' }}>
                        {pl.name}
                      </span>
                      {isActive && (
                        <span style={{ 
                          fontSize: 9, 
                          background: 'linear-gradient(135deg, #d47234, #ba581c)', 
                          color: '#fff', 
                          padding: '2px 7px', 
                          borderRadius: 6, 
                          fontWeight: 800,
                          letterSpacing: 0.5,
                          boxShadow: '0 2px 6px rgba(212, 114, 52, 0.4)'
                        }}>
                          AKTIF
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: '#a09388', lineHeight: 1.35 }}>
                      {pl.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom YouTube Playlist Input Box */}
        <div style={{
          background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.04) 0%, rgba(20, 16, 15, 0.7) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.09)',
          borderRadius: 18,
          padding: 16,
          marginBottom: 16,
          boxShadow: '0 6px 16px rgba(0,0,0,0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <IconLink size={14} style={{ color: '#ff9f55' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#fdf6ee', letterSpacing: 0.2 }}>
              Putar Playlist / Video YouTube Kamu Sendiri:
            </span>
          </div>

          <form onSubmit={handleCustomSubmit} style={{ display: 'flex', gap: 8 }}>
            <input 
              type="text"
              placeholder="Tempel link playlist / video YouTube..."
              value={customInput}
              onChange={e => { setCustomInput(e.target.value); setInputError(null); }}
              style={{
                flex: 1,
                background: 'rgba(0, 0, 0, 0.4)',
                border: inputError ? '1px solid #e63946' : '1px solid rgba(220, 140, 90, 0.25)',
                borderRadius: 12,
                padding: '10px 14px',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
              }}
            />
            <button 
              type="submit"
              className="btn btn-gold btn-sm"
              style={{ 
                padding: '0 16px', 
                whiteSpace: 'nowrap', 
                fontWeight: 800,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>Putar</span>
              <IconPlay size={13} />
            </button>
          </form>
          {inputError && (
            <p style={{ margin: '6px 0 0 0', fontSize: 11, color: '#ff8a80', fontWeight: 600 }}>
              {inputError}
            </p>
          )}
          <span style={{ fontSize: 10, color: '#887d74', display: 'block', marginTop: 7 }}>
            Mendukung link playlist YouTube lengkap (`list=...`) maupun video musik individual.
          </span>
        </div>

        {/* Video Dock & Offline Fallback Bottom Bar */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {musicMode === 'youtube' ? (
            <button
              onClick={() => toggleVideoDock()}
              style={{
                background: yt.videoDockVisible ? 'rgba(212, 114, 52, 0.25)' : 'rgba(255,255,255,0.06)',
                border: yt.videoDockVisible ? '1px solid #d47234' : '1px solid rgba(255,255,255,0.12)',
                color: yt.videoDockVisible ? '#ffaa66' : '#d4c5b9',
                borderRadius: 10,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <span>{yt.videoDockVisible ? '📺 Sembunyikan Layar Video' : '📺 Tampilkan Video di Pojok'}</span>
            </button>
          ) : <div />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#8e8178' }}>Sumber:</span>
            <button
              onClick={() => handleSwitchMode('youtube')}
              style={{
                background: musicMode === 'youtube' ? 'rgba(230, 57, 70, 0.25)' : 'transparent',
                border: musicMode === 'youtube' ? '1px solid #e63946' : '1px solid rgba(255,255,255,0.1)',
                color: musicMode === 'youtube' ? '#ff7b72' : '#9e9187',
                borderRadius: 8,
                padding: '4px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔴 YouTube
            </button>
            <button
              onClick={() => handleSwitchMode('synth')}
              style={{
                background: musicMode === 'synth' ? 'rgba(212, 114, 52, 0.25)' : 'transparent',
                border: musicMode === 'synth' ? '1px solid #d47234' : '1px solid rgba(255,255,255,0.1)',
                color: musicMode === 'synth' ? '#ffaa66' : '#9e9187',
                borderRadius: 8,
                padding: '4px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🎹 Synth Offline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Global background host untuk iframe YouTube (tidak dihentikan saat navigasi halaman) */
export const GlobalYouTubeHost: React.FC = () => {
  const yt = useYouTubePlayer();

  React.useEffect(() => {
    initYouTubePlayer('kuy-yt-iframe');
  }, []);

  return (
    <div 
      id="kuy-yt-iframe-container"
      style={{
        position: 'fixed',
        bottom: yt.videoDockVisible ? 80 : 0,
        right: yt.videoDockVisible ? 20 : 0,
        width: yt.videoDockVisible ? 260 : 160,
        height: yt.videoDockVisible ? 146 : 90,
        borderRadius: yt.videoDockVisible ? 14 : 0,
        overflow: 'hidden',
        boxShadow: yt.videoDockVisible ? '0 12px 36px rgba(0,0,0,0.7), 0 0 20px rgba(212,114,52,0.3)' : 'none',
        border: yt.videoDockVisible ? '2px solid rgba(220, 140, 90, 0.5)' : 'none',
        zIndex: yt.videoDockVisible ? 950 : -1,
        opacity: yt.videoDockVisible ? 1 : 0.01,
        pointerEvents: yt.videoDockVisible ? 'auto' : 'none',
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        background: '#000',
      }}
    >
      {yt.videoDockVisible && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }}>
          <button
            onClick={() => toggleVideoDock()}
            style={{
              background: 'rgba(0,0,0,0.7)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: 24,
              height: 24,
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Sembunyikan Layar Video"
          >
            ✕
          </button>
        </div>
      )}
      <iframe
        id="kuy-yt-iframe"
        src={yt.currentType === 'youtube' ? buildEmbedUrl(yt.playlistId, yt.embedKind, true) : 'about:blank'}
        title="Cardora Background Music"
        width="100%"
        height="100%"
        style={{ border: 'none', display: 'block' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
};

/** Floating mini music pill di sudut kanan bawah saat musik sedang aktif diputar */
export const FloatingMusicWidget: React.FC = () => {
  const yt = useYouTubePlayer();
  const isPlaying = yt.isPlaying;

  // Hanya tampilkan jika musik SEDANG AKTIF diputar (jika dijeda/dimatikan, sembunyikan sepenuhnya)
  if (yt.pillDismissed || !isPlaying) return null;

  return (
    <div 
      className="floating-music-pill"
      onClick={() => openMusicModal()}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 900,
        background: 'linear-gradient(135deg, rgba(28, 22, 20, 0.96) 0%, rgba(18, 14, 13, 0.98) 100%)',
        border: '1px solid rgba(220, 140, 90, 0.38)',
        backdropFilter: 'blur(12px)',
        borderRadius: 40,
        padding: '6px 12px 6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        boxShadow: '0 10px 28px rgba(0,0,0,0.5), 0 0 15px rgba(212,114,52,0.15)',
        cursor: 'pointer',
        color: '#fdf6ee',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      title="Klik untuk membuka pemutar musik lengkap"
    >
      <span style={{ fontSize: 16 }}>{isPlaying ? '🎵' : '⏸️'}</span>
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 135, overflow: 'hidden' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {yt.currentTitle || 'Casino Lounge Music'}
        </span>
        <span style={{ fontSize: 9, color: isPlaying ? '#ff9f55' : '#a89a8f', fontWeight: 600 }}>
          {isPlaying ? 'Sedang Diputar' : 'Dijeda'}
        </span>
      </div>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          toggleYouTubePlay();
        }}
        style={{
          background: isPlaying ? 'rgba(212, 114, 52, 0.3)' : 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: '#fff',
          borderRadius: '50%',
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: 12,
        }}
        title={isPlaying ? 'Jeda' : 'Putar'}
      >
        {isPlaying ? <IconPause size={12} /> : <IconPlay size={12} style={{ marginLeft: 1 }} />}
      </button>

      {/* Tombol Tutup / Hilangkan Floating Pill */}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          dismissFloatingPill();
        }}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: 'none',
          color: '#9e9187',
          borderRadius: '50%',
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          marginLeft: 2,
          transition: 'all 0.15s ease',
        }}
        title="Tutup & Sembunyikan widget ini"
      >
        <IconX size={12} />
      </button>
    </div>
  );
};
