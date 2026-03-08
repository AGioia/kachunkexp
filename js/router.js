// ═══════════════════════════════════════════════════
// KaChunk — Screen Router
// ═══════════════════════════════════════════════════

let currentScreen = 'homeScreen';
let onNavigateCallback = null;

export function getCurrentScreen() {
  return currentScreen;
}

export function onNavigate(cb) {
  onNavigateCallback = cb;
}

export function showScreen(id) {
  const prev = document.getElementById(currentScreen);
  const next = document.getElementById(id);
  if (prev === next) return;

  prev.classList.remove('active');
  prev.classList.add('slide-out-left');

  next.classList.add('active');

  setTimeout(() => {
    prev.classList.remove('slide-out-left');
  }, 350);

  currentScreen = id;

  // Notify listeners (e.g., FAB visibility)
  if (onNavigateCallback) onNavigateCallback(id);
}

export function goHome() {
  showScreen('homeScreen');
}
