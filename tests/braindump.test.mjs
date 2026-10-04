import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrainDump, GATHER, TRIGGERS, TRIAGE, triagePatch } from '../app/js/braindump.js';
import { buildSweep } from '../app/js/sweep.js';
import { emptyDoc } from '../app/js/model.js';

test('brain dump gathers first, then the trigger list, with unique ids', () => {
  const cards = buildBrainDump();
  assert.equal(cards.length, GATHER.length + TRIGGERS.length);
  assert.ok(cards.length >= 50, 'deep trigger list');
  const firstTrigger = cards.findIndex((c) => c.stage === 'trigger');
  assert.ok(cards.slice(0, firstTrigger).every((c) => c.stage === 'gather'));
  assert.ok(cards.slice(firstTrigger).every((c) => c.stage === 'trigger'));
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  for (const area of ['Physical stuff', 'Digital stuff', 'Work', 'Home', 'Money & admin', 'Health', 'People', 'Errands', 'Plans']) {
    assert.ok(cards.some((c) => c.area === area), `missing ${area}`);
  }
  for (const c of cards) assert.ok(c.q && c.hints.length >= 2, c.id);
});

test('brain dump ids never clash with weekly sweep ids', () => {
  const sweepIds = new Set(buildSweep(emptyDoc(), '2026-10-04').map((c) => c.id));
  assert.ok(buildBrainDump().every((c) => !sweepIds.has(c.id)));
});

test('triage choices have unique keys and the right patches', () => {
  assert.equal(new Set(TRIAGE.map((t) => t.key)).size, TRIAGE.length);
  assert.deepEqual(triagePatch('keep'), { triaged: true });
  assert.deepEqual(triagePatch('done'), { done: true, triaged: true });
  assert.deepEqual(triagePatch('someday'), { list: 'someday', triaged: true });
  assert.deepEqual(triagePatch('reference'), { list: 'reference', triaged: true });
  assert.equal(triagePatch('trash'), null);
  assert.equal(triagePatch('project'), null);
});
