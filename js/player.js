// ═══════════════════════════════════════════════════
// KaChunk — Player Engine
// ═══════════════════════════════════════════════════

import { loadChunks, flattenChunk } from './store.js';
import { esc, formatDuration, spawnParticles, requestWakeLock, releaseWakeLock } from './ui.js';
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
  clearInterval(playerInterval);

  loadPlayerStep();
  renderPlayerSteps();

  document.getElementById('playerTitle').textContent = playerChunk.name;
  document.getElementById('cdDisc').className = 'cd-disc';
  document.getElementById('playPauseBtn').innerHTML = '▶';

  const s = loadAudioSettings();
  const voiceBtn = document.getElementById('voiceToggleBtn');
  if (voiceBtn) voiceBtn.style.opacity = s.voice ? '1' : '0.4';

  showScreen('playerScreen');
}

// ─── Step Loading ───

function loadPlayerStep() {
  const step = playerFlatSteps[playerStepIdx];
  playerTotalSeconds = Math.round((parseFloat(step.minutes) || 1) * 60);
  playerSecondsLeft = playerTotalSeconds;

  document.getElementById('playerStepLabel').textContent = step.label || 'Step ' + (playerStepIdx + 1);
  document.getElementById('playerStepCount').textContent =
    `Step ${playerStepIdx + 1} of ${playerFlatSteps.length}`;

  updateTimerDisplay();
  updateProgress();
  renderPlayerSteps();
}

function updateTimerDisplay() {
  const m = Math.floor(playerSecondsLeft / 60);
  const s = playerSecondsLeft % 60;
  document.getElementById('playerTimer').textContent =
    m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}

function updateProgress() {
  const pct = playerTotalSeconds > 0
    ? ((playerTotalSeconds - playerSecondsLeft) / playerTotalSeconds) * 100
    : 0;
  document.getElementById('progressFill').style.width = pct + '%';
}

function renderPlayerSteps() {
  const container = document.getElementById('playerStepsList');
  container.innerHTML = playerFlatSteps.map((s, i) => {
    let cls = '';
    if (i < playerStepIdx) cls = 'completed';
    else if (i === playerStepIdx) cls = 'current';

    const sourceHtml = s.sourceChunk
      ? `<div class="psi-source"><span class="link-icon">🔗</span> ${esc(s.sourceChunk)}</div>`
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
  document.getElementById('playPauseBtn').innerHTML = '⏸';
  document.getElementById('cdDisc').className = 'cd-disc spinning';

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
  document.getElementById('playPauseBtn').innerHTML = '▶';
  document.getElementById('cdDisc').className = 'cd-disc paused';
  playUiSound('clickPause');
  stopBgAudio();
  releaseWakeLock();
  clearInterval(playerInterval);
}

function tick() {
  if (playerSecondsLeft <= 0) return;
  playerSecondsLeft--;
  updateTimerDisplay();
  updateProgress();
  if (playerSecondsLeft <= 0) onStepComplete();
}

function onStepComplete() {
  clearInterval(playerInterval);
  playAlarmSound(getEffectiveAlarm());
  vibrateDevice();

  if (playerStepIdx < playerFlatSteps.length - 1) {
    playerStepIdx++;
    loadPlayerStep();
    if (playerFlatSteps[playerStepIdx]) {
      announceStep(playerFlatSteps[playerStepIdx].label);
    }
    setTimeout(() => {
      if (getCurrentScreen() === 'playerScreen') resumePlayer();
    }, 800);
  } else {
    playerPlaying = false;
    document.getElementById('cdDisc').className = 'cd-disc';
    document.getElementById('playPauseBtn').innerHTML = '▶';
    renderPlayerSteps();
    releaseWakeLock();
    showCompletion();
  }
}

// ─── Next / Prev ───

export function playerNext() {
  if (playerStepIdx < playerFlatSteps.length - 1) {
    playUiSound('whoosh');
    playerStepIdx++;
    loadPlayerStep();
    if (playerPlaying) {
      clearInterval(playerInterval);
      playerInterval = setInterval(tick, 1000);
    }
  }
}

export function playerPrev() {
  if (playerStepIdx > 0) {
    playUiSound('whoosh');
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
  stopBgAudio();
  releaseWakeLock();
  playerPlaying = false;
  playerChunk = null;
  goHome();
  renderHome();
}

// ─── Completion ───

function showCompletion() {
  stopBgAudio();
  const totalMin = playerFlatSteps.reduce((s, st) => s + (parseFloat(st.minutes) || 0), 0);
  document.getElementById('completionSub').textContent =
    `${playerChunk.name} — ${formatDuration(totalMin)} completed!`;
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
  // Import showToast at top
  import('./ui.js').then(ui => ui.showToast(s.voice ? 'Voice on' : 'Voice off'));
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
