const CACHE = 'wellness-u14-v2';
const SHELL = ['./', 'index.html', 'secure-app.js', 'manifest.webmanifest', 'Logo_Lyon_La_Duchère_-_2021 (1).svg', 'Logo_Lyon_La_Duchère_-_2021 (1).svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord pour toujours servir la dernière version ; cache en secours hors-ligne.
// Seules les requêtes GET de même origine sont gérées (Supabase et CDN passent directement).
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match('index.html')))
  );
});
