const CACHE_NAME = 'kachunk-v3';

// Use relative paths so the SW works on any base path (GitHub Pages /kachunk/, custom domain /, etc.)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/player.css',
  './css/sheets.css',
  './css/audio.css',
  './js/app.js',
  './js/store.js',
  './js/identity.js',
  './js/router.js',
  './js/audio.js',
  './js/audio-settings.js',
  './js/ui.js',
  './js/home.js',
  './js/editor.js',
  './js/player.js',
  './js/schedule.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
