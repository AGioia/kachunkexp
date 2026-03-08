// ═══════════════════════════════════════════════════
// KaChunk — Chunk Drawer (Home Screen)
// Direct card interactions: tap chrono = play, arrow = edit, swipe = delete
// ═══════════════════════════════════════════════════

import { loadChunks, getTotalDuration, getFlatStepCount, hasSubChunks, getActiveSessions, createSession, updateSession, removeSession } from './store.js';
import { esc, formatDuration, formatTime12, showToast, showConfirm, executeConfirm, closeConfirm } from './ui.js';
import { showScreen, goHome } from './router.js';
import * as store from './store.js';
import { playUiSound, vibrateDevice } from './audio.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Track swipe state per card
let swipeState = { cardEl: null, startX: 0, currentX: 0 };

// ─── Render Home ───

export function renderHome() {
  const chunks = loadChunks();
  const sessions = getActiveSessions();
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
    const session = sessions.find(s => s.chunkId === c.id);
    const isActive = session && (session.status === 'playing' || session.status === 'paused' || session.status === 'overtime');
    const isPlaying = session && session.status === 'playing';

    return `
      <div class="chunk-card ${isActive ? 'active-chunk' : ''}" data-chunk-id="${c.id}" data-session-id="${session ? session.id : ''}">
        <div class="card-delete-bg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
          </svg>
        </div>
        <div class="card-content">
          <button class="chrono-thumb ${isActive ? 'is-active' : ''} ${isPlaying ? 'is-playing' : ''}" onclick="event.stopPropagation();window._kachunk.toggleChunkPlay('${c.id}')" aria-label="${isPlaying ? 'Pause' : 'Play'} ${c.name}">
            <svg viewBox="0 0 44 44">
              <circle class="ct-track" fill="none" stroke="rgba(26,22,19,0.04)" stroke-width="2" cx="22" cy="22" r="19"/>
              <circle class="ct-progress" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" cx="22" cy="22" r="19"
                stroke-dasharray="119.4" stroke-dashoffset="${isActive && session ? 119.4 * (1 - (session.flatStepIdx / session.flatSteps.length)) : 119.4 * (1 - Math.min(stepCount / 10, 1))}"
                transform="rotate(-90 22 22)"/>
            </svg>
            <div class="ct-icon">
              ${isPlaying
                ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
              }
            </div>
          </button>
          <div class="card-info" ${isActive ? `onclick="window._kachunk.openActivePlayer('${c.id}')"` : `onclick="window._kachunk.toggleChunkPlay('${c.id}')"`}>
            <div class="card-name">${esc(c.name || 'Untitled')}${hasSubs ? '<span class="card-has-subchunks"> &#x27C1;</span>' : ''}</div>
            <div class="card-meta">
              <span>${stepCount} step${stepCount !== 1 ? 's' : ''}</span>
              <span class="dot">·</span>
              <span>${formatDuration(totalMin)}</span>
              ${isActive && session ? `<span class="dot">·</span><span class="card-status ${session.status}">${session.status === 'playing' ? 'Playing' : session.status === 'overtime' ? 'Overtime' : 'Paused'}</span>` : ''}
            </div>
            ${schedText ? `<div class="card-schedule"><span class="sched-dot"></span> ${schedText}</div>` : ''}
          </div>
          <button class="card-edit-btn" onclick="event.stopPropagation();window._kachunk.editChunk('${c.id}')" aria-label="Edit ${c.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire up swipe-to-delete
  wireSwipeHandlers();
}

function getScheduleText(sched) {
  if (!sched || !sched.days || sched.days.length === 0) return '';
  const dayStr = sched.days.map(d => DAY_NAMES[d]).join(', ');
  const timeStr = formatTime12(sched.startTime);
  return `${dayStr} at ${timeStr}`;
}

// ─── Swipe-to-Delete ───

function wireSwipeHandlers() {
  const cards = document.querySelectorAll('.chunk-card');
  cards.forEach(card => {
    const content = card.querySelector('.card-content');
    if (!content) return;

    let isSwiping = false;

    content.addEventListener('touchstart', (e) => {
      isSwiping = false;
      swipeState.cardEl = card;
      swipeState.startX = e.touches[0].clientX;
      swipeState.currentX = swipeState.startX;
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (!swipeState.cardEl) return;
      swipeState.currentX = e.touches[0].clientX;
      const dx = swipeState.currentX - swipeState.startX;
      if (Math.abs(dx) > 10) {
        isSwiping = true;
        content.style.transition = 'none';
      }
      if (isSwiping && dx < 0) {
        const offset = Math.max(dx, -100);
        content.style.transform = `translateX(${offset}px)`;
        if (dx < -20) card.classList.add('swiped');
      }
    }, { passive: true });

    content.addEventListener('touchend', () => {
      if (!swipeState.cardEl) return;

      if (!isSwiping) {
        // It was a tap, not a swipe — don't interfere with click handlers
        swipeState.cardEl = null;
        return;
      }

      const dx = swipeState.currentX - swipeState.startX;
      content.style.transition = 'transform 0.25s ease';

      if (dx < -60) {
        content.style.transform = 'translateX(-80px)';
        card.classList.add('swiped');
        const chunkId = card.dataset.chunkId;
        setTimeout(() => {
          if (content.style.transform === 'translateX(-80px)') {
            content.style.transform = 'translateX(0)';
            card.classList.remove('swiped');
          }
        }, 4000);

        const deleteBg = card.querySelector('.card-delete-bg');
        deleteBg.onclick = () => {
          const chunks = loadChunks();
          const chunk = chunks.find(c => c.id === chunkId);
          showConfirm(`Delete "${chunk?.name || 'Untitled'}"?`, () => {
            store.deleteChunk(chunkId);
            showToast('Deleted');
            renderHome();
          });
        };
      } else {
        content.style.transform = 'translateX(0)';
        card.classList.remove('swiped');
      }
      swipeState.cardEl = null;
    });
  });
}

// ─── Direct Card Interactions ───

export function toggleChunkPlay(chunkId) {
  console.log('[KaChunk] toggleChunkPlay:', chunkId);
  // Always just open the player — it handles its own state
  const startPlayer = window._kachunk._startPlayer;
  if (startPlayer) {
    console.log('[KaChunk] calling startPlayer');
    startPlayer(chunkId);
  } else {
    console.log('[KaChunk] _startPlayer not found!');
  }
}

export function openActivePlayer(chunkId) {
  console.log('[KaChunk] openActivePlayer:', chunkId);
  const startPlayer = window._kachunk._startPlayer;
  if (startPlayer) {
    startPlayer(chunkId);
  } else {
    console.log('[KaChunk] _startPlayer not found!');
  }
}

export function editChunk(chunkId) {
  const openEditor = window._kachunk._openEditor;
  if (openEditor) openEditor(chunkId);
}

// ─── Legacy compat (kept for existing refs) ───

export function openSheet() {}
export function closeSheet() {}
export function playSelectedChunk() {}
export function editSelectedChunk() {}
export function scheduleSelectedChunk() {}
export function deleteSelectedChunk() {}
export function getSelectedChunkId() { return null; }
