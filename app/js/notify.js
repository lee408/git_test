// Builds notification text on the device from its own copy of your data. The push server only
// says which kind to show ({kind}); no task data ever leaves the device.
// Pure logic, unit-tested in tests/notify.test.mjs.
import { isoDay, addDays, live, openItems, inboxItems, suggestNow, reviewStatus } from './model.js';
import { randomQuote, formatQuote } from './quotes.js';
import { STEPS, saversSettings, durations, saversStreak, dayRecord } from './savers.js';

export const NOTIFY_KINDS = ['morning', 'evening', 'quote', 'savers'];
const ACTIVE = (i) => !['someday', 'reference'].includes(i.list);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function listTitles(items, max = 2) {
  const shown = items.slice(0, max).map((i) => i.title);
  return shown.join(', ') + (items.length > max ? ` +${items.length - max} more` : '');
}

function blocksOn(doc, day) {
  return openItems(doc).filter((i) => ACTIVE(i) && i.schedDate === day && i.schedTime)
    .sort((a, b) => a.schedTime.localeCompare(b.schedTime));
}

export function buildNotification(kind, doc, now = new Date(), { quote = randomQuote() } = {}) {
  const today = isoDay(now);
  if (kind === 'quote' || !doc) {
    return { title: 'A thought for today', body: formatQuote(quote), tag: `clearhead-${kind}`, url: './' };
  }

  if (kind === 'savers') {
    const cfg = saversSettings(doc.settings);
    const mins = durations(cfg).reduce((a, b) => a + b, 0);
    const streak = saversStreak(doc, today);
    const doneToday = dayRecord(doc, today)?.finished;
    const body = doneToday
      ? `Done today. ${streak}-day streak. See you tomorrow.`
      : `${STEPS.map((s) => s.name).join(' · ')}\n${mins} min${streak ? ` · keep your ${streak}-day streak going` : '. Start your streak today'}. Tap to begin.`;
    return { title: 'Your Miracle Morning', body, tag: 'clearhead-savers', url: './?savers=1' };
  }

  if (kind === 'morning') {
    const lines = [];
    const blocks = blocksOn(doc, today);
    if (blocks.length) lines.push(`Blocks: ${blocks.slice(0, 3).map((b) => `${b.schedTime} ${b.title}`).join(' · ')}${blocks.length > 3 ? ` +${blocks.length - 3}` : ''}`);
    const due = openItems(doc).filter((i) => ACTIVE(i) && i.due && i.due <= today).sort((a, b) => a.due.localeCompare(b.due));
    const overdue = due.filter((i) => i.due < today).length;
    if (due.length) lines.push(`Due: ${listTitles(due)}${overdue ? ` (${overdue} overdue)` : ''}`);
    const blockIds = new Set(blocks.map((b) => b.id));
    const top = suggestNow(doc, today).find((i) => !blockIds.has(i.id) && !(i.due && i.due <= today));
    if (top) lines.push(`Start with: ${top.title}`);
    const inbox = inboxItems(doc).length;
    if (inbox) lines.push(`Inbox: ${inbox} to clarify`);
    if (reviewStatus(doc, today).due) lines.push('Weekly review is due.');
    if (!lines.length) lines.push(`A clear day. Pick one meaningful thing and begin. ${formatQuote(quote)}`);
    return { title: 'Good morning. Here\'s your day', body: lines.join('\n'), tag: 'clearhead-morning', url: './' };
  }

  // evening shutdown
  const finished = live(doc.items).filter((i) => i.done && i.completedAt && isoDay(new Date(i.completedAt)) === today).length;
  const tomorrow = addDays(today, 1);
  const tBlocks = blocksOn(doc, tomorrow).length;
  const tDue = openItems(doc).filter((i) => ACTIVE(i) && i.due === tomorrow).length;
  const ahead = [tBlocks && plural(tBlocks, 'time block'), tDue && `${tDue} due`].filter(Boolean).join(', ');
  const lines = [
    `${finished ? `You finished ${plural(finished, 'action')} today. ` : ''}Capture any loose ends, then glance at tomorrow${ahead ? ` (${ahead})` : ''}.`,
    formatQuote(quote),
  ];
  return { title: 'Shutdown time', body: lines.join('\n'), tag: 'clearhead-evening', url: './?capture=1' };
}
