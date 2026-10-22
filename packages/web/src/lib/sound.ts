// sound.ts — efek suara sintetis WebAudio & Multi-Track Casino Lounge BGM sintetis (100% offline, jelas, jernih & tanpa dependensi).
import { getData } from './store';

let ctx: AudioContext | null = null;
export type Sfx = 'card' | 'turn' | 'win' | 'room' | 'error' | 'chip' | 'click' | 'knock' | 'shuffle' | 'allin' | 'achievement' | 'emote' | 'rebuy';

function getContext(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

const TONES: Record<Sfx, { f: number; t: number; d: number; type?: OscillatorType; g?: number }[]> = {
  card: [{ f: 1400, t: 0, d: 0.035, type: 'triangle', g: 0.15 }],
  turn: [{ f: 660, t: 0, d: 0.09 }, { f: 880, t: 0.09, d: 0.14 }],
  win: [{ f: 523, t: 0, d: 0.12 }, { f: 659, t: 0.11, d: 0.12 }, { f: 784, t: 0.22, d: 0.12 }, { f: 1047, t: 0.33, d: 0.3 }],
  room: [{ f: 740, t: 0, d: 0.08 }, { f: 988, t: 0.08, d: 0.1 }],
  error: [{ f: 200, t: 0, d: 0.15, type: 'square', g: 0.08 }],
  chip: [{ f: 2200, t: 0, d: 0.035, type: 'triangle', g: 0.15 }, { f: 1750, t: 0.025, d: 0.035, type: 'sine', g: 0.1 }],
  click: [{ f: 950, t: 0, d: 0.02, type: 'triangle', g: 0.08 }],
  knock: [
    { f: 260, t: 0, d: 0.04, type: 'triangle', g: 0.2 },
    { f: 240, t: 0.08, d: 0.05, type: 'triangle', g: 0.18 },
  ],
  shuffle: [
    { f: 1200, t: 0, d: 0.02, type: 'triangle', g: 0.08 },
    { f: 1500, t: 0.025, d: 0.025, type: 'triangle', g: 0.09 },
    { f: 1800, t: 0.05, d: 0.03, type: 'triangle', g: 0.08 },
  ],
  allin: [
    { f: 196, t: 0, d: 0.45, type: 'triangle', g: 0.3 },
    { f: 294, t: 0.02, d: 0.4, type: 'sine', g: 0.25 },
    { f: 392, t: 0.04, d: 0.35, type: 'sine', g: 0.22 },
  ],
  achievement: [
    { f: 523, t: 0, d: 0.1, type: 'sine', g: 0.2 },
    { f: 659, t: 0.08, d: 0.1, type: 'sine', g: 0.2 },
    { f: 784, t: 0.16, d: 0.12, type: 'sine', g: 0.22 },
    { f: 1046, t: 0.24, d: 0.25, type: 'triangle', g: 0.25 },
  ],
  emote: [
    { f: 880, t: 0, d: 0.05, type: 'sine', g: 0.15 },
    { f: 1100, t: 0.03, d: 0.06, type: 'sine', g: 0.12 },
  ],
  rebuy: [
    { f: 1318, t: 0, d: 0.06, type: 'triangle', g: 0.18 },
    { f: 1568, t: 0.06, d: 0.06, type: 'triangle', g: 0.18 },
    { f: 2093, t: 0.12, d: 0.15, type: 'triangle', g: 0.25 },
  ],
};

export function play(sfx: Sfx) {
  if (!getData().settings.sound) return;
  const audio = getContext();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    for (const tone of TONES[sfx] ?? []) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = tone.type ?? 'sine';
      o.frequency.value = tone.f;
      const peak = tone.g ?? 0.15;
      g.gain.setValueAtTime(0.0001, now + tone.t);
      g.gain.exponentialRampToValueAtTime(peak, now + tone.t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + tone.t + tone.d);
      o.connect(g).connect(audio.destination);
      o.start(now + tone.t);
      o.stop(now + tone.t + tone.d + 0.02);
    }
  } catch { /* ignore */ }
}

/* ==========================================================================
   Multi-Track Casino Lounge Synthesizer Engine (Audible, Rich & Warm)
   ========================================================================== */
export type BgmTrackId = 'smooth-jazz' | 'chill-lofi' | 'vegas-royale' | 'synth-casino';

interface TrackChord {
  bass: number;
  chord: number[];
  fill?: number[];
}

interface TrackDefinition {
  bpm: number;
  barDuration: number;
  chords: TrackChord[];
  waveType: OscillatorType;
  filterFreq?: number;
}

const TRACKS: Record<BgmTrackId, TrackDefinition> = {
  // 1. Smooth Jazz Lounge — Vintage double bass & warm 9th chords (~96 BPM swing)
  'smooth-jazz': {
    bpm: 96,
    barDuration: 2.5,
    waveType: 'triangle',
    chords: [
      { bass: 87.31, chord: [220.00, 261.63, 329.63, 392.00], fill: [440, 523.25] }, // Fmaj9
      { bass: 73.42, chord: [174.61, 220.00, 261.63, 329.63], fill: [349.23, 392] },   // Dm9
      { bass: 98.00, chord: [233.08, 293.66, 349.23, 440.00], fill: [466.16, 523.25] }, // Gm9
      { bass: 65.41, chord: [164.81, 233.08, 293.66, 440.00], fill: [392, 329.63] },   // C13
    ],
  },
  // 2. Chill Lofi Poker Beats — Warm mellow Rhodes, deep sub bass (~76 BPM chill)
  'chill-lofi': {
    bpm: 76,
    barDuration: 3.1,
    waveType: 'sine',
    filterFreq: 850,
    chords: [
      { bass: 65.41, chord: [164.81, 196.00, 246.94, 293.66], fill: [329.63, 392] }, // Cmaj7
      { bass: 55.00, chord: [130.81, 164.81, 196.00, 246.94], fill: [293.66, 261.63] }, // Am9
      { bass: 73.42, chord: [174.61, 220.00, 261.63, 329.63], fill: [392, 440] },       // Dm9
      { bass: 49.00, chord: [174.61, 207.65, 246.94, 311.13], fill: [246.94, 196] },   // G7b9
    ],
  },
  // 3. Vegas Royale Luxury — Upbeat classy casino swing (~116 BPM)
  'vegas-royale': {
    bpm: 116,
    barDuration: 2.05,
    waveType: 'triangle',
    chords: [
      { bass: 58.27, chord: [146.83, 174.61, 220.00, 261.63], fill: [349.23, 440] }, // Bbmaj7
      { bass: 49.00, chord: [123.47, 174.61, 233.08, 311.13], fill: [293.66, 369.99] }, // G7#9
      { bass: 65.41, chord: [155.56, 196.00, 233.08, 293.66], fill: [349.23, 440] }, // Cm9
      { bass: 43.65, chord: [155.56, 196.00, 233.08, 349.23], fill: [392, 349.23] }, // F9sus
    ],
  },
  // 4. Casino Velvet Synth — Ambient velvet pad with gentle chime bells (~86 BPM)
  'synth-casino': {
    bpm: 86,
    barDuration: 2.8,
    waveType: 'sine',
    chords: [
      { bass: 77.78, chord: [196.00, 233.08, 293.66, 349.23], fill: [523.25, 587.33] }, // Ebmaj9
      { bass: 65.41, chord: [155.56, 196.00, 233.08, 293.66], fill: [466.16, 523.25] }, // Cm9
      { bass: 87.31, chord: [207.65, 261.63, 311.13, 392.00], fill: [523.25, 466.16] }, // Fm9
      { bass: 58.27, chord: [207.65, 261.63, 293.66, 349.23], fill: [392, 349.23] },   // Bb11
    ],
  },
};

let currentTrack: BgmTrackId = 'smooth-jazz';
let bgmTimer: number | null = null;
let bgmGainNode: GainNode | null = null;
let bgmStep = 0;
let isBgmRunning = false;

function scheduleNextBgmBar() {
  if (!isBgmRunning || !bgmGainNode) return;
  const audio = getContext();
  if (!audio) return;

  const track = TRACKS[currentTrack] || TRACKS['smooth-jazz'];
  const curChord = track.chords[bgmStep % track.chords.length];
  const dur = track.barDuration;
  bgmStep++;

  try {
    const now = audio.currentTime;

    // 1. Walking Bass (Audible, resonant, deep)
    const bOsc = audio.createOscillator();
    const bGain = audio.createGain();
    bOsc.type = 'triangle';
    bOsc.frequency.setValueAtTime(curChord.bass, now);
    // Walking bass beat 1
    bGain.gain.setValueAtTime(0.001, now);
    bGain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    bGain.gain.exponentialRampToValueAtTime(0.05, now + dur * 0.48);
    // Walking bass beat 2 (harmonis 5th)
    bOsc.frequency.setValueAtTime(curChord.bass * 1.5, now + dur * 0.5);
    bGain.gain.setValueAtTime(0.05, now + dur * 0.5);
    bGain.gain.exponentialRampToValueAtTime(0.28, now + dur * 0.52);
    bGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.95);

    bOsc.connect(bGain);
    if (bgmGainNode) bGain.connect(bgmGainNode);
    bOsc.start(now);
    bOsc.stop(now + dur);

    // 2. Lush Electric Piano / Rhodes 7th Chords
    curChord.chord.forEach((freq, idx) => {
      const cOsc = audio.createOscillator();
      const cGain = audio.createGain();
      cOsc.type = track.waveType;
      const stagger = idx * 0.025;
      cOsc.frequency.setValueAtTime(freq, now + stagger);

      cGain.gain.setValueAtTime(0.0001, now + stagger);
      cGain.gain.exponentialRampToValueAtTime(0.22, now + stagger + 0.04);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.88);

      cOsc.connect(cGain);
      if (bgmGainNode) cGain.connect(bgmGainNode);
      cOsc.start(now + stagger);
      cOsc.stop(now + dur);
    });

    // 3. Melodic Fill / Chime Bell
    if (curChord.fill && bgmStep % 2 === 0) {
      curChord.fill.forEach((freq, fIdx) => {
        const mOsc = audio.createOscillator();
        const mGain = audio.createGain();
        mOsc.type = 'sine';
        const fillTime = now + dur * 0.55 + fIdx * 0.22;
        mOsc.frequency.setValueAtTime(freq, fillTime);

        mGain.gain.setValueAtTime(0.0001, fillTime);
        mGain.gain.exponentialRampToValueAtTime(0.16, fillTime + 0.02);
        mGain.gain.exponentialRampToValueAtTime(0.0001, fillTime + 0.35);

        mOsc.connect(mGain);
        if (bgmGainNode) mGain.connect(bgmGainNode);
        mOsc.start(fillTime);
        mOsc.stop(fillTime + 0.38);
      });
    }

    // 4. Subtle Lounge Brush Rhythm
    const brushOsc = audio.createOscillator();
    const brushGain = audio.createGain();
    brushOsc.type = 'triangle';
    brushOsc.frequency.setValueAtTime(140, now);
    brushGain.gain.setValueAtTime(0.001, now);
    brushGain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    brushGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    brushOsc.connect(brushGain);
    if (bgmGainNode) brushGain.connect(bgmGainNode);
    brushOsc.start(now);
    brushOsc.stop(now + 0.2);

  } catch {
    // Ignore audio schedule error
  }

  if (isBgmRunning) {
    const nextDelay = (track.barDuration * 1000) - 20;
    bgmTimer = window.setTimeout(scheduleNextBgmBar, Math.max(100, nextDelay));
  }
}

export function startBgm(trackId?: string) {
  const audio = getContext();
  if (!audio) return;

  if (trackId && trackId in TRACKS) {
    currentTrack = trackId as BgmTrackId;
  }

  if (audio.state === 'suspended') {
    void audio.resume();
  }

  // Clear any existing loop timer so we restart fresh
  if (bgmTimer) {
    clearTimeout(bgmTimer);
    bgmTimer = null;
  }

  // Ensure gain node is ready
  if (!bgmGainNode) {
    bgmGainNode = audio.createGain();
    bgmGainNode.connect(audio.destination);
  }

  const vol = (getData().settings.bgmVolume ?? 0.45);
  // Volume jelas dan nyaman didengar (vol * 0.95, min 0.08)
  const targetGain = Math.max(0.08, vol * 0.95);
  try {
    bgmGainNode.gain.cancelScheduledValues(audio.currentTime);
    bgmGainNode.gain.setValueAtTime(targetGain, audio.currentTime);
  } catch {}

  isBgmRunning = true;
  bgmStep = 0;
  // Start bar immediately
  scheduleNextBgmBar();
}

export function stopBgm() {
  isBgmRunning = false;
  if (bgmTimer) {
    clearTimeout(bgmTimer);
    bgmTimer = null;
  }
  if (bgmGainNode && ctx) {
    const nodeToFade = bgmGainNode;
    bgmGainNode = null; // disconnect pointer immediately so new startBgm is unaffected!
    try {
      nodeToFade.gain.setValueAtTime(nodeToFade.gain.value, ctx.currentTime);
      nodeToFade.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      setTimeout(() => {
        try { nodeToFade.disconnect(); } catch {}
      }, 160);
    } catch {
      try { nodeToFade.disconnect(); } catch {}
    }
  }
}

export function updateBgmVolume(vol: number) {
  if (bgmGainNode && ctx) {
    const targetGain = Math.max(0.001, vol * 0.95);
    try {
      bgmGainNode.gain.cancelScheduledValues(ctx.currentTime);
      bgmGainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
    } catch {}
  }
}

export function isBgmPlaying(): boolean {
  return isBgmRunning;
}

export function setBgmTrack(trackId: BgmTrackId) {
  currentTrack = trackId;
  bgmStep = 0;
}
