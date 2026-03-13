// ═══════════════════════════════════════════════════
// KaChunk — Chunk Drawer (Home Screen)
// Multi-engine aware — each chunk can run independently
// ═══════════════════════════════════════════════════

import { loadChunks, getTotalDuration, getFlatStepCount, hasSubChunks } from './store.js';
import { esc, formatDuration, formatTime12, showToast } from './ui.js';
import { playUiSound, vibrateDevice } from './audio.js';
import {
  isEngineActive, isEnginePlaying, getPlayerProgress,
  getFocusedStepLabel, startChunkFromDrawer,
  pauseChunkFromDrawer, resumeChunkFromDrawer, stopAndGoHome
} from './player.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Live update interval for drawer chrono thumbs ───
let drawerTickInterval = null;

function startDrawerTick() {
  if (drawerTickInterval) return;
  drawerTickInterval = setInterval(updateDrawerThumbs, 1000);
}

function stopDrawerTick() {
  clearInterval(drawerTickInterval);
  drawerTickInterval = null;
}

function updateDrawerThumbs() {
  const chunks = loadChunks();
  let anyActive = false;

  chunks.forEach(c => {
    if (!isEngineActive(c.id)) return;
    anyActive = true;

    const card = document.querySelector(`.chunk-card[data-chunk-id="${c.id}"]`);
    if (!card) return;

    const progress = getPlayerProgress(c.id);
    const dashoffset = 119.4 * (1 - progress);

    const progressRing = card.querySelector('.ct-progress');
    if (progressRing) progressRing.setAttribute('stroke-dashoffset', dashoffset);

    const fillRing = card.querySelector('.ct-fill');
    if (fillRing) fillRing.setAttribute('stroke-dashoffset', dashoffset);

    const label = getFocusedStepLabel(c.id);
    const labelEl = card.querySelector('.card-step-label');
    if (labelEl && label) labelEl.textContent = ' \u00B7 ' + label;

    // Update status text
    const statusEl = card.querySelector('.card-status');
    if (statusEl) {
      const playing = isEnginePlaying(c.id);
      statusEl.textContent = playing ? 'Active' : 'Paused';
      statusEl.className = 'card-status ' + (playing ? 'playing' : 'paused');
    }
  });

  if (!anyActive) stopDrawerTick();
}

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

  let anyActive = false;

  list.innerHTML = chunks.map(c => {
    const totalMin = getTotalDuration(c, chunks);
    const stepCount = getFlatStepCount(c, chunks);
    const hasSubs = hasSubChunks(c);
    const schedText = getScheduleText(c.schedule);
    const active = isEngineActive(c.id);
    const playing = isEnginePlaying(c.id);
    const progress = active ? getPlayerProgress(c.id) : 0;
    const focusedLabel = active ? getFocusedStepLabel(c.id) : '';

    if (active) anyActive = true;

    const dashoffset = 119.4 * (1 - progress);

    return `
      <div class="chunk-card ${active ? 'active-chunk' : ''} ${playing ? 'playing-chunk' : ''} ${active && !playing ? 'paused-chunk' : ''}" data-chunk-id="${c.id}">
        <div class="card-content">
          <button class="chrono-thumb ${active ? 'is-active' : ''}"
            
            
            
            
            
            ontouchstart="event.stopPropagation(); window._kachunk.chronoDown('${c.id}')"
            ontouchend="event.stopPropagation(); window._kachunk.chronoUp('${c.id}')"
            ontouchcancel="window._kachunk.chronoCancel()"
            onmousedown="event.stopPropagation(); window._kachunk.chronoDown('${c.id}')"
            onmouseup="event.stopPropagation(); window._kachunk.chronoUp('${c.id}')"
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
          <div class="card-info" onclick="window._kachunk.openPlayerScreen('${c.id}')" style="cursor: pointer; padding: 12px 0;">
            <div class="card-name">${esc(c.name || 'Untitled')}${hasSubs ? '<span class="card-has-subchunks"> &#x27C1;</span>' : ''}${active && focusedLabel ? `<span class="card-step-label"> · ${esc(focusedLabel)}</span>` : ''}</div>
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

  if (anyActive) startDrawerTick();
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
  pressTriggered = false;
  const active = isEngineActive(chunkId);
  if (!active) return; // Only allow reset if it's currently active/paused
  
  pressTimer = setTimeout(() => {
    pressTriggered = true;
    const eng = window._kachunk._engines.get(chunkId);
    if (eng) {
      eng.masterPause();
      window._kachunk._engines.delete(chunkId);
      window._kachunk.saveEngineState();
    }
    window._kachunk.playUiSound('boop');
    window._kachunk.vibrateDevice([50, 50, 50]);
    renderHome();
  }, 600); // 600ms hold to reset
}

export function chronoUp(chunkId) {
  clearTimeout(pressTimer);
  if (pressTriggered) return;

  const active = isEngineActive(chunkId);
  if (active) {
    if (isEnginePlaying(chunkId)) {
      pauseChunkFromDrawer(chunkId);
      playUiSound('clickPause');
      vibrateDevice([10]);
    } else {
      resumeChunkFromDrawer(chunkId);
      playUiSound('clickPlay');
      vibrateDevice([10, 20, 40]);
      startDrawerTick();
    }
  } else {
    // Start chunk
    startChunkFromDrawer(chunkId);
    playUiSound('clickPlay');
    vibrateDevice([10, 20, 40]);
    startDrawerTick();
  }
  renderHome();
}

export function chronoCancel() {
  clearTimeout(pressTimer);
  pressTriggered = false;
}



// ─── Card body: open player ───

export function openPlayerScreen(chunkId) {
  // Just open the player view — don't auto-start the chunk
  const fn = window._kachunk._startPlayer;
  if (fn) fn(chunkId);
}

// ─── Arrow: edit ───

export function editChunk(chunkId) {
  const fn = window._kachunk._openEditor;
  if (fn) fn(chunkId);
}
