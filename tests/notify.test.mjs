import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc } from '../app/js/model.js';
import { QUOTES, quoteOfDay, randomQuote, formatQuote } from '../app/js/quotes.js';
import { buildNotification } from '../app/js/notify.js';

// Monday 2026-10-05, 07:30 local.
const NOW = new Date(2026, 9, 5, 7, 30);
const Q = ['Discipline equals freedom.', 'Jocko Willink'];

test('quote collection: 200+ unique, attributed, notification-sized', () => {
  assert.ok(QUOTES.length >= 200);
  assert.equal(new Set(QUOTES.map((q) => q[0])).size, QUOTES.length);
  for (const [text, author] of QUOTES) {
    assert.ok(text && author, 'text and author');
    assert.ok(text.length <= 200, `too long for a notification: ${text}`);
  }
  for (const a of ['Jordan Peterson', 'Lee Kuan Yew', 'Jim Kwik', 'Marcus Aurelius', 'Seneca', 'Epictetus', 'Jocko Willink', 'David Allen', 'James Clear', 'Viktor Frankl']) {
    assert.ok(QUOTES.some((q) => q[1] === a), `missing ${a}`);
  }
  assert.deepEqual(quoteOfDay('2026-10-05'), quoteOfDay('2026-10-05'), 'stable within a day');
  assert.ok(new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) => quoteOfDay(d)[0])).size > 1);
  assert.deepEqual(randomQuote(() => 0), QUOTES[0]);
  assert.deepEqual(randomQuote(() => 0.999999), QUOTES[QUOTES.length - 1]);
  assert.equal(formatQuote(Q), '“Discipline equals freedom.” (Jocko Willink)');
});

const item = (id, f = {}) => ({ id, title: id, list: 'next', contexts: [], done: false, createdAt: 1, updatedAt: 1, ...f });

test('morning plan lists blocks, deadlines, a starting action, inbox and review', () => {
  const d = emptyDoc(); // review day Monday, never reviewed → due
  d.items.b2 = item('Call garage', { schedDate: '2026-10-05', schedTime: '14:00' });
  d.items.b1 = item('Draft report', { schedDate: '2026-10-05', schedTime: '09:00' });
  d.items.d1 = item('Pay invoice', { due: '2026-10-04' });
  d.items.d2 = item('Submit form', { due: '2026-10-05' });
  d.items.f = item('Plan holiday', { focus: true });
  d.items.i = item('Random thought', { list: 'inbox' });
  d.items.s = item('Learn piano', { list: 'someday', due: '2026-10-05' });
  const n = buildNotification('morning', d, NOW, { quote: Q });
  assert.equal(n.tag, 'clearhead-morning');
  const lines = n.body.split('\n');
  assert.equal(lines[0], 'Blocks: 09:00 Draft report · 14:00 Call garage');
  assert.equal(lines[1], 'Due: Pay invoice, Submit form (1 overdue)');
  assert.equal(lines[2], 'Start with: Plan holiday');
  assert.equal(lines[3], 'Inbox: 1 to clarify');
  assert.equal(lines[4], 'Weekly review is due.');
});

test('morning with nothing on falls back to encouragement', () => {
  const d = emptyDoc();
  d.reviews.r = { id: 'r', day: '2026-10-05', updatedAt: 1 };
  const n = buildNotification('morning', d, NOW, { quote: Q });
  assert.match(n.body, /A clear day/);
  assert.match(n.body, /Discipline equals freedom/);
});

test('evening shutdown counts today, looks at tomorrow and opens capture', () => {
  const d = emptyDoc();
  d.items.a = item('a', { done: true, completedAt: new Date(2026, 9, 5, 11).getTime() });
  d.items.b = item('b', { done: true, completedAt: new Date(2026, 9, 4, 11).getTime() });
  d.items.c = item('c', { schedDate: '2026-10-06', schedTime: '10:00' });
  d.items.e = item('e', { due: '2026-10-06' });
  const n = buildNotification('evening', d, new Date(2026, 9, 5, 18), { quote: Q });
  assert.equal(n.title, 'Shutdown time');
  assert.equal(n.url, './?capture=1');
  assert.equal(n.body.split('\n')[0], 'You finished 1 action today. Capture any loose ends, then glance at tomorrow (1 time block, 1 due).');
});

test('quote, and any kind without local data, shows a quote', () => {
  assert.equal(buildNotification('quote', emptyDoc(), NOW, { quote: Q }).body, formatQuote(Q));
  assert.equal(buildNotification('morning', null, NOW, { quote: Q }).body, formatQuote(Q));
});
