// One-tap "Add to Google Calendar" links for dated actions (deadlines and time blocks).
// Google's pre-filled event form needs no sign-in or setup; nothing is sent until you press Save there.
// Pure logic, unit-tested in tests/calendar.test.mjs.
import { addDays } from './model.js';

export const DEFAULT_BLOCK_MIN = 60;
const GCAL = 'https://calendar.google.com/calendar/render';

const compactDay = (d) => d.replace(/-/g, '');

export function blockLength(item) {
  return item.timeMin || DEFAULT_BLOCK_MIN;
}

// End of a time block as { date, time }, rolling past midnight when needed.
export function blockEnd(date, time, min) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const end = new Date(y, mo - 1, d, h, mi + min);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    time: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

// Which calendar events an item can have: 'due' (all-day) and/or 'block' (timed).
export function calendarKinds(item) {
  const kinds = [];
  if (item.due) kinds.push('due');
  if (item.schedDate && item.schedTime) kinds.push('block');
  return kinds;
}

// Fingerprint of what was sent to the calendar, to spot when the action's date changed since.
export function calKey(item, kind) {
  if (kind === 'due') return item.due || null;
  if (kind === 'block') return item.schedDate && item.schedTime ? `${item.schedDate}T${item.schedTime}/${blockLength(item)}` : null;
  return null;
}

// 'none' (never added), 'added', or 'outdated' (date/time changed after adding).
export function calendarState(item, kind) {
  const sent = item.cal?.[kind];
  if (!sent) return 'none';
  return sent === calKey(item, kind) ? 'added' : 'outdated';
}

export function calendarEvent(item, kind, projectTitle = '') {
  const lines = [];
  if (item.notes) lines.push(item.notes);
  if (projectTitle) lines.push(`Project: ${projectTitle}`);
  if (item.contexts?.length) lines.push(`Context: ${item.contexts.map((c) => '@' + c).join(' ')}`);
  lines.push('Added from Clearhead');
  const details = lines.join('\n');
  if (kind === 'due') {
    return { text: `Due: ${item.title}`, dates: `${compactDay(item.due)}/${compactDay(addDays(item.due, 1))}`, details };
  }
  const end = blockEnd(item.schedDate, item.schedTime, blockLength(item));
  const stamp = (d, t) => `${compactDay(d)}T${t.replace(':', '')}00`;
  return { text: item.title, dates: `${stamp(item.schedDate, item.schedTime)}/${stamp(end.date, end.time)}`, details };
}

// tz: IANA zone the times are written in (the device's), so Google places the block correctly.
export function gcalUrl(item, kind, { tz, projectTitle } = {}) {
  const ev = calendarEvent(item, kind, projectTitle);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.text, dates: ev.dates, details: ev.details });
  if (kind === 'block' && tz) q.set('ctz', tz);
  return `${GCAL}?${q}`;
}
