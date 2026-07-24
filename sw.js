// BluTracker Service Worker
const CACHE = 'blutracker-v21';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  
  // collection.json and seed.json: network first (keep data fresh)
  if (url.pathname.endsWith('collection.json') || url.pathname.endsWith('seed.json')) {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Firebase CDN: network only
  if (url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) {
    return;
  }

  // Everything else: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request)
      .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
    )
  );
});
