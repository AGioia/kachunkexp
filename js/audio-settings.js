// ═══════════════════════════════════════════════════
// KaChunk — Audio Settings Panel
// ═══════════════════════════════════════════════════

import {
  loadAudioSettings, saveAudioSettings, setVolume,
  ALARM_SOUNDS, BG_SOUNDS, previewSound, stopBgAudio
} from './audio.js';

export function openAudioSettings() {
  const s = loadAudioSettings();
  document.getElementById('audioSettingsOverlay').classList.add('show');
  document.getElementById('audioSettingsPanel').classList.add('show');
  document.getElementById('volumeSlider').value = s.volume;
  document.getElementById('volumePct').textContent = s.volume + '%';
  document.getElementById('voiceToggle').classList.toggle('on', !!s.voice);
  document.getElementById('sfxToggle').classList.toggle('on', !!s.sfx);
  renderSettingsPickers();
}

export function closeAudioSettings() {
  document.getElementById('audioSettingsOverlay').classList.remove('show');
  document.getElementById('audioSettingsPanel').classList.remove('show');
  stopBgAudio();
}

function renderSettingsPickers() {
  const s = loadAudioSettings();

  document.getElementById('settingsAlarmPicker').innerHTML =
    Object.entries(ALARM_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${s.alarm === key ? 'selected' : ''}" onclick="window._kachunk.selectAlarmSound('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');

  document.getElementById('settingsBgPicker').innerHTML =
    Object.entries(BG_SOUNDS).map(([key, snd]) =>
      `<button class="sound-pill ${s.bg === key ? 'selected' : ''}" onclick="window._kachunk.selectBgSound('${key}')">${snd.icon} ${snd.label}</button>`
    ).join('');
}

export function selectAlarmSound(key) {
  const s = loadAudioSettings();
  s.alarm = key;
  saveAudioSettings(s);
  renderSettingsPickers();
  previewSound('alarm', key);
}

export function selectBgSound(key) {
  const s = loadAudioSettings();
  s.bg = key;
  saveAudioSettings(s);
  renderSettingsPickers();
  previewSound('bg', key);
}

export function toggleSettingSwitch(key, btn) {
  const s = loadAudioSettings();
  s[key] = !s[key];
  saveAudioSettings(s);
  btn.classList.toggle('on', !!s[key]);
}

export function onVolumeChange(val) {
  const v = parseInt(val) || 0;
  document.getElementById('volumePct').textContent = v + '%';
  const s = loadAudioSettings();
  s.volume = v;
  saveAudioSettings(s);
  setVolume(v);
}
