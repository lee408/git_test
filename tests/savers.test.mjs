import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, merge } from '../app/js/model.js';
import {
  STEPS, PRESETS, durations, saversSettings, exerciseList, exerciseAt, breathPhase, saversStreak, lastDays, DEFAULT_EXERCISES,
} from '../app/js/savers.js';
import { buildNotification } from '../app/js/notify.js';

const TODAY = '2026-10-06';

test('six SAVERS steps in order', () => {
  assert.equal(STEPS.map((s) => s.letter).join(''), 'SAVERS');
});

test('presets and custom durations', () => {
  const cfg = saversSettings({});
  assert.deepEqual(durations(cfg), PRESETS.half.minutes);
  assert.equal(durations(cfg, 'express').reduce((a, b) => a + b), 6);
  assert.equal(durations(cfg, 'full').reduce((a, b) => a + b), 60);
  assert.deepEqual(durations({ ...cfg, custom: [3, '2', -1, 99, null, 4] }, 'custom'), [3, 2, 0, 60, 0, 4]);
  assert.deepEqual(saversSettings({ savers: { preset: 'full' } }).preset, 'full');
});

test('exercise routine slices the step evenly', () => {
  assert.deepEqual(exerciseList({ exercises: '  \n' }), DEFAULT_EXERCISES);
  const list = exerciseList({ exercises: 'Push-ups\n\nSquats\nPlank' });
  assert.deepEqual(list, ['Push-ups', 'Squats', 'Plank']);
  assert.equal(exerciseAt(list, 0, 300), 0);
  assert.equal(exerciseAt(list, 100, 300), 1);
  assert.equal(exerciseAt(list, 299, 300), 2);
  assert.equal(exerciseAt(list, 400, 300), 2);
});

test('box breathing cycles every 16 seconds', () => {
  assert.deepEqual(breathPhase(0), { label: 'Breathe in', count: 4 });
  assert.deepEqual(breathPhase(5), { label: 'Hold', count: 3 });
  assert.deepEqual(breathPhase(8), { label: 'Breathe out', count: 4 });
  assert.deepEqual(breathPhase(15), { label: 'Hold', count: 1 });
  assert.deepEqual(breathPhase(16), { label: 'Breathe in', count: 4 });
});

test('streak counts finished days back from today or yesterday', () => {
  const d = emptyDoc();
  const rec = (day, finished = true) => ({ id: day, day, done: { silence: true }, finished, updatedAt: 1 });
  d.practice['2026-10-05'] = rec('2026-10-05');
  d.practice['2026-10-04'] = rec('2026-10-04');
  d.practice['2026-10-02'] = rec('2026-10-02');
  assert.equal(saversStreak(d, TODAY), 2, 'today not done yet keeps yesterday\'s streak');
  d.practice[TODAY] = rec(TODAY);
  assert.equal(saversStreak(d, TODAY), 3);
  d.practice['2026-10-05'] = rec('2026-10-05', false);
  assert.equal(saversStreak(d, TODAY), 1, 'unfinished day breaks it');
  const grid = lastDays(d, TODAY, 7);
  assert.equal(grid.length, 7);
  assert.equal(grid.at(-1).day, TODAY);
  assert.equal(grid.at(-1).steps, 1);
});

test('practice days sync between devices', () => {
  const a = emptyDoc();
  const b = emptyDoc();
  a.practice[TODAY] = { id: TODAY, day: TODAY, done: { silence: true }, updatedAt: 5 };
  b.practice['2026-10-05'] = { id: '2026-10-05', day: '2026-10-05', done: { reading: true }, finished: true, updatedAt: 3 };
  const m = merge(a, b);
  assert.ok(m.practice[TODAY] && m.practice['2026-10-05']);
});

test('Miracle Morning notification shows streak and opens the session', () => {
  const d = emptyDoc();
  d.practice['2026-10-05'] = { id: '2026-10-05', day: '2026-10-05', done: {}, finished: true, updatedAt: 1 };
  const n = buildNotification('savers', d, new Date(2026, 9, 6, 6, 0), { quote: ['x', 'y'] });
  assert.equal(n.title, 'Your Miracle Morning');
  assert.match(n.body, /Silence · Affirmations · Visualization · Exercise · Reading · Scribing/);
  assert.match(n.body, /30 min/);
  assert.match(n.body, /1-day streak/);
  assert.equal(n.url, './?savers=1');
  d.practice[TODAY] = { id: TODAY, day: TODAY, done: {}, finished: true, updatedAt: 1 };
  assert.match(buildNotification('savers', d, new Date(2026, 9, 6, 6, 0)).body, /Done today/);
});
