// Clearhead push server: a Cloudflare Worker that sends scheduled Web Push reminders.
//
// It stores only, per device: the browser's push subscription, a device name, its time zone and
// its reminder times. Each push carries just {kind}, encrypted per
// RFC 8291 (morning/evening/quote/savers); the device builds the notification text from its own data.
//
// Setup (see README "Push notifications"): bind a KV namespace as DEVICES, set a secret
// CLEARHEAD_KEY, add a cron trigger "* * * * *". VAPID keys are generated on first use.
// Single file with no dependencies, so it can be pasted into the Cloudflare dashboard editor.

const KINDS = ['morning', 'evening', 'quote', 'savers'];
// Only ever POST to real browser push services.
const PUSH_HOSTS = ['fcm.googleapis.com', 'notify.windows.com', 'push.services.mozilla.com', 'push.apple.com'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, e.status || 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, new Date(event.scheduledTime)));
  },
};

// ---------- HTTP API ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (!env.DEVICES) throw new HttpError(500, 'Worker is missing its KV binding named DEVICES');
  if (url.pathname === '/api/health') return json({ ok: true, keySet: !!env.CLEARHEAD_KEY });
  if (url.pathname === '/api/vapid' && request.method === 'GET') return json({ publicKey: (await vapidKeys(env)).publicKey });

  const m = url.pathname.match(/^\/api\/devices\/([\w-]{8,64})(\/test)?$/);
  if (!m) throw new HttpError(404, 'Not found');
  authorize(request, env);
  const [, id, isTest] = m;
  const all = await loadDevices(env);

  if (isTest && request.method === 'POST') {
    const { kind = 'quote' } = await request.json().catch(() => ({}));
    if (!all[id]) throw new HttpError(404, 'This device is not registered');
    const res = await sendPush(env, all[id].subscription, { kind: KINDS.includes(kind) ? kind : 'quote', test: true });
    if (res.status === 404 || res.status === 410) { delete all[id]; await saveDevices(env, all); }
    return json({ ok: res.ok, status: res.status });
  }
  if (request.method === 'PUT') {
    all[id] = { ...validateDevice(await request.json().catch(() => null)), updatedAt: Date.now() };
    await saveDevices(env, all);
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    delete all[id];
    await saveDevices(env, all);
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

function authorize(request, env) {
  if (!env.CLEARHEAD_KEY) throw new HttpError(500, 'Set the CLEARHEAD_KEY secret on the worker first');
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const want = env.CLEARHEAD_KEY;
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  if (diff) throw new HttpError(401, 'Wrong access key');
}

export function validateDevice(body) {
  const sub = body?.subscription;
  let host;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname;
  } catch {
    throw new HttpError(400, 'Invalid push subscription');
  }
  if (!PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h))) throw new HttpError(400, 'Unsupported push service');
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') throw new HttpError(400, 'Push subscription keys missing');
  const tz = String(body.tz || 'UTC');
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { throw new HttpError(400, 'Unknown time zone'); }
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  if (schedule.length > 12) throw new HttpError(400, 'Too many reminders');
  for (const s of schedule) {
    if (!KINDS.includes(s?.kind)) throw new HttpError(400, `Unknown reminder type "${s?.kind}": update the worker code`);
    if (!TIME_RE.test(s?.time)) throw new HttpError(400, 'Invalid reminder time');
  }
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    name: String(body.name || 'Device').slice(0, 60),
    tz,
    schedule: schedule.map((s) => ({ kind: s.kind, time: s.time })),
  };
}

// All devices live in one KV value: one read per minute stays well inside the free tier.
async function loadDevices(env) {
  return (await env.DEVICES.get('devices', 'json')) || {};
}
async function saveDevices(env, all) {
  await env.DEVICES.put('devices', JSON.stringify(all));
}

// ---------- schedule ----------
export function localTime(date, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

// Runs every minute: sends each reminder whose local time matches. Returns pushes attempted.
export async function runSchedule(env, when) {
  const all = await loadDevices(env);
  let sent = 0;
  let changed = false;
  for (const [id, dev] of Object.entries(all)) {
    const now = localTime(when, dev.tz);
    for (const s of dev.schedule.filter((x) => x.time === now)) {
      sent++;
      const res = await sendPush(env, dev.subscription, { kind: s.kind }).catch(() => null);
      if (res && (res.status === 404 || res.status === 410)) {
        delete all[id]; // subscription expired or revoked
        changed = true;
        break;
      }
    }
  }
  if (changed) await saveDevices(env, all);
  return sent;
}

// ---------- Web Push: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291) ----------
export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

let vapidCache = null;
export async function vapidKeys(env) {
  if (vapidCache) return vapidCache;
  let stored = await env.DEVICES.get('vapid', 'json');
  if (!stored) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    stored = {
      jwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
      publicKey: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)),
    };
    await env.DEVICES.put('vapid', JSON.stringify(stored));
  }
  const privateKey = await crypto.subtle.importKey('jwk', stored.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidCache = { publicKey: stored.publicKey, privateKey };
  return vapidCache;
}
export function resetVapidCache() { vapidCache = null; }

async function vapidAuth(env, endpoint) {
  const { publicKey, privateKey } = await vapidKeys(env);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:clearhead-push@example.com',
  })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${publicKey}`;
}

export async function encryptPayload(subscription, text) {
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  // HKDF steps from RFC 8291 §3.4 (each output fits in one HMAC block).
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), [2])));
  const header = new Uint8Array(21); // salt(16) | record size(4) | key id length(1)
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export async function sendPush(env, subscription, message) {
  const body = await encryptPayload(subscription, JSON.stringify(message));
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(env, subscription.endpoint),
      TTL: '3600', // a reminder more than an hour late isn't useful
      Urgency: 'normal',
      Topic: message.kind, // a newer reminder of the same kind replaces an undelivered one
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
}
