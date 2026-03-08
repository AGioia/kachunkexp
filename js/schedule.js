// ═══════════════════════════════════════════════════
// KaChunk — Schedule Screen
// ═══════════════════════════════════════════════════

import { loadChunks, saveChunks } from './store.js';
import { showToast, formatTime12 } from './ui.js';
import { showScreen, goHome } from './router.js';
import { renderHome } from './home.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

let schedulingId = null;

export function openSchedule(id) {
  schedulingId = id;
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === id);
  if (!chunk) return;

  document.getElementById('scheduleTitle').textContent = 'Schedule';
  document.getElementById('scheduleSubtitle').textContent = chunk.name || 'Untitled';

  const sched = chunk.schedule || { days: [], startTime: '' };

  document.getElementById('dayToggles').innerHTML = DAY_LETTERS.map((letter, i) =>
    `<button class="day-toggle ${sched.days.includes(i) ? 'selected' : ''}"
      data-day="${i}" onclick="window._kachunk.toggleDay(this)">${letter}</button>`
  ).join('');

  document.getElementById('scheduleTime').value = sched.startTime || '07:00';
  updateScheduleSummary();

  showScreen('scheduleScreen');
}

export function toggleDay(el) {
  el.classList.toggle('selected');
  updateScheduleSummary();
}

function updateScheduleSummary() {
  const selected = Array.from(document.querySelectorAll('.day-toggle.selected'))
    .map(el => parseInt(el.dataset.day));
  const time = document.getElementById('scheduleTime').value;
  const summary = document.getElementById('scheduleSummary');

  if (selected.length === 0) {
    summary.textContent = 'No schedule set';
    summary.classList.remove('has-schedule');
    return;
  }

  const dayStr = selected.map(d => DAY_NAMES[d]).join(', ');
  const timeStr = formatTime12(time);
  summary.textContent = `Scheduled for ${dayStr} at ${timeStr}`;
  summary.classList.add('has-schedule');
}

export function saveSchedule() {
  const selected = Array.from(document.querySelectorAll('.day-toggle.selected'))
    .map(el => parseInt(el.dataset.day));
  const time = document.getElementById('scheduleTime').value;

  let chunks = loadChunks();
  const idx = chunks.findIndex(c => c.id === schedulingId);
  if (idx >= 0) {
    chunks[idx].schedule = { days: selected, startTime: time };
    saveChunks(chunks);
    showToast('Schedule saved');
  }
  goHome();
  renderHome();
}

export function clearSchedule() {
  let chunks = loadChunks();
  const idx = chunks.findIndex(c => c.id === schedulingId);
  if (idx >= 0) {
    chunks[idx].schedule = { days: [], startTime: '' };
    saveChunks(chunks);
    showToast('Schedule cleared');
  }
  goHome();
  renderHome();
}

// Listen for time change
export function initScheduleListeners() {
  document.getElementById('scheduleTime').addEventListener('change', updateScheduleSummary);
}
