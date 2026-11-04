// Local-first persistence. The whole GTD document lives in localStorage on each device;
// sync.js merges it with the copy in Dropbox.
import { emptyDoc, normalizeDoc, merge, stamp, uid, purgeTombstones, isoDay, activationPatch } from './model.js';
import { MAX_DEPTH, catDepth, canMove, findCatByName, descendants, tagMigration } from './categories.js';

const DOC_KEY = 'clearhead.doc.v1';
const listeners = new Set();
let doc = load();
migrateTags();

// Reference tags (older versions) become categories; returns true if anything changed.
function migrateTags() {
  const m = tagMigration(doc);
  if (!m.refs.length) return false;
  const now = Date.now();
  for (const c of m.cats) doc.cats[c.id] = { ...c, createdAt: now, updatedAt: now };
  for (const { id, cats } of m.refs) doc.refs[id] = { ...doc.refs[id], cats, tags: [], updatedAt: stamp(doc.refs[id]) };
  persist();
  return true;
}

// Replace category `from` with `to` (or drop it when `to` is null) on every item, project and reference.
function remapCats(from, to) {
  for (const k of ['items', 'projects', 'refs']) {
    for (const r of Object.values(doc[k])) {
      if (r.deleted || !(r.cats || []).includes(from)) continue;
      const cats = [...new Set(r.cats.map((c) => (c === from ? to : c)).filter(Boolean))];
      doc[k][r.id] = { ...r, cats, updatedAt: stamp(r) };
    }
  }
}

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
    if (migrateTags()) { changed(); return doc; }
    changed({ local: false });
    return doc;
  },

  replaceAll(other) {
    doc = normalizeDoc(other);
    migrateTags();
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

  // Follow-ups released by the most recent completion (for the UI to announce).
  lastActivated: [],

  updateItem(id, patch) {
    const prev = doc.items[id];
    if (!prev) return null;
    const next = { ...prev, ...patch, updatedAt: stamp(prev) };
    if (patch.done === true && !prev.done) next.completedAt = Date.now();
    if (patch.done === false) next.completedAt = null;
    if (patch.list === 'waiting' && prev.list !== 'waiting') next.waitingSince = Date.now();
    doc.items[id] = next;
    this.lastActivated = [];
    if (patch.done === true && !prev.done) {
      // Release "then do" follow-ups parked behind this action.
      for (const f of Object.values(doc.items)) {
        if (f.deleted || f.done || f.after !== id) continue;
        doc.items[f.id] = { ...f, ...activationPatch(f, id, isoDay(new Date())), updatedAt: stamp(f) };
        this.lastActivated.push(doc.items[f.id]);
      }
    } else if (patch.done === false && prev.done) {
      // Undo: park again whatever this completion released and hasn't been done since.
      for (const f of Object.values(doc.items)) {
        if (!f.deleted && !f.done && f.activatedBy === id) doc.items[f.id] = { ...f, after: id, activatedBy: null, updatedAt: stamp(f) };
      }
    }
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
    // Follow-ups of a deleted action become ordinary actions rather than vanishing.
    for (const f of Object.values(doc.items)) {
      if (!f.deleted && f.after === id) doc.items[f.id] = { ...f, after: null, updatedAt: stamp(f) };
    }
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

  addRef(fields) {
    const now = Date.now();
    const r = { id: uid(), kind: 'note', title: '', url: '', note: '', tags: [], projectId: null, itemId: null, file: null, createdAt: now, ...fields, updatedAt: now };
    doc.refs[r.id] = r;
    changed();
    return r;
  },

  updateRef(id, patch) {
    const prev = doc.refs[id];
    if (!prev || prev.deleted) return null;
    doc.refs[id] = { ...prev, ...patch, updatedAt: stamp(prev) };
    changed();
    return doc.refs[id];
  },

  deleteRef(id) {
    const prev = doc.refs[id];
    if (!prev) return;
    doc.refs[id] = { id, deleted: true, updatedAt: stamp(prev) };
    changed();
  },

  // ---------- categories ----------
  // Finds or creates each level of a path like ['Work', 'Clients']; returns the last id.
  ensureCatPath(names, parentId = null) {
    if (catDepth(doc, parentId) + names.length > MAX_DEPTH) throw new Error(`Categories go ${MAX_DEPTH} levels deep at most.`);
    let created = false;
    for (const name of names) {
      let c = findCatByName(doc, name, parentId);
      if (!c) {
        const now = Date.now();
        c = { id: uid(), name: name.trim().slice(0, 60), parentId, createdAt: now, updatedAt: now };
        doc.cats[c.id] = c;
        created = true;
      }
      parentId = c.id;
    }
    if (created) changed();
    return parentId;
  },

  renameCat(id, name) {
    const prev = doc.cats[id];
    const n = name.trim().slice(0, 60);
    if (!prev || prev.deleted || !n) return false;
    const clash = findCatByName(doc, n, prev.parentId || null);
    if (clash && clash.id !== id) throw new Error(`There's already a "${n}" there. Use Merge instead.`);
    doc.cats[id] = { ...prev, name: n, updatedAt: stamp(prev) };
    changed();
    return true;
  },

  moveCat(id, parentId) {
    const prev = doc.cats[id];
    if (!prev || prev.deleted) return false;
    if (!canMove(doc, id, parentId || null)) throw new Error(`That would put it inside itself or more than ${MAX_DEPTH} levels deep.`);
    const clash = findCatByName(doc, prev.name, parentId || null);
    if (clash && clash.id !== id) throw new Error(`There's already a "${prev.name}" there. Use Merge instead.`);
    doc.cats[id] = { ...prev, parentId: parentId || null, updatedAt: stamp(prev) };
    changed();
    return true;
  },

  // Everything in `from` moves to `into`; `from`'s sub-categories move under `into`.
  mergeCat(from, into) {
    if (from === into || !doc.cats[from] || !doc.cats[into]) return false;
    if (descendants(doc, from).has(into)) throw new Error('Can\'t merge a category into one of its own sub-categories.');
    const kids = Object.values(doc.cats).filter((c) => !c.deleted && c.parentId === from);
    for (const k of kids) if (!canMove(doc, k.id, into)) throw new Error(`Merging would go more than ${MAX_DEPTH} levels deep.`);
    for (const k of kids) {
      const clash = findCatByName(doc, k.name, into);
      if (clash) this.mergeCat(k.id, clash.id);
      else doc.cats[k.id] = { ...k, parentId: into, updatedAt: stamp(k) };
    }
    remapCats(from, into);
    doc.cats[from] = { id: from, deleted: true, updatedAt: stamp(doc.cats[from]) };
    changed();
    return true;
  },

  // Items and sub-categories move up to the parent (or become uncategorised / top level).
  deleteCat(id) {
    const prev = doc.cats[id];
    if (!prev || prev.deleted) return;
    const parentId = prev.parentId && doc.cats[prev.parentId] && !doc.cats[prev.parentId].deleted ? prev.parentId : null;
    for (const k of Object.values(doc.cats)) {
      if (k.deleted || k.parentId !== id) continue;
      const clash = findCatByName(doc, k.name, parentId);
      if (clash && clash.id !== k.id) { this.mergeCat(k.id, clash.id); continue; }
      doc.cats[k.id] = { ...k, parentId, updatedAt: stamp(k) };
    }
    remapCats(id, parentId);
    doc.cats[id] = { id, deleted: true, updatedAt: stamp(prev) };
    changed();
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
