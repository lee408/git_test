import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { store } = await import('../app/js/store.js');
const { emptyDoc, merge } = await import('../app/js/model.js');
const {
  catTree, catLabel, catDepth, descendants, canMove, splitPath, resolvePath, effectiveCats, matchesCat, catStats,
  searchRefs, tagMigration, UNCATEGORIZED,
} = await import('../app/js/categories.js');

function fresh() {
  store.replaceAll(emptyDoc());
  const acme = store.ensureCatPath(['Work', 'Clients', 'Acme']);
  const garden = store.ensureCatPath(['Home', 'Garden']);
  const d = store.doc;
  const id = (name) => Object.values(d.cats).find((c) => c.name === name).id;
  return { acme, garden, work: id('Work'), clients: id('Clients'), home: id('Home') };
}

test('paths, tree order, depth limit and path parsing', () => {
  const c = fresh();
  const d = store.doc;
  assert.equal(catLabel(d, c.acme), 'Work › Clients › Acme');
  assert.equal(catDepth(d, c.acme), 3);
  assert.deepEqual(catTree(d).map((x) => `${x.depth}:${x.cat.name}`), ['1:Home', '2:Garden', '1:Work', '2:Clients', '3:Acme']);
  assert.equal(store.ensureCatPath(['work', 'CLIENTS']), c.clients, 'existing levels matched case-insensitively');
  assert.throws(() => store.ensureCatPath(['Work', 'Clients', 'Acme', 'Too deep']), /3 levels/);
  assert.deepEqual(splitPath(' Work / Clients › Acme '), ['Work', 'Clients', 'Acme']);
  const r = resolvePath(d, ['Work', 'Clients', 'Beta']);
  assert.deepEqual(r.existing.map((x) => x.name), ['Work', 'Clients']);
  assert.deepEqual(r.missing, ['Beta']);
});

test('several categories per item, project inheritance, filters include sub-categories', () => {
  const c = fresh();
  const p = store.addProject({ title: 'Website', cats: [c.clients] });
  const own = store.addItem({ title: 'Mow lawn', list: 'next', cats: [c.garden, c.acme] });
  const inherits = store.addItem({ title: 'Draft homepage', list: 'next', projectId: p.id });
  const none = store.addItem({ title: 'Random', list: 'inbox' });
  const d = store.doc;
  assert.deepEqual(effectiveCats(d, d.items[inherits.id]), [c.clients]);
  assert.ok(matchesCat(d, d.items[own.id], c.home), 'Home includes Garden');
  assert.ok(matchesCat(d, d.items[own.id], c.work), 'and Work via Acme');
  assert.ok(matchesCat(d, d.items[inherits.id], c.work));
  assert.ok(!matchesCat(d, d.items[inherits.id], c.home));
  assert.ok(matchesCat(d, d.items[none.id], UNCATEGORIZED));
  assert.ok(matchesCat(d, d.items[none.id], ''));
  assert.deepEqual(catStats(d, c.work), { actions: 2, projects: 1, refs: 0 });
});

test('move respects depth and cycles; rename clash; merge; delete moves things up', () => {
  const c = fresh();
  const d = () => store.doc;
  assert.ok(!canMove(d(), c.work, c.acme), 'no cycles');
  assert.ok(!canMove(d(), c.clients, c.garden), 'Home›Garden›Clients›Acme would be 4 deep');
  assert.ok(canMove(d(), c.garden, c.work));
  assert.throws(() => store.moveCat(c.clients, c.garden), /levels deep/);
  store.ensureCatPath(['Home', 'Clients']);
  assert.throws(() => store.renameCat(c.garden, 'Clients'), /Merge/);

  const item = store.addItem({ title: 'Invoice Acme', list: 'next', cats: [c.acme, c.garden] });
  store.deleteCat(c.clients);
  assert.equal(d().cats[c.acme].parentId, c.work, 'sub-category moves up');
  store.deleteCat(c.acme);
  assert.deepEqual(d().items[item.id].cats, [c.work, c.garden], 'item moves up to the parent');
  store.mergeCat(c.garden, c.work);
  assert.deepEqual(d().items[item.id].cats, [c.work], 'merged and deduped');
  assert.ok(d().cats[c.garden].deleted);
  store.deleteCat(c.work);
  assert.deepEqual(d().items[item.id].cats, [], 'top-level delete leaves it uncategorised');
});

test('Reference tags migrate to shared categories, deterministically', () => {
  const d = emptyDoc();
  d.refs.a = { id: 'a', title: 'Boiler manual', tags: ['Home', 'Manuals'], createdAt: 1, updatedAt: 1 };
  d.refs.b = { id: 'b', title: 'Policy', tags: ['home'], createdAt: 2, updatedAt: 1 };
  const m1 = tagMigration(d);
  const m2 = tagMigration(structuredClone(d));
  assert.deepEqual(m1.cats.map((c) => c.id), m2.cats.map((c) => c.id), 'same ids on every device');
  assert.deepEqual(m1.cats.map((c) => c.name), ['Home', 'Manuals']);
  assert.deepEqual(m1.refs.find((r) => r.id === 'b').cats, [m1.cats[0].id]);

  store.replaceAll(d); // runs the migration
  const s = store.doc;
  assert.deepEqual(s.refs.a.tags, []);
  assert.equal(searchRefs(s, { q: 'manuals' }).length, 1, 'search matches category names');
  const home = Object.values(s.cats).find((c) => c.name === 'Home').id;
  assert.deepEqual(searchRefs(s, { cat: home }).map((r) => r.id).sort(), ['a', 'b']);
  const other = emptyDoc();
  other.cats.x = { id: 'x', name: 'Health', parentId: null, updatedAt: 9 };
  assert.ok(merge(s, other).cats.x, 'categories sync');
});

test('descendants', () => {
  const c = fresh();
  assert.deepEqual([...descendants(store.doc, c.work)].length, 3);
});
