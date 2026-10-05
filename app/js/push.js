// Push notification registration for this device. The server address and access key are
// synced (doc.settings); which reminders this device gets, and when, are per device (prefs).
import { store, prefs } from './store.js';
import { uid } from './model.js';

const DEFAULTS = {
  name: '',
  morning: { on: true, time: '07:30' },
  evening: { on: true, time: '18:00' },
  quotes: { on: true, times: ['12:30'] },
};

export const SNAPSHOT_URL = '__snapshot.json';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// "9:00, 15:30" → ["09:00", "15:30"]; ignores anything that isn't a time.
export function parseTimes(text) {
  return [...new Set(String(text).split(/[\s,;]+/).map((t) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }).filter((t) => TIME_RE.test(t)))].sort().slice(0, 6);
}

export const push = {
  get supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  get server() { return (store.doc.settings.pushServer || '').replace(/\/+$/, ''); },
  get key() { return store.doc.settings.pushKey || ''; },
  get deviceId() {
    let id = prefs.get('push.deviceId', null);
    if (!id) { id = `dev-${uid()}`; prefs.set('push.deviceId', id); }
    return id;
  },
  get config() {
    const c = prefs.get('push.config', {});
    return { ...DEFAULTS, ...c, morning: { ...DEFAULTS.morning, ...c.morning }, evening: { ...DEFAULTS.evening, ...c.evening }, quotes: { ...DEFAULTS.quotes, ...c.quotes } };
  },
  set config(c) { prefs.set('push.config', c); },
  get enabled() { return prefs.get('push.enabled', false); },

  schedule(c = this.config) {
    const s = [];
    if (c.morning.on && TIME_RE.test(c.morning.time)) s.push({ kind: 'morning', time: c.morning.time });
    if (c.evening.on && TIME_RE.test(c.evening.time)) s.push({ kind: 'evening', time: c.evening.time });
    if (c.quotes.on) for (const time of c.quotes.times) s.push({ kind: 'quote', time });
    return s;
  },

  async api(method, path, body) {
    if (!this.server) throw new Error('Enter your push server address first.');
    let res;
    try {
      res = await fetch(`${this.server}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Could not reach the push server. Check the address and that you are online.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Push server error (${res.status})`);
    return data;
  },

  // Asks permission, subscribes this browser, and registers its schedule with the server.
  async enable() {
    if (!this.supported) throw new Error('This browser can\'t receive push notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked for this app. Allow them in the browser or Android settings.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await this.api('GET', '/api/vapid');
    const appKey = b64urlToBytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // Re-subscribe if the server's keys changed (e.g. a new worker).
    const subKey = sub?.options?.applicationServerKey;
    if (sub && subKey && new Uint8Array(subKey).join() !== appKey.join()) { await sub.unsubscribe(); sub = null; }
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      } catch (e) {
        throw new Error(`This browser refused the push subscription (${e.message}).`);
      }
    }
    await this.api('PUT', `/api/devices/${this.deviceId}`, {
      subscription: sub.toJSON(),
      name: this.config.name || defaultName(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      schedule: this.schedule(),
    });
    prefs.set('push.enabled', true);
  },

  async disable() {
    try { await this.api('DELETE', `/api/devices/${this.deviceId}`); } catch { /* server may be gone */ }
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
    prefs.set('push.enabled', false);
  },

  async test(kind) {
    return this.api('POST', `/api/devices/${this.deviceId}/test`, { kind });
  },
};

function defaultName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

// The service worker builds notifications from this copy of the data (it can't read localStorage).
let snapTimer;
export function saveSnapshot(doc) {
  if (!('caches' in window)) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    caches.open('clearhead-data')
      .then((c) => c.put(new URL(SNAPSHOT_URL, document.baseURI).href, new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' } })))
      .catch(() => {});
  }, 1000);
}
