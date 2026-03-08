// ═══════════════════════════════════════════════════
// KaChunk — UI Utilities
// Toasts, particles, completion, confirm dialogs
// ═══════════════════════════════════════════════════

// ─── Toast ───

let toastTimer = null;

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── HTML Escaping ───

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Duration Formatting ───

export function formatDuration(mins) {
  if (mins < 1) return '<1 min';
  if (mins < 60) return Math.round(mins) + ' min';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
}

export function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// ─── Particles ───

export function spawnParticles() {
  const emojis = ['🎉', '✨', '🌟', '💛', '🎊', '⭐', '🔥', '💫'];
  for (let i = 0; i < 12; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = (10 + Math.random() * 80) + 'vw';
      p.style.top = (30 + Math.random() * 50) + 'vh';
      p.style.animationDuration = (1 + Math.random() * 1) + 's';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 2000);
    }, i * 120);
  }
}

// ─── Confirm Dialog ───

let pendingConfirmCallback = null;

export function showConfirm(message, onConfirm) {
  pendingConfirmCallback = onConfirm;
  document.getElementById('confirmMsg').textContent = message;
  document.getElementById('confirmDialog').classList.add('show');
}

export function closeConfirm() {
  document.getElementById('confirmDialog').classList.remove('show');
  pendingConfirmCallback = null;
}

export function executeConfirm() {
  const cb = pendingConfirmCallback;
  closeConfirm();
  if (cb) cb();
}

// ─── Wake Lock ───

let wakeLock = null;

export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
}

export function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}
