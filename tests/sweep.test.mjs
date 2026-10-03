import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc } from '../app/js/model.js';
import { buildSweep, splitLines } from '../app/js/sweep.js';

const TODAY = '2026-10-03';

test('splitLines gives one entry per line and strips bullets', () => {
  assert.deepEqual(splitLines('- Call mum\n\n* Buy bulbs @errands\n1. Renew passport\n[ ] Fix bike\n  • Book dentist  '),
    ['Call mum', 'Buy bulbs @errands', 'Renew passport', 'Fix bike', 'Book dentist']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines(undefined), []);
});

test('buildSweep covers every area and adds a card per active project, stalled first', () => {
  const d = emptyDoc();
  d.projects.a = { id: 'a', title: 'Alpha', outcome: 'Alpha shipped', status: 'active', updatedAt: 1 };
  d.projects.b = { id: 'b', title: 'Beta', status: 'active', updatedAt: 1 };
  d.projects.c = { id: 'c', title: 'Parked', status: 'someday', updatedAt: 1 };
  d.items.x = { id: 'x', title: 'Email Sam the spec', list: 'next', projectId: 'a', done: false, createdAt: 1, updatedAt: 1 };
  d.items.y = { id: 'y', title: 'Quote', list: 'waiting', waitingOn: 'Builder', projectId: 'a', done: false, createdAt: 1, updatedAt: 1 };
  const cards = buildSweep(d, TODAY);
  const areas = new Set(cards.map((c) => c.area));
  for (const a of ['Clear your head', 'Look back', 'Look ahead', 'Project', 'Projects', 'Work', 'Home & admin', 'People & personal', 'Last sweep']) {
    assert.ok(areas.has(a), `missing area ${a}`);
  }
  const proj = cards.filter((c) => c.area === 'Project');
  assert.deepEqual(proj.map((c) => c.projectId), ['b', 'a'], 'stalled Beta first, someday project excluded');
  assert.equal(proj[0].stalled, true);
  assert.match(proj[0].hints.join(' '), /No next action/);
  const alpha = proj[1].hints.join(' ');
  assert.match(alpha, /Alpha shipped/);
  assert.match(alpha, /Email Sam the spec/);
  assert.match(alpha, /Builder/);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, 'ids are unique');
});
