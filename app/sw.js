// Offline app shell + push notifications. Registered as a module worker.
// Bump VERSION whenever app files change.
import { buildNotification } from './js/notify.js';

const VERSION = 'clearhead-v7';
const DATA_CACHE = 'clearhead-data'; // the app's data snapshot, kept across versions
const KEEP = [DATA_CACHE, 'clearhead-files', 'clearhead-share']; // offline files and pending shares
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/sync.js', 'js/sweep.js', 'js/calendar.js', 'js/braindump.js',
  'js/quotes.js', 'js/notify.js', 'js/push.js', 'js/savers.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !KEEP.includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin GETs: serve from cache, refresh in the background (stale-while-revalidate).
// Navigations with query strings (share target, shortcuts, OAuth) fall back to the cached shell.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
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

// Android "Share to Clearhead": park the shared files/text in a cache, then open the app on them.
async function receiveShare(req) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  try {
    const form = await req.formData();
    const cache = await caches.open('clearhead-share');
    const base = new URL(`__share/${id}/`, self.registration.scope).href;
    const filesIn = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size);
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: [] };
    for (const [k, f] of filesIn.entries()) {
      await cache.put(base + k, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
      meta.files.push({ name: f.name || `shared-${k}`, type: f.type || '' });
    }
    await cache.put(`${base}meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* fall through to the app */ }
  return Response.redirect(new URL(`./?shared=${id}`, self.registration.scope).href, 303);
}

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
