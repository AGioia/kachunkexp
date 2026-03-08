// ═══════════════════════════════════════════════════
// KaChunk — Audio Engine
// Web Audio API: alarms, background sounds, UI effects, voice
// ═══════════════════════════════════════════════════

const AUDIO_SETTINGS_KEY = 'kachunk_audio_settings';
const DEFAULT_AUDIO = { alarm: 'chime', bg: 'none', volume: 75, voice: false, sfx: true };

// ─── Settings Persistence ───

export function loadAudioSettings() {
  try {
    const d = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (d) return { ...DEFAULT_AUDIO, ...JSON.parse(d) };
  } catch (e) {}
  return { ...DEFAULT_AUDIO };
}

export function saveAudioSettings(s) {
  try { localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}

// ─── Web Audio Context ───

let audioCtx = null;
let masterGain = null;

export function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    masterGain.gain.value = loadAudioSettings().volume / 100;
  }
  return audioCtx;
}

export function getMasterGain() {
  getAudioCtx();
  return masterGain;
}

export function setVolume(v) {
  if (masterGain) masterGain.gain.value = v / 100;
}

export function unlockAudio() {
  getAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// ─── Sound Libraries ───

export const ALARM_SOUNDS = {
  chime: { label: 'Chime', icon: '🎵' },
  bell: { label: 'Bell', icon: '🔔' },
  buzzer: { label: 'Buzzer', icon: '📢' },
  digital: { label: 'Digital', icon: '🤖' },
  zen: { label: 'Zen', icon: '🧘' }
};

export const BG_SOUNDS = {
  none: { label: 'None', icon: '🔇' },
  ticking: { label: 'Ticking', icon: '⏱' },
  whitenoise: { label: 'White Noise', icon: '📻' },
  rain: { label: 'Rain', icon: '🌧' },
  lofi: { label: 'Lo-Fi', icon: '🎧' }
};

// ─── Alarm Generators ───

function playAlarmChime(ctx, dest) {
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];
  const durations = [0, 0.15, 0.3];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + durations[i]);
    gain.gain.setValueAtTime(0, now + durations[i]);
    gain.gain.linearRampToValueAtTime(0.3, now + durations[i] + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durations[i] + 0.8);
    osc.connect(gain); gain.connect(dest);
    osc.start(now + durations[i]); osc.stop(now + durations[i] + 0.85);
  });
  const shimmer = ctx.createOscillator();
  const sg = ctx.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(1046.5, now + 0.3);
  sg.gain.setValueAtTime(0, now + 0.3);
  sg.gain.linearRampToValueAtTime(0.12, now + 0.35);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
  shimmer.connect(sg); sg.connect(dest);
  shimmer.start(now + 0.3); shimmer.stop(now + 1.6);
}

function playAlarmBell(ctx, dest) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.6);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.4, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc.connect(gain); gain.connect(dest);
  osc.start(now); osc.stop(now + 0.85);
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1200 * 2.76, now);
  g2.gain.setValueAtTime(0, now);
  g2.gain.linearRampToValueAtTime(0.15, now + 0.003);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc2.connect(g2); g2.connect(dest);
  osc2.start(now); osc2.stop(now + 0.55);
}

function playAlarmBuzzer(ctx, dest) {
  const now = ctx.currentTime;
  for (let p = 0; p < 3; p++) {
    const t = now + p * 0.25;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gain.gain.setValueAtTime(0.2, t + 0.12);
    gain.gain.linearRampToValueAtTime(0, t + 0.18);
    osc.connect(gain); gain.connect(dest);
    osc.start(t); osc.stop(t + 0.2);
  }
}

function playAlarmDigital(ctx, dest) {
  const now = ctx.currentTime;
  for (let b = 0; b < 3; b++) {
    const t = now + b * 0.3;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.08);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
    gain.gain.setValueAtTime(0.2, t + 0.15);
    gain.gain.linearRampToValueAtTime(0, t + 0.2);
    osc.connect(gain); gain.connect(dest);
    osc.start(t); osc.stop(t + 0.22);
  }
}

function playAlarmZen(ctx, dest) {
  const now = ctx.currentTime;
  const f = 220;
  [
    [f, 0.3, 3.0, 'sine'],
    [f * 2.01, 0.12, 2.5, 'sine'],
    [f * 3.03, 0.06, 1.8, 'sine']
  ].forEach(([freq, vol, dur, type], i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.1 + i * 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + dur + 0.1);
  });
}

const alarmFunctions = { chime: playAlarmChime, bell: playAlarmBell, buzzer: playAlarmBuzzer, digital: playAlarmDigital, zen: playAlarmZen };

// ─── Background Sound Generators ───

let bgAudioNodes = null;

function createBgTicking(ctx, dest) {
  const nodes = [];
  let stopped = false;
  function tick() {
    if (stopped) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.02);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.06);
    nodes.push(osc);
  }
  tick();
  const interval = setInterval(tick, 1000);
  return { nodes, stop() { stopped = true; clearInterval(interval); nodes.forEach(n => { try { n.stop(); } catch(e) {} }); } };
}

function createBgWhitenoise(ctx, dest) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0.06;
  src.connect(g); g.connect(dest); src.start();
  return { nodes: [src], stop() { try { src.stop(); } catch(e) {} } };
}

function createBgRain(ctx, dest) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] = (last + (0.02 * (Math.random() * 2 - 1))) / 1.02;
    last = data[i]; data[i] *= 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
  const g = ctx.createGain(); g.gain.value = 0.15;
  src.connect(f); f.connect(g); g.connect(dest); src.start();
  return { nodes: [src], stop() { try { src.stop(); } catch(e) {} } };
}

function createBgLofi(ctx, dest) {
  let stopped = false;
  const nodes = [];
  const beatLen = 60 / 80;
  function bar() {
    if (stopped) return;
    const now = ctx.currentTime;
    for (let beat = 0; beat < 4; beat++) {
      const t = now + beat * beatLen;
      if (beat === 0 || beat === 2) {
        const k = ctx.createOscillator();
        const kg = ctx.createGain();
        k.type = 'sine';
        k.frequency.setValueAtTime(160, t);
        k.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        kg.gain.setValueAtTime(0.2, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        k.connect(kg); kg.connect(dest);
        k.start(t); k.stop(t + 0.22); nodes.push(k);
      }
      const hBuf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
      const hData = hBuf.getChannelData(0);
      for (let i = 0; i < hData.length; i++) hData[i] = Math.random() * 2 - 1;
      const h = ctx.createBufferSource(); h.buffer = hBuf;
      const hg = ctx.createGain();
      const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000;
      hg.gain.setValueAtTime(0.06, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      h.connect(hf); hf.connect(hg); hg.connect(dest);
      h.start(t); h.stop(t + 0.06); nodes.push(h);
    }
  }
  bar();
  const interval = setInterval(bar, beatLen * 4 * 1000);
  return { nodes, stop() { stopped = true; clearInterval(interval); nodes.forEach(n => { try { n.stop(); } catch(e) {} }); } };
}

const bgFunctions = { ticking: createBgTicking, whitenoise: createBgWhitenoise, rain: createBgRain, lofi: createBgLofi };

// ─── UI Sound Generators ───

function playUiClickPlay(ctx, dest) {
  const now = ctx.currentTime;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(1800, now); o.frequency.exponentialRampToValueAtTime(1200, now + 0.015);
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.25, now + 0.002); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  o.connect(g); g.connect(dest); o.start(now); o.stop(now + 0.07);
}

function playUiClickPause(ctx, dest) {
  const now = ctx.currentTime;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(1200, now); o.frequency.exponentialRampToValueAtTime(800, now + 0.02);
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.15, now + 0.002); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  o.connect(g); g.connect(dest); o.start(now); o.stop(now + 0.06);
}

function playUiWhoosh(ctx, dest) {
  const now = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(1000, now); f.frequency.exponentialRampToValueAtTime(3000, now + 0.07); f.frequency.exponentialRampToValueAtTime(600, now + 0.15);
  f.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.15, now + 0.03); g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  src.connect(f); f.connect(g); g.connect(dest); src.start(now); src.stop(now + 0.16);
}

// ─── The KaChunk Sound ───
// Signature interaction: a satisfying mechanical "chunk" with weight and snap

function playKaChunk(ctx, dest) {
  const now = ctx.currentTime;

  // 1. Mechanical click — sharp transient
  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = 'sine';
  click.frequency.setValueAtTime(2400, now);
  click.frequency.exponentialRampToValueAtTime(400, now + 0.025);
  clickGain.gain.setValueAtTime(0, now);
  clickGain.gain.linearRampToValueAtTime(0.35, now + 0.002);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  click.connect(clickGain); clickGain.connect(dest);
  click.start(now); click.stop(now + 0.07);

  // 2. Body thunk — the "chunk" weight
  const thunk = ctx.createOscillator();
  const thunkGain = ctx.createGain();
  thunk.type = 'sine';
  thunk.frequency.setValueAtTime(180, now + 0.01);
  thunk.frequency.exponentialRampToValueAtTime(80, now + 0.08);
  thunkGain.gain.setValueAtTime(0, now + 0.01);
  thunkGain.gain.linearRampToValueAtTime(0.25, now + 0.015);
  thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  thunk.connect(thunkGain); thunkGain.connect(dest);
  thunk.start(now + 0.01); thunk.stop(now + 0.13);

  // 3. Bright confirmation — the reward ring
  const ring = ctx.createOscillator();
  const ringGain = ctx.createGain();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(880, now + 0.04);
  ringGain.gain.setValueAtTime(0, now + 0.04);
  ringGain.gain.linearRampToValueAtTime(0.15, now + 0.06);
  ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  ring.connect(ringGain); ringGain.connect(dest);
  ring.start(now + 0.04); ring.stop(now + 0.36);

  // 4. Harmonic shimmer
  const shimmer = ctx.createOscillator();
  const shimGain = ctx.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(1320, now + 0.06);
  shimGain.gain.setValueAtTime(0, now + 0.06);
  shimGain.gain.linearRampToValueAtTime(0.06, now + 0.08);
  shimGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  shimmer.connect(shimGain); shimGain.connect(dest);
  shimmer.start(now + 0.06); shimmer.stop(now + 0.32);
}

// ─── Overtime Alert Pulse Sound ───
// Gentle ambient pulse, escalates subtly

function playOvertimePulse(ctx, dest, intensity) {
  const now = ctx.currentTime;
  const vol = 0.04 + (intensity || 0) * 0.03; // louder as things stack
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.3);
  gain.gain.linearRampToValueAtTime(0, now + 1.2);
  osc.connect(gain); gain.connect(dest);
  osc.start(now); osc.stop(now + 1.3);
}

const uiFunctions = { clickPlay: playUiClickPlay, clickPause: playUiClickPause, whoosh: playUiWhoosh, kachunk: playKaChunk, overtimePulse: playOvertimePulse };

// ─── Playback API ───

export function playAlarmSound(soundName) {
  try {
    const ctx = getAudioCtx();
    const fn = alarmFunctions[soundName || 'chime'];
    if (fn) fn(ctx, getMasterGain());
  } catch (e) { console.log('Alarm error:', e); }
}

export function startBgAudio(soundName) {
  stopBgAudio();
  try {
    if (!soundName || soundName === 'none') return;
    const ctx = getAudioCtx();
    const fn = bgFunctions[soundName];
    if (fn) bgAudioNodes = fn(ctx, getMasterGain());
  } catch (e) { console.log('Bg audio error:', e); }
}

export function stopBgAudio() {
  if (bgAudioNodes) {
    try { bgAudioNodes.stop(); } catch (e) {}
    bgAudioNodes = null;
  }
}

export function playUiSound(soundName) {
  try {
    if (!loadAudioSettings().sfx) return;
    const ctx = getAudioCtx();
    const fn = uiFunctions[soundName];
    if (fn) fn(ctx, getMasterGain());
  } catch (e) { console.log('UI sound error:', e); }
}

export function previewSound(type, name) {
  try {
    const ctx = getAudioCtx();
    const dest = getMasterGain();
    if (type === 'alarm') {
      const fn = alarmFunctions[name];
      if (fn) fn(ctx, dest);
    } else if (type === 'bg') {
      stopBgAudio();
      if (name === 'none') return;
      const fn = bgFunctions[name];
      if (fn) {
        bgAudioNodes = fn(ctx, dest);
        setTimeout(() => { if (bgAudioNodes) { try { bgAudioNodes.stop(); } catch(e) {} bgAudioNodes = null; } }, 2000);
      }
    }
  } catch (e) {}
}

export function playCompletionFanfare() {
  try {
    const ctx = getAudioCtx();
    const dest = getMasterGain();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const times = [0, 0.12, 0.24, 0.36, 0.52, 0.64];
    const volumes = [0.25, 0.25, 0.28, 0.35, 0.2, 0.35];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = i < 4 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + times[i]);
      gain.gain.setValueAtTime(0, now + times[i]);
      gain.gain.linearRampToValueAtTime(volumes[i], now + times[i] + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + times[i] + (i === notes.length - 1 ? 1.5 : 0.5));
      osc.connect(gain); gain.connect(dest);
      osc.start(now + times[i]); osc.stop(now + times[i] + 1.6);
    });
  } catch (e) {}
}

// ─── Voice ───

export function announceStep(label) {
  try {
    const s = loadAudioSettings();
    if (!s.voice || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance('Time for: ' + (label || 'next step'));
    utt.rate = 1.0; utt.pitch = 1.0; utt.volume = s.volume / 100;
    window.speechSynthesis.speak(utt);
  } catch (e) {}
}

export function announceCompletion(name) {
  try {
    const s = loadAudioSettings();
    if (!s.voice || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance('All done! ' + (name || 'Chunk') + ' complete');
    utt.rate = 1.0; utt.pitch = 1.1; utt.volume = s.volume / 100;
    window.speechSynthesis.speak(utt);
  } catch (e) {}
}

// ─── Vibration ───

export function vibrateDevice(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern || [200, 100, 200]);
}
