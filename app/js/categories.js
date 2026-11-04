// Categories: a synced tree (up to 3 levels) shared by inbox items/actions, projects and Reference.
// Things hold `cats: [categoryId]` (several allowed). An action without its own categories
// inherits its project's. Pure logic, unit-tested in tests/categories.test.mjs.
import { live, openItems, findRefs } from './model.js';

export const MAX_DEPTH = 3;
export const UNCATEGORIZED = '_none';

const getCat = (doc, id) => {
  const c = doc.cats?.[id];
  return c && !c.deleted ? c : null;
};

export function catPath(doc, id) {
  const out = [];
  const seen = new Set();
  for (let c = getCat(doc, id); c && !seen.has(c.id); c = getCat(doc, c.parentId)) {
    seen.add(c.id);
    out.unshift(c);
  }
  return out;
}

export const catLabel = (doc, id) => catPath(doc, id).map((c) => c.name).join(' › ');
export const catDepth = (doc, id) => catPath(doc, id).length;

export function childCats(doc, parentId = null) {
  return live(doc.cats || {}).filter((c) => (c.parentId || null) === (parentId || null)).sort((a, b) => a.name.localeCompare(b.name));
}

// Depth-first list for rendering: [{ cat, depth }], roots first, alphabetical at each level.
// A category whose parent was deleted shows as a root.
export function catTree(doc) {
  const all = live(doc.cats || {});
  const isRoot = (c) => !c.parentId || !getCat(doc, c.parentId);
  const out = [];
  const walk = (list, depth) => {
    for (const c of list.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ cat: c, depth });
      walk(all.filter((k) => k.parentId === c.id), depth + 1);
    }
  };
  walk(all.filter(isRoot), 1);
  return out;
}

export function descendants(doc, id) {
  const out = new Set([id]);
  const all = live(doc.cats || {});
  for (let added = true; added;) {
    added = false;
    for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); added = true; }
  }
  return out;
}

// How many levels the subtree under `id` spans (1 = no children).
export function subtreeHeight(doc, id) {
  const kids = live(doc.cats || {}).filter((c) => c.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(doc, k.id))) : 0);
}

// Can category `id` (with its subtree) be placed under `parentId` (null = top level)?
export function canMove(doc, id, parentId) {
  if (!parentId) return subtreeHeight(doc, id) <= MAX_DEPTH;
  if (!getCat(doc, parentId) || descendants(doc, id).has(parentId)) return false;
  return catDepth(doc, parentId) + subtreeHeight(doc, id) <= MAX_DEPTH;
}

export function findCatByName(doc, name, parentId = null) {
  const n = name.trim().toLowerCase();
  return live(doc.cats || {}).find((c) => c.name.toLowerCase() === n && (c.parentId || null) === (parentId || null)) || null;
}

// "Work / Clients / Acme" → ['Work', 'Clients', 'Acme'].
export function splitPath(text) {
  return String(text || '').split(/\s*[/›>]\s*/).map((s) => s.trim()).filter(Boolean);
}

// Which parts of a path already exist, and what would need creating.
export function resolvePath(doc, names) {
  let parentId = null;
  const existing = [];
  for (let k = 0; k < names.length; k++) {
    const c = findCatByName(doc, names[k], parentId);
    if (!c) return { existing, missing: names.slice(k), parentId };
    existing.push(c);
    parentId = c.id;
  }
  return { existing, missing: [], parentId };
}

export function ownCats(doc, thing) {
  return (thing?.cats || []).filter((id) => getCat(doc, id));
}

// Actions inherit their project's categories when they have none of their own.
export function effectiveCats(doc, thing) {
  const own = ownCats(doc, thing);
  if (own.length || !thing?.projectId) return own;
  const p = doc.projects?.[thing.projectId];
  return p && !p.deleted ? ownCats(doc, p) : [];
}

// filter: '' (all), UNCATEGORIZED, or a category id (includes its sub-categories).
export function matchesCat(doc, thing, filter) {
  if (!filter) return true;
  const cats = effectiveCats(doc, thing);
  if (filter === UNCATEGORIZED) return cats.length === 0;
  const within = descendants(doc, filter);
  return cats.some((id) => within.has(id));
}

export function catStats(doc, id) {
  const inCat = (x) => matchesCat(doc, x, id);
  return {
    actions: openItems(doc).filter((i) => ['next', 'waiting', 'inbox'].includes(i.list) && inCat(i)).length,
    projects: live(doc.projects).filter((p) => p.status !== 'done' && inCat(p)).length,
    refs: live(doc.refs || {}).filter(inCat).length,
  };
}

// Reference search, also matching category names; optionally limited to a category.
export function searchRefs(doc, { q = '', cat = '', projectId = null, itemId = null } = {}) {
  const needle = q.trim().toLowerCase();
  return findRefs(doc, { projectId, itemId }).filter((r) => {
    if (!matchesCat(doc, r, cat)) return false;
    if (!needle) return true;
    return [r.title, r.url, r.note, r.file?.name, ...ownCats(doc, r).map((id) => catLabel(doc, id))]
      .some((f) => String(f || '').toLowerCase().includes(needle));
  });
}

const slug = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'tag';

// Old Reference tags become top-level categories. Ids are derived from the tag name so two
// devices migrating the same tag produce the same category instead of duplicates.
export function tagMigration(doc) {
  const newCats = {};
  const refs = [];
  for (const r of live(doc.refs || {})) {
    if (!(r.tags || []).length) continue;
    const ids = [...ownCats(doc, r)];
    for (const tag of r.tags) {
      const existing = findCatByName(doc, tag, null);
      const id = existing?.id || `tag-${slug(tag)}`;
      if (!existing && !getCat(doc, id) && !newCats[id]) newCats[id] = { id, name: tag.trim(), parentId: null };
      if (!ids.includes(id)) ids.push(id);
    }
    refs.push({ id: r.id, cats: ids });
  }
  return { cats: Object.values(newCats), refs };
}
