// ═══════════════════════════════════════════════════
// KaChunk — Data Store
// localStorage now, structured for future SQLite swap
// ═══════════════════════════════════════════════════

const STORAGE_KEY = 'kachunk_data';
const LEGACY_KEY = 'chunk_app_data';
const SESSIONS_KEY = 'kachunk_active_sessions';

// ─── Core CRUD ───

export function loadChunks() {
  try {
    let d = localStorage.getItem(STORAGE_KEY);
    if (!d) {
      d = localStorage.getItem(LEGACY_KEY);
      if (d) {
        localStorage.setItem(STORAGE_KEY, d);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    return d ? JSON.parse(d) : [];
  } catch { return []; }
}

export function saveChunks(chunks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chunks));
}

export function getChunk(id) {
  return loadChunks().find(c => c.id === id) || null;
}

export function deleteChunk(id) {
  const chunks = loadChunks().filter(c => c.id !== id);
  saveChunks(chunks);
  return chunks;
}

export function upsertChunk(chunk) {
  const chunks = loadChunks();
  const idx = chunks.findIndex(c => c.id === chunk.id);
  if (idx >= 0) {
    chunks[idx] = chunk;
  } else {
    chunks.push(chunk);
  }
  saveChunks(chunks);
  return chunks;
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ═══════════════════════════════════════════════════
// Active Sessions — Multiple chunks can run simultaneously
//
// A session tracks:
//   - Which chunk is playing
//   - Current position (step index + depth path for nested chunks)
//   - Timer state (seconds left, overtime seconds)
//   - Started timestamp
//   - Status: 'playing' | 'paused' | 'overtime' | 'completed'
// ═══════════════════════════════════════════════════

/**
 * Session shape:
 * {
 *   id: string,
 *   chunkId: string,
 *   chunkName: string,
 *   status: 'playing' | 'paused' | 'overtime' | 'completed',
 *   stepPath: number[],          // path of step indices through nesting
 *   flatStepIdx: number,         // index in flattened step list
 *   secondsLeft: number,
 *   totalSeconds: number,
 *   overtimeSeconds: number,
 *   startedAt: string,           // ISO timestamp
 *   updatedAt: string,           // ISO timestamp
 *   flatSteps: Array,            // cached flattened steps
 * }
 */

export function loadSessions() {
  try {
    const d = localStorage.getItem(SESSIONS_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
}

export function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function getSession(id) {
  return loadSessions().find(s => s.id === id) || null;
}

export function createSession(chunkId) {
  const chunks = loadChunks();
  const chunk = chunks.find(c => c.id === chunkId);
  if (!chunk) return null;

  const flatSteps = flattenChunk(chunk, chunks);
  if (flatSteps.length === 0) return null;

  const firstStep = flatSteps[0];
  const totalSeconds = Math.round((parseFloat(firstStep.minutes) || 1) * 60);

  const session = {
    id: genId(),
    chunkId: chunk.id,
    chunkName: chunk.name,
    status: 'paused',
    stepPath: [0],
    flatStepIdx: 0,
    secondsLeft: totalSeconds,
    totalSeconds: totalSeconds,
    overtimeSeconds: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flatSteps: flatSteps,
  };

  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
  return session;
}

export function updateSession(id, updates) {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx < 0) return null;
  sessions[idx] = { ...sessions[idx], ...updates, updatedAt: new Date().toISOString() };
  saveSessions(sessions);
  return sessions[idx];
}

export function removeSession(id) {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  return sessions;
}

export function getActiveSessions() {
  return loadSessions().filter(s => s.status !== 'completed');
}

export function getOvertimeSessions() {
  return loadSessions().filter(s => s.status === 'overtime');
}

// ═══════════════════════════════════════════════════
// Sub-Chunk Utilities
// ═══════════════════════════════════════════════════

/**
 * Flatten a chunk's steps, resolving sub-chunk references recursively.
 * Each flattened step includes depth info for navigation.
 */
export function flattenChunk(chunk, allChunks, visited, depth, parentPath) {
  if (!visited) visited = new Set();
  if (depth === undefined) depth = 0;
  if (!parentPath) parentPath = [];
  if (!chunk || !chunk.steps) return [];
  if (visited.has(chunk.id)) return [];
  visited.add(chunk.id);

  const result = [];
  chunk.steps.forEach((step, stepIdx) => {
    const currentPath = [...parentPath, stepIdx];
    const stepType = step.type || 'step';

    if (stepType === 'chunk') {
      const sub = allChunks.find(c => c.id === step.chunkId);
      if (sub) {
        // Wrapper node for boxed nesting UI
        result.push({
          label: sub.name,
          name: sub.name,
          minutes: getTotalDuration(sub, allChunks),
          sound: step.sound,
          sourceChunk: null,
          sourceChunkId: sub.id,
          depth: depth,
          path: currentPath,
          locked: !!step.locked,
          isWrapper: true,
          subCount: getFlatStepCount(sub, allChunks),
        });

        // If this sub-chunk is locked, use the snapshot instead of live data
        if (step.locked && step.snapshot) {
          step.snapshot.forEach((snapStep, snapIdx) => {
            result.push({
              label: snapStep.label,
              minutes: snapStep.minutes,
              sound: snapStep.sound,
              sourceChunk: sub.name,
              sourceChunkId: sub.id,
              depth: depth + 1,
              path: [...currentPath, snapIdx],
              locked: true,
              isWrapper: false,
            });
          });
        } else {
          const subSteps = flattenChunk(sub, allChunks, new Set(visited), depth + 1, currentPath);
          subSteps.forEach(ss => {
            result.push({
              ...ss,
              sourceChunk: ss.sourceChunk || sub.name,
              sourceChunkId: ss.sourceChunkId || sub.id,
            });
          });
        }
      }
    } else {
      result.push({
        label: step.label,
        minutes: step.minutes,
        sound: step.sound,
        sourceChunk: null,
        sourceChunkId: null,
        depth: depth,
        path: currentPath,
        locked: false,
      });
    }
  });
  return result;
}

export function getTotalDuration(chunk, allChunks) {
  return flattenChunk(chunk, allChunks).reduce((s, st) => s + (parseFloat(st.minutes) || 0), 0);
}

export function getFlatStepCount(chunk, allChunks) {
  return flattenChunk(chunk, allChunks).length;
}

export function chunkReferencesId(targetChunk, chunkId, allChunks, visited) {
  if (!visited) visited = new Set();
  if (!targetChunk || !targetChunk.steps) return false;
  if (visited.has(targetChunk.id)) return false;
  visited.add(targetChunk.id);
  for (let i = 0; i < targetChunk.steps.length; i++) {
    const step = targetChunk.steps[i];
    if ((step.type || 'step') === 'chunk') {
      if (step.chunkId === chunkId) return true;
      const sub = allChunks.find(c => c.id === step.chunkId);
      if (sub && chunkReferencesId(sub, chunkId, allChunks, new Set(visited))) return true;
    }
  }
  return false;
}

export function hasSubChunks(chunk) {
  if (!chunk || !chunk.steps) return false;
  return chunk.steps.some(s => (s.type || 'step') === 'chunk');
}

// ═══════════════════════════════════════════════════
// Lock / Snapshot for embedded chunks
// ═══════════════════════════════════════════════════

/**
 * Lock an embedded chunk reference — snapshot its current steps.
 * Called on the parent chunk's step that references the sub-chunk.
 */
export function lockEmbeddedChunk(parentChunkId, stepIndex) {
  const chunks = loadChunks();
  const parent = chunks.find(c => c.id === parentChunkId);
  if (!parent || !parent.steps[stepIndex]) return false;

  const step = parent.steps[stepIndex];
  if ((step.type || 'step') !== 'chunk') return false;

  const sub = chunks.find(c => c.id === step.chunkId);
  if (!sub) return false;

  // Snapshot the sub-chunk's flattened steps
  const flatSteps = flattenChunk(sub, chunks);
  step.locked = true;
  step.snapshot = flatSteps.map(s => ({
    label: s.label,
    minutes: s.minutes,
    sound: s.sound,
  }));
  step.snapshotAt = new Date().toISOString();

  saveChunks(chunks);
  return true;
}

/**
 * Unlock an embedded chunk — remove snapshot, revert to live reference.
 */
export function unlockEmbeddedChunk(parentChunkId, stepIndex) {
  const chunks = loadChunks();
  const parent = chunks.find(c => c.id === parentChunkId);
  if (!parent || !parent.steps[stepIndex]) return false;

  const step = parent.steps[stepIndex];
  step.locked = false;
  delete step.snapshot;
  delete step.snapshotAt;

  saveChunks(chunks);
  return true;
}
