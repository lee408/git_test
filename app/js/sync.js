// Dropbox sync using OAuth PKCE (no client secret, no server).
// Data goes to /Apps/<your app name>/clearhead.json in your own Dropbox.
import { store, prefs } from './store.js';
import { sameDoc } from './model.js';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DL_URL = 'https://content.dropboxapi.com/2/files/download';
const UL_URL = 'https://content.dropboxapi.com/2/files/upload';
const FILE = '/clearhead.json';

const statusListeners = new Set();
let status = { state: 'idle', message: '' };
let running = null;
let pending = false;

function setStatus(state, message = '') {
  status = { state, message, at: Date.now() };
  for (const fn of statusListeners) fn(status);
}

export const sync = {
  get status() { return status; },
  onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
  get appKey() { return prefs.get('dbx.appKey', ''); },
  set appKey(v) { prefs.set('dbx.appKey', v.trim() || null); },
  get connected() { return !!prefs.get('dbx.refresh', null); },
  get lastSync() { return prefs.get('dbx.lastSync', null); },
  redirectUri,
  connect,
  disconnect,
  handleRedirect,
  run,
  schedule,
};

function redirectUri() {
  return location.origin + location.pathname;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function connect() {
  const key = sync.appKey;
  if (!key) throw new Error('Enter your Dropbox app key first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  prefs.set('dbx.pkce', { verifier, state });
  const q = new URLSearchParams({
    client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    token_access_type: 'offline', redirect_uri: redirectUri(), state,
  });
  location.href = `${AUTH_URL}?${q}`;
}

function disconnect() {
  for (const k of ['dbx.refresh', 'dbx.access', 'dbx.lastSync', 'dbx.rev']) prefs.set(k, null);
  setStatus('idle', 'Disconnected');
}

// Call on startup. Returns true if this page load was the OAuth redirect.
async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const err = params.get('error');
  if (!code && !err) return false;
  history.replaceState(null, '', redirectUri());
  const pkce = prefs.get('dbx.pkce', null);
  prefs.set('dbx.pkce', null);
  if (err) { setStatus('error', `Dropbox: ${params.get('error_description') || err}`); return true; }
  if (!pkce || pkce.state !== params.get('state')) { setStatus('error', 'Sign-in state mismatch, please try again.'); return true; }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: sync.appKey,
      code_verifier: pkce.verifier, redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) { setStatus('error', `Dropbox sign-in failed (${res.status})`); return true; }
  const tok = await res.json();
  prefs.set('dbx.refresh', tok.refresh_token);
  prefs.set('dbx.access', { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
  setStatus('idle', 'Connected to Dropbox');
  return true;
}

async function accessToken() {
  const cur = prefs.get('dbx.access', null);
  if (cur && cur.exp > Date.now()) return cur.token;
  const refresh = prefs.get('dbx.refresh', null);
  if (!refresh) throw new Error('Not connected');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: sync.appKey }),
  });
  if (res.status === 400 || res.status === 401) {
    disconnect();
    throw new Error('Dropbox access was revoked. Reconnect in Settings.');
  }
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const tok = await res.json();
  prefs.set('dbx.access', { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
  return tok.access_token;
}

async function download(token) {
  const res = await fetch(DL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: FILE }) },
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    if (String(body.error_summary || '').startsWith('path/not_found')) return null;
    throw new Error(`Download failed: ${body.error_summary || res.status}`);
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const meta = JSON.parse(res.headers.get('Dropbox-API-Result') || '{}');
  return { doc: await res.json(), rev: meta.rev };
}

class Conflict extends Error {}

async function upload(token, doc, rev) {
  const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' };
  const res = await fetch(UL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: FILE, mode, autorename: false, mute: true }),
    },
    body: JSON.stringify(doc),
  });
  if (res.status === 409) throw new Conflict();
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return (await res.json()).rev;
}

async function runOnce() {
  const token = await accessToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await download(token);
    if (remote) store.mergeIn(remote.doc);
    const local = store.doc;
    if (remote && sameDoc(local, remote.doc)) return;
    try {
      await upload(token, local, remote?.rev);
      return;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      // Another device wrote in between: download, merge and try again.
    }
  }
  throw new Error('Sync kept conflicting, will retry shortly.');
}

// Runs a sync now; concurrent calls coalesce into one follow-up run.
async function run() {
  if (!sync.connected) return;
  if (!navigator.onLine) { setStatus('offline', 'Offline: changes are saved on this device'); return; }
  if (running) { pending = true; return running; }
  setStatus('syncing');
  running = (async () => {
    try {
      await runOnce();
      prefs.set('dbx.lastSync', Date.now());
      setStatus('ok');
    } catch (e) {
      setStatus('error', e.message);
    } finally {
      running = null;
      if (pending) { pending = false; run(); }
    }
  })();
  return running;
}

let timer = null;
function schedule(delay = 2500) {
  if (!sync.connected) return;
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}
