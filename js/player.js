// ═══════════════════════════════════════════════════
// KaChunk — Player Engine
// Parallel step model: each step runs its own timer independently
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
let playerFlatSteps = [];  // each step gets: { ...stepData, _state }
let focusedStepIdx = 0;    // which step the chrono face shows (focused, not "current")
let playerPlaying = false;
let tickInterval = null;

// Ring radii must match the SVG
const MASTER_RADIUS = 122;
const MASTER_CIRC = 2 * Math.PI * MASTER_RADIUS;
const SUBCHUNK_RADIUS = 115;
const SUBCHUNK_CIRC = 2 * Math.PI * SUBCHUNK_RADIUS;
const STEP_RADIUS = 108;
const STEP_CIRC = 2 * Math.PI * STEP_RADIUS;
const OVERTIME_RADIUS = 101;
const OVERTIME_CIRC = 2 * Math.PI * OVERTIME_RADIUS;

// ─── Step State ───
// Each step in playerFlatSteps gets a _state object:
// { status: 'idle'|'running'|'overtime'|'done', secondsLeft, totalSeconds, overtimeSeconds }

function initStepState(step) {
  const total = Math.round((parseFloat(step.minutes) || 1) * 60);
  step._state = {
    status: 'idle',
    totalSeconds: total,
    secondsLeft: total,
    overtimeSeconds: 0,
  };
}

function getRunningSteps() {
  return playerFlatSteps.filter(s => s._state && (s._state.status === 'running' || s._state.status === 'overtime'));
}

function getOvertimeSteps() {
  return playerFlatSteps.filter(s => s._state && s._state.status === 'overtime');
}

function areAllDone() {
  return playerFlatSteps.every(s => s._state && s._state.status === 'done');
}

function getTotalElapsed() {
  let elapsed = 0;
  playerFlatSteps.forEach(s => {
    if (!s._state) return;
    const st = s._state;
    if (st.status === 'done' || st.status === 'running' || st.status === 'overtime') {
      elapsed += (st.totalSeconds - st.secondsLeft) + st.overtimeSeconds;
    }
  });
  return elapsed;
}

function getTotalDurationSecs() {
  return playerFlatSteps.reduce((sum, s) => sum + Math.round((parseFloat(s.minutes) || 1) * 60), 0);
}

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
    const step = playerFlatSteps[focusedStepIdx];
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

// ─── Start / Open Player ───

export function startPlayer(id) {
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  const flat = flattenChunk(chunk, chunks);
  if (flat.length === 0) return;

  // If already viewing this chunk, just show screen
  if (playerChunk && playerChunk.id === id) {
    showScreen('playerScreen');
    return;
  }

  // New chunk
  playerChunk = chunk;
  playerFlatSteps = flat;
  playerFlatSteps.forEach(s => initStepState(s));
  focusedStepIdx = 0;
  playerPlaying = false;

  renderChronoTicks();
  renderDotSidebar();
  renderPlayerSteps();
  updateFocusedDisplay();

  document.getElementById('playerTitle').textContent = playerChunk.name;
  document.getElementById('breadcrumbBar').classList.remove('expanded');
  updatePlayPauseIcon(false);

  const s = loadAudioSettings();
  const voiceBtn = document.getElementById('voiceToggleBtn');
  if (voiceBtn) voiceBtn.style.opacity = s.voice ? '1' : '0.4';

  document.getElementById('chronoFace').className = 'chrono-face';
  document.getElementById('kachunkBtn').classList.remove('ready-pulse', 'snapping');

  showScreen('playerScreen');
}

export function openPlayerView(id) {
  if (playerChunk && playerChunk.id === id) {
    showScreen('playerScreen');
    return;
  }
  startPlayer(id);
}

// ─── Update focused step display (chrono center) ───

function updateFocusedDisplay() {
  const step = playerFlatSteps[focusedStepIdx];
  if (!step || !step._state) return;
  const st = step._state;

  // Timer display
  const timerEl = document.getElementById('playerTimer');
  if (st.status === 'overtime') {
    const m = Math.floor(st.overtimeSeconds / 60);
    const s = st.overtimeSeconds % 60;
    timerEl.textContent = '+' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.add('overtime');
  } else {
    const m = Math.floor(st.secondsLeft / 60);
    const s = st.secondsLeft % 60;
    timerEl.textContent = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.remove('overtime');
  }

  document.getElementById('playerStepLabel').textContent = step.label || 'Step ' + (focusedStepIdx + 1);

  // Count running/total
  const running = getRunningSteps().length;
  const overtime = getOvertimeSteps().length;
  const done = playerFlatSteps.filter(s => s._state?.status === 'done').length;
  document.getElementById('playerStepCount').textContent =
    `${done}/${playerFlatSteps.length} done` + (running > 0 ? ` · ${running} active` : '') + (overtime > 0 ? ` · ${overtime} overtime` : '');

  updateChronoRings();
  updateBreadcrumb();
}

// ─── Chrono Rings ───

function updateChronoRings() {
  const step = playerFlatSteps[focusedStepIdx];
  const st = step?._state;
  const stepRing = document.getElementById('ringProgress');
  const overtimeRing = document.getElementById('ringOvertime');
  const face = document.getElementById('chronoFace');

  if (!stepRing || !st) return;

  // Step ring
  if (st.status === 'overtime') {
    stepRing.style.strokeDashoffset = '0';
    overtimeRing.classList.add('active');
    const pct = Math.min(st.overtimeSeconds / 300, 1);
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC * (1 - pct);
    updateOvertimeTicks(pct);
    face.className = st.overtimeSeconds > 60 ? 'chrono-face alerting-escalated' : 'chrono-face alerting';
  } else if (st.status === 'done') {
    stepRing.style.strokeDashoffset = '0';
    overtimeRing.classList.remove('active');
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC;
    resetOvertimeTicks();
    face.className = 'chrono-face';
  } else {
    const pct = st.totalSeconds > 0 ? (st.totalSeconds - st.secondsLeft) / st.totalSeconds : 0;
    stepRing.style.strokeDashoffset = STEP_CIRC * (1 - pct);
    overtimeRing.classList.remove('active');
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC;
    resetOvertimeTicks();
    face.className = 'chrono-face';
  }

  // Master ring
  const masterRing = document.getElementById('ringMaster');
  if (masterRing) {
    const totalSecs = getTotalDurationSecs();
    const elapsed = getTotalElapsed();
    const masterPct = totalSecs > 0 ? Math.min(elapsed / totalSecs, 1) : 0;
    masterRing.style.strokeDashoffset = MASTER_CIRC * (1 - masterPct);
  }

  // Sub-chunk ring
  const subRing = document.getElementById('ringSubchunk');
  const subTrack = document.getElementById('ringSubchunkTrack');
  const currentStep = playerFlatSteps[focusedStepIdx];
  if (subRing && subTrack && currentStep && currentStep.depth > 0 && currentStep.sourceChunkId) {
    subRing.style.opacity = '1';
    subTrack.style.opacity = '1';
    const subSteps = playerFlatSteps.filter(s => s.sourceChunkId === currentStep.sourceChunkId);
    const subDone = subSteps.filter(s => s._state?.status === 'done').length;
    const subPct = subSteps.length > 0 ? subDone / subSteps.length : 0;
    subRing.style.strokeDashoffset = SUBCHUNK_CIRC * (1 - subPct);
  } else if (subRing && subTrack) {
    subRing.style.opacity = '0';
    subTrack.style.opacity = '0';
  }

  updateDotSidebar();
}

function updateOvertimeTicks(pct) {
  const ticks = document.querySelectorAll('#chronoTicks .tick');
  const count = Math.floor(pct * 60);
  ticks.forEach((tick, i) => {
    tick.classList.toggle('overtime', i < count);
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

// ─── Step List ───

function renderPlayerSteps() {
  const container = document.getElementById('playerStepsList');
  container.innerHTML = playerFlatSteps.map((s, i) => {
    const st = s._state || {};
    let cls = '';
    if (st.status === 'done') cls = 'completed';
    else if (st.status === 'running') cls = 'current';
    else if (st.status === 'overtime') cls = 'current overtime';
    if (i === focusedStepIdx) cls += ' focused';

    const sourceHtml = s.sourceChunk
      ? `<div class="psi-source"><span class="link-icon">&#x27C1;</span> ${esc(s.sourceChunk)}</div>`
      : '';

    // Show timer for running/overtime steps
    let timerHtml = '';
    if (st.status === 'running') {
      const m = Math.floor(st.secondsLeft / 60);
      const sec = st.secondsLeft % 60;
      timerHtml = `<span class="psi-timer">${m}:${sec.toString().padStart(2, '0')}</span>`;
    } else if (st.status === 'overtime') {
      const m = Math.floor(st.overtimeSeconds / 60);
      const sec = st.overtimeSeconds % 60;
      timerHtml = `<span class="psi-timer overtime">+${m}:${sec.toString().padStart(2, '0')}</span>`;
    }

    const statusIcon = st.status === 'done' ? '&#x2713;'
      : (st.status === 'running' || st.status === 'overtime') ? '&#x25CF;'
      : (i + 1);

    return `
      <div class="player-step-item ${cls}" onclick="window._kachunk.onStepTap(${i})">
        <div class="psi-num">${statusIcon}</div>
        <div class="psi-label-wrap">
          ${sourceHtml}
          <div class="psi-label">${esc(s.label || 'Step ' + (i + 1))}</div>
        </div>
        ${timerHtml}
        <div class="psi-dur">${s.minutes}m</div>
      </div>
    `;
  }).join('');
}

// ─── Dot Sidebar ───

function renderDotSidebar() {
  const track = document.getElementById('dotSidebarTrack');
  if (!track || playerFlatSteps.length === 0) return;
  track.innerHTML = playerFlatSteps.map((step, i) => {
    const depthClass = step.depth > 0 ? ` depth-${Math.min(step.depth, 3)}` : '';
    return `<div class="dot-step${depthClass}" data-dot-idx="${i}" onclick="window._kachunk.focusStep(${i})">
      <div class="dot-timer"><svg viewBox="0 0 10 10"><circle class="dot-timer-fill" cx="5" cy="5" r="3" stroke-dasharray="${2 * Math.PI * 3}" stroke-dashoffset="${2 * Math.PI * 3}" transform="rotate(-90 5 5)"/></svg></div>
    </div>`;
  }).join('');
}

function updateDotSidebar() {
  const dots = document.querySelectorAll('.dot-step');
  dots.forEach((dot, i) => {
    const st = playerFlatSteps[i]?._state;
    if (!st) return;
    dot.classList.remove('completed', 'current', 'overtime');
    const timerFill = dot.querySelector('.dot-timer-fill');
    const circ = 2 * Math.PI * 3;

    if (st.status === 'done') {
      dot.classList.add('completed');
      if (timerFill) timerFill.style.strokeDashoffset = '0';
    } else if (st.status === 'running') {
      dot.classList.add('current');
      const pct = st.totalSeconds > 0 ? (st.totalSeconds - st.secondsLeft) / st.totalSeconds : 0;
      if (timerFill) timerFill.style.strokeDashoffset = circ * (1 - pct);
    } else if (st.status === 'overtime') {
      dot.classList.add('current', 'overtime');
      if (timerFill) timerFill.style.strokeDashoffset = '0';
    } else {
      if (timerFill) timerFill.style.strokeDashoffset = `${circ}`;
    }
  });
  const currentDot = document.querySelector('.dot-step.current');
  if (currentDot) currentDot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── Breadcrumb ───

function updateBreadcrumb() {
  const currentStep = playerFlatSteps[focusedStepIdx];
  const currentEl = document.getElementById('breadcrumbCurrent');
  const expandedEl = document.getElementById('breadcrumbExpanded');
  if (!currentStep || !playerChunk) return;

  const crumbs = [{ name: playerChunk.name, depth: 0 }];
  if (currentStep.sourceChunk) {
    crumbs.push({ name: currentStep.sourceChunk, depth: currentStep.depth });
  }
  currentEl.textContent = crumbs.length <= 1 ? crumbs[0].name : crumbs.map(c => c.name).join(' > ');
  expandedEl.innerHTML = crumbs.map((c, i) => {
    const isActive = i === crumbs.length - 1;
    return `<button class="breadcrumb-item ${isActive ? 'bc-active' : ''}" onclick="window._kachunk.closeBreadcrumb()">
      <span class="bc-depth">${i}</span>
      <span class="bc-name">${esc(c.name)}</span>
    </button>`;
  }).join('');
}

export function toggleBreadcrumb() {
  document.getElementById('breadcrumbBar').classList.toggle('expanded');
}

export function closeBreadcrumb() {
  document.getElementById('breadcrumbBar').classList.remove('expanded');
}

export function scrollToStep(idx) {
  const stepItems = document.querySelectorAll('.player-step-item');
  if (stepItems[idx]) stepItems[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ─── Step Interactions ───

// Tap a step: if idle, start it. If running, focus it. If overtime, mark done.
export function onStepTap(idx) {
  const step = playerFlatSteps[idx];
  if (!step || !step._state) return;
  const st = step._state;

  if (st.status === 'idle') {
    // Start this step
    st.status = 'running';
    playUiSound('clickPlay');
    vibrateDevice([10, 20, 40]);
    announceStep(step.label);
    focusedStepIdx = idx;
    ensureTickRunning();
  } else if (st.status === 'running' || st.status === 'overtime') {
    // Focus on this step (show its timer on the chrono)
    focusedStepIdx = idx;
  } else if (st.status === 'done') {
    // Already done — just focus
    focusedStepIdx = idx;
  }

  updateFocusedDisplay();
  renderPlayerSteps();
}

// Focus a step (from dot sidebar) without changing its state
export function focusStep(idx) {
  if (idx >= 0 && idx < playerFlatSteps.length) {
    focusedStepIdx = idx;
    updateFocusedDisplay();
    renderPlayerSteps();
  }
}

// ─── Play / Pause (global) ───

export function togglePlay() {
  if (playerPlaying) {
    pauseAll();
  } else {
    resumeOrStartNext();
  }
}

function resumeOrStartNext() {
  playerPlaying = true;
  updatePlayPauseIcon(true);
  playUiSound('clickPlay');
  startBgAudio(getEffectiveBg());
  requestWakeLock();

  // If nothing is running, start the first idle step
  const running = getRunningSteps();
  if (running.length === 0) {
    const nextIdle = playerFlatSteps.find(s => s._state?.status === 'idle');
    if (nextIdle) {
      nextIdle._state.status = 'running';
      focusedStepIdx = playerFlatSteps.indexOf(nextIdle);
      announceStep(nextIdle.label);
    }
  }

  ensureTickRunning();
  updateFocusedDisplay();
  renderPlayerSteps();
}

function pauseAll() {
  playerPlaying = false;
  updatePlayPauseIcon(false);
  playUiSound('clickPause');
  stopBgAudio();
  releaseWakeLock();
  clearInterval(tickInterval);
  tickInterval = null;
  renderPlayerSteps();
}

// ─── Global Tick (1Hz) ───

function ensureTickRunning() {
  if (tickInterval) return;
  tickInterval = setInterval(globalTick, 1000);
}

function globalTick() {
  if (!playerPlaying) return;

  let anyRunning = false;
  let newOvertimes = [];

  playerFlatSteps.forEach((step, i) => {
    const st = step._state;
    if (!st) return;

    if (st.status === 'running') {
      anyRunning = true;
      st.secondsLeft--;
      if (st.secondsLeft <= 0) {
        // Step timer expired — enter overtime
        st.status = 'overtime';
        st.secondsLeft = 0;
        st.overtimeSeconds = 0;
        newOvertimes.push(i);
      }
    } else if (st.status === 'overtime') {
      anyRunning = true;
      st.overtimeSeconds++;
    }
  });

  // Handle new overtimes
  newOvertimes.forEach(i => {
    if (i === focusedStepIdx) {
      playAlarmSound(getEffectiveAlarm());
      vibrateDevice();
      document.getElementById('kachunkBtn').classList.add('ready-pulse');
    }
  });

  updateFocusedDisplay();
  renderPlayerSteps();

  // If nothing is running or overtime, stop ticking
  if (!anyRunning) {
    clearInterval(tickInterval);
    tickInterval = null;
    if (areAllDone()) {
      showCompletion();
    }
  }
}

// ─── KaChunk! (Advance focused step) ───

export function playerNext() {
  const step = playerFlatSteps[focusedStepIdx];
  if (!step || !step._state) return;
  const st = step._state;

  // KaChunk interaction
  const kb = document.getElementById('kachunkBtn');
  playUiSound('kachunk');
  vibrateDevice([15, 30, 80]);
  kb.classList.remove('ready-pulse', 'snapping');
  void kb.offsetWidth;
  kb.classList.add('snapping');
  setTimeout(() => kb.classList.remove('snapping'), 400);

  // Mark current focused step as done
  st.status = 'done';

  // Auto-start the next idle step if global play is on
  if (playerPlaying) {
    const nextIdle = playerFlatSteps.find(s => s._state?.status === 'idle');
    if (nextIdle) {
      nextIdle._state.status = 'running';
      focusedStepIdx = playerFlatSteps.indexOf(nextIdle);
      announceStep(nextIdle.label);
      ensureTickRunning();
    } else if (areAllDone()) {
      playerPlaying = false;
      updatePlayPauseIcon(false);
      releaseWakeLock();
      showCompletion();
    }
  }

  updateFocusedDisplay();
  renderPlayerSteps();
}

export function playerPrev() {
  // In parallel model, prev focuses the previous step
  if (focusedStepIdx > 0) {
    focusedStepIdx--;
    playUiSound('whoosh');
    updateFocusedDisplay();
    renderPlayerSteps();
  }
}

// Jump to step (legacy compat)
export function jumpToStep(idx) {
  onStepTap(idx);
}

// ─── Navigate ───

export function goBackToDrawer() {
  goHome();
  renderHome();
}

export function stopAndGoHome() {
  clearInterval(tickInterval);
  tickInterval = null;
  stopBgAudio();
  releaseWakeLock();
  playerPlaying = false;
  playerChunk = null;
  playerFlatSteps = [];
  focusedStepIdx = 0;
  goHome();
  renderHome();
}

// ─── Completion ───

function showCompletion() {
  stopBgAudio();
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

// ─── Start chunk from drawer (no screen transition) ───

export function startChunkFromDrawer(id) {
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  const flat = flattenChunk(chunk, chunks);
  if (flat.length === 0) return;

  // If already loaded, just resume
  if (playerChunk && playerChunk.id === id) {
    if (!playerPlaying) {
      resumeOrStartNext();
    }
    return;
  }

  // Initialize fresh
  playerChunk = chunk;
  playerFlatSteps = flat;
  playerFlatSteps.forEach(s => initStepState(s));
  focusedStepIdx = 0;

  // Auto-start the first step
  playerPlaying = true;
  playerFlatSteps[0]._state.status = 'running';
  ensureTickRunning();
}

export function pauseChunkFromDrawer(id) {
  if (playerChunk && playerChunk.id === id && playerPlaying) {
    pauseAll();
  }
}

export function resumeChunkFromDrawer(id) {
  if (playerChunk && playerChunk.id === id && !playerPlaying) {
    resumeOrStartNext();
  }
}

export function getFocusedStepLabel() {
  const step = playerFlatSteps[focusedStepIdx];
  return step ? (step.label || 'Step ' + (focusedStepIdx + 1)) : '';
}

// ─── Exports for drawer to query state ───

export function getPlayerChunkId() {
  return playerChunk ? playerChunk.id : null;
}

export function isPlayerRunning() {
  return playerPlaying;
}

export function getPlayerProgress() {
  if (!playerChunk || playerFlatSteps.length === 0) return 0;
  const total = getTotalDurationSecs();
  const elapsed = getTotalElapsed();
  return total > 0 ? elapsed / total : 0;
}
