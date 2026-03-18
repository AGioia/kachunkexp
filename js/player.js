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

// Loop group colors (max 5 groups)
const LOOP_COLORS = ['#C44B1A', '#2A9D8F', '#D4A03C', '#8B3A3A', '#5B7BA5'];

class ChunkEngine {
  constructor(chunk, flatSteps) {
    this.chunk = chunk;
    this.id = chunk.id;
    this.flatSteps = flatSteps;
    this.focusedIdx = 0;
    this.playing = false;
    // Loop system
    this.loopGroups = [];      // [{ steps: [idx, idx, ...], mode: 'halt'|'auto', laps: 0 }]
    this.loopSelectMode = false;
    this.loopSelectGroupIdx = 0;
    this.viewPath = []; // which group is being edited/viewed
    flatSteps.forEach(s => this._initStep(s));
  }

  _initStep(step) {
    const total = Math.round((parseFloat(step.minutes) || 1) * 60);
    step._state = {
      status: 'idle',
      totalSeconds: total,
      // Wall-clock based timing:
      startedAt: null,
      priorElapsed: 0,
    };
  }

  // Compute live secondsLeft / overtimeSeconds from wall clock
  _calcStep(st) {
    if (st.status === 'running' || st.status === 'overtime') {
      const elapsed = st.priorElapsed + (st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0);
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
      const elapsed = st.priorElapsed + (st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0);
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

  getRunning()  { return this.flatSteps.filter(s => !s.isWrapper && (s._state.status === 'running' || s._state.status === 'overtime')); }
  getPaused()   { return this.flatSteps.filter(s => !s.isWrapper && s._state.status === 'paused'); }
  getOvertime() { return this.flatSteps.filter(s => !s.isWrapper && s._state.status === 'overtime'); }
  allDone()     { return this.flatSteps.filter(s => !s.isWrapper).every(s => s._state.status === 'done'); }

  totalDurationSecs() {
    return this.flatSteps.filter(s => !s.isWrapper).reduce((sum, s) => sum + Math.round((parseFloat(s.minutes) || 1) * 60), 0);
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

  // ─── Loop Group Methods ───

  getStepLoopGroup(stepIdx) {
    return this.loopGroups.findIndex(g => g.steps.includes(stepIdx));
  }

  getStepLoopSeq(stepIdx) {
    const gi = this.getStepLoopGroup(stepIdx);
    if (gi === -1) return -1;
    return this.loopGroups[gi].steps.indexOf(stepIdx);
  }

  toggleStepInGroup(stepIdx, groupIdx) {
    if (groupIdx < 0 || groupIdx >= this.loopGroups.length) return;
    const group = this.loopGroups[groupIdx];
    const pos = group.steps.indexOf(stepIdx);
    if (pos !== -1) {
      // Remove from this group
      group.steps.splice(pos, 1);
    } else {
      // Remove from any other group first
      this.loopGroups.forEach((g, i) => {
        if (i !== groupIdx) {
          const p = g.steps.indexOf(stepIdx);
          if (p !== -1) g.steps.splice(p, 1);
        }
      });
      group.steps.push(stepIdx);
    }
  }

  toggleStepMode(stepIdx) {
    const gi = this.getStepLoopGroup(stepIdx);
    if (gi === -1) return;
    const group = this.loopGroups[gi];
    // Per-step override stored on _state
    const st = this.flatSteps[stepIdx]._state;
    st.loopMode = st.loopMode === 'auto' ? 'halt' : 'auto';
  }

  getStepLoopMode(stepIdx) {
    const gi = this.getStepLoopGroup(stepIdx);
    if (gi === -1) return null;
    const st = this.flatSteps[stepIdx]._state;
    return st.loopMode || this.loopGroups[gi].mode;
  }

  // Get next step in the loop group sequence (wraps around)
  getNextInLoop(stepIdx) {
    const gi = this.getStepLoopGroup(stepIdx);
    if (gi === -1) return -1;
    const group = this.loopGroups[gi];
    const seq = group.steps.indexOf(stepIdx);
    if (seq === -1) return -1;
    const nextSeq = (seq + 1) % group.steps.length;
    if (nextSeq === 0) group.laps++; // completed a full cycle
    return group.steps[nextSeq];
  }

  getLoopLaps(stepIdx) {
    const gi = this.getStepLoopGroup(stepIdx);
    if (gi === -1) return 0;
    return this.loopGroups[gi].laps;
  }

  clearAllLoopGroups() {
    this.loopGroups = [];
    this.flatSteps.forEach(s => { delete s._state.loopMode; });
  }

  ensureGroupExists(groupIdx) {
    while (this.loopGroups.length <= groupIdx) {
      this.loopGroups.push({ steps: [], mode: 'halt', laps: 0 });
    }
  }

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

    // Check if step is in a loop group
    const loopNext = this.getNextInLoop(this.focusedIdx);
    if (loopNext !== -1) {
      // In a loop: reset current step for next lap, advance to next in loop
      this._initStep(this.flatSteps[this.focusedIdx]); // reset for reuse
      this.focusedIdx = loopNext;
      const nst = this.flatSteps[loopNext]._state;
      if (nst.status === 'done' || nst.status === 'idle') {
        this._initStep(this.flatSteps[loopNext]); // reset for reuse
        if (this.playing) this._startStep(this.flatSteps[loopNext]._state);
      }
      return;
    }

    // Not in a loop: normal progression
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

export const engines = new Map();   // chunkId → ChunkEngine
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
      // Check for auto-pass-through loops
      newOT.forEach(i => {
        const mode = eng.getStepLoopMode(i);
        if (mode === 'auto') {
          // Auto-advance this step in its loop
          const loopNext = eng.getNextInLoop(i);
          if (loopNext !== -1) {
            eng._initStep(eng.flatSteps[i]);
            const nst = eng.flatSteps[loopNext]._state;
            if (nst.status === 'done' || nst.status === 'idle') eng._initStep(eng.flatSteps[loopNext]);
            eng._startStep(eng.flatSteps[loopNext]._state);
            if (i === eng.focusedIdx) eng.focusedIdx = loopNext;
            return; // don't alarm for auto-loops
          }
        }
      });

      // Filter out auto-looped steps for alarm
      const alarmSteps = newOT.filter(i => eng.getStepLoopMode(i) !== 'auto');
      if (alarmSteps.length > 0) anyAlarm = true;

      if (eng.id === viewingId) {
        if (newOT.includes(eng.focusedIdx)) {
          DOM.kachunkBtn?.classList.add('ready-pulse');
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


// ─── DOM Cache ───
const DOM = {};
function initPlayerDOM() {
  if (DOM.playerTimer) return;
  const ids = [
    'playerTimer', 'playerStepLabel', 'playerStepCount', 'ringProgress', 
    'ringOvertime', 'chronoFace', 'ringMaster', 'ringSubchunk', 'ringSubchunkTrack',
    'kachunkBtn', 'kachunkIcon', 'playerTitle', 'breadcrumbBar', 'voiceToggleBtn',
    'chronoTicks', 'playerStepsList', 'dotSidebarTrack', 'breadcrumbCurrent', 
    'breadcrumbExpanded', 'pauseBtn', 'chronoSvg', 'loopBtn', 'completionSub',
    'completionOverlay', 'playerBgPicker', 'bgPickerOverlay', 'playerBgPickerPills'
  ];
  for (const id of ids) {
    DOM[id] = document.getElementById(id);
  }
}

document.addEventListener('DOMContentLoaded', initPlayerDOM);

// ═══════════════════════════════════════════════════
// Player Screen UI — renders whichever engine is viewed
// ═══════════════════════════════════════════════════

function renderChronoTicks() {
  const g = DOM.chronoTicks || document.getElementById('chronoTicks');
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
  
  renderPlayerSteps();
  updateFocusedDisplay();
  initPlayerDOM();
  initPullToPop();
  
  const ptEl = document.getElementById('playerParentTitle');
  if (eng.viewPath.length === 0) {
    DOM.playerTitle.textContent = eng.chunk.name;
    if (ptEl) ptEl.style.display = 'none';
  } else {
    // Find the wrapper step for our current path
    const wrapper = eng.flatSteps.find(s => s.isWrapper && s.path.join('-') === eng.viewPath.join('-'));
    DOM.playerTitle.textContent = wrapper ? wrapper.name : eng.chunk.name;
    if (ptEl) {
      ptEl.style.display = 'block';
      let parentName = eng.chunk.name;
      if (eng.viewPath.length > 1) {
        const pPath = eng.viewPath.slice(0, -1);
        const pWrap = eng.flatSteps.find(s => s.isWrapper && s.path.join('-') === pPath.join('-'));
        if (pWrap) parentName = pWrap.name;
      }
      ptEl.textContent = '⤺ ' + parentName;
    }
  }

  
  updateKachunkIcon();
  const s = loadAudioSettings();
  const voiceBtn = DOM.voiceToggleBtn;
  if (voiceBtn) voiceBtn.style.opacity = s.voice ? '1' : '0.4';
  DOM.chronoFace.className = 'chrono-face';
  DOM.kachunkBtn.classList.remove('ready-pulse', 'snapping');
  updateLoopUI();
}

function updateFocusedDisplay() {
  const eng = viewingEngine();
  if (!eng) return;
  const step = eng.focusedStep();
  const st = step?._state;
  if (!st) return;

  const { secondsLeft, overtimeSeconds } = ChunkEngine.calc(st);
  const timerEl = DOM.playerTimer || document.getElementById('playerTimer');
  if (st.status === 'overtime') {
    const m = Math.floor(overtimeSeconds / 60), s = overtimeSeconds % 60;
    timerEl.textContent = '+' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.add('overtime');
  } else {
    const m = Math.floor(secondsLeft / 60), s = secondsLeft % 60;
    timerEl.textContent = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    timerEl.classList.remove('overtime');
  }

  DOM.playerStepLabel.textContent = eng.focusedLabel();
  updatePauseIcon();

  const running = eng.getRunning().length, paused = eng.getPaused().length;
  const overtime = eng.getOvertime().length;
  const realSteps = eng.flatSteps.filter(s => !s.isWrapper);
  const done = realSteps.filter(s => s._state.status === 'done').length;
  let t = `${done}/${realSteps.length} done`;
  if (running > 0) t += ` · ${running} active`;
  if (paused > 0) t += ` · ${paused} paused`;
  if (overtime > 0) t += ` · ${overtime} overtime`;
  DOM.playerStepCount.textContent = t;

  updateChronoRings();
  
}

function updateChronoRings() {
  const eng = viewingEngine();
  if (!eng) return;
  const step = eng.focusedStep();
  const st = step?._state;
  const stepRing = DOM.ringProgress || document.getElementById('ringProgress');
  const overtimeRing = DOM.ringOvertime || document.getElementById('ringOvertime');
  const face = DOM.chronoFace || document.getElementById('chronoFace');
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
  const masterRing = DOM.ringMaster;
  if (masterRing) {
    const masterPct = eng.totalDurationSecs() > 0 ? Math.min(eng.totalElapsed() / eng.totalDurationSecs(), 1) : 0;
    masterRing.style.strokeDashoffset = MASTER_CIRC * (1 - masterPct);
  }

  // Sub-chunk ring
  const subRing = DOM.ringSubchunk;
  const subTrack = DOM.ringSubchunkTrack;
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

function updateDotSidebar() {
  const eng = viewingEngine();
  const track = DOM.dotSidebarTrack || document.getElementById('dotSidebarTrack');
  if (!eng || !track) return;

  const depth = Math.max(1, (eng.viewPath?.length || 0) + 1);
  let html = '';
  for (let i = 0; i < depth; i++) {
    const active = i === depth - 1 ? ' active' : '';
    html += `<div class="dot-step${active}"><div class="dot-timer"><svg viewBox="0 0 10 10"><circle class="dot-timer-fill" cx="5" cy="5" r="3" /></svg></div></div>`;
  }
  track.innerHTML = html;
}

// ─── Step List (no auto-scroll to chrono) ───


function renderPlayerSteps() {
  const eng = viewingEngine();
  if (!eng) return;
  const container = DOM.playerStepsList;
  
  // Filter steps to ONLY show those at the current viewPath
  // A step belongs here if its path length string matches current viewPath EXACTLY
  // For 'wrappers' (chunks), their path is their OWN path, and their children are deeper.
  const viewPathStr = eng.viewPath.join('-');
  
  const visibleSteps = eng.flatSteps.map((s, idx) => ({...s, originalIndex: idx}))
    .filter(s => {
      const parentPathStr = s.path.slice(0, -1).join('-');
      if (s.isWrapper) {
        return parentPathStr === viewPathStr;
      }
      // Normal steps are visible when they are direct children of the current view level
      return parentPathStr === viewPathStr;
    })
    .filter((s, idx, arr) => {
      // Hide normal steps that belong inside a wrapper shown at this same level.
      if (s.isWrapper) return true;
      const wrappedHere = arr.find(w => w.isWrapper && s.path.slice(0, w.path.length).join('-') === w.path.join('-'));
      return !wrappedHere;
    });

  container.innerHTML = visibleSteps.map((s) => {
    const rawIdx = s.originalIndex;
    if (s.isWrapper) {
      // Look at children to compute aggregate status
      const kids = eng.flatSteps.filter(k => !k.isWrapper && k.path.slice(0, s.path.length).join('-') === s.path.join('-'));
      const activeKids = kids.filter(k => k._state.status === 'running' || k._state.status === 'overtime').length;
      const doneKids = kids.filter(k => k._state.status === 'done').length;
      const isDone = kids.length > 0 && doneKids === kids.length;
      
      let cls = 'player-step wrapper-step';
      if (isDone) cls += ' completed';
      else if (activeKids > 0) cls += ' current';
      
      const inView = eng.focusedIdx >= s.originalIndex && eng.focusedIdx < s.originalIndex + s.subCount + 1;
      if (inView) cls += ' focused';
      
      const icon = isDone ? '&#x2713;' : (activeKids > 0 ? '&#x25CF;' : '&#x27C1;');
      
      let timerHtml = '';
      if (activeKids > 0) {
         timerHtml = `<span class="psi-timer">${activeKids} active</span>`;
      } else if (isDone) {
         timerHtml = `<span class="psi-timer">${s.subCount} done</span>`;
      } else {
         timerHtml = `<span class="psi-timer">${s.subCount} steps</span>`;
      }

      return `
        <div class="${cls}" data-path="${s.path.join('-')}" 
             ontouchstart="window._kachunk.wrapperDown('${s.path.join('-')}')"
             ontouchend="window._kachunk.wrapperUp('${s.path.join('-')}')"
             onmousedown="window._kachunk.wrapperDown('${s.path.join('-')}')"
             onmouseup="window._kachunk.wrapperUp('${s.path.join('-')}')"
             onclick="return false">
          <div class="psi-icon" style="font-size:16px;">${icon}</div>
          <div class="psi-content">
            <div class="psi-label">${esc(s.name)}</div>
          </div>
          ${timerHtml}
        </div>
      `;
    }

    // NORMAL STEP RENDERING
    const st = s._state;
    let cls = '';
    if (st.status === 'done') cls = 'completed';
    else if (st.status === 'running') cls = 'current';
    else if (st.status === 'overtime') cls = 'current overtime';
    else if (st.status === 'paused') cls = 'paused';
    if (rawIdx === eng.focusedIdx) cls += ' focused';

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
      : st.status === 'paused' ? '&#x25CB;' : '&#x25CB;'; // dot instead of numbers inside nest

    const gi = eng.getStepLoopGroup(rawIdx);
    const loopColor = gi !== -1 ? LOOP_COLORS[gi % LOOP_COLORS.length] : '';
    const loopSeq = gi !== -1 ? eng.getStepLoopSeq(rawIdx) + 1 : 0;
    const inSelectGroup = eng.loopSelectMode && gi === eng.loopSelectGroupIdx;
    const barWidth = eng.loopSelectMode && gi !== -1 ? (inSelectGroup ? '5px' : '3px') : (gi !== -1 ? '2px' : '0');
    const loopBarHtml = gi !== -1
      ? `<div class="psi-loop-bar${inSelectGroup ? ' selecting' : ''}" style="background:${loopColor};width:${barWidth}"><span class="psi-loop-seq">${loopSeq}</span></div>`
      : (eng.loopSelectMode ? '<div class="psi-loop-bar empty"></div>' : '<div class="psi-loop-bar empty"></div>');

    const tapHandler = eng.loopSelectMode
      ? `window._kachunk.loopStepTap(${rawIdx})`
      : `window._kachunk.onStepTap(${rawIdx})`;

    return `
      <div class="player-step-item ${cls}" onclick="${tapHandler}">
        ${loopBarHtml}
        <div class="psi-num">${icon}</div>
        <div class="psi-label-wrap"><div class="psi-label">${esc(s.label || 'Step')}</div></div>
        ${timerHtml}<div class="psi-dur">${s.minutes}m</div>
      </div>
    `;
  }).join('');
}

function updatePauseIcon() {
  const btn = DOM.pauseBtn || document.getElementById('pauseBtn');
  if (!btn) return;
  const eng = viewingEngine();
  const st = eng?.focusedStep()?._state;
  if (st && st.status === 'done') {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7" opacity="0.2"/><circle cx="12" cy="12" r="2.2"/></svg>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  }
}

function updateKachunkIcon() {
  const icon = DOM.kachunkIcon;
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
    const kb = DOM.kachunkBtn;
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
    DOM.chronoFace.className = 'chrono-face';
    DOM.kachunkBtn.classList.remove('ready-pulse');
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
  DOM.chronoFace.className = 'chrono-face';
  DOM.kachunkBtn.classList.remove('ready-pulse');
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
    eng._startStep(st);
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

// ─── Loop Select Mode ───

let loopLongPressTimer = null;
let loopLongPressTriggered = false;

export function loopBtnDown() {
  loopLongPressTriggered = false;
  loopLongPressTimer = setTimeout(() => {
    loopLongPressTriggered = true;
    const eng = viewingEngine();
    if (!eng) return;
    eng.clearAllLoopGroups();
    eng.loopSelectMode = false;
    vibrateDevice([50, 30, 50]);
    showToast('All loops cleared');
    renderPlayerSteps(); updateLoopUI();
  }, 600);
}

export function loopBtnUp() {
  clearTimeout(loopLongPressTimer);
  if (loopLongPressTriggered) return;

  const eng = viewingEngine();
  if (!eng) return;

  if (!eng.loopSelectMode) {
    // Enter loop select mode, start at group 0
    eng.loopSelectMode = true;
    eng.loopSelectGroupIdx = 0;
    eng.ensureGroupExists(0);
    playUiSound('clickPlay');
  } else {
    // Cycle through groups
    const nextIdx = eng.loopSelectGroupIdx + 1;
    // If current group is empty and we're past all real groups → exit
    const currentGroup = eng.loopGroups[eng.loopSelectGroupIdx];
    if (currentGroup && currentGroup.steps.length === 0) {
      // On empty slot — one more tap exits
      eng.loopSelectMode = false;
      // Clean up empty groups
      eng.loopGroups = eng.loopGroups.filter(g => g.steps.length > 0);
      playUiSound('clickPause');
    } else if (nextIdx <= eng.loopGroups.length) {
      // Move to next group (or empty slot)
      eng.loopSelectGroupIdx = nextIdx;
      eng.ensureGroupExists(nextIdx);
      playUiSound('whoosh');
    }
  }
  renderPlayerSteps(); updateLoopUI();
}

export function loopBtnCancel() {
  clearTimeout(loopLongPressTimer);
  loopLongPressTriggered = false;
}

export function loopStepTap(stepIdx) {
  const eng = viewingEngine();
  if (!eng || !eng.loopSelectMode) return;
  eng.toggleStepInGroup(stepIdx, eng.loopSelectGroupIdx);
  playUiSound('clickPlay');
  vibrateDevice([10]);
  renderPlayerSteps(); updateLoopUI();
}

export function loopStepToggleMode(stepIdx) {
  const eng = viewingEngine();
  if (!eng || !eng.loopSelectMode) return;
  eng.toggleStepMode(stepIdx);
  vibrateDevice([10]);
  renderPlayerSteps();
}

// Chrono dial touch for group scrolling
let dialStartAngle = null;
let dialStartGroup = 0;

export function chronoDialStart(e) {
  const eng = viewingEngine();
  if (!eng || !eng.loopSelectMode) return;
  const touch = e.touches ? e.touches[0] : e;
  const svg = DOM.chronoSvg;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  dialStartAngle = Math.atan2(touch.clientY - cy, touch.clientX - cx);
  dialStartGroup = eng.loopSelectGroupIdx;
  e.preventDefault();
}

export function chronoDialMove(e) {
  const eng = viewingEngine();
  if (!eng || !eng.loopSelectMode || dialStartAngle === null) return;
  const touch = e.touches ? e.touches[0] : e;
  const svg = DOM.chronoSvg;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const currentAngle = Math.atan2(touch.clientY - cy, touch.clientX - cx);
  let delta = currentAngle - dialStartAngle;
  // Normalize to [-PI, PI]
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  // Each 60° = one group
  const groupDelta = Math.round(delta / (Math.PI / 3));
  const maxGroups = eng.loopGroups.length + 1; // +1 for empty slot
  let newIdx = dialStartGroup + groupDelta;
  newIdx = Math.max(0, Math.min(newIdx, maxGroups - 1));
  if (newIdx !== eng.loopSelectGroupIdx) {
    eng.loopSelectGroupIdx = newIdx;
    eng.ensureGroupExists(newIdx);
    playUiSound('whoosh');
    renderPlayerSteps(); updateLoopUI();
  }
  e.preventDefault();
}

export function chronoDialEnd() {
  dialStartAngle = null;
}

function updateLoopUI() {
  const eng = viewingEngine();
  const btn = DOM.loopBtn;
  if (!btn || !eng) return;

  if (eng.loopSelectMode) {
    btn.classList.add('active');
    const group = eng.loopGroups[eng.loopSelectGroupIdx];
    const isEmpty = !group || group.steps.length === 0;
    const groupNum = eng.loopSelectGroupIdx + 1;
    const color = LOOP_COLORS[eng.loopSelectGroupIdx % LOOP_COLORS.length];

    btn.innerHTML = isEmpty
      ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2"/></svg>`
      : `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="${color}" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="${color}" font-size="11" font-family="'JetBrains Mono'">${groupNum}</text></svg>`;

    // Add dial mode class to chrono
    DOM.chronoFace?.classList.add('loop-dial');
  } else {
    btn.classList.remove('active');
    // Show lap count for focused step's loop, or default icon
    const laps = eng.getLoopLaps(eng.focusedIdx);
    const gi = eng.getStepLoopGroup(eng.focusedIdx);

    if (gi !== -1) {
      const color = LOOP_COLORS[gi % LOOP_COLORS.length];
      // Hash marks around circle for laps
      let hashes = '';
      for (let i = 0; i < Math.min(laps, 12); i++) {
        const angle = i * 30;
        hashes += `<line x1="12" y1="2" x2="12" y2="4" stroke="${color}" stroke-width="1" transform="rotate(${angle} 12 12)"/>`;
      }
      btn.innerHTML = `<svg viewBox="0 0 24 24">${hashes}<path d="M12 6a6 6 0 1 1-3 11.2" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><path d="M9 17.2l-2 1.5 0.5-2.5" fill="${color}"/></svg>`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 6a6 6 0 1 1-3 11.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"/><path d="M9 17.2l-2 1.5 0.5-2.5" fill="currentColor" opacity="0.3"/></svg>`;
    }
    DOM.chronoFace?.classList.remove('loop-dial');
  }
}

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
  DOM.completionSub.textContent =
    `${eng.chunk.name} — ${formatDuration(totalMin)} completed`;
  DOM.completionOverlay.classList.add('show');
  playCompletionFanfare(); announceCompletion(eng.chunk.name);
  spawnParticles(); vibrateDevice([100, 50, 100, 50, 200]);
}

export function closeCompletion() {
  DOM.completionOverlay.classList.remove('show');
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
  const panel = DOM.playerBgPicker;
  const overlay = DOM.bgPickerOverlay;
  if (panel.classList.contains('show')) { closeBgAudioPicker(); }
  else { overlay.classList.add('show'); panel.classList.add('show'); renderPlayerBgPicker(); }
}

export function closeBgAudioPicker() {
  DOM.bgPickerOverlay.classList.remove('show');
  DOM.playerBgPicker.classList.remove('show');
}

function renderPlayerBgPicker() {
  const eng = viewingEngine();
  const currentBg = getEffectiveBg(eng);
  DOM.playerBgPickerPills.innerHTML =
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

// ─── Experimental Wrapper & Navigation Gestures ───
let wrpTimer;
let wrpTriggered = false;

export function wrapperDown(pathStr) {
  wrpTriggered = false;
  wrpTimer = setTimeout(() => {
    wrpTriggered = true;
    playerGoDeeper(pathStr);
  }, 500);
}

export function wrapperUp(pathStr) {
  clearTimeout(wrpTimer);
  if (wrpTriggered) return;
  const eng = viewingEngine();
  if (!eng) return;
  const wrapIdx = eng.flatSteps.findIndex(s => s.isWrapper && s.path.join('-') === pathStr);
  if (wrapIdx !== -1 && wrapIdx + 1 < eng.flatSteps.length) {
    onStepTap(wrapIdx + 1);
  }
}

export function playerGoDeeper(pathStr) {
  const eng = viewingEngine();
  if (!eng) return;
  eng.viewPath = pathStr ? pathStr.split('-').map(Number) : [];
  playUiSound('boop');
  switchPlayerView(eng);
}

export function playerPopUp() {
  const eng = viewingEngine();
  if (!eng || eng.viewPath.length === 0) return;
  eng.viewPath = eng.viewPath.slice(0, -1);
  playUiSound('boop');
  switchPlayerView(eng);
}
let pullStartY = null;

function initPullToPop() {
  const list = DOM.playerStepsList;
  if (!list || list._pullToPopBound) return;
  list._pullToPopBound = true;

  list.addEventListener('touchstart', (e) => {
    if (list.scrollTop <= 0) pullStartY = e.touches[0].clientY;
    else pullStartY = null;
  }, { passive: true });

  list.addEventListener('touchend', (e) => {
    if (pullStartY == null) return;
    const endY = e.changedTouches[0].clientY;
    if (endY - pullStartY > 80) playerPopUp();
    pullStartY = null;
  }, { passive: true });
}
