import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDoc, parseCapture, parseDateWord, vagueHint, merge, sameDoc, suggestNow, reviewStatus,
  nextActions, projectHealth, purgeTombstones, addDays,
} from '../app/js/model.js';

// 2026-10-03 is a Saturday.
const TODAY = '2026-10-03';

test('parseDateWord handles relative words and formats', () => {
  assert.equal(parseDateWord('today', TODAY), '2026-10-03');
  assert.equal(parseDateWord('tmr', TODAY), '2026-10-04');
  assert.equal(parseDateWord('mon', TODAY), '2026-10-05');
  assert.equal(parseDateWord('sat', TODAY), '2026-10-10', 'same weekday means next week');
  assert.equal(parseDateWord('+3d', TODAY), '2026-10-06');
  assert.equal(parseDateWord('+2w', TODAY), '2026-10-17');
  assert.equal(parseDateWord('25/12', TODAY), '2026-12-25');
  assert.equal(parseDateWord('1/1', TODAY), '2027-01-01', 'past day/month rolls into next year');
  assert.equal(parseDateWord('2027-02-03', TODAY), '2027-02-03');
  assert.equal(parseDateWord('banana', TODAY), null);
});

test('parseCapture extracts shorthand and keeps the rest as title', () => {
  const p = parseCapture('Call Sam about invoice @phone @Admin +Tax_return ~1h30m !low due:fri start:+2d', TODAY);
  assert.equal(p.title, 'Call Sam about invoice');
  assert.deepEqual(p.contexts, ['phone', 'admin']);
  assert.equal(p.project, 'Tax return');
  assert.equal(p.timeMin, 90);
  assert.equal(p.energy, 'low');
  assert.equal(p.due, '2026-10-09');
  assert.equal(p.start, '2026-10-05');
});

test('parseCapture leaves unrecognised tokens in the title', () => {
  const p = parseCapture('Email a@b.com re 2+2 ~soon due:someday', TODAY);
  assert.equal(p.title, 'Email a@b.com re 2+2 ~soon due:someday');
  assert.equal(p.due, null);
  assert.equal(p.timeMin, null);
});

test('vagueHint flags fuzzy verbs and bare topics, not concrete actions', () => {
  assert.match(vagueHint('Sort out car'), /sort out/);
  assert.match(vagueHint('Look into pensions'), /look into/);
  assert.match(vagueHint('Taxes'), /topic/);
  assert.equal(vagueHint('Call garage to book MOT'), null);
  assert.equal(vagueHint('Buy milk'), null);
  assert.equal(vagueHint('Email Jo the draft budget'), null);
});

function item(id, fields = {}) {
  return { id, title: id, list: 'next', contexts: [], done: false, createdAt: 1, updatedAt: 1, ...fields };
}

test('merge keeps the newest version of each record and unions the rest', () => {
  const a = emptyDoc();
  const b = emptyDoc();
  a.items.x = item('x', { title: 'old', updatedAt: 5 });
  b.items.x = item('x', { title: 'new', updatedAt: 9 });
  a.items.onlyA = item('onlyA');
  b.items.onlyB = item('onlyB');
  b.settings = { ...b.settings, contexts: ['home'], updatedAt: 3 };
  const m = merge(a, b);
  assert.equal(m.items.x.title, 'new');
  assert.ok(m.items.onlyA && m.items.onlyB);
  assert.deepEqual(m.settings.contexts, ['home']);
  assert.deepEqual(merge(b, a), m, 'merge is order independent');
});

test('deletions win over older edits and survive merge', () => {
  const a = emptyDoc();
  const b = emptyDoc();
  a.items.x = { id: 'x', deleted: true, updatedAt: 10 };
  b.items.x = item('x', { updatedAt: 7 });
  assert.equal(merge(a, b).items.x.deleted, true);
  assert.equal(merge(b, a).items.x.deleted, true);
});

test('sameDoc detects when an upload is needed', () => {
  const a = emptyDoc();
  a.items.x = item('x');
  const b = structuredClone(a);
  assert.ok(sameDoc(a, b));
  b.items.x.updatedAt = 2;
  assert.ok(!sameDoc(a, b));
});

test('purgeTombstones removes only old deletions', () => {
  const d = emptyDoc();
  const now = Date.now();
  d.items.old = { id: 'old', deleted: true, updatedAt: now - 200 * 86400000 };
  d.items.recent = { id: 'recent', deleted: true, updatedAt: now - 10 * 86400000 };
  purgeTombstones(d, now);
  assert.ok(!d.items.old);
  assert.ok(d.items.recent);
});

test('suggestNow filters by context, time, energy and defers', () => {
  const d = emptyDoc();
  d.items.a = item('a', { contexts: ['home'], timeMin: 10, energy: 'low' });
  d.items.b = item('b', { contexts: ['office'] });
  d.items.c = item('c', { timeMin: 60 });
  d.items.d = item('d', { energy: 'high' });
  d.items.e = item('e', { start: addDays(TODAY, 1) });
  d.items.f = item('f', { list: 'someday' });
  d.items.g = item('g', { done: true });
  const ids = (ctx) => suggestNow(d, TODAY, ctx).map((i) => i.id).sort();
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ contexts: ['home'] }), ['a', 'c', 'd'], 'context-free actions fit anywhere');
  assert.deepEqual(ids({ contexts: ['home'], timeMin: 15, energy: 'low' }), ['a']);
});

test('suggestNow puts focus and overdue first', () => {
  const d = emptyDoc();
  d.items.plain = item('plain');
  d.items.overdue = item('overdue', { due: addDays(TODAY, -1) });
  d.items.focus = item('focus', { focus: true });
  assert.deepEqual(suggestNow(d, TODAY).map((i) => i.id), ['focus', 'overdue', 'plain']);
});

test('actions in someday projects are hidden from next actions; stalled projects detected', () => {
  const d = emptyDoc();
  d.projects.p1 = { id: 'p1', title: 'Active', status: 'active', updatedAt: 1 };
  d.projects.p2 = { id: 'p2', title: 'Parked', status: 'someday', updatedAt: 1 };
  d.projects.p3 = { id: 'p3', title: 'Stalled', status: 'active', updatedAt: 1 };
  d.items.a = item('a', { projectId: 'p1' });
  d.items.b = item('b', { projectId: 'p2' });
  assert.deepEqual(nextActions(d, TODAY).map((i) => i.id), ['a']);
  assert.equal(projectHealth(d, d.projects.p1, TODAY).stalled, false);
  assert.equal(projectHealth(d, d.projects.p3, TODAY).stalled, true);
});

test('reviewStatus: due from review day until a review is logged, with streak', () => {
  const d = emptyDoc(); // reviewDay = 1 (Monday)
  // Saturday 2026-10-03: period started Monday 2026-09-28.
  let rs = reviewStatus(d, TODAY);
  assert.equal(rs.due, true);
  assert.equal(rs.periodStart, '2026-09-28');
  assert.equal(rs.daysLate, 5);
  d.reviews.r1 = { id: 'r1', day: '2026-09-21', updatedAt: 1 };
  d.reviews.r2 = { id: 'r2', day: '2026-09-29', updatedAt: 1 };
  rs = reviewStatus(d, TODAY);
  assert.equal(rs.due, false);
  assert.equal(rs.streak, 2);
  rs = reviewStatus(d, '2026-10-05'); // next Monday
  assert.equal(rs.due, true);
  assert.equal(rs.streak, 2, 'streak not broken until the period is missed');
});
