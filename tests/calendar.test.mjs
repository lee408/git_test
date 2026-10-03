import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, parseAt, parseCapture } from '../app/js/model.js';
import { gcalUrl, calendarEvent, calendarState, calKey, blockEnd, calendarKinds } from '../app/js/calendar.js';

const TODAY = '2026-10-03'; // Saturday

test('parseTime accepts 24h, am/pm and compact forms', () => {
  assert.equal(parseTime('14:00'), '14:00');
  assert.equal(parseTime('9am'), '09:00');
  assert.equal(parseTime('2:30pm'), '14:30');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12pm'), '12:00');
  assert.equal(parseTime('0930'), '09:30');
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime('13pm'), null);
  assert.equal(parseTime('fri'), null);
});

test('parseAt combines date words with a time', () => {
  assert.deepEqual(parseAt('14:00', TODAY), { date: TODAY, time: '14:00' });
  assert.deepEqual(parseAt('thu-9am', TODAY), { date: '2026-10-08', time: '09:00' });
  assert.deepEqual(parseAt('tmr@2:30pm', TODAY), { date: '2026-10-04', time: '14:30' });
  assert.deepEqual(parseAt('2026-10-05-14:30', TODAY), { date: '2026-10-05', time: '14:30' });
  assert.equal(parseAt('someday', TODAY), null);
});

test('capture shorthand at: sets a time block and ~ sets its length', () => {
  const p = parseCapture('Draft report at:mon-10:00 ~90m @deep', TODAY);
  assert.equal(p.title, 'Draft report');
  assert.equal(p.schedDate, '2026-10-05');
  assert.equal(p.schedTime, '10:00');
  assert.equal(p.timeMin, 90);
});

test('blockEnd rolls over midnight', () => {
  assert.deepEqual(blockEnd('2026-10-03', '23:30', 60), { date: '2026-10-04', time: '00:30' });
});

const item = { title: 'Submit tax return', notes: 'Use the HMRC portal', due: '2026-10-09', contexts: ['computer'], schedDate: '2026-10-07', schedTime: '14:00', timeMin: 90 };

test('deadline becomes an all-day event; block a timed event in the device time zone', () => {
  const due = calendarEvent(item, 'due', 'Taxes');
  assert.equal(due.text, 'Due: Submit tax return');
  assert.equal(due.dates, '20261009/20261010');
  assert.match(due.details, /Use the HMRC portal\nProject: Taxes\nContext: @computer\nAdded from Clearhead/);
  const url = new URL(gcalUrl(item, 'block', { tz: 'Europe/London' }));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Submit tax return');
  assert.equal(url.searchParams.get('dates'), '20261007T140000/20261007T153000');
  assert.equal(url.searchParams.get('ctz'), 'Europe/London');
});

test('calendarState notices when the date changes after adding', () => {
  assert.deepEqual(calendarKinds(item), ['due', 'block']);
  assert.equal(calendarState(item, 'due'), 'none');
  const added = { ...item, cal: { due: calKey(item, 'due'), block: calKey(item, 'block') } };
  assert.equal(calendarState(added, 'due'), 'added');
  assert.equal(calendarState({ ...added, due: '2026-10-10' }, 'due'), 'outdated');
  assert.equal(calendarState({ ...added, timeMin: 30 }, 'block'), 'outdated', 'length change counts');
});
