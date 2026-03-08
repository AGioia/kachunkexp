// ═══════════════════════════════════════════════════
// KaChunk — Home Screen
// ═══════════════════════════════════════════════════

import { loadChunks, getTotalDuration, getFlatStepCount, hasSubChunks } from './store.js';
import { esc, formatDuration, formatTime12, showToast, showConfirm, executeConfirm, closeConfirm } from './ui.js';
import { showScreen, goHome } from './router.js';
import * as store from './store.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let selectedChunkId = null;

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

  list.innerHTML = chunks.map(c => {
    const totalMin = getTotalDuration(c, chunks);
    const stepCount = getFlatStepCount(c, chunks);
    const hasSubs = hasSubChunks(c);
    const schedText = getScheduleText(c.schedule);
    return `
      <div class="chunk-card" onclick="window._kachunk.openSheet('${c.id}')">
        <div class="chrono-thumb">
          <svg viewBox="0 0 44 44">
            <circle fill="none" stroke="rgba(26,22,19,0.04)" stroke-width="2" cx="22" cy="22" r="19"/>
            <circle fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" cx="22" cy="22" r="19"
              stroke-dasharray="119.4" stroke-dashoffset="${119.4 * (1 - Math.min(stepCount / 10, 1))}"
              transform="rotate(-90 22 22)"/>
          </svg>
        </div>
        <div class="card-info">
          <div class="card-name">${esc(c.name || 'Untitled')}${hasSubs ? '<span class="card-has-subchunks">⟁</span>' : ''}</div>
          <div class="card-meta">
            <span>${stepCount} step${stepCount !== 1 ? 's' : ''}</span>
            <span class="dot">·</span>
            <span>${formatDuration(totalMin)}</span>
          </div>
          ${schedText ? `<div class="card-schedule"><span class="dot" style="width:4px;height:4px;border-radius:50%;background:var(--accent);display:inline-block"></span> ${schedText}</div>` : ''}
        </div>
        <svg class="card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
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

// ─── Action Sheet ───

export function openSheet(id) {
  selectedChunkId = id;
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  document.getElementById('sheetTitle').textContent = chunk.name || 'Untitled';
  document.getElementById('sheetOverlay').classList.add('show');
  document.getElementById('actionSheet').classList.add('show');
}

export function closeSheet() {
  document.getElementById('sheetOverlay').classList.remove('show');
  document.getElementById('actionSheet').classList.remove('show');
  selectedChunkId = null;
}

export function getSelectedChunkId() {
  return selectedChunkId;
}

export function playSelectedChunk(startPlayerFn) {
  const id = selectedChunkId;
  closeSheet();
  setTimeout(() => startPlayerFn(id), 150);
}

export function editSelectedChunk(openEditorFn) {
  const id = selectedChunkId;
  closeSheet();
  setTimeout(() => openEditorFn(id), 150);
}

export function scheduleSelectedChunk(openScheduleFn) {
  const id = selectedChunkId;
  closeSheet();
  setTimeout(() => openScheduleFn(id), 150);
}

export function deleteSelectedChunk() {
  const id = selectedChunkId;
  closeSheet();
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  showConfirm(`Delete "${chunk.name || 'Untitled'}"? This can't be undone.`, () => {
    store.deleteChunk(id);
    showToast('Chunk deleted');
    renderHome();
  });
}
