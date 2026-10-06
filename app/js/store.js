// Local-first persistence. The whole GTD document lives in localStorage on each device;
// sync.js merges it with the copy in Dropbox.
import { emptyDoc, normalizeDoc, merge, stamp, uid, purgeTombstones } from './model.js';

const DOC_KEY = 'clearhead.doc.v1';
const listeners = new Set();
let doc = load();

function load() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    return raw ? normalizeDoc(JSON.parse(raw)) : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

function persist() {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch (e) {
    console.error('Could not save', e);
  }
}

function changed({ local = true } = {}) {
  persist();
  for (const fn of listeners) fn({ local });
}

export const store = {
  get doc() { return doc; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Merge a document from elsewhere (sync or import). Returns the merged doc.
  mergeIn(other) {
    doc = purgeTombstones(merge(doc, normalizeDoc(other)));
    changed({ local: false });
    return doc;
  },

  replaceAll(other) {
    doc = normalizeDoc(other);
    changed();
  },

  addItem(fields) {
    const now = Date.now();
    const item = {
      id: uid(), title: '', notes: '', list: 'inbox', contexts: [], projectId: null,
      timeMin: null, energy: null, due: null, start: null, waitingOn: '', focus: false,
      done: false, completedAt: null, createdAt: now, ...fields, updatedAt: now,
    };
    doc.items[item.id] = item;
    changed();
    return item;
  },

  updateItem(id, patch) {
    const prev = doc.items[id];
    if (!prev) return null;
    const next = { ...prev, ...patch, updatedAt: stamp(prev) };
    if (patch.done === true && !prev.done) next.completedAt = Date.now();
    if (patch.done === false) next.completedAt = null;
    if (patch.list === 'waiting' && prev.list !== 'waiting') next.waitingSince = Date.now();
    doc.items[id] = next;
    changed();
    return next;
  },

  restoreItem(rec) {
    doc.items[rec.id] = { ...rec, deleted: false, updatedAt: stamp(doc.items[rec.id]) };
    changed();
  },

  deleteItem(id) {
    const prev = doc.items[id];
    if (!prev) return;
    doc.items[id] = { id, deleted: true, updatedAt: stamp(prev) };
    changed();
  },

  addProject(fields) {
    const now = Date.now();
    const p = { id: uid(), title: '', outcome: '', notes: '', status: 'active', createdAt: now, ...fields, updatedAt: now };
    doc.projects[p.id] = p;
    changed();
    return p;
  },

  updateProject(id, patch) {
    const prev = doc.projects[id];
    if (!prev) return null;
    doc.projects[id] = { ...prev, ...patch, updatedAt: stamp(prev) };
    changed();
    return doc.projects[id];
  },

  deleteProject(id) {
    const prev = doc.projects[id];
    if (!prev) return;
    // Actions survive as standalone next actions.
    for (const i of Object.values(doc.items)) {
      if (i.projectId === id && !i.deleted) doc.items[i.id] = { ...i, projectId: null, updatedAt: stamp(i) };
    }
    doc.projects[id] = { id, deleted: true, updatedAt: stamp(prev) };
    changed();
  },

  findOrCreateProject(name) {
    const n = name.trim().toLowerCase();
    const existing = Object.values(doc.projects).find((p) => !p.deleted && p.title.toLowerCase() === n)
      || Object.values(doc.projects).find((p) => !p.deleted && p.status === 'active' && p.title.toLowerCase().startsWith(n));
    return existing || this.addProject({ title: name.trim() });
  },

  updateSettings(patch) {
    doc.settings = { ...doc.settings, ...patch, updatedAt: stamp(doc.settings) };
    changed();
  },

  // Miracle Morning: merge step results into that day's practice record.
  updatePractice(day, patch) {
    const prev = doc.practice[day];
    const base = prev && !prev.deleted ? prev : { id: day, day, done: {}, createdAt: Date.now() };
    doc.practice[day] = { ...base, ...patch, done: { ...base.done, ...(patch.done || {}) }, updatedAt: stamp(prev) };
    changed();
    return doc.practice[day];
  },

  completeReview(day) {
    const r = { id: uid(), day, createdAt: Date.now(), updatedAt: Date.now() };
    doc.reviews[r.id] = r;
    changed();
  },
};

// Small per-device preferences (not synced): current view, Now filters, sync tokens.
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('clearhead.pref.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === undefined || value === null) localStorage.removeItem('clearhead.pref.' + key);
      else localStorage.setItem('clearhead.pref.' + key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
  },
};
