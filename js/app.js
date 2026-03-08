// ═══════════════════════════════════════════════════
// KaChunk — App Init
// Wires all modules together, registers global handlers
// ═══════════════════════════════════════════════════

import { initIdentity } from './identity.js';
import { onNavigate, goHome } from './router.js';
import { renderHome, openSheet, closeSheet, playSelectedChunk, editSelectedChunk, scheduleSelectedChunk, deleteSelectedChunk } from './home.js';
import { createNewChunk, openEditor, addStep, removeStep, moveStep, updateStepLabel, updateStepMinutes, toggleSubPreview, saveChunk, openStepSoundPicker, pickStepSound, openChunkPicker, closeChunkPicker, pickSubChunk, selectEditAlarm, selectEditBg, toggleLock } from './editor.js';
import { startPlayer, togglePlay, playerNext, playerPrev, stopAndGoHome, closeCompletion, toggleVoiceInPlayer, toggleBgAudioPicker, closeBgAudioPicker, selectPlayerBg, toggleBreadcrumb, closeBreadcrumb, scrollToStep } from './player.js';
import { openSchedule, toggleDay, saveSchedule, clearSchedule, initScheduleListeners } from './schedule.js';
import { openAudioSettings, closeAudioSettings, selectAlarmSound, selectBgSound, toggleSettingSwitch, onVolumeChange } from './audio-settings.js';
import { closeConfirm, executeConfirm } from './ui.js';
import { unlockAudio } from './audio.js';

// ─── Global bridge for inline onclick handlers ───
// ES modules can't be called from inline HTML onclick,
// so we expose a global namespace.

window._kachunk = {
  // Home
  openSheet,
  closeSheet,
  playSelectedChunk: () => playSelectedChunk(startPlayer),
  editSelectedChunk: () => editSelectedChunk(openEditor),
  scheduleSelectedChunk: () => scheduleSelectedChunk(openSchedule),
  deleteSelectedChunk,

  // Editor
  createNewChunk,
  addStep,
  removeStep,
  moveStep,
  updateStepLabel,
  updateStepMinutes,
  toggleSubPreview,
  saveChunk,
  openStepSoundPicker,
  pickStepSound,
  openChunkPicker,
  closeChunkPicker,
  pickSubChunk,
  selectEditAlarm,
  selectEditBg,
  toggleLock,

  // Player
  togglePlay,
  playerNext,
  playerPrev,
  stopAndGoHome,
  closeCompletion,
  toggleVoiceInPlayer,
  toggleBgAudioPicker,
  closeBgAudioPicker,
  selectPlayerBg,
  toggleBreadcrumb,
  closeBreadcrumb,
  scrollToStep,

  // Schedule
  toggleDay,
  saveSchedule,
  clearSchedule,

  // Audio Settings
  openAudioSettings,
  closeAudioSettings,
  selectAlarmSound,
  selectBgSound,
  toggleSettingSwitch,
  onVolumeChange,

  // Confirm
  closeConfirm,
  executeConfirm,

  // Navigation
  goHome: () => { goHome(); renderHome(); },
};

// ─── FAB visibility ───
onNavigate((screenId) => {
  document.getElementById('fabBtn').style.display = (screenId === 'homeScreen') ? 'flex' : 'none';
});

// ─── FAB handlers ───
const fab = document.getElementById('fabBtn');
fab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); createNewChunk(); });
fab.addEventListener('touchend', (e) => { e.preventDefault(); createNewChunk(); });

// ─── Schedule listeners ───
initScheduleListeners();

// ─── Unlock audio on first interaction ───
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });

// ─── Identity (silent init) ───
initIdentity();

// ─── Service Worker ───
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── Initial Render ───
renderHome();

console.log('[KaChunk] Ready');
