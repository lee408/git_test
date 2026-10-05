// Offline app shell + push notifications. Registered as a module worker.
// Bump VERSION whenever app files change.
import { buildNotification } from './js/notify.js';

const VERSION = 'clearhead-v5';
const DATA_CACHE = 'clearhead-data'; // the app's data snapshot, kept across versions
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/sync.js', 'js/sweep.js', 'js/calendar.js', 'js/braindump.js',
  'js/quotes.js', 'js/notify.js', 'js/push.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== DATA_CACHE).map((k) => caches.delete(k))))
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

async function loadSnapshot() {
  try {
    const res = await (await caches.open(DATA_CACHE)).match(new URL('__snapshot.json', self.registration.scope).href);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

// The push only says which reminder to show; the text comes from this device's own data.
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { /* empty or non-JSON push */ }
  e.waitUntil((async () => {
    const n = buildNotification(msg.kind || 'quote', await loadSnapshot(), new Date());
    await self.registration.showNotification(n.title, {
      body: n.body, tag: n.tag, icon: 'icons/icon-192.png', data: { url: n.url },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      return win.navigate(url).catch(() => {});
    }
    return self.clients.openWindow(url);
  })());
});
