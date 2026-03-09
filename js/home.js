// ═══════════════════════════════════════════════════
// KaChunk — Chunk Drawer (Home Screen)
// Chrono thumb: center dot, pac-man fill, pulse when paused
// Long-press: reset (if active) or schedule (if idle)
// ═══════════════════════════════════════════════════

import { loadChunks, getTotalDuration, getFlatStepCount, hasSubChunks } from './store.js';
import { esc, formatDuration, formatTime12, showToast } from './ui.js';
import { playUiSound, vibrateDevice } from './audio.js';
import { getPlayerChunkId, isPlayerRunning, getPlayerProgress } from './player.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Track which chunks the user has activated from the drawer
const activeChunks = new Map(); // chunkId → { playing: bool }

// ─── Render Home ───

export function renderHome() {
  const chunks = loadChunks();
  const list = document.getElementById('chunkList');

  if (chunks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-chrono"></div>
        <h2>No Chunks Yet</h2>
        <p>Create your first chunk — a sequence of timed steps to guide your rhythm.</p>
      </div>
    `;
    return;
  }

  // Check if the player module has this chunk loaded
  const playerChunkId = getPlayerChunkId();

  list.innerHTML = chunks.map(c => {
    const totalMin = getTotalDuration(c, chunks);
    const stepCount = getFlatStepCount(c, chunks);
    const hasSubs = hasSubChunks(c);
    const schedText = getScheduleText(c.schedule);
    const active = activeChunks.has(c.id);
    const playing = active && activeChunks.get(c.id).playing;
    const progress = (c.id === playerChunkId) ? getPlayerProgress() : 0;

    // Pac-man depletion: full circle = 119.4, deplete as progress increases
    const dashoffset = 119.4 * (1 - progress);

    return `
      <div class="chunk-card ${active ? 'active-chunk' : ''} ${playing ? 'playing-chunk' : ''} ${active && !playing ? 'paused-chunk' : ''}" data-chunk-id="${c.id}">
        <div class="card-content">
          <button class="chrono-thumb ${active ? 'is-active' : ''}"
            ontouchstart="window._kachunk.chronoDown('${c.id}')"
            ontouchend="window._kachunk.chronoUp('${c.id}')"
            ontouchcancel="window._kachunk.chronoCancel()"
            onmousedown="window._kachunk.chronoDown('${c.id}')"
            onmouseup="window._kachunk.chronoUp('${c.id}')"
            onclick="return false"
            aria-label="${c.name}">
            <svg viewBox="0 0 44 44">
              <circle fill="none" stroke="rgba(26,22,19,0.04)" stroke-width="2" cx="22" cy="22" r="19"/>
              ${active ? `<circle class="ct-fill" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" cx="22" cy="22" r="19"
                stroke-dasharray="119.4" stroke-dashoffset="${dashoffset}"
                transform="rotate(-90 22 22)" opacity="0.15"/>` : ''}
              <circle class="ct-progress" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" cx="22" cy="22" r="19"
                stroke-dasharray="119.4" stroke-dashoffset="${active ? dashoffset : 119.4 * (1 - Math.min(stepCount / 10, 1))}"
                transform="rotate(-90 22 22)"/>
            </svg>
            <div class="ct-dot"></div>
          </button>
          <div class="card-info" onclick="window._kachunk.openPlayer('${c.id}')">
            <div class="card-name">${esc(c.name || 'Untitled')}${hasSubs ? '<span class="card-has-subchunks"> &#x27C1;</span>' : ''}</div>
            <div class="card-meta">
              <span>${stepCount} step${stepCount !== 1 ? 's' : ''}</span>
              <span class="dot">·</span>
              <span>${formatDuration(totalMin)}</span>
              ${active ? `<span class="dot">·</span><span class="card-status ${playing ? 'playing' : 'paused'}">${playing ? 'Active' : 'Paused'}</span>` : ''}
            </div>
            ${schedText ? `<div class="card-schedule"><span class="sched-dot"></span> ${schedText}</div>` : ''}
          </div>
          <button class="card-edit-btn" onclick="window._kachunk.editChunk('${c.id}')" aria-label="Edit ${esc(c.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getScheduleText(sched) {
  if (!sched || !sched.days || sched.days.length === 0) return '';
  const dayStr = sched.days.map(d => DAY_NAMES[d]).join(', ');
  const timeStr = formatTime12(sched.startTime);
  return `${dayStr} at ${timeStr}`;
}

// ─── Chrono Thumb: press handling ───

let pressTimer = null;
let pressChunkId = null;
let pressTriggered = false;

export function chronoDown(chunkId) {
  pressChunkId = chunkId;
  pressTriggered = false;
  const active = activeChunks.has(chunkId);

  pressTimer = setTimeout(() => {
    pressTriggered = true;
    vibrateDevice([30]);

    if (active) {
      // Long-press on active chunk = reset
      activeChunks.delete(chunkId);
      // If player has this chunk, stop it
      const stopFn = window._kachunk.stopAndGoHome;
      if (getPlayerChunkId() === chunkId && stopFn) {
        stopFn();
      }
      showToast('Reset');
      renderHome();
    } else {
      // Long-press on idle chunk = schedule
      const fn = window._kachunk._openSchedule;
      if (fn) fn(chunkId);
    }
  }, 500);
}

export function chronoUp(chunkId) {
  clearTimeout(pressTimer);
  if (pressTriggered) return;

  // Short tap
  const active = activeChunks.has(chunkId);
  if (active) {
    // Toggle play/pause
    const state = activeChunks.get(chunkId);
    state.playing = !state.playing;
    if (state.playing) {
      playUiSound('clickPlay');
      vibrateDevice([10, 20, 40]);
    } else {
      playUiSound('clickPause');
      vibrateDevice([10]);
    }
  } else {
    // Start chunk
    activeChunks.set(chunkId, { playing: true });
    playUiSound('clickPlay');
    vibrateDevice([10, 20, 40]);
    // Initialize in player module
    const fn = window._kachunk._startPlayer;
    if (fn) fn(chunkId);
  }
  renderHome();
}

export function chronoCancel() {
  clearTimeout(pressTimer);
  pressTriggered = false;
}

// ─── Card body: open player ───

export function openPlayer(chunkId) {
  if (!activeChunks.has(chunkId)) {
    activeChunks.set(chunkId, { playing: true });
  }
  const fn = window._kachunk._startPlayer;
  if (fn) fn(chunkId);
}

// ─── Arrow: edit ───

export function editChunk(chunkId) {
  const fn = window._kachunk._openEditor;
  if (fn) fn(chunkId);
}
