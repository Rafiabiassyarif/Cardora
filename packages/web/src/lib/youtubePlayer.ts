// youtubePlayer.ts — Unified Luxury Music & Playlist Engine untuk Cardora (HTML5 Stream + YouTube + WebAudio Synth)
import { useEffect, useState } from 'react';
import { getData, update } from './store';
import { startBgm, stopBgm, updateBgmVolume } from './sound';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

export interface PresetPlaylist {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tag: string;
  type: 'stream' | 'youtube' | 'synth';
  streamUrl?: string;
  youtubeId?: string;
}

export const PRESET_PLAYLISTS: PresetPlaylist[] = [
  {
    id: 'smooth-jazz',
    name: 'Smooth Jazz Lounge',
    desc: 'Vintage spy-fi, double bass & saxophone kasino berkelas',
    icon: '🎷',
    tag: 'Jazz Lounge',
    type: 'synth',
  },
  {
    id: 'chill-lofi',
    name: 'Chill Lofi Poker Beats',
    desc: 'Downtempo beats & chill ambient pengiring konsentrasi',
    icon: '☕',
    tag: 'Lo-Fi Chill',
    type: 'synth',
  },
  {
    id: 'vegas-royale',
    name: 'Vegas Royale Luxury',
    desc: 'Nuansa megah kasino retro Vegas & vintage bachelor pad',
    icon: '🎲',
    tag: 'Casino Vegas',
    type: 'synth',
  },
  {
    id: 'synth-casino',
    name: 'Casino Velvet Synth',
    desc: 'Piano elektrik 7th chords sintetis 100% offline tanpa kuota',
    icon: '🎹',
    tag: 'Offline Synth',
    type: 'synth',
  },
];

export interface YouTubePlayerState {
  isReady: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTitle: string;
  currentAuthor: string;
  currentVideoId: string;
  playlistId: string;
  currentType: 'stream' | 'youtube' | 'synth';
  currentStreamUrl?: string;
  /** Jenis embed YouTube untuk mode 'youtube'. */
  embedKind: 'playlist' | 'video';
  volume: number; // 0 - 100
  isMuted: boolean;
  isShuffle: boolean;
  error: string | null;
  videoDockVisible: boolean;
  pillDismissed: boolean;
}

let liveAudioElement: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

let currentState: YouTubePlayerState = {
  isReady: true,
  isPlaying: false,
  isBuffering: false,
  currentTitle: 'Smooth Jazz Lounge',
  currentAuthor: 'Cardora Casino Radio',
  currentVideoId: '',
  playlistId: 'smooth-jazz',
  // Default: synth offline (preset "Smooth Jazz Lounge"). Stream radio eksternal lama dialihkan
  // server-nya ke alert.mp3, jadi tidak dipakai sebagai default.
  currentType: 'synth',
  embedKind: 'playlist',
  volume: 45,
  isMuted: false,
  isShuffle: false,
  error: null,
  videoDockVisible: false,
  pillDismissed: false,
};

function notify() {
  listeners.forEach(fn => fn());
}

export function subscribeYouTubePlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getYouTubePlayerState(): YouTubePlayerState {
  return currentState;
}

// Modal open/close
let modalOpen = false;
const modalListeners = new Set<() => void>();

export function openMusicModal() {
  modalOpen = true;
  currentState.pillDismissed = false; // reset dismissed when opening modal
  modalListeners.forEach(fn => fn());
  notify();
}

export function closeMusicModal() {
  modalOpen = false;
  modalListeners.forEach(fn => fn());
}

export function useMusicModal(): boolean {
  const [open, setOpen] = useState(modalOpen);
  useEffect(() => {
    const fn = () => setOpen(modalOpen);
    modalListeners.add(fn);
    return () => { modalListeners.delete(fn); };
  }, []);
  return open;
}

/** Inisialisasi Audio Stream Element */
function getLiveAudio(): HTMLAudioElement {
  if (!liveAudioElement) {
    liveAudioElement = new Audio();
    liveAudioElement.crossOrigin = 'anonymous';
    liveAudioElement.preload = 'none';

    liveAudioElement.addEventListener('playing', () => {
      currentState.isPlaying = true;
      currentState.isBuffering = false;
      update(d => { d.settings.bgm = true; });
      notify();
    });

    liveAudioElement.addEventListener('waiting', () => {
      currentState.isBuffering = true;
      notify();
    });

    liveAudioElement.addEventListener('pause', () => {
      // Abaikan pause yang dipicu saat pindah ke synth/YouTube (bukan aksi pengguna pada stream).
      if (currentState.currentType !== 'stream') return;
      currentState.isPlaying = false;
      currentState.isBuffering = false;
      update(d => { d.settings.bgm = false; });
      notify();
    });

    liveAudioElement.addEventListener('error', () => {
      // src dikosongkan saat pindah preset juga memicu 'error' — hanya tangani bila stream memang aktif.
      if (currentState.currentType !== 'stream' || !liveAudioElement?.getAttribute('src')) return;
      currentState.isBuffering = false;
      // Fallback mulus ke WebAudio synth agar musik selalu berbunyi!
      startBgm();
      currentState.isPlaying = true;
      currentState.currentAuthor = 'Cardora Casino Synth (Fallback)';
      notify();
    });
  }
  return liveAudioElement;
}

/** Buat URL embed YouTube jika mode youtube aktif */
export function buildEmbedUrl(id: string, type: 'playlist' | 'video' = 'playlist', autoplay = false): string {
  const ap = autoplay ? 1 : 0;
  if (type === 'playlist') {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(id)}&enablejsapi=1&autoplay=${ap}&playsinline=1&modestbranding=1&rel=0`;
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&autoplay=${ap}&playsinline=1&modestbranding=1&rel=0`;
}

/** Kirim perintah ke iframe YouTube */
export function sendYouTubeCommand(func: string, args: any = '') {
  const iframe = document.getElementById('kuy-yt-iframe') as HTMLIFrameElement | null;
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: func,
          args: args || '',
        }),
        '*'
      );
    } catch (err) {
      console.warn('[YouTube postMessage Error]', err);
    }
  }
}

/** Listener window message dari YouTube Iframe */
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (!data) return;

      if (data.event === 'infoDelivery' && data.info) {
        const info = data.info;
        if (typeof info.playerState === 'number' && currentState.currentType === 'youtube') {
          currentState.isPlaying = info.playerState === 1;
          currentState.isBuffering = info.playerState === 3;
          update(d => { d.settings.bgm = info.playerState === 1; });
          notify();
        }
        if (info.videoData && info.videoData.title && currentState.currentType === 'youtube') {
          currentState.currentTitle = info.videoData.title;
          currentState.currentAuthor = info.videoData.author || 'YouTube';
          currentState.currentVideoId = info.videoData.video_id || '';
          notify();
        }
      }
    } catch {}
  });
}

/** Inisialisasi Player pada saat aplikasi dibuka */
export function initYouTubePlayer(elementId: string) {
  if (typeof window === 'undefined') return;

  const savedVol = Math.round((getData().settings.bgmVolume ?? 0.35) * 100);
  currentState.volume = savedVol;
  currentState.isReady = true;

  const audio = getLiveAudio();
  audio.volume = savedVol / 100;
  notify();
}

/** Putar track atau preset tertentu */
export function playPreset(pl: PresetPlaylist) {
  currentState.playlistId = pl.id;
  currentState.currentTitle = pl.name;
  currentState.currentAuthor = pl.tag;
  currentState.currentType = 'synth';
  currentState.error = null;
  currentState.videoDockVisible = false;

  // Hentikan live audio stream & YouTube video jika ada
  if (liveAudioElement) {
    liveAudioElement.pause();
    liveAudioElement.src = '';
  }
  sendYouTubeCommand('pauseVideo');

  update(d => {
    d.settings.bgm = true;
    if (!d.settings.music) {
      d.settings.music = { mode: 'synth', youtubePlaylistId: pl.id, youtubeTitle: pl.name };
    } else {
      d.settings.music.mode = 'synth';
      d.settings.music.youtubePlaylistId = pl.id;
      d.settings.music.youtubeTitle = pl.name;
    }
  });

  startBgm(pl.id);
  currentState.isPlaying = true;
  notify();
}

/** Kompatibilitas mundur: playPlaylist */
export function playPlaylist(idOrUrl: string, customTitle?: string, type: 'playlist' | 'video' = 'playlist') {
  // Cek apakah ada di preset
  const preset = PRESET_PLAYLISTS.find(p => p.id === idOrUrl || p.id.toLowerCase() === idOrUrl.toLowerCase());
  if (preset) {
    playPreset(preset);
    return;
  }

  // Jika input kustom YouTube
  currentState.currentType = 'youtube';
  currentState.embedKind = type;
  currentState.playlistId = idOrUrl;
  currentState.currentTitle = customTitle || 'Custom YouTube Track';
  currentState.currentAuthor = 'YouTube Stream';
  currentState.videoDockVisible = true; // Munculkan layar video agar interaktif

  if (liveAudioElement) liveAudioElement.pause();
  stopBgm();

  update(d => {
    d.settings.bgm = true;
    if (!d.settings.music) {
      d.settings.music = { mode: 'youtube', youtubePlaylistId: idOrUrl, youtubeTitle: customTitle };
    } else {
      d.settings.music.mode = 'youtube';
      d.settings.music.youtubePlaylistId = idOrUrl;
    }
  });

  // src iframe dikendalikan GlobalYouTubeHost dari state (playlistId + embedKind) — tidak diset manual
  // agar render React berikutnya tidak memuat ulang iframe tanpa autoplay.
  currentState.isPlaying = true;
  notify();
}

export function playSingleVideo(videoId: string, customTitle?: string) {
  playPlaylist(videoId, customTitle, 'video');
}

/** Toggle Play / Pause */
export function toggleYouTubePlay(): boolean {
  if (currentState.isPlaying) {
    pauseYouTube();
    return false;
  } else {
    playYouTube();
    return true;
  }
}

export function playYouTube() {
  currentState.isPlaying = true;
  currentState.error = null;
  update(d => { d.settings.bgm = true; });

  if (currentState.currentType === 'synth' || !currentState.currentType) {
    startBgm(currentState.playlistId);
  } else if (currentState.currentType === 'stream') {
    const audio = getLiveAudio();
    if (!audio.src || audio.src === 'about:blank') {
      audio.src = currentState.currentStreamUrl || '';
    }
    audio.volume = currentState.isMuted ? 0 : currentState.volume / 100;
    audio.play().catch(() => {
      startBgm(currentState.playlistId);
    });
  } else {
    sendYouTubeCommand('playVideo');
  }

  notify();
}

export function pauseYouTube() {
  currentState.isPlaying = false;
  update(d => { d.settings.bgm = false; });

  if (liveAudioElement) {
    liveAudioElement.pause();
  }
  stopBgm();
  sendYouTubeCommand('pauseVideo');

  notify();
}

export function nextYouTubeTrack() {
  // Ganti ke preset berikutnya dalam koleksi
  const curIdx = PRESET_PLAYLISTS.findIndex(p => p.id === currentState.playlistId);
  const nextIdx = (curIdx + 1) % PRESET_PLAYLISTS.length;
  playPreset(PRESET_PLAYLISTS[nextIdx]);
}

export function prevYouTubeTrack() {
  const curIdx = PRESET_PLAYLISTS.findIndex(p => p.id === currentState.playlistId);
  const prevIdx = (curIdx - 1 + PRESET_PLAYLISTS.length) % PRESET_PLAYLISTS.length;
  playPreset(PRESET_PLAYLISTS[prevIdx]);
}

export function setYouTubeVolume(vol: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(vol)));
  currentState.volume = clamped;

  if (liveAudioElement) {
    liveAudioElement.volume = clamped / 100;
  }
  updateBgmVolume(clamped / 100);
  sendYouTubeCommand('setVolume', [clamped]);

  if (clamped > 0 && currentState.isMuted) {
    currentState.isMuted = false;
    sendYouTubeCommand('unMute');
  }

  update(d => {
    d.settings.bgmVolume = clamped / 100;
  });
  notify();
}

export function toggleYouTubeMute() {
  currentState.isMuted = !currentState.isMuted;
  if (currentState.isMuted) {
    if (liveAudioElement) liveAudioElement.volume = 0;
    updateBgmVolume(0);
    sendYouTubeCommand('mute');
  } else {
    if (liveAudioElement) liveAudioElement.volume = currentState.volume / 100;
    updateBgmVolume(currentState.volume / 100);
    sendYouTubeCommand('unMute');
    sendYouTubeCommand('setVolume', [currentState.volume]);
  }
  notify();
}

export function toggleYouTubeShuffle() {
  currentState.isShuffle = !currentState.isShuffle;
  notify();
}

export function toggleVideoDock() {
  currentState.videoDockVisible = !currentState.videoDockVisible;
  notify();
}

export function dismissFloatingPill() {
  currentState.pillDismissed = true;
  notify();
}

/** Parser input URL/ID YouTube */
export function parseYouTubeInput(input: string): { type: 'playlist' | 'video'; id: string } | null {
  const clean = input.trim();
  if (!clean) return null;

  // Cek parameter list= (Playlist)
  const listMatch = clean.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch) {
    return { type: 'playlist', id: listMatch[1] };
  }

  // Jika input diawali prefix playlist umum
  if (/^(PL|RD|UU|FL|LL|OLAK)[a-zA-Z0-9_-]+$/i.test(clean)) {
    return { type: 'playlist', id: clean };
  }

  // Cek Video URL (watch?v= atau youtu.be/)
  const videoMatch = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (videoMatch) {
    return { type: 'video', id: videoMatch[1] };
  }

  // ID video 11 karakter
  if (/^[\w-]{11}$/.test(clean)) {
    return { type: 'video', id: clean };
  }

  // ID panjang lainnya diasumsikan playlist
  if (/^[a-zA-Z0-9_-]{12,}$/.test(clean)) {
    return { type: 'playlist', id: clean };
  }

  return null;
}

/** React Hook untuk berlangganan status YouTube Player */
export function useYouTubePlayer(): YouTubePlayerState {
  const [state, setState] = useState<YouTubePlayerState>(currentState);

  useEffect(() => {
    return subscribeYouTubePlayer(() => {
      setState({ ...currentState });
    });
  }, []);

  return state;
}
