// ═══════════════════════════════════════════════════
// KaChunk — Chunk Editor
// ═══════════════════════════════════════════════════

import { loadChunks, saveChunks, genId, flattenChunk, getTotalDuration, getFlatStepCount, chunkReferencesId } from './store.js';
import { esc, formatDuration, showToast } from './ui.js';
import { showScreen, goHome } from './router.js';
import { ALARM_SOUNDS, BG_SOUNDS, previewSound } from './audio.js';
import { renderHome } from './home.js';

let editingId = null;
let editSteps = [];
let editChunkAudioAlarm = 'default';
let editChunkAudioBg = 'default';

// ─── Open Editor ───

export function createNewChunk() {
  editingId = null;
  document.getElementById('editName').value = '';
  editSteps = [{ label: '', minutes: 5 }];
  editChunkAudioAlarm = 'default';
  editChunkAudioBg = 'default';
  renderEditSteps();
  renderEditAudioPickers();
  showScreen('editScreen');
  setTimeout(() => document.getElementById('editName').focus(), 400);
}

export function openEditor(id) {
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  editingId = chunk.id;
  document.getElementById('editName').value = chunk.name;
  editSteps = chunk.steps.map(s => ({ ...s }));
  if (editSteps.length === 0) editSteps = [{ label: '', minutes: 5 }];
  editChunkAudioAlarm = chunk.audioAlarm || 'default';
  editChunkAudioBg = chunk.audioBg || 'default';
  renderEditSteps();
  renderEditAudioPickers();
  showScreen('editScreen');
}

// ─── Render Steps ───

function renderEditSteps() {
  const container = document.getElementById('editSteps');
  const allChunks = loadChunks();
  container.innerHTML = editSteps.map((s, i) => {
    const stepType = s.type || 'step';
    if (stepType === 'chunk') {
      const sub = allChunks.find(c => c.id === s.chunkId);
      if (sub) {
        const subDur = getTotalDuration(sub, allChunks);
        const subCount = getFlatStepCount(sub, allChunks);
        const previewSteps = flattenChunk(sub, allChunks);
        const previewId = 'subpreview_' + i;
        return `
          <div class="step-item sub-chunk-item" onclick="window._kachunk.toggleSubPreview('${previewId}')">
            <div class="step-number" style="background:var(--accent-light)">🔗</div>
            <div class="sub-chunk-info">
              <div class="sub-chunk-name"><span class="link-icon">💿</span> ${esc(sub.name)}</div>
              <div class="sub-chunk-meta">${subCount} step${subCount !== 1 ? 's' : ''} · ${formatDuration(subDur)}</div>
              <div class="sub-chunk-preview" id="${previewId}">
                ${previewSteps.map(ps => `<div class="sub-chunk-preview-step"><span>${esc(ps.label || 'Untitled')}</span><span>${ps.minutes}m</span></div>`).join('')}
              </div>
            </div>
            <div class="step-reorder">
              <button onclick="event.stopPropagation();window._kachunk.moveStep(${i},-1)" ${i === 0 ? 'disabled style="opacity:0.2"' : ''}>▲</button>
              <button onclick="event.stopPropagation();window._kachunk.moveStep(${i},1)" ${i === editSteps.length - 1 ? 'disabled style="opacity:0.2"' : ''}>▼</button>
            </div>
            <button class="step-delete" onclick="event.stopPropagation();window._kachunk.removeStep(${i})" ${editSteps.length <= 1 ? 'disabled style="opacity:0.15"' : ''}>✕</button>
          </div>`;
      } else {
        return `
          <div class="step-item sub-chunk-item">
            <div class="step-number" style="background:var(--danger)">✕</div>
            <div class="sub-chunk-info">
              <div class="sub-chunk-name sub-chunk-deleted">Deleted chunk</div>
              <div class="sub-chunk-meta">This chunk no longer exists</div>
            </div>
            <div class="step-reorder">
              <button onclick="window._kachunk.moveStep(${i},-1)" ${i === 0 ? 'disabled style="opacity:0.2"' : ''}>▲</button>
              <button onclick="window._kachunk.moveStep(${i},1)" ${i === editSteps.length - 1 ? 'disabled style="opacity:0.2"' : ''}>▼</button>
            </div>
            <button class="step-delete" onclick="window._kachunk.removeStep(${i})">✕</button>
          </div>`;
      }
    }
    return `
    <div class="step-item">
      <div class="step-number">${i + 1}</div>
      <input type="text" value="${esc(s.label)}" placeholder="Step name"
        onchange="window._kachunk.updateStepLabel(${i},this.value)" oninput="window._kachunk.updateStepLabel(${i},this.value)">
      <div class="step-duration">
        <input type="number" value="${s.minutes}" min="0.5" max="999" step="0.5"
          onchange="window._kachunk.updateStepMinutes(${i},this.value)"
          oninput="window._kachunk.updateStepMinutes(${i},this.value)">
        <span>min</span>
      </div>
      <button class="step-sound-btn ${s.sound ? 'has-sound' : ''}" onclick="window._kachunk.openStepSoundPicker(this,${i})" title="Step sound">🔔</button>
      <div class="step-reorder">
        <button onclick="window._kachunk.moveStep(${i},-1)" ${i === 0 ? 'disabled style="opacity:0.2"' : ''}>▲</button>
        <button onclick="window._kachunk.moveStep(${i},1)" ${i === editSteps.length - 1 ? 'disabled style="opacity:0.2"' : ''}>▼</button>
      </div>
      <button class="step-delete" onclick="window._kachunk.removeStep(${i})" ${editSteps.length <= 1 ? 'disabled style="opacity:0.15"' : ''}>✕</button>
    </div>`;
  }).join('');
}

// ─── Step Operations ───

export function addStep() {
  editSteps.push({ label: '', minutes: 5 });
  renderEditSteps();
  const items = document.querySelectorAll('#editSteps .step-item');
  const last = items[items.length - 1];
  if (last) {
    const input = last.querySelector('input[type="text"]');
    if (input) input.focus();
  }
}

export function removeStep(i) {
  if (editSteps.length <= 1) return;
  editSteps.splice(i, 1);
  renderEditSteps();
}

export function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= editSteps.length) return;
  [editSteps[i], editSteps[j]] = [editSteps[j], editSteps[i]];
  renderEditSteps();
}

export function updateStepLabel(i, val) {
  editSteps[i].label = val;
}

export function updateStepMinutes(i, val) {
  editSteps[i].minutes = parseFloat(val) || 1;
}

export function toggleSubPreview(previewId) {
  const el = document.getElementById(previewId);
  if (el) el.classList.toggle('expanded');
}

// ─── Step Sound Picker ───

let stepSoundDropdownIdx = -1;

export function openStepSoundPicker(btn, stepIdx) {
  stepSoundDropdownIdx = stepIdx;
  const dropdown = document.getElementById('stepSoundDropdown');
  const rect = btn.getBoundingClientRect();
  const currentSound = editSteps[stepIdx].sound || 'default';

  dropdown.innerHTML =
    `<button class="step-sound-option ${currentSound === 'default' ? 'selected' : ''}" onclick="window._kachunk.pickStepSound('default')"><span class="opt-icon">🎛</span> Default</button>` +
    Object.entries(ALARM_SOUNDS).map(([key, snd]) =>
      `<button class="step-sound-option ${currentSound === key ? 'selected' : ''}" onclick="window._kachunk.pickStepSound('${key}')"><span class="opt-icon">${snd.icon}</span> ${snd.label}</button>`
    ).join('');

  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  dropdown.classList.add('show');

  setTimeout(() => {
    document.addEventListener('click', closeStepSoundDropdown, { once: true });
  }, 10);
}

function closeStepSoundDropdown() {
  document.getElementById('stepSoundDropdown').classList.remove('show');
  stepSoundDropdownIdx = -1;
}

export function pickStepSound(key) {
  if (stepSoundDropdownIdx >= 0 && stepSoundDropdownIdx < editSteps.length) {
    editSteps[stepSoundDropdownIdx].sound = key === 'default' ? undefined : key;
    renderEditSteps();
    if (key !== 'default') previewSound('alarm', key);
  }
  closeStepSoundDropdown();
}

// ─── Chunk Picker (Add Sub-chunk) ───

export function openChunkPicker() {
  const allChunks = loadChunks();
  const listEl = document.getElementById('chunkPickerList');

  const available = allChunks.filter(c => {
    if (editingId && c.id === editingId) return false;
    if (editingId && chunkReferencesId(c, editingId, allChunks)) return false;
    return true;
  });

  if (available.length === 0) {
    listEl.innerHTML = '<div class="chunk-picker-empty">No other chunks available to add.</div>';
  } else {
    listEl.innerHTML = available.map(c => {
      const dur = getTotalDuration(c, allChunks);
      const count = getFlatStepCount(c, allChunks);
      return `
        <button class="chunk-picker-item" onclick="window._kachunk.pickSubChunk('${c.id}')">
          <div class="cpi-disc"></div>
          <div class="cpi-info">
            <div class="cpi-name">${esc(c.name || 'Untitled')}</div>
            <div class="cpi-meta">${count} step${count !== 1 ? 's' : ''} · ${formatDuration(dur)}</div>
          </div>
        </button>`;
    }).join('');
  }

  document.getElementById('chunkPickerOverlay').classList.add('show');
  document.getElementById('chunkPicker').classList.add('show');
}

export function closeChunkPicker() {
  document.getElementById('chunkPickerOverlay').classList.remove('show');
  document.getElementById('chunkPicker').classList.remove('show');
}

export function pickSubChunk(chunkId) {
  editSteps.push({ type: 'chunk', chunkId: chunkId });
  closeChunkPicker();
  renderEditSteps();
  showToast('Sub-chunk added');
}

// ─── Audio Pickers ───

function renderEditAudioPickers() {
  const alarmPicker = document.getElementById('editAlarmPicker');
  const bgPicker = document.getElementById('editBgPicker');

  alarmPicker.innerHTML =
    `<button class="sound-pill ${editChunkAudioAlarm === 'default' ? 'selected' : ''}" onclick="window._kachunk.selectEditAlarm('default')">🎛 Default</button>` +
    Object.entries(ALARM_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${editChunkAudioAlarm === key ? 'selected' : ''}" onclick="window._kachunk.selectEditAlarm('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');

  bgPicker.innerHTML =
    `<button class="sound-pill ${editChunkAudioBg === 'default' ? 'selected' : ''}" onclick="window._kachunk.selectEditBg('default')">🎛 Default</button>` +
    Object.entries(BG_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${editChunkAudioBg === key ? 'selected' : ''}" onclick="window._kachunk.selectEditBg('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');
}

export function selectEditAlarm(key) {
  editChunkAudioAlarm = key;
  renderEditAudioPickers();
  if (key !== 'default') previewSound('alarm', key);
}

export function selectEditBg(key) {
  editChunkAudioBg = key;
  renderEditAudioPickers();
  if (key !== 'default') previewSound('bg', key);
}

// ─── Save ───

export function saveChunk() {
  const name = document.getElementById('editName').value.trim();
  if (!name) {
    showToast('Please enter a name');
    document.getElementById('editName').focus();
    return;
  }

  const validSteps = editSteps.filter(s => {
    if ((s.type || 'step') === 'chunk') return true;
    return s.label && s.label.trim();
  });
  if (validSteps.length === 0) {
    showToast('Add at least one named step');
    return;
  }

  validSteps.forEach(s => {
    if ((s.type || 'step') === 'chunk') return;
    s.label = s.label.trim();
    s.minutes = Math.max(0.5, parseFloat(s.minutes) || 1);
  });

  let chunks = loadChunks();

  if (editingId) {
    const idx = chunks.findIndex(c => c.id === editingId);
    if (idx >= 0) {
      chunks[idx].name = name;
      chunks[idx].steps = validSteps;
      chunks[idx].audioAlarm = editChunkAudioAlarm !== 'default' ? editChunkAudioAlarm : undefined;
      chunks[idx].audioBg = editChunkAudioBg !== 'default' ? editChunkAudioBg : undefined;
    }
  } else {
    chunks.push({
      id: genId(),
      name,
      steps: validSteps,
      schedule: { days: [], startTime: '' },
      audioAlarm: editChunkAudioAlarm !== 'default' ? editChunkAudioAlarm : undefined,
      audioBg: editChunkAudioBg !== 'default' ? editChunkAudioBg : undefined
    });
  }

  saveChunks(chunks);
  showToast(editingId ? 'Chunk updated' : 'Chunk created');
  goHome();
  renderHome();
}
