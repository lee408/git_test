import test from 'node:test';
import assert from 'node:assert/strict';

// store.js persists to localStorage; give it an in-memory one.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { store } = await import('../app/js/store.js');
const {
  emptyDoc, isParked, openItems, nextActions, inboxItems, followUpsOf, wouldCycle, projectHealth, isoDay, addDays,
  findRefs, refTags, parseTags, merge,
} = await import('../app/js/model.js');

const today = isoDay(new Date());

test('follow-ups stay parked until their predecessor is done, then activate', () => {
  store.replaceAll(emptyDoc());
  const p = store.addProject({ title: 'Kitchen' });
  const a = store.addItem({ title: 'Get quote from plumber', list: 'next', projectId: p.id });
  const b = store.addItem({ title: 'Email quote to Sam', list: 'next', after: a.id, afterOffset: 2 });
  const w = store.addItem({ title: 'Reply from Sam', list: 'waiting', waitingOn: 'Sam', after: b.id, afterOffset: 7 });
  const d = store.doc;
  assert.ok(isParked(d, d.items[b.id]) && isParked(d, d.items[w.id]));
  assert.deepEqual(openItems(d).map((i) => i.id), [a.id], 'parked items hidden everywhere');
  assert.deepEqual(nextActions(d, today).map((i) => i.id), [a.id]);
  assert.deepEqual(followUpsOf(d, a.id).map((i) => i.id), [b.id]);

  store.updateItem(a.id, { done: true });
  assert.deepEqual(store.lastActivated.map((i) => i.id), [b.id]);
  const b1 = store.doc.items[b.id];
  assert.equal(b1.after, null);
  assert.equal(b1.activatedBy, a.id);
  assert.equal(b1.start, addDays(today, 2), 'offset becomes a start date');
  assert.ok(isParked(store.doc, store.doc.items[w.id]), 'chain continues: waiting still parked behind b');
  assert.ok(projectHealth(store.doc, store.doc.projects[p.id], today).stalled, 'cross-project follow-up does not count for Kitchen');

  store.updateItem(b.id, { done: true });
  const w1 = store.doc.items[w.id];
  assert.equal(w1.list, 'waiting');
  assert.equal(w1.due, addDays(today, 7), 'waiting-for gets a check-back date');
  assert.ok(w1.waitingSince);
});

test('undoing a completion parks the released follow-ups again', () => {
  store.replaceAll(emptyDoc());
  const a = store.addItem({ title: 'A', list: 'next' });
  const b = store.addItem({ title: 'B', list: 'next', after: a.id });
  store.updateItem(a.id, { done: true });
  assert.equal(store.doc.items[b.id].after, null);
  store.updateItem(a.id, { done: false });
  assert.equal(store.doc.items[b.id].after, a.id);
  assert.ok(isParked(store.doc, store.doc.items[b.id]));
});

test('deleting a predecessor releases its follow-ups', () => {
  store.replaceAll(emptyDoc());
  const a = store.addItem({ title: 'A', list: 'next' });
  const b = store.addItem({ title: 'B', list: 'inbox', after: a.id });
  store.deleteItem(a.id);
  assert.equal(store.doc.items[b.id].after, null);
  assert.deepEqual(inboxItems(store.doc).map((i) => i.id), [b.id]);
});

test('wouldCycle prevents loops', () => {
  const d = emptyDoc();
  d.items.a = { id: 'a', after: null };
  d.items.b = { id: 'b', after: 'a' };
  d.items.c = { id: 'c', after: 'b' };
  assert.ok(wouldCycle(d, 'a', 'c'), 'a after c would loop');
  assert.ok(wouldCycle(d, 'a', 'a'), 'self');
  assert.ok(!wouldCycle(d, 'd', 'c'));
});

test('reference search, tags and sync', () => {
  const d = emptyDoc();
  d.refs.r1 = { id: 'r1', kind: 'link', title: 'Boiler manual', url: 'https://example.com/boiler.pdf', tags: ['Home', 'Manuals'], projectId: 'p1', createdAt: 1, updatedAt: 1 };
  d.refs.r2 = { id: 'r2', kind: 'file', title: 'Car insurance', file: { name: 'policy-2026.pdf' }, tags: ['car', 'Finance'], createdAt: 2, updatedAt: 1 };
  d.refs.r3 = { id: 'r3', deleted: true, updatedAt: 1 };
  assert.deepEqual(refTags(d), ['car', 'Finance', 'Home', 'Manuals']);
  assert.deepEqual(findRefs(d).map((r) => r.id), ['r2', 'r1'], 'newest first, deleted hidden');
  assert.deepEqual(findRefs(d, { tag: 'home' }).map((r) => r.id), ['r1']);
  assert.deepEqual(findRefs(d, { q: 'policy' }).map((r) => r.id), ['r2'], 'searches file names');
  assert.deepEqual(findRefs(d, { projectId: 'p1' }).map((r) => r.id), ['r1']);
  assert.deepEqual(parseTags(' Home, #car,home ,, Finance'), ['home', 'car', 'Finance'], 'deduped case-insensitively (last spelling wins)');
  const other = emptyDoc();
  other.refs.r4 = { id: 'r4', title: 'x', updatedAt: 5 };
  assert.ok(merge(d, other).refs.r4 && merge(d, other).refs.r1);
});
