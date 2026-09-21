// ─────────────────────────────────────────────────────────────────────────────
// lib/game/audio.ts  –  Procedural audio via Web Audio API (no asset files)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicOscillators: OscillatorNode[] = [];
let musicPlaying = false;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

export function initAudio(): void {
  const ac = getCtx();
  musicGain = ac.createGain();
  musicGain.gain.value = 0.18;
  musicGain.connect(ac.destination);
  sfxGain = ac.createGain();
  sfxGain.gain.value = 0.4;
  sfxGain.connect(ac.destination);
}

export function setMusicVolume(v: number): void {
  if (musicGain) musicGain.gain.value = v;
}
export function setSfxVolume(v: number): void {
  if (sfxGain) sfxGain.gain.value = v;
}

// ── Background music (arpeggiated neon synth) ─────────────────────────────────

const SCALE = [0, 2, 3, 7, 8, 10]; // Phrygian-ish neon scale
const ROOT  = 60; // MIDI C4

export function startMusic(): void {
  if (musicPlaying) return;
  musicPlaying = true;
  const ac = getCtx();
  if (!musicGain) initAudio();
  scheduleArp(ac, 0);
}

export function stopMusic(): void {
  musicPlaying = false;
  musicOscillators.forEach(o => { try { o.stop(); } catch (_) {} });
  musicOscillators = [];
}

function scheduleArp(ac: AudioContext, startTime: number): void {
  if (!musicPlaying || !musicGain) return;
  const tempo = 0.14; // seconds per note
  const notes = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];

  for (let i = 0; i < notes.length; i++) {
    const noteIndex = SCALE[notes[i] % SCALE.length];
    const freq = midiToHz(ROOT + noteIndex + (notes[i] >= SCALE.length ? 12 : 0));
    const t = startTime + i * tempo;

    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, t + tempo * 0.85);

    // Light filter for that neon synth sound
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 3;

    osc.connect(filter);
    filter.connect(env);
    env.connect(musicGain);

    osc.start(t);
    osc.stop(t + tempo);
    musicOscillators.push(osc);
  }

  // Bass drone
  const bass = ac.createOscillator();
  bass.type = 'square';
  bass.frequency.value = midiToHz(ROOT - 12);
  const bassGain = ac.createGain();
  bassGain.gain.setValueAtTime(0.08, startTime);
  bassGain.gain.setValueAtTime(0, startTime + notes.length * tempo - 0.02);
  bass.connect(bassGain);
  bassGain.connect(musicGain);
  bass.start(startTime);
  bass.stop(startTime + notes.length * tempo);
  musicOscillators.push(bass);

  // Schedule next bar
  const nextBar = startTime + notes.length * tempo;
  const delay = Math.max(0, (nextBar - ac.currentTime) * 1000 - 50);
  setTimeout(() => scheduleArp(ac, nextBar), delay);
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Sound effects ──────────────────────────────────────────────────────────────

export function playSfx(type: 'jump' | 'slide' | 'coin' | 'hit' | 'gameover'): void {
  if (!sfxGain) initAudio();
  const ac = getCtx();
  const now = ac.currentTime;

  switch (type) {
    case 'jump':    playJump(ac, now);     break;
    case 'slide':   playSlide(ac, now);    break;
    case 'coin':    playCoin(ac, now);     break;
    case 'hit':     playHit(ac, now);      break;
    case 'gameover':playGameOver(ac, now); break;
  }
}

function playJump(ac: AudioContext, t: number): void {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(600, t + 0.12);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(g); g.connect(sfxGain!);
  osc.start(t); osc.stop(t + 0.2);
}

function playSlide(ac: AudioContext, t: number): void {
  const noise = createNoise(ac, 0.15);
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 500;
  filter.Q.value = 2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  noise.connect(filter); filter.connect(g); g.connect(sfxGain!);
  noise.start(t); noise.stop(t + 0.15);
}

function playCoin(ac: AudioContext, t: number): void {
  const freqs = [880, 1320];
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ac.createGain();
    const st = t + i * 0.06;
    g.gain.setValueAtTime(0.4, st);
    g.gain.exponentialRampToValueAtTime(0.001, st + 0.15);
    osc.connect(g); g.connect(sfxGain!);
    osc.start(st); osc.stop(st + 0.2);
  });
}

function playHit(ac: AudioContext, t: number): void {
  const noise = createNoise(ac, 0.3);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.8, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  noise.connect(filter); filter.connect(g); g.connect(sfxGain!);
  noise.start(t); noise.stop(t + 0.35);

  // Low thud
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.25);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.6, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(g2); g2.connect(sfxGain!);
  osc.start(t); osc.stop(t + 0.3);
}

function playGameOver(ac: AudioContext, t: number): void {
  const notes = [440, 392, 349, 294];
  notes.forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const g = ac.createGain();
    const st = t + i * 0.2;
    g.gain.setValueAtTime(0.4, st);
    g.gain.exponentialRampToValueAtTime(0.001, st + 0.3);
    osc.connect(g); g.connect(sfxGain!);
    osc.start(st); osc.stop(st + 0.35);
  });
}

function createNoise(ac: AudioContext, duration: number): AudioBufferSourceNode {
  const bufferSize = ac.sampleRate * duration;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  return src;
}
