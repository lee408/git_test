import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import worker, { runSchedule, localTime, resetVapidCache, b64urlDecode } from '../worker/clearhead-push.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}

// A fake browser subscription whose private key we hold, so the test can decrypt pushes.
function browserSubscription(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh, auth,
    json: { endpoint: `https://${host}/fcm/send/abc123`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } },
  };
}

// Independent RFC 8291 decryption using Node's own HKDF + AES-GCM.
function decrypt(body, { ecdh, auth }) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'last-record delimiter');
  return JSON.parse(plain.subarray(0, end).toString());
}

function verifyVapid(header, endpoint) {
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, 'vapid header format');
  const [h, c, s] = m[1].split('.');
  const pub = b64urlDecode(m[2]);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'JWT signature verifies');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  assert.match(claims.sub, /^(mailto:|https:)/);
}

async function call(env, method, path, body, key = 'secret-key') {
  const res = await worker.fetch(new Request(`https://push.example.workers.dev${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function capturePushes(status = 201) {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('', { status }); };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}

test('localTime converts to the device time zone', () => {
  const when = new Date(Date.UTC(2026, 9, 5, 6, 30)); // 06:30 UTC
  assert.equal(localTime(when, 'Europe/London'), '07:30');
  assert.equal(localTime(when, 'Asia/Singapore'), '14:30');
  assert.equal(localTime(when, 'UTC'), '06:30');
});

test('register, push on schedule, encrypted payload and signed VAPID', async () => {
  resetVapidCache();
  const env = { DEVICES: kv(), CLEARHEAD_KEY: 'secret-key' };
  const vapid = await call(env, 'GET', '/api/vapid');
  assert.equal(vapid.status, 200);
  assert.equal(b64urlDecode(vapid.body.publicKey).length, 65, 'uncompressed P-256 key');

  const phone = browserSubscription();
  const reg = await call(env, 'PUT', '/api/devices/device-phone-1', {
    subscription: phone.json, name: 'Pixel', tz: 'Europe/London',
    schedule: [{ kind: 'morning', time: '07:30' }, { kind: 'quote', time: '07:30' }, { kind: 'evening', time: '18:00' }],
  });
  assert.deepEqual(reg, { status: 200, body: { ok: true } });

  const cap = capturePushes();
  try {
    assert.equal(await runSchedule(env, new Date(Date.UTC(2026, 9, 5, 6, 29))), 0, 'nothing at 07:29');
    assert.equal(await runSchedule(env, new Date(Date.UTC(2026, 9, 5, 6, 30))), 2, 'morning + quote at 07:30 London');
  } finally { cap.restore(); }
  assert.equal(cap.sent.length, 2);
  const [first] = cap.sent;
  assert.equal(first.url, phone.json.endpoint);
  assert.equal(first.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(first.init.headers.Topic, 'morning');
  verifyVapid(first.init.headers.Authorization, phone.json.endpoint);
  assert.deepEqual(decrypt(first.init.body, phone), { kind: 'morning' });
  assert.deepEqual(decrypt(cap.sent[1].init.body, phone), { kind: 'quote' });
  assert.ok(!new TextDecoder().decode(first.init.body).includes('morning'), 'payload is not plaintext');
});

test('VAPID keys persist in KV across worker restarts', async () => {
  resetVapidCache();
  const env = { DEVICES: kv(), CLEARHEAD_KEY: 'k' };
  const a = (await call(env, 'GET', '/api/vapid')).body.publicKey;
  resetVapidCache();
  const b = (await call(env, 'GET', '/api/vapid')).body.publicKey;
  assert.equal(a, b);
});

test('test endpoint pushes now; expired subscriptions are removed', async () => {
  resetVapidCache();
  const env = { DEVICES: kv(), CLEARHEAD_KEY: 'secret-key' };
  const pc = browserSubscription('wns2-par02p.notify.windows.com');
  await call(env, 'PUT', '/api/devices/device-pc-0001', { subscription: pc.json, name: 'PC', tz: 'UTC', schedule: [{ kind: 'quote', time: '09:00' }] });
  let cap = capturePushes(201);
  const t = await call(env, 'POST', '/api/devices/device-pc-0001/test', { kind: 'evening' });
  cap.restore();
  assert.deepEqual(t.body, { ok: true, status: 201 });
  assert.deepEqual(decrypt(cap.sent[0].init.body, pc), { kind: 'evening', test: true });

  cap = capturePushes(410);
  await runSchedule(env, new Date(Date.UTC(2026, 9, 5, 9, 0)));
  cap.restore();
  assert.deepEqual(JSON.parse(env.DEVICES.m.get('devices')), {}, 'gone device removed');
});

test('rejects wrong key, unknown push hosts and bad schedules', async () => {
  resetVapidCache();
  const env = { DEVICES: kv(), CLEARHEAD_KEY: 'secret-key' };
  const good = browserSubscription().json;
  assert.equal((await call(env, 'PUT', '/api/devices/device-x-0001', { subscription: good }, 'nope')).status, 401);
  assert.equal((await call(env, 'PUT', '/api/devices/device-x-0001', { subscription: { ...good, endpoint: 'https://evil.example.com/x' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/devices/device-x-0001', { subscription: { ...good, endpoint: 'http://fcm.googleapis.com/x' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/devices/device-x-0001', { subscription: good, schedule: [{ kind: 'morning', time: '25:00' }] })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/devices/device-x-0001', { subscription: good, tz: 'Mars/Olympus' })).status, 400);
  assert.equal((await call({ DEVICES: kv() }, 'PUT', '/api/devices/device-x-0001', { subscription: good })).status, 500, 'no key configured');
  assert.equal((await call({}, 'GET', '/api/vapid')).status, 500, 'no KV binding');
  const pre = await worker.fetch(new Request('https://w.dev/api/vapid', { method: 'OPTIONS' }), env);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
});
