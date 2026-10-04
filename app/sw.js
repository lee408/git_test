// Offline app shell. Bump VERSION whenever app files change.
const VERSION = 'clearhead-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/sync.js', 'js/sweep.js', 'js/calendar.js', 'js/braindump.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin GETs: serve from cache, refresh in the background (stale-while-revalidate).
// Navigations with query strings (share target, shortcuts, OAuth) fall back to the cached shell.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = req.mode === 'navigate' ? new Request(new URL('./', self.registration.scope)) : req;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then((res) => {
      if (res.ok && (req.mode !== 'navigate' || !url.search)) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
