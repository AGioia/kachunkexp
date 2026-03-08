// ═══════════════════════════════════════════════════
// KaChunk — Data Store
// localStorage now, structured for future SQLite swap
// ═══════════════════════════════════════════════════

const STORAGE_KEY = 'kachunk_data';
const LEGACY_KEY = 'chunk_app_data'; // migrate from old key

// ─── Core CRUD ───

export function loadChunks() {
  try {
    let d = localStorage.getItem(STORAGE_KEY);
    // Migrate from legacy key if needed
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

// ─── Sub-Chunk Utilities ───

export function flattenChunk(chunk, allChunks, visited) {
  if (!visited) visited = new Set();
  if (!chunk || !chunk.steps) return [];
  if (visited.has(chunk.id)) return [];
  visited.add(chunk.id);

  const result = [];
  chunk.steps.forEach(step => {
    const stepType = step.type || 'step';
    if (stepType === 'chunk') {
      const sub = allChunks.find(c => c.id === step.chunkId);
      if (sub) {
        const subSteps = flattenChunk(sub, allChunks, new Set(visited));
        subSteps.forEach(ss => {
          result.push({
            label: ss.label,
            minutes: ss.minutes,
            sound: ss.sound,
            sourceChunk: ss.sourceChunk || sub.name
          });
        });
      }
    } else {
      result.push({
        label: step.label,
        minutes: step.minutes,
        sound: step.sound,
        sourceChunk: null
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
