// ═══════════════════════════════════════════════════
// KaChunk — App Init
// Wires all modules together, registers global handlers
// ═══════════════════════════════════════════════════

import { initIdentity } from './identity.js';
import { onNavigate, goHome } from './router.js';
import { renderHome, openPlayerScreen, editChunk, chronoDown, chronoUp, chronoCancel } from './home.js';
import { createNewChunk, openEditor, addStep, removeStep, moveStep, updateStepLabel, updateStepMinutes, toggleSubPreview, openStepSoundPicker, pickStepSound, openChunkPicker, closeChunkPicker, pickSubChunk, selectEditAlarm, selectEditBg, toggleLock, deleteChunkFromEditor } from './editor.js';
import { engines, startPlayer, openPlayerView, togglePlay, kachunkAction, smartPause, restartDown, restartUp, restartCancel, playerNext, playerPrev, jumpToStep, onStepTap, focusStep, goBackToDrawer, stopAndGoHome, closeCompletion, toggleVoiceInPlayer, toggleBgAudioPicker, closeBgAudioPicker, selectPlayerBg, loopBtnDown, loopBtnUp, loopBtnCancel, loopStepTap, loopStepToggleMode, chronoDialStart, chronoDialMove, chronoDialEnd, wrapperDown, wrapperUp, playerGoDeeper, playerPopUp } from './player.js';
import { openSchedule, toggleDay, saveSchedule, clearSchedule, initScheduleListeners } from './schedule.js';
import { openAudioSettings, closeAudioSettings, selectAlarmSound, selectBgSound, toggleSettingSwitch, onVolumeChange } from './audio-settings.js';
import { closeConfirm, executeConfirm } from './ui.js';
import { unlockAudio } from './audio.js';

// ─── Global bridge for inline onclick handlers ───

window._kachunk = {
  // Chunk Drawer (Home)
  openPlayerScreen,
  editChunk,
  chronoDown, chronoUp, chronoCancel,

  // Internal refs for home.js to call without circular imports
  _startPlayer: startPlayer,
  _openEditor: openEditor,
  _openSchedule: openSchedule,
  _engines: engines,

  // Editor
  createNewChunk,
  addStep,
  removeStep,
  moveStep,
  updateStepLabel,
  updateStepMinutes,
  toggleSubPreview,
  openStepSoundPicker,
  pickStepSound,
  openChunkPicker,
  closeChunkPicker,
  pickSubChunk,
  selectEditAlarm,
  selectEditBg,
  toggleLock,
  deleteChunkFromEditor,

  // Player
  togglePlay,
  kachunkAction,
  smartPause,
  restartDown,
  restartUp,
  restartCancel,
  playerNext,
  playerPrev,
  jumpToStep,
  onStepTap,
  focusStep,
  goBackToDrawer,
  stopAndGoHome,
  closeCompletion,
  toggleVoiceInPlayer,
  toggleBgAudioPicker,
  closeBgAudioPicker,
  selectPlayerBg,

  // Loop
  loopBtnDown,
  loopBtnUp,
  loopBtnCancel,
  loopStepTap,
  loopStepToggleMode,
  chronoDialStart,
  chronoDialMove,
  chronoDialEnd,
  wrapperDown,
  wrapperUp,
  playerGoDeeper,
  playerPopUp,

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
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── Initial Render ───
renderHome();

// Ready
