// ═══════════════════════════════════════════════════
// KaChunk — Player Engine
// Chronometer face, aging/overtime, KaChunk button
// ═══════════════════════════════════════════════════

import { loadChunks, flattenChunk } from './store.js';
import { esc, formatDuration, spawnParticles, requestWakeLock, releaseWakeLock, showToast } from './ui.js';
import { showScreen, goHome, getCurrentScreen } from './router.js';
import { renderHome } from './home.js';
import {
  loadAudioSettings, saveAudioSettings,
  playAlarmSound, startBgAudio, stopBgAudio,
  playUiSound, playCompletionFanfare,
  announceStep, announceCompletion, vibrateDevice,
  BG_SOUNDS
} from './audio.js';

let playerChunk = null;
let playerFlatSteps = [];
let playerStepIdx = 0;
let playerSecondsLeft = 0;
let playerTotalSeconds = 0;
let playerPlaying = false;
let playerInterval = null;
let isOvertime = false;
let overtimeSeconds = 0;
let overtimePulseInterval = null;

const CHRONO_RADIUS = 115;
const CHRONO_CIRCUMFERENCE = 2 * Math.PI * CHRONO_RADIUS; // ~722.6
const OVERTIME_RADIUS = 108;
const OVERTIME_CIRCUMFERENCE = 2 * Math.PI * OVERTIME_RADIUS; // ~678.6

// ─── Chronometer Tick Marks ───

function renderChronoTicks() {
  const g = document.getElementById('chronoTicks');
  if (!g) return;
  let html = '';
  for (let i = 0; i < 60; i++) {
    const angle = i * 6;
    const isMajor = i % 5 === 0;
    const y1 = isMajor ? 16 : 18;
    const y2 = isMajor ? 28 : 24;
    const cls = isMajor ? 'tick major' : 'tick';
    html += `<line class="${cls}" data-tick="${i}" x1="130" y1="${y1}" x2="130" y2="${y2}" transform="rotate(${angle}, 130, 130)"/>`;
  }
  g.innerHTML = html;
}

// ─── Effective Audio ───

function getEffectiveAlarm() {
  const s = loadAudioSettings();
  if (playerChunk) {
    const step = playerFlatSteps[playerStepIdx];
    if (step && step.sound && step.sound !== 'default') return step.sound;
    if (playerChunk.audioAlarm && playerChunk.audioAlarm !== 'default') return playerChunk.audioAlarm;
  }
  return s.alarm || 'chime';
}

function getEffectiveBg() {
  const s = loadAudioSettings();
  if (playerChunk) {
    if (playerChunk.audioBg && playerChunk.audioBg !== 'default') return playerChunk.audioBg;
  }
  return s.bg || 'none';
}

// ─── Start Player ───

export function startPlayer(id) {
  const chunks = loadChunks();
  playerChunk = chunks.find(c => c.id === id);
  if (!playerChunk) return;

  playerFlatSteps = flattenChunk(playerChunk, chunks);
  if (playerFlatSteps.length === 0) return;

  playerStepIdx = 0;
  playerPlaying = false;
  isOvertime = false;
  overtimeSeconds = 0;
  clearInterval(playerInterval);
  clearInterval(overtimePulseInterval);

  renderChronoTicks();
  loadPlayerStep();
  renderPlayerSteps();

  document.getElementById('playerTitle').textContent = playerChunk.name;
  updatePlayPauseIcon(false);

  const s = loadAudioSettings();
  const voiceBtn = document.getElementById('voiceToggleBtn');
  if (voiceBtn) voiceBtn.style.opacity = s.voice ? '1' : '0.4';

  // Reset chrono state
  const face = document.getElementById('chronoFace');
  face.className = 'chrono-face';

  // Reset kachunk button
  const kb = document.getElementById('kachunkBtn');
  kb.classList.remove('ready-pulse', 'snapping');

  showScreen('playerScreen');
}

// ─── Step Loading ───

function loadPlayerStep() {
  const step = playerFlatSteps[playerStepIdx];
  playerTotalSeconds = Math.round((parseFloat(step.minutes) || 1) * 60);
  playerSecondsLeft = playerTotalSeconds;
  isOvertime = false;
  overtimeSeconds = 0;

  document.getElementById('playerStepLabel').textContent = step.label || 'Step ' + (playerStepIdx + 1);
  document.getElementById('playerStepCount').textContent =
    `Step ${playerStepIdx + 1} of ${playerFlatSteps.length}`;

  // Reset overtime visuals
  const timerEl = document.getElementById('playerTimer');
  timerEl.classList.remove('overtime');
  const face = document.getElementById('chronoFace');
  face.className = 'chrono-face';
  const overtimeRing = document.getElementById('ringOvertime');
  overtimeRing.classList.remove('active');
  overtimeRing.style.strokeDashoffset = OVERTIME_CIRCUMFERENCE;
  resetOvertimeTicks();

  const kb = document.getElementById('kachunkBtn');
  kb.classList.remove('ready-pulse');

  clearInterval(overtimePulseInterval);

  updateTimerDisplay();
  updateChronoProgress();
  renderPlayerSteps();
}

function updateTimerDisplay() {
  const timerEl = document.getElementById('playerTimer');
  if (isOvertime) {
    const m = Math.floor(overtimeSeconds / 60);
    const s = overtimeSeconds % 60;
    timerEl.textContent = '+' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  } else {
    const m = Math.floor(playerSecondsLeft / 60);
    const s = playerSecondsLeft % 60;
    timerEl.textContent = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  }
}

function updateChronoProgress() {
  const ring = document.getElementById('ringProgress');
  if (!ring) return;

  if (isOvertime) {
    // Full progress ring when in overtime
    ring.style.strokeDashoffset = '0';

    // Overtime ring grows
    const overtimeRing = document.getElementById('ringOvertime');
    overtimeRing.classList.add('active');
    // Cap overtime visual at 5 minutes (300 seconds)
    const pct = Math.min(overtimeSeconds / 300, 1);
    const offset = OVERTIME_CIRCUMFERENCE * (1 - pct);
    overtimeRing.style.strokeDashoffset = offset;

    // Color ticks based on overtime progress
    updateOvertimeTicks(pct);
  } else {
    const pct = playerTotalSeconds > 0
      ? (playerTotalSeconds - playerSecondsLeft) / playerTotalSeconds
      : 0;
    const offset = CHRONO_CIRCUMFERENCE * (1 - pct);
    ring.style.strokeDashoffset = offset;
  }
}

function updateOvertimeTicks(pct) {
  const ticks = document.querySelectorAll('#chronoTicks .tick');
  const overtimeTickCount = Math.floor(pct * 60);
  ticks.forEach((tick, i) => {
    if (i < overtimeTickCount) {
      tick.classList.add('overtime');
    } else {
      tick.classList.remove('overtime');
    }
  });
}

function resetOvertimeTicks() {
  document.querySelectorAll('#chronoTicks .tick.overtime').forEach(t => t.classList.remove('overtime'));
}

function updatePlayPauseIcon(playing) {
  const btn = document.getElementById('playPauseBtn');
  if (playing) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
}

function renderPlayerSteps() {
  const container = document.getElementById('playerStepsList');
  container.innerHTML = playerFlatSteps.map((s, i) => {
    let cls = '';
    if (i < playerStepIdx) cls = 'completed';
    else if (i === playerStepIdx) cls = isOvertime ? 'current overtime' : 'current';

    const sourceHtml = s.sourceChunk
      ? `<div class="psi-source"><span class="link-icon">⟁</span> ${esc(s.sourceChunk)}</div>`
      : '';

    return `
      <div class="player-step-item ${cls}">
        <div class="psi-num">${i < playerStepIdx ? '✓' : (i + 1)}</div>
        <div class="psi-label-wrap">
          ${sourceHtml}
          <div class="psi-label">${esc(s.label || 'Step ' + (i + 1))}</div>
        </div>
        <div class="psi-dur">${s.minutes}m</div>
      </div>
    `;
  }).join('');
}

// ─── Play / Pause ───

export function togglePlay() {
  if (playerPlaying) pausePlayer();
  else resumePlayer();
}

function resumePlayer() {
  playerPlaying = true;
  updatePlayPauseIcon(true);

  playUiSound('clickPlay');
  startBgAudio(getEffectiveBg());
  if (playerFlatSteps[playerStepIdx]) {
    announceStep(playerFlatSteps[playerStepIdx].label);
  }

  requestWakeLock();
  clearInterval(playerInterval);
  playerInterval = setInterval(tick, 1000);
}

function pausePlayer() {
  playerPlaying = false;
  updatePlayPauseIcon(false);
  playUiSound('clickPause');
  stopBgAudio();
  releaseWakeLock();
  clearInterval(playerInterval);
  clearInterval(overtimePulseInterval);
}

function tick() {
  if (isOvertime) {
    // Count up during overtime
    overtimeSeconds++;
    updateTimerDisplay();
    updateChronoProgress();
    renderPlayerSteps();
    return;
  }

  if (playerSecondsLeft <= 0) return;
  playerSecondsLeft--;
  updateTimerDisplay();
  updateChronoProgress();

  if (playerSecondsLeft <= 0) {
    onStepTimerExpired();
  }
}

// ─── Timer Expired (enters overtime / aging mode) ───

function onStepTimerExpired() {
  isOvertime = true;
  overtimeSeconds = 0;

  // Visual: timer turns overtime color
  document.getElementById('playerTimer').classList.add('overtime');

  // Visual: chrono face starts pulsing
  document.getElementById('chronoFace').classList.add('alerting');

  // Sound: alarm
  playAlarmSound(getEffectiveAlarm());

  // Haptic
  vibrateDevice();

  // KaChunk button starts pulsing — "press me to advance"
  const kb = document.getElementById('kachunkBtn');
  kb.classList.add('ready-pulse');

  // Ambient overtime pulse sound (every 8 seconds, gentle)
  clearInterval(overtimePulseInterval);
  overtimePulseInterval = setInterval(() => {
    if (!playerPlaying || !isOvertime) {
      clearInterval(overtimePulseInterval);
      return;
    }
    const intensity = Math.min(overtimeSeconds / 120, 1); // escalates over 2 min
    playUiSound('overtimePulse');
    // Escalate visual if overtime is getting long
    if (overtimeSeconds > 60) {
      document.getElementById('chronoFace').className = 'chrono-face alerting-escalated';
    }
  }, 8000);

  // Announce
  announceStep('Time\'s up: ' + (playerFlatSteps[playerStepIdx]?.label || 'current step'));

  renderPlayerSteps();
}

// ─── KaChunk! (Next Step) ───

export function playerNext() {
  if (playerStepIdx < playerFlatSteps.length - 1) {
    // THE KACHUNK INTERACTION
    const kb = document.getElementById('kachunkBtn');

    // Sound: the signature kachunk
    playUiSound('kachunk');

    // Haptic: sharp satisfying click
    vibrateDevice([15, 30, 80]);

    // Animation: mechanical snap
    kb.classList.remove('ready-pulse', 'snapping');
    void kb.offsetWidth; // force reflow
    kb.classList.add('snapping');
    setTimeout(() => kb.classList.remove('snapping'), 400);

    // Clear overtime state
    isOvertime = false;
    overtimeSeconds = 0;
    clearInterval(overtimePulseInterval);

    // Advance
    playerStepIdx++;
    loadPlayerStep();

    if (playerPlaying) {
      clearInterval(playerInterval);
      playerInterval = setInterval(tick, 1000);
      announceStep(playerFlatSteps[playerStepIdx]?.label);
    }
  } else if (playerStepIdx === playerFlatSteps.length - 1) {
    // Last step — KaChunk completes the whole chunk
    playUiSound('kachunk');
    vibrateDevice([15, 30, 80]);
    isOvertime = false;
    clearInterval(playerInterval);
    clearInterval(overtimePulseInterval);

    playerPlaying = false;
    updatePlayPauseIcon(false);
    releaseWakeLock();
    renderPlayerSteps();
    showCompletion();
  }
}

export function playerPrev() {
  if (playerStepIdx > 0) {
    playUiSound('whoosh');
    isOvertime = false;
    overtimeSeconds = 0;
    clearInterval(overtimePulseInterval);
    playerStepIdx--;
    loadPlayerStep();
    if (playerPlaying) {
      clearInterval(playerInterval);
      playerInterval = setInterval(tick, 1000);
    }
  }
}

export function stopAndGoHome() {
  clearInterval(playerInterval);
  clearInterval(overtimePulseInterval);
  stopBgAudio();
  releaseWakeLock();
  playerPlaying = false;
  isOvertime = false;
  playerChunk = null;
  goHome();
  renderHome();
}

// ─── Completion ───

function showCompletion() {
  stopBgAudio();
  clearInterval(overtimePulseInterval);
  const totalMin = playerFlatSteps.reduce((s, st) => s + (parseFloat(st.minutes) || 0), 0);
  document.getElementById('completionSub').textContent =
    `${playerChunk.name} — ${formatDuration(totalMin)} completed`;
  document.getElementById('completionOverlay').classList.add('show');
  playCompletionFanfare();
  announceCompletion(playerChunk.name);
  spawnParticles();
  vibrateDevice([100, 50, 100, 50, 200]);
}

export function closeCompletion() {
  document.getElementById('completionOverlay').classList.remove('show');
  stopAndGoHome();
}

// ─── Voice Toggle ───

export function toggleVoiceInPlayer() {
  const s = loadAudioSettings();
  s.voice = !s.voice;
  saveAudioSettings(s);
  const btn = document.getElementById('voiceToggleBtn');
  btn.style.opacity = s.voice ? '1' : '0.4';
  showToast(s.voice ? 'Voice on' : 'Voice off');
}

// ─── BG Audio Picker ───

export function toggleBgAudioPicker() {
  const panel = document.getElementById('playerBgPicker');
  const overlay = document.getElementById('bgPickerOverlay');
  if (panel.classList.contains('show')) {
    closeBgAudioPicker();
  } else {
    overlay.classList.add('show');
    panel.classList.add('show');
    renderPlayerBgPicker();
  }
}

export function closeBgAudioPicker() {
  document.getElementById('bgPickerOverlay').classList.remove('show');
  document.getElementById('playerBgPicker').classList.remove('show');
}

function renderPlayerBgPicker() {
  const currentBg = getEffectiveBg();
  document.getElementById('playerBgPickerPills').innerHTML =
    Object.entries(BG_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${currentBg === key ? 'selected' : ''}" onclick="window._kachunk.selectPlayerBg('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');
}

export function selectPlayerBg(key) {
  const s = loadAudioSettings();
  s.bg = key;
  saveAudioSettings(s);
  closeBgAudioPicker();
  if (playerPlaying) {
    stopBgAudio();
    if (key !== 'none') startBgAudio(key);
  }
}
