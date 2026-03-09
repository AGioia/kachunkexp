// ═══════════════════════════════════════════════════
// KaChunk — Multi-Engine Player
// Multiple chunks run simultaneously, single player view switches between them
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

// ─── Ring Constants ───
const MASTER_RADIUS = 122, MASTER_CIRC = 2 * Math.PI * MASTER_RADIUS;
const SUBCHUNK_RADIUS = 115, SUBCHUNK_CIRC = 2 * Math.PI * SUBCHUNK_RADIUS;
const STEP_RADIUS = 108, STEP_CIRC = 2 * Math.PI * STEP_RADIUS;
const OVERTIME_RADIUS = 101, OVERTIME_CIRC = 2 * Math.PI * OVERTIME_RADIUS;

// ═══════════════════════════════════════════════════
// ChunkEngine — one per active chunk
// ═══════════════════════════════════════════════════

class ChunkEngine {
  constructor(chunk, flatSteps) {
    this.chunk = chunk;
    this.id = chunk.id;
    this.flatSteps = flatSteps;
    this.focusedIdx = 0;
    this.playing = false;
    flatSteps.forEach(s => this._initStep(s));
  }

  _initStep(step) {
    const total = Math.round((parseFloat(step.minutes) || 1) * 60);
    step._state = {
      status: 'idle',
      totalSeconds: total,
      // Wall-clock based timing:
      startedAt: null,       // Date.now() when step began running
      priorElapsed: 0,       // seconds accumulated before current run (from pauses)
    };
  }

  // Compute live secondsLeft / overtimeSeconds from wall clock
  _calcStep(st) {
    if (st.status === 'running' || st.status === 'overtime') {
      const elapsed = st.priorElapsed + (Date.now() - st.startedAt) / 1000;
      const left = st.totalSeconds - elapsed;
      return { secondsLeft: Math.max(0, Math.round(left)), overtimeSeconds: left < 0 ? Math.round(-left) : 0, elapsed };
    } else if (st.status === 'paused') {
      const left = st.totalSeconds - st.priorElapsed;
      return { secondsLeft: Math.max(0, Math.round(left)), overtimeSeconds: left < 0 ? Math.round(-left) : 0, elapsed: st.priorElapsed };
    } else if (st.status === 'done') {
      return { secondsLeft: 0, overtimeSeconds: Math.round(st.priorElapsed > st.totalSeconds ? st.priorElapsed - st.totalSeconds : 0), elapsed: st.priorElapsed };
    }
    return { secondsLeft: st.totalSeconds, overtimeSeconds: 0, elapsed: 0 };
  }

  // Convenience: get computed values for a step's state
  static calc(st) {
    if (st.status === 'running' || st.status === 'overtime') {
      const elapsed = st.priorElapsed + (Date.now() - st.startedAt) / 1000;
      const left = st.totalSeconds - elapsed;
      return { secondsLeft: Math.max(0, Math.round(left)), overtimeSeconds: left < 0 ? Math.round(-left) : 0 };
    } else if (st.status === 'paused') {
      const left = st.totalSeconds - st.priorElapsed;
      return { secondsLeft: Math.max(0, Math.round(left)), overtimeSeconds: left < 0 ? Math.round(-left) : 0 };
    } else if (st.status === 'done') {
      return { secondsLeft: 0, overtimeSeconds: Math.round(st.priorElapsed > st.totalSeconds ? st.priorElapsed - st.totalSeconds : 0) };
    }
    return { secondsLeft: st.totalSeconds, overtimeSeconds: 0 };
  }

  getRunning()  { return this.flatSteps.filter(s => s._state.status === 'running' || s._state.status === 'overtime'); }
  getPaused()   { return this.flatSteps.filter(s => s._state.status === 'paused'); }
  getOvertime() { return this.flatSteps.filter(s => s._state.status === 'overtime'); }
  allDone()     { return this.flatSteps.every(s => s._state.status === 'done'); }

  totalDurationSecs() {
    return this.flatSteps.reduce((sum, s) => sum + Math.round((parseFloat(s.minutes) || 1) * 60), 0);
  }

  totalElapsed() {
    let e = 0;
    this.flatSteps.forEach(s => {
      const c = this._calcStep(s._state);
      if (s._state.status !== 'idle') e += (s._state.totalSeconds - c.secondsLeft) + c.overtimeSeconds;
    });
    return e;
  }

  progress() {
    const t = this.totalDurationSecs();
    return t > 0 ? this.totalElapsed() / t : 0;
  }

  focusedStep() { return this.flatSteps[this.focusedIdx]; }
  focusedState() { return this.focusedStep()?._state; }
  focusedLabel() { const s = this.focusedStep(); return s ? (s.label || 'Step ' + (this.focusedIdx + 1)) : ''; }

  // Tick: check for status transitions (running → overtime). Returns indices that just went overtime.
  tick() {
    if (!this.playing) return [];
    const newOT = [];
    this.flatSteps.forEach((step, i) => {
      const st = step._state;
      if (st.status === 'running') {
        const { secondsLeft } = this._calcStep(st);
        if (secondsLeft <= 0) {
          st.status = 'overtime';
          newOT.push(i);
        }
      }
      // overtime just keeps accumulating via wall clock — no manual increment needed
    });
    return newOT;
  }

  _startStep(st) {
    st.status = 'running';
    st.startedAt = Date.now();
    // priorElapsed stays as-is (could be resuming from pause)
  }

  _pauseStep(st) {
    if (st.status === 'running' || st.status === 'overtime') {
      st.priorElapsed += (Date.now() - st.startedAt) / 1000;
      st.startedAt = null;
      st.status = 'paused';
    }
  }

  _completeStep(st) {
    if (st.startedAt) st.priorElapsed += (Date.now() - st.startedAt) / 1000;
    st.startedAt = null;
    st.status = 'done';
  }

  startFocused() {
    const st = this.focusedState();
    if (st && st.status === 'idle') { this._startStep(st); this.playing = true; }
  }

  pauseFocused() {
    const st = this.focusedState();
    if (!st) return;
    const { secondsLeft } = this._calcStep(st);
    if (st.status === 'overtime' || (st.status === 'paused' && secondsLeft <= 0)) {
      this._completeStep(st);
    } else if (st.status === 'running') {
      this._pauseStep(st);
    }
    if (this.getRunning().length === 0) this.playing = false;
  }

  masterPause() {
    this.flatSteps.forEach(s => {
      if (s._state.status === 'running' || s._state.status === 'overtime') this._pauseStep(s._state);
    });
    this.playing = false;
  }

  resumeOrStartNext() {
    this.playing = true;
    const paused = this.getPaused();
    if (paused.length > 0) {
      paused.forEach(s => {
        const { secondsLeft } = this._calcStep(s._state);
        s._state.status = secondsLeft > 0 ? 'running' : 'overtime';
        s._state.startedAt = Date.now();
      });
    } else {
      const fst = this.focusedState();
      if (fst && fst.status === 'idle') {
        this._startStep(fst);
      } else {
        const next = this.flatSteps.find(s => s._state.status === 'idle');
        if (next) { this._startStep(next._state); this.focusedIdx = this.flatSteps.indexOf(next); }
      }
    }
  }

  masterReset() {
    this.flatSteps.forEach(s => this._initStep(s));
    this.focusedIdx = 0;
    this.playing = false;
  }

  restartFocused() {
    const st = this.focusedState();
    if (!st) return;
    if (st.status === 'running' || st.status === 'overtime') {
      st.priorElapsed = 0; st.startedAt = Date.now(); st.status = 'running';
    } else if (st.status === 'paused') {
      st.priorElapsed = 0; st.startedAt = null;
    } else if (st.status === 'idle' || st.status === 'done') {
      st.priorElapsed = 0; st.startedAt = null;
      if (this.playing) { this._startStep(st); } else { st.status = 'idle'; }
    }
  }

  // Find next step: same-level sibling first, then bubble up, then any remaining idle
  findNext(fromIdx) {
    const cur = this.flatSteps[fromIdx];
    if (!cur) return -1;

    // 1. Try same-level sibling (same sourceChunkId + depth)
    const sibling = this._findSiblingAfter(fromIdx, cur.sourceChunkId, cur.depth);
    if (sibling !== -1) return sibling;

    // 2. Bubble up: walk to parent layer and find next sibling there
    let depth = cur.depth;
    let scanFrom = fromIdx;
    while (depth > 0) {
      // Find the step just past this nested chunk (where depth drops)
      let exitIdx = -1;
      for (let i = scanFrom + 1; i < this.flatSteps.length; i++) {
        if (this.flatSteps[i].depth < depth) { exitIdx = i; break; }
      }
      if (exitIdx === -1) { depth--; continue; }

      const parent = this.flatSteps[exitIdx];
      // Try finding a sibling at the parent's level
      const parentSibling = this._findSiblingAfter(exitIdx - 1, parent.sourceChunkId, parent.depth);
      if (parentSibling !== -1) return parentSibling;

      // Keep bubbling
      depth = parent.depth;
      scanFrom = exitIdx;
    }

    // 3. Top level: try next top-level step after current position
    for (let i = fromIdx + 1; i < this.flatSteps.length; i++) {
      if (this.flatSteps[i].depth === 0 && this.flatSteps[i]._state.status !== 'done') return i;
    }

    // 4. Fallback: find ANY remaining idle/paused step anywhere
    const anyRemaining = this.flatSteps.findIndex(s =>
      s._state.status === 'idle' || s._state.status === 'paused'
    );
    return anyRemaining !== -1 ? anyRemaining : -1;
  }

  _findSiblingAfter(fromIdx, sourceChunkId, depth) {
    for (let i = fromIdx + 1; i < this.flatSteps.length; i++) {
      const c = this.flatSteps[i];
      if (sourceChunkId === null && depth === 0) {
        if (c.depth === 0) return i;
      } else {
        if (c.sourceChunkId === sourceChunkId && c.depth === depth) return i;
        if (c.depth < depth) return -1; // exited the nested chunk
      }
    }
    return -1;
  }

  advanceFocused() {
    const st = this.focusedState();
    if (!st) return;
    this._completeStep(st);
    const nextIdx = this.findNext(this.focusedIdx);
    if (nextIdx !== -1) {
      this.focusedIdx = nextIdx;
      const nst = this.flatSteps[nextIdx]._state;
      if (this.playing && nst.status === 'idle') { this._startStep(nst); }
    }
  }
}

// ═══════════════════════════════════════════════════
// Engine Registry — multiple engines, single tick
// ═══════════════════════════════════════════════════

const engines = new Map();   // chunkId → ChunkEngine
let viewingId = null;        // which engine the player screen is showing
let globalTickInterval = null;

function viewingEngine() { return viewingId ? engines.get(viewingId) : null; }

function ensureGlobalTick() {
  if (globalTickInterval) return;
  globalTickInterval = setInterval(globalTick, 1000);
}

function stopGlobalTickIfIdle() {
  const anyPlaying = [...engines.values()].some(e => e.playing);
  if (!anyPlaying && globalTickInterval) {
    clearInterval(globalTickInterval);
    globalTickInterval = null;
    stopBgAudio();
    releaseWakeLock();
  }
}

function getOrCreateEngine(chunkId) {
  if (engines.has(chunkId)) return engines.get(chunkId);
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === chunkId);
  if (!chunk) return null;
  const flat = flattenChunk(chunk, chunks);
  if (flat.length === 0) return null;
  const eng = new ChunkEngine(chunk, flat);
  engines.set(chunkId, eng);
  return eng;
}

function getEffectiveAlarm(eng) {
  const s = loadAudioSettings();
  if (eng) {
    const step = eng.focusedStep();
    if (step?.sound && step.sound !== 'default') return step.sound;
    if (eng.chunk.audioAlarm && eng.chunk.audioAlarm !== 'default') return eng.chunk.audioAlarm;
  }
  return s.alarm || 'chime';
}

function getEffectiveBg(eng) {
  const s = loadAudioSettings();
  if (eng?.chunk.audioBg && eng.chunk.audioBg !== 'default') return eng.chunk.audioBg;
  return s.bg || 'none';
}

// ─── Global Tick ───

function globalTick() {
  let anyAlarm = false;
  engines.forEach((eng) => {
    const newOT = eng.tick();
    if (newOT.length > 0) {
      anyAlarm = true;
      // If this is the viewed engine, update UI
      if (eng.id === viewingId) {
        if (newOT.includes(eng.focusedIdx)) {
          document.getElementById('kachunkBtn')?.classList.add('ready-pulse');
        }
        const fst = eng.focusedState()?.status;
        if (fst === 'idle' || fst === 'done') {
          eng.focusedIdx = newOT[0];
        }
      }
    }
    if (eng.allDone() && eng.playing) {
      eng.playing = false;
      if (eng.id === viewingId) showCompletion(eng);
    }
  });

  if (anyAlarm) {
    const veng = viewingEngine();
    playAlarmSound(getEffectiveAlarm(veng));
    vibrateDevice();
  }

  // Update player screen if visible
  if (viewingId && getCurrentScreen() === 'playerScreen') {
    updateFocusedDisplay();
    renderPlayerSteps();
  }

  stopGlobalTickIfIdle();
}

// ═══════════════════════════════════════════════════
// Player Screen UI — renders whichever engine is viewed
// ═══════════════════════════════════════════════════

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

function switchPlayerView(eng) {
  viewingId = eng.id;
  renderChronoTicks();
  renderDotSidebar();
  renderPlayerSteps();
  updateFocusedDisplay();
  document.getElementById('playerTitle').textContent = eng.chunk.name;
  document.getElementById('breadcrumbBar').classList.remove('expanded');
  updateKachunkIcon();
  const s = loadAudioSettings();
  const voiceBtn = document.getElementById('voiceToggleBtn');
  if (voiceBtn) voiceBtn.style.opacity = s.voice ? '1' : '0.4';
  document.getElementById('chronoFace').className = 'chrono-face';
  document.getElementById('kachunkBtn').classList.remove('ready-pulse', 'snapping');
}

function updateFocusedDisplay() {
  const eng = viewingEngine();
  if (!eng) return;
  const step = eng.focusedStep();
  const st = step?._state;
  if (!st) return;

  const { secondsLeft, overtimeSeconds } = ChunkEngine.calc(st);
  const timerEl = document.getElementById('playerTimer');
  if (st.status === 'overtime') {
    const m = Math.floor(overtimeSeconds / 60), s = overtimeSeconds % 60;
    timerEl.textContent = '+' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.add('overtime');
  } else {
    const m = Math.floor(secondsLeft / 60), s = secondsLeft % 60;
    timerEl.textContent = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.remove('overtime');
  }

  document.getElementById('playerStepLabel').textContent = eng.focusedLabel();
  updatePauseIcon();

  const running = eng.getRunning().length, paused = eng.getPaused().length;
  const overtime = eng.getOvertime().length;
  const done = eng.flatSteps.filter(s => s._state.status === 'done').length;
  let t = `${done}/${eng.flatSteps.length} done`;
  if (running > 0) t += ` · ${running} active`;
  if (paused > 0) t += ` · ${paused} paused`;
  if (overtime > 0) t += ` · ${overtime} overtime`;
  document.getElementById('playerStepCount').textContent = t;

  updateChronoRings();
  updateBreadcrumb();
}

function updateChronoRings() {
  const eng = viewingEngine();
  if (!eng) return;
  const step = eng.focusedStep();
  const st = step?._state;
  const stepRing = document.getElementById('ringProgress');
  const overtimeRing = document.getElementById('ringOvertime');
  const face = document.getElementById('chronoFace');
  if (!stepRing || !st) return;

  const { secondsLeft: sl, overtimeSeconds: ot } = ChunkEngine.calc(st);

  if (st.status === 'overtime') {
    stepRing.style.strokeDashoffset = '0';
    overtimeRing.classList.add('active');
    const pct = Math.min(ot / 300, 1);
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC * (1 - pct);
    updateOvertimeTicks(pct);
    face.className = ot > 60 ? 'chrono-face alerting-escalated' : 'chrono-face alerting';
  } else if (st.status === 'done') {
    stepRing.style.strokeDashoffset = '0';
    overtimeRing.classList.remove('active');
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC;
    resetOvertimeTicks();
    face.className = 'chrono-face';
  } else if (st.status === 'paused') {
    const pct = st.totalSeconds > 0 ? (st.totalSeconds - sl) / st.totalSeconds : 0;
    stepRing.style.strokeDashoffset = STEP_CIRC * (1 - pct);
    if (sl <= 0 && ot > 0) {
      overtimeRing.classList.add('active');
      overtimeRing.style.strokeDashoffset = OVERTIME_CIRC * (1 - Math.min(ot / 300, 1));
    } else {
      overtimeRing.classList.remove('active');
      overtimeRing.style.strokeDashoffset = OVERTIME_CIRC;
    }
    resetOvertimeTicks();
    face.className = 'chrono-face paused';
  } else {
    const pct = st.totalSeconds > 0 ? (st.totalSeconds - sl) / st.totalSeconds : 0;
    stepRing.style.strokeDashoffset = STEP_CIRC * (1 - pct);
    overtimeRing.classList.remove('active');
    overtimeRing.style.strokeDashoffset = OVERTIME_CIRC;
    resetOvertimeTicks();
    face.className = 'chrono-face';
  }

  // Master ring
  const masterRing = document.getElementById('ringMaster');
  if (masterRing) {
    const masterPct = eng.totalDurationSecs() > 0 ? Math.min(eng.totalElapsed() / eng.totalDurationSecs(), 1) : 0;
    masterRing.style.strokeDashoffset = MASTER_CIRC * (1 - masterPct);
  }

  // Sub-chunk ring
  const subRing = document.getElementById('ringSubchunk');
  const subTrack = document.getElementById('ringSubchunkTrack');
  if (subRing && subTrack && step.depth > 0 && step.sourceChunkId) {
    subRing.style.opacity = '1'; subTrack.style.opacity = '1';
    const subSteps = eng.flatSteps.filter(s => s.sourceChunkId === step.sourceChunkId);
    const subDone = subSteps.filter(s => s._state.status === 'done').length;
    subRing.style.strokeDashoffset = SUBCHUNK_CIRC * (1 - (subSteps.length > 0 ? subDone / subSteps.length : 0));
  } else if (subRing && subTrack) {
    subRing.style.opacity = '0'; subTrack.style.opacity = '0';
  }

  updateDotSidebar();
}

function updateOvertimeTicks(pct) {
  const ticks = document.querySelectorAll('#chronoTicks .tick');
  const count = Math.floor(pct * 60);
  ticks.forEach((tick, i) => { tick.classList.toggle('overtime', i < count); });
}

function resetOvertimeTicks() {
  document.querySelectorAll('#chronoTicks .tick.overtime').forEach(t => t.classList.remove('overtime'));
}

// ─── Step List (no auto-scroll to chrono) ───

function renderPlayerSteps() {
  const eng = viewingEngine();
  if (!eng) return;
  const container = document.getElementById('playerStepsList');
  container.innerHTML = eng.flatSteps.map((s, i) => {
    const st = s._state;
    let cls = '';
    if (st.status === 'done') cls = 'completed';
    else if (st.status === 'running') cls = 'current';
    else if (st.status === 'overtime') cls = 'current overtime';
    else if (st.status === 'paused') cls = 'paused';
    if (i === eng.focusedIdx) cls += ' focused';

    const sourceHtml = s.sourceChunk
      ? `<div class="psi-source"><span class="link-icon">&#x27C1;</span> ${esc(s.sourceChunk)}</div>` : '';

    const { secondsLeft: sl, overtimeSeconds: ot } = ChunkEngine.calc(st);
    let timerHtml = '';
    if (st.status === 'running') {
      timerHtml = `<span class="psi-timer">${Math.floor(sl / 60)}:${(sl % 60).toString().padStart(2, '0')}</span>`;
    } else if (st.status === 'overtime') {
      timerHtml = `<span class="psi-timer overtime">+${Math.floor(ot / 60)}:${(ot % 60).toString().padStart(2, '0')}</span>`;
    } else if (st.status === 'paused') {
      if (sl > 0) {
        timerHtml = `<span class="psi-timer paused">${Math.floor(sl / 60)}:${(sl % 60).toString().padStart(2, '0')}</span>`;
      } else {
        timerHtml = `<span class="psi-timer paused overtime">+${Math.floor(ot / 60)}:${(ot % 60).toString().padStart(2, '0')}</span>`;
      }
    }

    const icon = st.status === 'done' ? '&#x2713;'
      : (st.status === 'running' || st.status === 'overtime') ? '&#x25CF;'
      : st.status === 'paused' ? '&#x25CB;' : (i + 1);

    return `<div class="player-step-item ${cls}" onclick="window._kachunk.onStepTap(${i})">
        <div class="psi-num">${icon}</div>
        <div class="psi-label-wrap">${sourceHtml}<div class="psi-label">${esc(s.label || 'Step ' + (i + 1))}</div></div>
        ${timerHtml}<div class="psi-dur">${s.minutes}m</div>
      </div>`;
  }).join('');
}

// ─── Dot Sidebar ───

function renderDotSidebar() {
  const eng = viewingEngine();
  const track = document.getElementById('dotSidebarTrack');
  if (!track || !eng) return;
  track.innerHTML = eng.flatSteps.map((step, i) => {
    const dc = step.depth > 0 ? ` depth-${Math.min(step.depth, 3)}` : '';
    return `<div class="dot-step${dc}" data-dot-idx="${i}" onclick="window._kachunk.focusStep(${i})">
      <div class="dot-timer"><svg viewBox="0 0 10 10"><circle class="dot-timer-fill" cx="5" cy="5" r="3" stroke-dasharray="${2 * Math.PI * 3}" stroke-dashoffset="${2 * Math.PI * 3}" transform="rotate(-90 5 5)"/></svg></div>
    </div>`;
  }).join('');
}

function updateDotSidebar() {
  const eng = viewingEngine();
  if (!eng) return;
  const dots = document.querySelectorAll('.dot-step');
  const circ = 2 * Math.PI * 3;
  dots.forEach((dot, i) => {
    const st = eng.flatSteps[i]?._state;
    if (!st) return;
    dot.classList.remove('completed', 'current', 'overtime', 'paused');
    const fill = dot.querySelector('.dot-timer-fill');
    const { secondsLeft: sl } = ChunkEngine.calc(st);
    if (st.status === 'done') {
      dot.classList.add('completed'); if (fill) fill.style.strokeDashoffset = '0';
    } else if (st.status === 'running') {
      dot.classList.add('current');
      const pct = st.totalSeconds > 0 ? (st.totalSeconds - sl) / st.totalSeconds : 0;
      if (fill) fill.style.strokeDashoffset = circ * (1 - pct);
    } else if (st.status === 'overtime') {
      dot.classList.add('current', 'overtime'); if (fill) fill.style.strokeDashoffset = '0';
    } else if (st.status === 'paused') {
      dot.classList.add('paused');
      const pct = st.totalSeconds > 0 ? (st.totalSeconds - sl) / st.totalSeconds : 0;
      if (fill) fill.style.strokeDashoffset = circ * (1 - pct);
    } else {
      if (fill) fill.style.strokeDashoffset = `${circ}`;
    }
  });
  // Don't auto-scroll — respect user's scroll position
}

// ─── Breadcrumb ───

function updateBreadcrumb() {
  const eng = viewingEngine();
  if (!eng) return;
  const step = eng.focusedStep();
  const currentEl = document.getElementById('breadcrumbCurrent');
  const expandedEl = document.getElementById('breadcrumbExpanded');
  if (!step || !eng.chunk) return;

  const crumbs = [{ name: eng.chunk.name, depth: 0 }];
  if (step.sourceChunk) crumbs.push({ name: step.sourceChunk, depth: step.depth });
  currentEl.textContent = crumbs.length <= 1 ? crumbs[0].name : crumbs.map(c => c.name).join(' > ');
  expandedEl.innerHTML = crumbs.map((c, i) => {
    const isActive = i === crumbs.length - 1;
    return `<button class="breadcrumb-item ${isActive ? 'bc-active' : ''}" onclick="window._kachunk.closeBreadcrumb()">
      <span class="bc-depth">${i}</span><span class="bc-name">${esc(c.name)}</span></button>`;
  }).join('');
}

export function toggleBreadcrumb() { document.getElementById('breadcrumbBar').classList.toggle('expanded'); }
export function closeBreadcrumb() { document.getElementById('breadcrumbBar').classList.remove('expanded'); }
export function scrollToStep(idx) {
  const items = document.querySelectorAll('.player-step-item');
  if (items[idx]) items[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ─── Control Button Icons ───

function updatePauseIcon() {
  const btn = document.getElementById('pauseBtn');
  if (!btn) return;
  const eng = viewingEngine();
  const st = eng?.focusedState();
  const { secondsLeft: psl } = st ? ChunkEngine.calc(st) : { secondsLeft: 1 };
  if (st && (st.status === 'overtime' || (st.status === 'paused' && psl <= 0))) {
    btn.innerHTML = `<svg viewBox="0 0 44 44">
      <circle fill="none" stroke="currentColor" stroke-width="2" cx="22" cy="22" r="18" opacity="0.4"/>
      <circle fill="none" stroke="var(--accent)" stroke-width="2.5" cx="22" cy="22" r="18"
        stroke-dasharray="113.1" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 22 22)"/>
      <circle fill="var(--accent)" cx="22" cy="22" r="3"/>
    </svg>`;
    btn.classList.add('complete-mode');
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    btn.classList.remove('complete-mode');
  }
}

function updateKachunkIcon() {
  const icon = document.getElementById('kachunkIcon');
  if (!icon) return;
  const eng = viewingEngine();
  const st = eng?.focusedState();
  if (st && st.status === 'paused') {
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  } else if (!eng?.playing) {
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  } else {
    icon.innerHTML = '<path d="M5 18l7-6-7-6zM11 18l7-6-7-6z"/><path d="M18 6h2v12h-2z"/>';
  }
  updatePauseIcon();
}

// ═══════════════════════════════════════════════════
// Public API — called from app.js / home.js
// ═══════════════════════════════════════════════════

// ─── Open player screen for a chunk ───

export function startPlayer(id) {
  const eng = getOrCreateEngine(id);
  if (!eng) return;
  switchPlayerView(eng);
  showScreen('playerScreen');
}

export function openPlayerView(id) { startPlayer(id); }

// ─── Drawer-level controls (no screen transition) ───

export function startChunkFromDrawer(id) {
  const eng = getOrCreateEngine(id);
  if (!eng) return;
  if (eng.playing) return; // already running
  eng.startFocused();
  announceStep(eng.focusedLabel());
  startBgAudio(getEffectiveBg(eng));
  requestWakeLock();
  ensureGlobalTick();
}

export function pauseChunkFromDrawer(id) {
  const eng = engines.get(id);
  if (eng && eng.playing) {
    eng.masterPause();
    stopGlobalTickIfIdle();
  }
}

export function resumeChunkFromDrawer(id) {
  const eng = engines.get(id);
  if (eng && !eng.playing) {
    eng.resumeOrStartNext();
    startBgAudio(getEffectiveBg(eng));
    requestWakeLock();
    ensureGlobalTick();
  }
}

export function getFocusedStepLabel(id) {
  if (id) { const eng = engines.get(id); return eng ? eng.focusedLabel() : ''; }
  const eng = viewingEngine();
  return eng ? eng.focusedLabel() : '';
}

// ─── Player controls (operate on viewed engine) ───

export function kachunkAction() {
  const eng = viewingEngine();
  if (!eng) return;
  const st = eng.focusedState();

  if (st && st.status === 'paused') {
    const { secondsLeft: ksl } = ChunkEngine.calc(st);
    st.status = ksl > 0 ? 'running' : 'overtime';
    st.startedAt = Date.now();
    eng.playing = true;
    playUiSound('clickPlay'); vibrateDevice([10, 20, 40]);
    startBgAudio(getEffectiveBg(eng)); requestWakeLock();
    ensureGlobalTick();
  } else if (!eng.playing) {
    eng.resumeOrStartNext();
    playUiSound('clickPlay');
    startBgAudio(getEffectiveBg(eng)); requestWakeLock();
    ensureGlobalTick();
  } else {
    // Active → advance
    const kb = document.getElementById('kachunkBtn');
    playUiSound('kachunk'); vibrateDevice([15, 30, 80]);
    kb.classList.remove('ready-pulse', 'snapping');
    void kb.offsetWidth;
    kb.classList.add('snapping');
    setTimeout(() => kb.classList.remove('snapping'), 400);
    eng.advanceFocused();
    if (eng.allDone()) { eng.playing = false; showCompletion(eng); }
    ensureGlobalTick();
  }
  updateFocusedDisplay(); renderPlayerSteps(); updateKachunkIcon();
}

export function smartPause() {
  const eng = viewingEngine();
  if (!eng) return;
  const st = eng.focusedState();

  const { secondsLeft: spsl } = st ? ChunkEngine.calc(st) : { secondsLeft: 1 };
  if (st && (st.status === 'overtime' || (st.status === 'paused' && spsl <= 0))) {
    eng.pauseFocused();
    playUiSound('clickPause'); vibrateDevice([15, 30]);
    document.getElementById('chronoFace').className = 'chrono-face';
    document.getElementById('kachunkBtn').classList.remove('ready-pulse');
    if (eng.allDone()) showCompletion(eng);
  } else if (st && st.status === 'running') {
    eng.pauseFocused();
    playUiSound('clickPause'); vibrateDevice([10]);
  } else if (eng.playing) {
    eng.masterPause();
    playUiSound('clickPause');
  }
  stopGlobalTickIfIdle();
  updateFocusedDisplay(); renderPlayerSteps(); updateKachunkIcon();
}

export function togglePlay() {
  const eng = viewingEngine();
  if (!eng) return;
  if (eng.playing) smartPause(); else kachunkAction();
}

let restartTimer = null, restartTriggered = false;

export function restartDown() {
  restartTriggered = false;
  restartTimer = setTimeout(() => {
    restartTriggered = true;
    const eng = viewingEngine();
    if (!eng) return;
    vibrateDevice([50, 30, 50]);
    eng.masterReset();
    stopGlobalTickIfIdle();
    showToast('All reset');
    updateFocusedDisplay(); renderPlayerSteps(); updateKachunkIcon();
  }, 600);
}

export function restartUp() {
  clearTimeout(restartTimer);
  if (restartTriggered) return;
  const eng = viewingEngine();
  if (!eng) return;
  eng.restartFocused();
  playUiSound('whoosh'); vibrateDevice([10]);
  if (eng.playing) ensureGlobalTick();
  document.getElementById('chronoFace').className = 'chrono-face';
  document.getElementById('kachunkBtn').classList.remove('ready-pulse');
  updateFocusedDisplay(); renderPlayerSteps(); updateKachunkIcon();
}

export function restartCancel() { clearTimeout(restartTimer); restartTriggered = false; }

export function onStepTap(idx) {
  const eng = viewingEngine();
  if (!eng) return;
  const st = eng.flatSteps[idx]?._state;
  if (!st) return;
  eng.focusedIdx = idx;
  if (st.status === 'idle' && eng.playing) {
    st.status = 'running';
    playUiSound('clickPlay'); vibrateDevice([10, 20, 40]);
    announceStep(eng.flatSteps[idx].label);
    ensureGlobalTick();
  }
  updateFocusedDisplay(); renderPlayerSteps(); updateKachunkIcon();
}

export function focusStep(idx) {
  const eng = viewingEngine();
  if (!eng || idx < 0 || idx >= eng.flatSteps.length) return;
  eng.focusedIdx = idx;
  updateFocusedDisplay(); renderPlayerSteps();
}

export function playerNext() { kachunkAction(); }
export function playerPrev() {
  const eng = viewingEngine();
  if (!eng || eng.focusedIdx <= 0) return;
  eng.focusedIdx--;
  playUiSound('whoosh');
  updateFocusedDisplay(); renderPlayerSteps();
}
export function jumpToStep(idx) { onStepTap(idx); }

// ─── Navigate ───

export function goBackToDrawer() { goHome(); renderHome(); }

export function stopAndGoHome() {
  const eng = viewingEngine();
  if (eng) {
    eng.masterReset();
    engines.delete(eng.id);
  }
  viewingId = null;
  stopGlobalTickIfIdle();
  goHome(); renderHome();
}

// ─── Completion ───

function showCompletion(eng) {
  stopBgAudio();
  const totalMin = eng.flatSteps.reduce((s, st) => s + (parseFloat(st.minutes) || 0), 0);
  document.getElementById('completionSub').textContent =
    `${eng.chunk.name} — ${formatDuration(totalMin)} completed`;
  document.getElementById('completionOverlay').classList.add('show');
  playCompletionFanfare(); announceCompletion(eng.chunk.name);
  spawnParticles(); vibrateDevice([100, 50, 100, 50, 200]);
}

export function closeCompletion() {
  document.getElementById('completionOverlay').classList.remove('show');
  const eng = viewingEngine();
  if (eng) { engines.delete(eng.id); }
  viewingId = null;
  goHome(); renderHome();
}

// ─── Voice / BG Audio ───

export function toggleVoiceInPlayer() {
  const s = loadAudioSettings();
  s.voice = !s.voice; saveAudioSettings(s);
  const btn = document.getElementById('voiceToggleBtn');
  btn.style.opacity = s.voice ? '1' : '0.4';
  showToast(s.voice ? 'Voice on' : 'Voice off');
}

export function toggleBgAudioPicker() {
  const panel = document.getElementById('playerBgPicker');
  const overlay = document.getElementById('bgPickerOverlay');
  if (panel.classList.contains('show')) { closeBgAudioPicker(); }
  else { overlay.classList.add('show'); panel.classList.add('show'); renderPlayerBgPicker(); }
}

export function closeBgAudioPicker() {
  document.getElementById('bgPickerOverlay').classList.remove('show');
  document.getElementById('playerBgPicker').classList.remove('show');
}

function renderPlayerBgPicker() {
  const eng = viewingEngine();
  const currentBg = getEffectiveBg(eng);
  document.getElementById('playerBgPickerPills').innerHTML =
    Object.entries(BG_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${currentBg === key ? 'selected' : ''}" onclick="window._kachunk.selectPlayerBg('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');
}

export function selectPlayerBg(key) {
  const s = loadAudioSettings(); s.bg = key; saveAudioSettings(s);
  closeBgAudioPicker();
  const eng = viewingEngine();
  if (eng?.playing) { stopBgAudio(); if (key !== 'none') startBgAudio(key); }
}

// ─── Drawer query API ───

// ─── Visibility change: recalc immediately when tab returns ───
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engines.size > 0) {
    // Check for any missed overtime transitions
    engines.forEach(eng => {
      eng.flatSteps.forEach((step, i) => {
        const st = step._state;
        if (st.status === 'running') {
          const { secondsLeft } = ChunkEngine.calc(st);
          if (secondsLeft <= 0) {
            st.status = 'overtime';
            playAlarmSound(getEffectiveAlarm(eng));
            vibrateDevice();
          }
        }
      });
    });
    if (viewingId && getCurrentScreen() === 'playerScreen') {
      updateFocusedDisplay();
      renderPlayerSteps();
      updateKachunkIcon();
    }
  }
});

export function getPlayerChunkId() { return viewingId; }
export function isPlayerRunning() { return viewingEngine()?.playing || false; }
export function getPlayerProgress(id) {
  const eng = id ? engines.get(id) : viewingEngine();
  return eng ? eng.progress() : 0;
}
export function isEngineActive(id) { return engines.has(id); }
export function isEnginePlaying(id) { return engines.get(id)?.playing || false; }
