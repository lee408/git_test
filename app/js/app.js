import {
  isoDay, addDays, daysBetween, parseCapture, vagueHint, live, openItems, inboxItems, nextActions,
  projectHealth, suggestNow, reviewStatus, isAvailable, normalizeDoc,
} from './model.js';
import { store, prefs } from './store.js';
import { sync } from './sync.js';
import { buildSweep, splitLines } from './sweep.js';
import { buildBrainDump, TRIAGE, triagePatch } from './braindump.js';
import { gcalUrl, calKey, calendarKinds, calendarState, blockLength, blockEnd } from './calendar.js';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const today = () => isoDay(new Date());
const doc = () => store.doc;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_CHOICES = [5, 15, 30, 60, 120];
const NOW_LIMIT = 5;
const QUICK_SORT_MIN = 10; // offer one-tap triage once the inbox is this big

function fmtDay(s) {
  const d = daysBetween(today(), s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const date = new Date(s + 'T00:00');
  if (d > 1 && d < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? m % 60 + 'm' : ''}` : `${m}m`);

const ICONS = {
  now: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  next: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  projects: '<path d="M3 6h6l2 2h10v11H3z"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  someday: '<path d="M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6"/>',
  upcoming: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  review: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/><path d="m9 12 2 2 4-4"/>',
  done: '<path d="m5 12 5 5L20 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const VIEWS = [
  { id: 'now', label: 'Now', key: '1' },
  { id: 'inbox', label: 'Inbox', key: '2' },
  { id: 'next', label: 'Next actions', key: '3' },
  { id: 'projects', label: 'Projects', key: '4' },
  { id: 'waiting', label: 'Waiting for', key: '5' },
  { id: 'someday', label: 'Someday / Maybe', key: '6' },
  { id: 'upcoming', label: 'Upcoming', key: '7' },
  { id: 'review', label: 'Weekly review', key: '8' },
  { id: 'done', label: 'Done', key: '9' },
  { id: 'settings', label: 'Settings', key: '0' },
];
const MOBILE_TABS = ['now', 'inbox', 'next', 'projects', 'more'];

// ---------- UI state (per device) ----------
const state = {
  view: prefs.get('view', 'now'),
  projectId: null,
  now: prefs.get('nowCtx', { contexts: [], timeMin: null, energy: null }),
  showAllNow: false,
  nextFilter: prefs.get('nextFilter', null),
  process: null,
  editingId: null,
};
if (!VIEWS.some((v) => v.id === state.view) && !['more', 'sweep', 'dump', 'triage'].includes(state.view)) state.view = 'now';

function go(view, extra = {}) {
  Object.assign(state, { view, ...extra });
  if (view !== 'project') prefs.set('view', view);
  if (view !== 'inbox') state.process = null;
  render();
  window.scrollTo(0, 0);
}

// ---------- shared templates ----------
function chips(i, { project = true } = {}) {
  const t = today();
  const out = [];
  if (i.due) {
    const d = daysBetween(t, i.due);
    const cls = d < 0 ? 'bad' : d === 0 ? 'warn' : '';
    out.push(`<span class="chip ${cls}">Due ${esc(fmtDay(i.due))}</span>`);
  }
  if (i.schedDate && i.schedTime) {
    const cls = i.schedDate < t && !i.done ? 'bad' : i.schedDate === t ? 'warn' : '';
    out.push(`<span class="chip block ${cls}">${esc(fmtDay(i.schedDate))} ${esc(i.schedTime)}–${esc(blockEnd(i.schedDate, i.schedTime, blockLength(i)).time)}</span>`);
  }
  if (i.start && i.start > t) out.push(`<span class="chip">Starts ${esc(fmtDay(i.start))}</span>`);
  if (i.cal && !i.done) {
    const states = Object.keys(i.cal).filter((k) => i.cal[k]).map((k) => calendarState(i, k));
    if (states.includes('outdated')) out.push('<span class="chip warn">Calendar out of date</span>');
    else if (states.includes('added')) out.push('<span class="chip">In calendar</span>');
  }
  for (const c of i.contexts || []) out.push(`<span class="chip ctx">@${esc(c)}</span>`);
  if (project && i.projectId && doc().projects[i.projectId] && !doc().projects[i.projectId].deleted) {
    out.push(`<button class="chip proj" data-action="open-project" data-pid="${i.projectId}">${esc(doc().projects[i.projectId].title)}</button>`);
  }
  if (i.timeMin) out.push(`<span class="chip">${fmtMin(i.timeMin)}</span>`);
  if (i.energy) out.push(`<span class="chip energy-${i.energy}">${i.energy} energy</span>`);
  if (i.list === 'waiting' && i.waitingOn) {
    const days = Math.floor((Date.now() - (i.waitingSince || i.createdAt)) / 86400000);
    out.push(`<span class="chip ${days >= 7 ? 'warn' : ''}">${esc(i.waitingOn)} · ${days}d</span>`);
  }
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}

function taskRow(i, opts = {}) {
  return `<li class="task ${i.done ? 'is-done' : ''}" data-id="${i.id}">
    <button class="check" data-action="toggle-done" aria-label="${i.done ? 'Mark not done' : 'Mark done'}"></button>
    <button class="task-body" data-action="edit">
      <span class="task-title">${esc(i.title) || '<em>Untitled</em>'}</span>
      ${i.notes ? `<span class="task-notes">${esc(i.notes.split('\n')[0])}</span>` : ''}
    </button>
    ${chips(i, opts)}
    ${opts.extra || ''}
    <button class="star ${i.focus ? 'on' : ''}" data-action="toggle-focus" aria-label="Focus" title="Focus: always show first">${icon('star')}</button>
  </li>`;
}

const taskList = (items, opts) => (items.length ? `<ul class="tasks">${items.map((i) => taskRow(i, opts)).join('')}</ul>` : '');
const empty = (msg) => `<p class="empty">${msg}</p>`;

function header(title, sub = '', actions = '') {
  return `<header class="view-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions}</header>`;
}

function banners() {
  const out = [];
  const d = doc();
  const dump = dumpGet();
  const empty = !live(d.items).length && !live(d.projects).length;
  if (empty && !dump.started && !prefs.get('dumpDismissed', false)) {
    out.push(`<div class="welcome"><h2>Welcome to Clearhead</h2>
      <p>GTD starts with one big <strong>brain dump</strong>: gathering every pile of stuff and every open loop in your head into one inbox, then sorting it. Set aside 1–2 hours. You can pause any time and pick up where you left off.</p>
      <ol class="plain"><li><strong>Gather</strong> the physical and digital piles (desk, email, phone, tabs…)</li>
      <li><strong>Empty your head</strong> with ~40 guided prompts across work, home, money, health, people and plans</li>
      <li><strong>Quick sort</strong> everything with one tap each, then clarify the real actions</li></ol>
      <div class="row"><button class="btn primary" data-action="dump-start">Start brain dump</button>
      <button class="link" data-action="dump-dismiss">Skip, I'll add things as I go</button></div></div>`);
  } else if (dump.started && !dump.finished) {
    out.push(`<div class="banner"><span><strong>Brain dump in progress</strong>: ${plural(dump.captured, 'thing')} captured so far.</span>
      <button class="btn primary" data-action="dump-start">Resume</button></div>`);
  }
  const inbox = inboxItems(doc()).length;
  const rs = reviewStatus(doc(), today());
  if (rs.due) {
    const when = rs.daysLate === 0 ? 'today' : `${plural(rs.daysLate, 'day')} overdue`;
    out.push(`<div class="banner review"><span><strong>Weekly review is due</strong> (${when}). 30 minutes now keeps the whole system trustworthy.</span>
      <button class="btn primary" data-action="nav" data-view="review">Start review</button></div>`);
  }
  const untriaged = inboxItems(d).filter((i) => !i.triaged).length;
  if (inbox > 0) {
    out.push(`<div class="banner"><span><strong>${plural(inbox, 'item')}</strong> in your inbox to clarify.</span>
      ${untriaged >= QUICK_SORT_MIN ? `<button class="btn" data-action="nav" data-view="triage">Quick sort</button>` : ''}
      <button class="btn" data-action="process-start">Process</button></div>`);
  }
  return out.join('');
}

// ---------- views ----------
const views = {};

views.now = () => {
  const d = doc();
  const t = today();
  const ctxs = d.settings.contexts;
  const blocks = openItems(d).filter((i) => i.schedDate === t && i.schedTime && !['someday', 'reference'].includes(i.list))
    .sort((a, b) => a.schedTime.localeCompare(b.schedTime));
  const blockIds = new Set(blocks.map((i) => i.id));
  const suggestions = suggestNow(d, t, state.now).filter((i) => !blockIds.has(i.id));
  const shown = state.showAllNow ? suggestions : suggestions.slice(0, NOW_LIMIT);
  const hidden = suggestions.length - shown.length;
  const overdueWaiting = openItems(d).filter((i) => i.list === 'waiting' && Date.now() - (i.waitingSince || i.createdAt) > 7 * 86400000).length;
  const tog = (on) => (on ? 'on' : '');
  return `${header('What now?', 'Pick where you are, how much time and energy you have. Only the best few actions are shown.')}
    ${banners()}
    <section class="filters" aria-label="Current situation">
      <div class="filter-row"><span class="filter-label">Where / mode</span>
        ${ctxs.map((c) => `<button class="pill ${tog(state.now.contexts.includes(c))}" data-action="now-ctx" data-ctx="${esc(c)}">@${esc(c)}</button>`).join('')}
      </div>
      <div class="filter-row"><span class="filter-label">Time</span>
        ${TIME_CHOICES.map((m) => `<button class="pill ${tog(state.now.timeMin === m)}" data-action="now-time" data-min="${m}">${fmtMin(m)}</button>`).join('')}
      </div>
      <div class="filter-row"><span class="filter-label">Energy</span>
        ${['low', 'med', 'high'].map((e) => `<button class="pill ${tog(state.now.energy === e)}" data-action="now-energy" data-energy="${e}">${e}</button>`).join('')}
        ${state.now.contexts.length || state.now.timeMin || state.now.energy ? '<button class="link" data-action="now-clear">Clear</button>' : ''}
      </div>
    </section>
    ${blocks.length ? `<h2 class="group">Scheduled today <span class="count">${blocks.length}</span></h2>${taskList(blocks)}<h2 class="group">Then, best fits</h2>` : ''}
    ${shown.length ? taskList(shown) : empty(nextActions(d, t).length
    ? 'Nothing fits right now. Try a different context, or more time or energy.'
    : 'No next actions yet. Capture something above, then process your inbox.')}
    ${hidden > 0 ? `<button class="link more" data-action="now-all">Show ${hidden} more that also fit</button>` : ''}
    ${state.showAllNow && suggestions.length > NOW_LIMIT ? '<button class="link more" data-action="now-all">Show fewer</button>' : ''}
    ${overdueWaiting ? `<p class="hint">${plural(overdueWaiting, 'item')} waiting more than a week. <button class="link" data-action="nav" data-view="waiting">Follow up?</button></p>` : ''}`;
};

views.inbox = () => {
  if (state.process) return processView();
  const items = inboxItems(doc());
  const untriaged = items.filter((i) => !i.triaged).length;
  return `${header('Inbox', 'Capture now, decide later. Process to zero at least once a day.',
    items.length ? `<div class="row">${untriaged >= QUICK_SORT_MIN ? `<button class="btn" data-action="nav" data-view="triage">Quick sort (${untriaged})</button>` : ''}<button class="btn primary" data-action="process-start">Process inbox</button></div>` : '')}
    ${items.length ? taskList(items) : empty('Inbox zero. Your head is clear.')}`;
};

views.next = () => {
  const d = doc();
  const t = today();
  const all = nextActions(d, t);
  const deferred = nextActions(d, t, { includeDeferred: true }).length - all.length;
  const f = state.nextFilter;
  const items = f ? all.filter((i) => (f === '_none' ? !i.contexts?.length : i.contexts?.includes(f))) : all;
  const groups = new Map();
  for (const c of d.settings.contexts) groups.set(c, []);
  groups.set('_none', []);
  for (const i of items) {
    const key = i.contexts?.find((c) => groups.has(c)) || (i.contexts?.[0] ?? '_none');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const sortItems = (arr) => arr.sort((a, b) => (b.focus - a.focus) || ((a.due || '9') < (b.due || '9') ? -1 : 1) || a.createdAt - b.createdAt);
  return `${header('Next actions', `${plural(all.length, 'action')} you could do now${deferred ? `, plus ${deferred} scheduled for later` : ''}.`)}
    <div class="filter-row">
      <button class="pill ${!f ? 'on' : ''}" data-action="next-filter" data-ctx="">All</button>
      ${d.settings.contexts.map((c) => `<button class="pill ${f === c ? 'on' : ''}" data-action="next-filter" data-ctx="${esc(c)}">@${esc(c)}</button>`).join('')}
      <button class="pill ${f === '_none' ? 'on' : ''}" data-action="next-filter" data-ctx="_none">No context</button>
    </div>
    ${[...groups].filter(([, arr]) => arr.length).map(([c, arr]) => `<h2 class="group">${c === '_none' ? 'Anywhere' : '@' + esc(c)} <span class="count">${arr.length}</span></h2>${taskList(sortItems(arr))}`).join('')
    || empty('No next actions here.')}`;
};

views.projects = () => {
  const d = doc();
  const t = today();
  const ps = live(d.projects);
  const active = ps.filter((p) => p.status === 'active').map((p) => ({ p, h: projectHealth(d, p, t) }))
    .sort((a, b) => (b.h.stalled - a.h.stalled) || a.p.title.localeCompare(b.p.title));
  const someday = ps.filter((p) => p.status === 'someday');
  const done = ps.filter((p) => p.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  const stalled = active.filter((x) => x.h.stalled).length;
  const card = ({ p, h }) => `<li class="project ${h.stalled ? 'stalled' : ''}">
      <button class="project-main" data-action="open-project" data-pid="${p.id}">
        <span class="task-title">${esc(p.title)}</span>
        ${p.outcome ? `<span class="task-notes">${esc(p.outcome)}</span>` : ''}
        <span class="chips">${h.stalled ? '<span class="chip bad">No next action</span>' : ''}
          ${h.available.length ? `<span class="chip">${plural(h.available.length, 'next action')}</span>` : ''}
          ${h.waiting.length ? `<span class="chip">${h.waiting.length} waiting</span>` : ''}</span>
      </button>
      ${h.stalled ? `<form class="inline-add" data-form="project-action" data-pid="${p.id}"><input name="title" placeholder="Next action to move this forward…" aria-label="Next action for ${esc(p.title)}"><button class="btn">Add</button></form>` : ''}
    </li>`;
  return `${header('Projects', `Any outcome needing more than one action. ${stalled ? `<strong class="bad-text">${plural(stalled, 'project')} stalled</strong>: every active project needs a next action.` : 'All active projects have a next action.'}`)}
    <form class="inline-add" data-form="new-project"><input name="title" placeholder="New project: describe the outcome, e.g. 'Kitchen tap fixed'" aria-label="New project"><button class="btn primary">Add project</button></form>
    ${active.length ? `<ul class="projects">${active.map(card).join('')}</ul>` : empty('No active projects.')}
    ${someday.length ? `<details><summary>Someday projects (${someday.length})</summary><ul class="projects">${someday.map((p) => card({ p, h: projectHealth(d, p, t) })).join('')}</ul></details>` : ''}
    ${done.length ? `<details><summary>Completed projects</summary><ul class="projects">${done.map((p) => card({ p, h: projectHealth(d, p, t) })).join('')}</ul></details>` : ''}`;
};

views.project = () => {
  const d = doc();
  const p = d.projects[state.projectId];
  if (!p || p.deleted) { state.view = 'projects'; return views.projects(); }
  const h = projectHealth(d, p, today());
  const doneItems = live(d.items).filter((i) => i.projectId === p.id && i.done).sort((a, b) => b.completedAt - a.completedAt);
  const other = h.actions.filter((i) => i.list !== 'next' && i.list !== 'waiting');
  return `<button class="link back" data-action="nav" data-view="projects">← Projects</button>
    <form class="project-edit" data-form="project-edit" data-pid="${p.id}">
      <input class="title-input" name="title" value="${esc(p.title)}" aria-label="Project name">
      <label>Outcome: what does "done" look like?<textarea name="outcome" rows="2">${esc(p.outcome)}</textarea></label>
      <label>Notes / support material<textarea name="notes" rows="3">${esc(p.notes)}</textarea></label>
      <div class="row"><button class="btn">Save</button>
        ${p.status !== 'done' ? `<button type="button" class="btn" data-action="project-status" data-status="done">Complete project</button>` : `<button type="button" class="btn" data-action="project-status" data-status="active">Reopen</button>`}
        ${p.status === 'active' ? `<button type="button" class="btn" data-action="project-status" data-status="someday">Move to Someday</button>` : ''}
        ${p.status === 'someday' ? `<button type="button" class="btn" data-action="project-status" data-status="active">Activate</button>` : ''}
        <button type="button" class="btn danger" data-action="project-delete">Delete</button></div>
    </form>
    ${h.stalled ? '<div class="banner bad"><span>This project has no next action, so it will never move. Add one below.</span></div>' : ''}
    <form class="inline-add" data-form="project-action" data-pid="${p.id}"><input name="title" placeholder="Add next action (shorthand works: @phone ~15m due:fri)" aria-label="Add action"><button class="btn primary">Add</button></form>
    ${h.nexts.length ? `<h2 class="group">Next actions</h2>${taskList(h.nexts, { project: false })}` : ''}
    ${h.waiting.length ? `<h2 class="group">Waiting for</h2>${taskList(h.waiting, { project: false })}` : ''}
    ${other.length ? `<h2 class="group">Other</h2>${taskList(other, { project: false })}` : ''}
    ${doneItems.length ? `<details><summary>Done (${doneItems.length})</summary>${taskList(doneItems, { project: false })}</details>` : ''}`;
};

views.waiting = () => {
  const items = openItems(doc()).filter((i) => i.list === 'waiting').sort((a, b) => (a.waitingSince || a.createdAt) - (b.waitingSince || b.createdAt));
  const stale = (i) => Date.now() - (i.waitingSince || i.createdAt) > 7 * 86400000;
  const nudge = (i) => (stale(i) ? '<button class="btn small" data-action="follow-up">Follow up</button>' : '');
  return `${header('Waiting for', 'Things you delegated or are expecting. Chase anything older than a week.')}
    ${items.length ? `<ul class="tasks">${items.map((i) => taskRow(i, { extra: nudge(i) })).join('')}</ul>` : empty('Not waiting on anyone.')}`;
};

views.someday = () => {
  const d = doc();
  const items = openItems(d).filter((i) => i.list === 'someday').sort((a, b) => a.createdAt - b.createdAt);
  const refs = openItems(d).filter((i) => i.list === 'reference');
  const projects = live(d.projects).filter((p) => p.status === 'someday');
  const act = (i) => `<button class="btn small" data-action="activate" data-id="${i.id}">Make next action</button>`;
  return `${header('Someday / Maybe', 'Ideas parked without guilt. Look through them in every weekly review.')}
    ${items.length ? `<ul class="tasks">${items.map((i) => taskRow(i, { extra: act(i) })).join('')}</ul>` : empty('Nothing parked.')}
    ${projects.length ? `<h2 class="group">Someday projects</h2><ul class="projects">${projects.map((p) => `<li class="project"><button class="project-main" data-action="open-project" data-pid="${p.id}"><span class="task-title">${esc(p.title)}</span></button></li>`).join('')}</ul>` : ''}
    ${refs.length ? `<h2 class="group">Reference</h2>${taskList(refs)}` : ''}`;
};

views.upcoming = () => {
  const t = today();
  const items = openItems(doc()).filter((i) => i.due || i.schedDate || (i.start && i.start > t));
  const byDay = new Map();
  for (const i of items) {
    const key = [i.start > t ? i.start : null, i.schedDate, i.due].filter(Boolean).sort()[0];
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(i);
  }
  const days = [...byDay.keys()].sort();
  return `${header('Upcoming', 'Time blocks, deadlines and things scheduled to come back (the "tickler"). Send any of them to Google Calendar.')}
    ${days.map((k) => `<h2 class="group ${k < t ? 'bad-text' : ''}">${esc(fmtDay(k))} <span class="count">${esc(k)}</span></h2><ul class="tasks">${byDay.get(k)
    .sort((a, b) => (a.schedTime || '99').localeCompare(b.schedTime || '99'))
    .map((i) => taskRow(i, { extra: calButtons(i) })).join('')}</ul>`).join('')
    || empty('Nothing dated. That\'s fine. GTD only uses dates for real deadlines.')}`;
};

// "Add to Google Calendar" buttons for whichever dates an item has that aren't in the calendar yet.
function calButtons(i) {
  const label = { due: 'deadline', block: 'time block' };
  const btns = calendarKinds(i).filter((k) => calendarState(i, k) !== 'added')
    .map((k) => `<button class="btn small cal" data-action="cal-add" data-kind="${k}">${calendarState(i, k) === 'outdated' ? 'Re-add' : 'Add'} ${label[k]} to Google Calendar</button>`);
  return btns.length ? `<div class="row cal-row">${btns.join('')}</div>` : '';
}

function openCalendar(id, kind) {
  const i = doc().items[id];
  if (!i || !calKey(i, kind)) return;
  const project = i.projectId && doc().projects[i.projectId];
  const url = gcalUrl(i, kind, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, projectTitle: project && !project.deleted ? project.title : '' });
  window.open(url, '_blank', 'noopener');
  store.updateItem(id, { cal: { ...(i.cal || {}), [kind]: calKey(i, kind) } });
}

// After saving a dated action, offer to put it in Google Calendar (can be turned off in Settings).
function offerCalendar(id) {
  const i = doc().items[id];
  if (!i || i.done || prefs.get('calOffer', true) === false) return false;
  // An event that's now wrong matters more than one never added.
  const kinds = calendarKinds(i);
  const kind = kinds.find((k) => calendarState(i, k) === 'outdated') || kinds.find((k) => calendarState(i, k) === 'none');
  if (!kind) return false;
  const what = kind === 'due' ? 'deadline' : 'time block';
  toast(`${calendarState(i, kind) === 'outdated' ? 'Date changed. Update' : 'Add'} the ${what} in Google Calendar?`, () => openCalendar(id, kind), 'Add');
  return true;
}

const REVIEW_STEPS = [
  { id: 'loose', title: 'Mind sweep: collect loose ends', body: () => {
    const sw = sweepGet(reviewStatus(doc(), today()).periodStart);
    if (sw.finished) return `Done: ${plural(sw.captured, 'thing')} captured. Re-run it any time something else surfaces.`;
    return 'Guiding questions, one at a time, to get every open loop out of your head: life areas plus each of your projects.';
  }, action: () => {
    const sw = sweepGet(reviewStatus(doc(), today()).periodStart);
    return ['sweep-start', sw.finished ? 'Sweep again' : sw.id ? 'Resume mind sweep' : 'Start mind sweep'];
  } },
  { id: 'inbox', title: 'Process inbox to zero', body: () => `${plural(inboxItems(doc()).length, 'item')} in inbox.`, action: ['process-start', 'Process inbox'] },
  { id: 'calendar', title: 'Review your calendar', body: 'Look back 1 week for follow-ups, ahead 2 weeks for preparation. Capture anything it triggers.' },
  { id: 'next', title: 'Review next actions', body: () => `${plural(nextActions(doc(), today()).length, 'action')}. Tick off done ones, delete stale ones, sharpen vague ones.`, view: 'next' },
  { id: 'projects', title: 'Review projects', body: () => { const s = live(doc().projects).filter((p) => projectHealth(doc(), p, today()).stalled).length; return s ? `<strong class="bad-text">${plural(s, 'project')} have no next action.</strong> Fix those.` : 'Every active project has a next action.'; }, view: 'projects' },
  { id: 'waiting', title: 'Review waiting for', body: () => `${plural(openItems(doc()).filter((i) => i.list === 'waiting').length, 'item')}. Chase anything overdue.`, view: 'waiting' },
  { id: 'upcoming', title: 'Check upcoming deadlines', body: 'Anything due in the next 2 weeks that needs a next action now?', view: 'upcoming' },
  { id: 'someday', title: 'Review someday / maybe', body: 'Activate anything that\'s now a priority; delete what no longer excites you.', view: 'someday' },
  { id: 'creative', title: 'Get creative', body: 'Any new ideas, projects or bold moves? Capture them.' },
];

views.review = () => {
  const rs = reviewStatus(doc(), today());
  const checks = reviewChecks(rs.periodStart);
  const doneCount = REVIEW_STEPS.filter((s) => checks[s.id]).length;
  const dayName = WEEKDAY_NAMES[doc().settings.reviewDay ?? 1];
  return `${header('Weekly review', rs.due
    ? `Due since ${esc(fmtDay(rs.periodStart))}. Work through the steps below, top to bottom.`
    : `Done for this week (${esc(fmtDay(rs.last))}). Next one: ${dayName}.`)}
    <div class="review-stats"><span class="stat"><strong>${rs.streak}</strong> week streak</span><span class="stat"><strong>${doneCount}/${REVIEW_STEPS.length}</strong> steps</span></div>
    <ol class="review-steps">${REVIEW_STEPS.map((s) => `<li class="${checks[s.id] ? 'checked' : ''}">
      <label class="review-check"><input type="checkbox" data-action="review-check" data-step="${s.id}" ${checks[s.id] ? 'checked' : ''}><span class="task-title">${s.title}</span></label>
      <p>${typeof s.body === 'function' ? s.body() : s.body}</p>
      ${s.action ? (([a, label]) => `<button class="btn small" data-action="${a}">${label}</button>`)(typeof s.action === 'function' ? s.action() : s.action) : ''}
      ${s.view ? `<button class="btn small" data-action="nav" data-view="${s.view}">Open</button>` : ''}
    </li>`).join('')}</ol>
    <button class="btn primary big" data-action="review-finish">${rs.due ? 'Finish weekly review' : 'Log another review'}</button>`;
};

function reviewChecks(periodStart) {
  const saved = prefs.get('reviewChecks', { period: null, done: {} });
  return saved.period === periodStart ? saved.done : {};
}

// ---------- guided capture walkthroughs: weekly mind sweep + first brain dump ----------
// One question card at a time; each typed line becomes an inbox item. Progress is saved per
// device so a walk can be paused and resumed. The weekly sweep resets every review period.
function sweepGet(period) {
  const s = prefs.get('sweep', null);
  return s && s.period === period ? s : { period, id: null, captured: 0, finished: false };
}

function dumpGet() {
  return prefs.get('dump', null) || { id: null, captured: 0, finished: false, started: false };
}

const WALKS = {
  sweep: {
    title: 'Mind sweep',
    intro: 'Write down everything each question brings up, one line each. Don\'t judge or organise yet; that comes when you process the inbox.',
    pauseView: 'review',
    load: () => ({ st: sweepGet(reviewStatus(doc(), today()).periodStart), cards: buildSweep(doc(), today()) }),
    save: (st) => prefs.set('sweep', st),
    onFinish: () => {
      const rs = reviewStatus(doc(), today());
      prefs.set('reviewChecks', { period: rs.periodStart, done: { ...reviewChecks(rs.periodStart), loose: true } });
    },
    done: (st) => {
      const inbox = inboxItems(doc()).length;
      return `${header('Mind sweep')}
        <div class="wizard done-card"><p class="big-emoji">✓</p>
          <p><strong>${plural(st.captured, 'thing')} out of your head.</strong> Nothing to remember now: it's all in the inbox.</p>
          <div class="row center">${inbox ? `<button class="btn primary" data-action="process-start">Process inbox (${inbox})</button>` : ''}
          <button class="btn" data-action="nav" data-view="review">Back to review</button></div></div>`;
    },
  },
  dump: {
    title: 'Brain dump',
    intro: 'Get every commitment, idea and open loop out of your head and your piles. Don\'t decide anything yet. One line per thing, and expect 100+ items.',
    pauseView: 'now',
    load: () => ({ st: dumpGet(), cards: buildBrainDump() }),
    save: (st) => prefs.set('dump', { ...st, started: true }),
    stageLabel: (c) => (c.stage === 'gather' ? 'Step 1 of 2 · Gather your stuff' : 'Step 2 of 2 · Empty your head'),
    done: (st) => {
      const untriaged = inboxItems(doc()).filter((i) => !i.triaged).length;
      return `${header('Brain dump complete')}
        <div class="wizard done-card"><p class="big-emoji">✓</p>
          <p><strong>${plural(st.captured, 'thing')} captured.</strong> That's the hardest part done. Everything you've been carrying is now in one place.</p>
          <p class="hint">Next, a quick sort: one tap per item to bin, park or keep it. Then only the real actions get the full clarify treatment. You can do it in several sittings.</p>
          <div class="row center">${untriaged ? `<button class="btn primary" data-action="nav" data-view="triage">Quick sort ${untriaged} items</button>` : '<button class="btn primary" data-action="process-start">Process inbox</button>'}
          <button class="btn" data-action="nav" data-view="now">Later</button></div></div>`;
    },
  },
};

function walkContext(key) {
  const { st, cards } = WALKS[key].load();
  const i = Math.max(0, cards.findIndex((c) => c.id === st.id));
  return { st, cards, i };
}

function walkView(key) {
  const w = WALKS[key];
  const { st, cards, i } = walkContext(key);
  if (st.finished) return w.done(st);
  const c = cards[i];
  return `${header(w.title, w.intro)}
    ${w.stageLabel ? `<p class="walk-stage">${esc(w.stageLabel(c))}</p>` : ''}
    <progress class="sweep-progress" max="${cards.length}" value="${i}" aria-label="${w.title} progress"></progress>
    <p class="sweep-meta"><span>Question ${i + 1} of ${cards.length}</span><span>${plural(st.captured, 'thing')} captured</span></p>
    <div class="wizard sweep-card">
      <span class="label">${esc(c.area)}${c.stalled ? ' · <span class="bad-text">no next action</span>' : ''}</span>
      <h2 class="q">${esc(c.q)}</h2>
      <ul class="sweep-hints">${c.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <label class="sr-only" for="walk-text">Your answers, one per line</label>
      <textarea id="walk-text" data-walk="${key}" rows="5" placeholder="One per line…${c.projectId ? ' (filed under this project)' : ''}" autofocus></textarea>
      <p class="hint">Each line becomes an inbox item. Shorthand works (@phone ~15m due:fri).<span class="desktop-only"> <kbd>Ctrl</kbd>+<kbd>Enter</kbd> for next.</span></p>
      <div class="choices"><button class="btn primary" data-action="walk-next" data-walk="${key}">${i + 1 < cards.length ? 'Next →' : `Finish ${w.title.toLowerCase()}`}</button></div>
      <div class="wizard-nav">${i > 0 ? `<button class="link" data-action="walk-back" data-walk="${key}">← Back</button>` : '<span></span>'}
        <span><button class="link" data-action="walk-finish" data-walk="${key}">Finish now</button> · <button class="link" data-action="nav" data-view="${w.pauseView}">Pause</button></span></div>
    </div>`;
}

views.sweep = () => walkView('sweep');
views.dump = () => walkView('dump');

// Captures whatever is typed on the current card, then moves by `delta` cards (or finishes).
function walkMove(key, delta, { finish = false } = {}) {
  const w = WALKS[key];
  const { st, cards, i } = walkContext(key);
  const c = cards[i];
  const lines = splitLines($('#walk-text')?.value);
  for (const line of lines) capture(line, '', { projectId: c.projectId || null, src: c.area });
  st.captured += lines.length;
  const to = i + delta;
  if (finish || to >= cards.length) {
    st.finished = true;
    w.onFinish?.();
  } else {
    st.id = cards[Math.max(0, to)].id;
  }
  w.save(st);
  if (lines.length) toast(`${plural(lines.length, 'item')} added to Inbox`);
  render();
  window.scrollTo(0, 0);
}

function startWalk(key) {
  const { st } = WALKS[key].load();
  if (st.finished) WALKS[key].save({ ...st, id: null, captured: 0, finished: false });
  go(key);
}

// ---------- quick sort (triage) for a big inbox ----------
let lastTriage = null;

views.triage = () => {
  const all = inboxItems(doc());
  const left = all.filter((i) => !i.triaged);
  if (!left.length) {
    const newProjects = live(doc().projects).filter((p) => projectHealth(doc(), p, today()).stalled).length;
    return `${header('Quick sort done')}
      <div class="wizard done-card"><p class="big-emoji">✓</p>
        <p><strong>${all.length ? `${plural(all.length, 'action')} left to clarify.` : 'Inbox empty.'}</strong></p>
        ${newProjects ? `<p class="hint">${plural(newProjects, 'project')} still need a first next action. You'll find them at the top of Projects.</p>` : ''}
        <div class="row center">${all.length ? '<button class="btn primary" data-action="process-start">Clarify actions</button>' : ''}
        ${newProjects ? '<button class="btn" data-action="nav" data-view="projects">Projects</button>' : ''}
        <button class="btn" data-action="nav" data-view="now">Done for now</button></div></div>`;
  }
  const item = left[0];
  return `${header('Quick sort', 'One tap each. Don\'t think hard: if it needs thought, it\'s an Action or a Project.')}
    <progress class="sweep-progress" max="${all.length}" value="${all.length - left.length}" aria-label="Quick sort progress"></progress>
    <p class="sweep-meta"><span>${plural(left.length, 'item')} left</span><span>${all.length - left.length} kept for clarifying</span></p>
    <div class="wizard triage-card" data-id="${item.id}">
      ${item.src ? `<span class="label">${esc(item.src)}</span>` : ''}
      <p class="triage-title">${esc(item.title)}</p>
      <div class="triage-grid">${TRIAGE.map((t) => `<button class="btn ${t.to === 'keep' ? 'primary' : t.to === 'trash' ? 'danger' : ''}" data-action="triage" data-to="${t.to}">
        <span>${t.label}<kbd class="desktop-only">${t.key.toUpperCase()}</kbd></span><small>${t.help}</small></button>`).join('')}</div>
      <div class="wizard-nav"><button class="link" data-action="edit">Edit wording</button><button class="link" data-action="nav" data-view="now">Pause</button></div>
    </div>`;
};

function triage(id, to) {
  const before = doc().items[id];
  if (!before) return;
  let projectId = null;
  if (to === 'trash') store.deleteItem(id);
  else if (to === 'project') {
    projectId = store.addProject({ title: before.title }).id;
    store.deleteItem(id);
  } else store.updateItem(id, triagePatch(to));
  lastTriage = { before, projectId };
  const label = TRIAGE.find((t) => t.to === to).label;
  toast(to === 'keep' ? 'Kept for clarifying' : `${label}: ${before.title}`, undoTriage);
}

function undoTriage() {
  if (!lastTriage) return;
  if (lastTriage.projectId) store.deleteProject(lastTriage.projectId);
  store.restoreItem(lastTriage.before);
  lastTriage = null;
}

views.done = () => {
  const items = live(doc().items).filter((i) => i.done && i.completedAt > Date.now() - 30 * 86400000)
    .sort((a, b) => b.completedAt - a.completedAt);
  const byDay = new Map();
  for (const i of items) {
    const k = isoDay(new Date(i.completedAt));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(i);
  }
  return `${header('Done', `${plural(items.length, 'action')} finished in the last 30 days.`)}
    ${[...byDay].map(([k, arr]) => `<h2 class="group">${esc(fmtDay(k))} <span class="count">${arr.length}</span></h2>${taskList(arr)}`).join('') || empty('Nothing completed recently.')}`;
};

views.more = () => {
  const d = doc();
  const counts = {
    waiting: openItems(d).filter((i) => i.list === 'waiting').length,
    someday: openItems(d).filter((i) => i.list === 'someday').length,
    upcoming: openItems(d).filter((i) => i.due || (i.start && i.start > today())).length,
    review: reviewStatus(d, today()).due ? 'due' : '',
  };
  return `${header('More')}
    <ul class="menu">${['waiting', 'someday', 'upcoming', 'review', 'done', 'settings'].map((id) => {
    const v = VIEWS.find((x) => x.id === id);
    return `<li><button data-action="nav" data-view="${id}">${icon(id)}<span>${v.label}</span>${counts[id] ? `<span class="badge ${id === 'review' ? 'warn' : ''}">${counts[id]}</span>` : ''}</button></li>`;
  }).join('')}</ul>`;
};

views.settings = () => {
  const s = doc().settings;
  const st = sync.status;
  const last = sync.lastSync ? new Date(sync.lastSync).toLocaleString() : 'never';
  return `${header('Settings')}
    <section class="card"><h2>Contexts</h2>
      <form data-form="contexts"><label>Comma-separated, without the @<input name="contexts" value="${esc(s.contexts.join(', '))}"></label><button class="btn">Save contexts</button></form>
    </section>
    <section class="card"><h2>Weekly review</h2>
      <label>Review day <select data-action="review-day">${WEEKDAY_NAMES.map((n, i) => `<option value="${i}" ${i === (s.reviewDay ?? 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="hint">From this day until you finish a review, a reminder shows at the top of the Now screen.</p>
    </section>
    <section class="card" id="sync-settings"><h2>Sync (Dropbox)</h2>
      <p class="hint">Your data stays on each device and is mirrored to one file in a private Dropbox app folder that only this app can see. See the README for the 5-minute setup.</p>
      ${sync.connected ? `<p>Connected. Last sync: <strong>${esc(last)}</strong>${st.state === 'error' ? ` · <span class="bad-text">${esc(st.message)}</span>` : ''}</p>
        <div class="row"><button class="btn primary" data-action="sync-now">Sync now</button><button class="btn danger" data-action="sync-disconnect">Disconnect</button></div>`
    : `<form data-form="dropbox"><label>Dropbox app key<input name="appKey" value="${esc(sync.appKey)}" autocomplete="off" spellcheck="false"></label>
        <p class="hint">Redirect URI to register in the Dropbox console: <code>${esc(sync.redirectUri())}</code></p>
        <button class="btn primary">Connect Dropbox</button></form>
        ${st.state === 'error' ? `<p class="bad-text">${esc(st.message)}</p>` : ''}`}
    </section>
    <section class="card"><h2>Brain dump</h2>
      ${(() => { const dmp = dumpGet(); return `<p class="hint">The full GTD collection: gather every pile, then ~40 prompts to empty your head, then a one-tap quick sort. Worth redoing every few months, or whenever life feels out of control.${dmp.started ? ` ${dmp.finished ? 'Last run' : 'In progress'}: ${plural(dmp.captured, 'thing')} captured.` : ''}</p>
      <div class="row"><button class="btn primary" data-action="dump-start">${dmp.started && !dmp.finished ? 'Resume brain dump' : 'Start brain dump'}</button>
      <button class="btn" data-action="nav" data-view="triage">Quick sort inbox</button></div>`; })()}
    </section>
    <section class="card"><h2>Google Calendar</h2>
      <p class="hint">Actions with a deadline or a time block get an "Add to Google Calendar" button (in the editor and in Upcoming). It opens Google Calendar with the event filled in. Nothing is sent until you press Save there, and no sign-in to Clearhead is needed.</p>
      <p class="hint"><strong>Tip:</strong> keep these events separate. In Google Calendar, go to Settings → Add calendar → Create new calendar, name it "Clearhead", then pick it in the event form's calendar dropdown.</p>
      <p class="hint">Changing a date later doesn't move the event. The action shows "Calendar out of date" with a Re-add button; delete the old event in Google Calendar.</p>
      <label class="review-check"><input type="checkbox" data-action="cal-offer" ${prefs.get('calOffer', true) !== false ? 'checked' : ''}><span>Offer to add after saving a dated action</span></label>
    </section>
    <section class="card"><h2>Backup</h2>
      <div class="row"><button class="btn" data-action="export">Export JSON</button>
      <label class="btn">Import / merge JSON<input type="file" accept="application/json,.json" data-action="import" hidden></label></div>
    </section>
    <section class="card"><h2>Capture shorthand</h2>
      <p>Type in the capture bar: <code>Call Sam re invoice @phone +Tax_return ~10m !low due:fri start:+2d</code></p>
      <ul class="plain"><li><code>@context</code>, <code>+Project_Name</code> (underscores become spaces)</li>
      <li><code>at:</code> time block: <code>at:14:00</code> (today), <code>at:thu-9am</code>, <code>at:tmr-2:30pm</code>; length from <code>~</code> (default 1h)</li>
      <li><code>~15m</code> / <code>~1h</code> time needed, <code>!low</code> <code>!med</code> <code>!high</code> energy</li>
      <li><code>due:</code> / <code>start:</code> with <code>today</code>, <code>tmr</code>, <code>mon</code>…<code>sun</code>, <code>+3d</code>, <code>+2w</code>, <code>25/12</code>, <code>2026-12-25</code></li></ul>
    </section>
    <section class="card"><h2>Keyboard (Windows)</h2>
      <ul class="plain"><li><kbd>N</kbd> or <kbd>/</kbd> capture · <kbd>P</kbd> process inbox · <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd> switch views · <kbd>Esc</kbd> close</li></ul>
    </section>`;
};

// ---------- clarify / process wizard ----------
function processStart() {
  const first = inboxItems(doc())[0];
  if (!first) { toast('Inbox is empty'); return; }
  state.view = 'inbox';
  state.process = { id: first.id, step: 'actionable', history: [], skipped: [], draft: draftFrom(first) };
  render();
}

function draftFrom(i) {
  return {
    title: i.title, notes: i.notes || '', contexts: [...(i.contexts || [])], timeMin: i.timeMin, energy: i.energy,
    due: i.due, start: i.start, projectId: i.projectId, waitingOn: i.waitingOn || '', outcome: '',
    schedDate: i.schedDate || null, schedTime: i.schedTime || null,
  };
}

function processNextItem() {
  const p = state.process;
  const nextItem = inboxItems(doc()).find((i) => !p.skipped.includes(i.id));
  if (!nextItem) { state.process = { step: 'zero', skipped: p.skipped, history: [] }; render(); return; }
  state.process = { id: nextItem.id, step: 'actionable', history: [], skipped: p.skipped, draft: draftFrom(nextItem) };
  render();
}

function step(to, { read = true } = {}) {
  const p = state.process;
  if (read) readDraft();
  p.history.push(p.step);
  p.step = to;
  render();
}

function readDraft() {
  const p = state.process;
  if (!p?.draft) return;
  const TEXT = ['title', 'notes', 'outcome', 'waitingOn'];
  for (const el of $$('[data-draft]')) {
    const k = el.dataset.draft;
    p.draft[k] = TEXT.includes(k) ? el.value.trim() : el.value || null;
  }
}

function finishItem(patch) {
  const p = state.process;
  readDraft();
  const dr = p.draft;
  const base = {
    title: dr.title, notes: dr.notes, contexts: dr.contexts, timeMin: dr.timeMin, energy: dr.energy,
    due: dr.due || null, start: dr.start || null, projectId: dr.projectId || null,
    ...blockFields(dr.schedDate, dr.schedTime),
  };
  const id = p.id;
  store.updateItem(id, { ...base, ...patch });
  processNextItem();
  if (!patch.done) offerCalendar(id);
}

function processView() {
  const p = state.process;
  const remaining = inboxItems(doc()).length;
  if (p.step === 'zero') {
    return `${header('Inbox processed')}
      <div class="wizard done-card"><p class="big-emoji">✓</p><p><strong>${p.skipped.length ? `Done, apart from ${plural(p.skipped.length, 'skipped item')}.` : 'Inbox zero.'}</strong> Everything is where it belongs.</p>
      <div class="row"><button class="btn primary" data-action="nav" data-view="now">What should I do now?</button>
      ${p.skipped.length ? '<button class="btn" data-action="process-start">Go through skipped</button>' : ''}</div></div>`;
  }
  const item = doc().items[p.id];
  if (!item || item.deleted || item.list !== 'inbox' || item.done) { queueMicrotask(processNextItem); return ''; }
  const dr = p.draft;
  const vague = vagueHint(dr.title);
  const projects = live(doc().projects).filter((x) => x.status === 'active').sort((a, b) => a.title.localeCompare(b.title));
  const q = (title, help = '') => `<h2 class="q">${title}</h2>${help ? `<p class="hint">${help}</p>` : ''}`;
  let body = '';
  switch (p.step) {
    case 'actionable':
      body = `${q('Is it actionable?', 'Is there something you (or someone) need to do about this?')}
        <div class="choices"><button class="btn primary" data-action="p-go" data-to="multi">Yes</button><button class="btn" data-action="p-go" data-to="not">No</button></div>`;
      break;
    case 'not':
      body = `${q('Not actionable: where does it go?')}
        <div class="choices"><button class="btn" data-action="p-finish" data-list="someday">Someday / Maybe<small>Might do later</small></button>
        <button class="btn" data-action="p-finish" data-list="reference">Reference<small>Keep for info</small></button>
        <button class="btn danger" data-action="p-trash">Trash<small>Not needed</small></button></div>`;
      break;
    case 'multi':
      body = `${q('Will it take more than one action to finish?', 'If yes, it\'s a project: you\'ll define the outcome, then the first step.')}
        <div class="choices"><button class="btn" data-action="p-go" data-to="project">Yes, it's a project</button><button class="btn primary" data-action="p-go" data-to="action">No, single action</button></div>`;
      break;
    case 'project':
      body = `${q('Define the project')}
        <label>Outcome: what does "done" look like?<input data-draft="outcome" value="${esc(dr.outcome || dr.title)}" placeholder="e.g. Car serviced and MOT passed"></label>
        <label>Very next physical action<input data-draft="title" data-vague value="${dr.projectId ? esc(dr.title) : ''}" placeholder="e.g. Call garage to book service" autofocus></label>
        <p class="vague-hint" aria-live="polite"></p>
        <div class="choices"><button class="btn primary" data-action="p-project">Continue</button></div>`;
      break;
    case 'action':
      body = `${q('What\'s the very next physical action?', 'Make it something you could start without thinking: a verb, an object, a place.')}
        <label>Action<input data-draft="title" data-vague value="${esc(dr.title)}" autofocus></label>
        <p class="vague-hint" aria-live="polite">${vague ? esc(vague) : ''}</p>
        ${projects.length ? `<label>Part of a project? <select data-draft="projectId"><option value="">No project</option>${projects.map((x) => `<option value="${x.id}" ${dr.projectId === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>` : ''}
        <div class="choices"><button class="btn primary" data-action="p-go" data-to="two">Continue</button></div>`;
      break;
    case 'two':
      body = `${q('Will it take less than 2 minutes?', `<strong>${esc(dr.title)}</strong>`)}
        <div class="choices"><button class="btn primary" data-action="p-go" data-to="doit">Yes, do it now</button><button class="btn" data-action="p-go" data-to="who">No</button></div>`;
      break;
    case 'doit':
      body = `${q('Do it now', `<strong>${esc(dr.title)}</strong>. Faster than tracking it.`)}
        <div class="choices"><button class="btn primary" data-action="p-did">Done ✓</button><button class="btn" data-action="p-go" data-to="who">It's taking longer, keep it</button></div>`;
      break;
    case 'who':
      body = `${q('Are you the right person to do it?')}
        <div class="choices"><button class="btn primary" data-action="p-go" data-to="details">Yes, me</button><button class="btn" data-action="p-go" data-to="delegate">Delegate it</button></div>`;
      break;
    case 'delegate':
      body = `${q('Who are you handing it to?', 'Send the request now, then track it in Waiting for.')}
        <label>Waiting on<input data-draft="waitingOn" value="${esc(dr.waitingOn)}" placeholder="Name" autofocus></label>
        <label>Check back by (optional)<input type="date" data-draft="due" value="${esc(dr.due || '')}"></label>
        <div class="choices"><button class="btn primary" data-action="p-finish" data-list="waiting">Save to Waiting for</button></div>`;
      break;
    case 'details':
      body = `${q('When and where can you do it?', 'Only add dates if they are real. Context, time and energy are what the Now view filters on.')}
        <div class="filter-row"><span class="filter-label">Context</span>${doc().settings.contexts.map((c) => `<button class="pill ${dr.contexts.includes(c) ? 'on' : ''}" data-action="p-ctx" data-ctx="${esc(c)}">@${esc(c)}</button>`).join('')}</div>
        <div class="filter-row"><span class="filter-label">Time</span>${TIME_CHOICES.map((m) => `<button class="pill ${dr.timeMin === m ? 'on' : ''}" data-action="p-time" data-min="${m}">${fmtMin(m)}</button>`).join('')}</div>
        <div class="filter-row"><span class="filter-label">Energy</span>${['low', 'med', 'high'].map((e) => `<button class="pill ${dr.energy === e ? 'on' : ''}" data-action="p-energy" data-energy="${e}">${e}</button>`).join('')}</div>
        <div class="row dates"><label>Not before<input type="date" data-draft="start" value="${esc(dr.start || '')}"></label>
        <label>Deadline<input type="date" data-draft="due" value="${esc(dr.due || '')}"></label></div>
        <div class="row dates"><label>Block time on<input type="date" data-draft="schedDate" value="${esc(dr.schedDate || '')}"></label>
        <label>at<input type="time" data-draft="schedTime" value="${esc(dr.schedTime || '')}"></label></div>
        <p class="hint">A time block reserves a slot in your calendar; its length is the Time above (1h if not set).</p>
        <div class="choices"><button class="btn primary" data-action="p-finish" data-list="next">Save as next action</button></div>`;
      break;
    default:
      body = '';
  }
  return `${header('Clarify', `${plural(remaining, 'item')} left in inbox`)}
    <div class="wizard">
      <div class="wizard-item"><span class="label">Item</span><strong>${esc(item.title)}</strong>${item.notes ? `<p class="task-notes">${esc(item.notes)}</p>` : ''}</div>
      ${body}
      <div class="wizard-nav">${p.history.length ? '<button class="link" data-action="p-back">← Back</button>' : '<span></span>'}
        <span><button class="link" data-action="p-skip">Skip for now</button> · <button class="link" data-action="p-stop">Stop</button></span></div>
    </div>`;
}

// ---------- editor dialog ----------
function openEditor(id) {
  const i = doc().items[id];
  if (!i || i.deleted) return;
  state.editingId = id;
  const d = doc();
  const projects = live(d.projects).filter((p) => p.status !== 'done' || p.id === i.projectId).sort((a, b) => a.title.localeCompare(b.title));
  const ctxs = [...new Set([...d.settings.contexts, ...(i.contexts || [])])];
  const dlg = $('#editor');
  $('#editor-form').innerHTML = `
    <label>Action<input name="title" value="${esc(i.title)}" data-vague required></label>
    <p class="vague-hint" aria-live="polite">${esc(i.list === 'next' ? vagueHint(i.title) || '' : '')}</p>
    <label>Notes<textarea name="notes" rows="3">${esc(i.notes)}</textarea></label>
    <div class="grid2">
      <label>List<select name="list">${[['inbox', 'Inbox'], ['next', 'Next action'], ['waiting', 'Waiting for'], ['someday', 'Someday / Maybe'], ['reference', 'Reference']]
    .map(([v, l]) => `<option value="${v}" ${i.list === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Project<select name="projectId"><option value="">None</option>${projects.map((p) => `<option value="${p.id}" ${i.projectId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      <label>Time<select name="timeMin"><option value="">?</option>${[...new Set([...TIME_CHOICES, ...(i.timeMin ? [i.timeMin] : [])])].sort((a, b) => a - b)
    .map((m) => `<option value="${m}" ${i.timeMin === m ? 'selected' : ''}>${fmtMin(m)}</option>`).join('')}</select></label>
      <label>Energy<select name="energy"><option value="">?</option>${['low', 'med', 'high'].map((e) => `<option ${i.energy === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <label>Not before<input type="date" name="start" value="${esc(i.start || '')}"></label>
      <label>Deadline<input type="date" name="due" value="${esc(i.due || '')}"></label>
      <label>Block time on<input type="date" name="schedDate" value="${esc(i.schedDate || '')}"></label>
      <label>at<input type="time" name="schedTime" value="${esc(i.schedTime || '')}"></label>
    </div>
    <div class="row cal-row"><button type="button" class="btn small cal" data-action="editor-cal" data-kind="due">Deadline → Google Calendar</button>
      <button type="button" class="btn small cal" data-action="editor-cal" data-kind="block">Time block → Google Calendar</button></div>
    <p class="hint cal-status">${esc(calendarKinds(i).map((k) => `${k === 'due' ? 'Deadline' : 'Time block'}: ${{ none: 'not in calendar', added: 'added to calendar', outdated: 'calendar out of date' }[calendarState(i, k)]}`).join(' · '))}</p>
    <fieldset><legend>Contexts</legend><div class="filter-row">${ctxs.map((c) => `<label class="pill-check"><input type="checkbox" name="ctx" value="${esc(c)}" ${i.contexts?.includes(c) ? 'checked' : ''}><span>@${esc(c)}</span></label>`).join('')}</div></fieldset>
    <label class="waiting-field">Waiting on<input name="waitingOn" value="${esc(i.waitingOn || '')}"></label>
    <div class="row end"><button type="button" class="btn danger" data-action="editor-delete">Delete</button><span class="spacer"></span>
      <button type="button" class="btn" data-action="editor-cancel">Cancel</button><button class="btn primary">Save</button></div>`;
  dlg.showModal();
  toggleWaitingField();
}

// A time block needs both a date and a time; a lone time means today.
function blockFields(date, time) {
  if (!time) return { schedDate: null, schedTime: null };
  return { schedDate: date || today(), schedTime: time };
}

function saveEditor(form, { offer = true } = {}) {
  const f = new FormData(form);
  const id = state.editingId;
  const timeMin = f.get('timeMin') ? Number(f.get('timeMin')) : null;
  store.updateItem(id, {
    title: f.get('title').trim() || doc().items[id].title, notes: f.get('notes'), list: f.get('list'), projectId: f.get('projectId') || null,
    timeMin, energy: f.get('energy') || null, start: f.get('start') || null, due: f.get('due') || null,
    ...blockFields(f.get('schedDate'), f.get('schedTime')),
    contexts: f.getAll('ctx'), waitingOn: f.get('waitingOn').trim(),
  });
  $('#editor').close();
  if (offer) offerCalendar(id);
  return id;
}

// ---------- capture ----------
function capturePreview() {
  const v = $('#capture-input').value;
  const p = parseCapture(v, today());
  const bits = [];
  for (const c of p.contexts) bits.push(`@${esc(c)}`);
  if (p.project) bits.push(`Project: ${esc(p.project)}`);
  if (p.timeMin) bits.push(fmtMin(p.timeMin));
  if (p.energy) bits.push(`${p.energy} energy`);
  if (p.start) bits.push(`starts ${esc(fmtDay(p.start))}`);
  if (p.due) bits.push(`due ${esc(fmtDay(p.due))}`);
  if (p.schedTime) bits.push(`block ${esc(fmtDay(p.schedDate))} ${esc(p.schedTime)}`);
  $('#capture-preview').innerHTML = bits.map((b) => `<span class="chip">${b}</span>`).join('');
}

function capture(text, notes = '', { projectId: defaultProject = null, src = null } = {}) {
  const p = parseCapture(text, today());
  if (!p.title) return null;
  const projectId = p.project ? store.findOrCreateProject(p.project).id : defaultProject;
  return store.addItem({
    title: p.title, notes, contexts: p.contexts, projectId, timeMin: p.timeMin, energy: p.energy, due: p.due, start: p.start,
    schedDate: p.schedDate, schedTime: p.schedTime, ...(src ? { src } : {}),
  });
}

// ---------- toast ----------
let toastTimer;
function toast(msg, undo, label = 'Undo') {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button class="link" data-action="undo">${esc(label)}</button>` : ''}`;
  el.hidden = false;
  toast.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toast.undo = null; }, undo ? 8000 : 3000);
}

// ---------- render ----------
let deferredRender = false;
function isEditingMain() {
  const a = document.activeElement;
  return a && $('#main').contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value;
}

function render() {
  const d = doc();
  const t = today();
  const counts = {
    inbox: inboxItems(d).length,
    next: nextActions(d, t).length,
    projects: live(d.projects).filter((p) => projectHealth(d, p, t).stalled).length,
    waiting: openItems(d).filter((i) => i.list === 'waiting').length,
    review: reviewStatus(d, t).due ? '!' : '',
  };
  const navView = { project: 'projects', sweep: 'review', dump: 'now', triage: 'inbox' }[state.view] || state.view;
  $('#sidenav').innerHTML = VIEWS.map((v) => `<button class="${navView === v.id ? 'active' : ''}" data-action="nav" data-view="${v.id}" title="${v.label} (${v.key})">
      ${icon(v.id)}<span>${v.label}</span>${counts[v.id] ? `<span class="badge ${v.id === 'projects' || v.id === 'review' ? 'warn' : ''}">${counts[v.id]}</span>` : ''}</button>`).join('');
  const moreActive = !MOBILE_TABS.includes(navView);
  $('#tabbar').innerHTML = MOBILE_TABS.map((id) => {
    const label = id === 'more' ? 'More' : VIEWS.find((v) => v.id === id).label.split(' ')[0];
    const badge = id === 'more' ? counts.review : counts[id];
    return `<button class="${navView === id || (id === 'more' && moreActive) ? 'active' : ''}" data-action="nav" data-view="${id}">${icon(id)}<span>${label}</span>${badge ? `<span class="badge ${id === 'more' || id === 'projects' ? 'warn' : ''}">${badge}</span>` : ''}</button>`;
  }).join('');
  const html = (views[state.view] || views.now)();
  $('#main').innerHTML = html;
  const af = $('#main [autofocus]');
  if (af && matchMedia('(pointer: fine)').matches) af.focus();
  document.title = counts.inbox ? `(${counts.inbox}) Clearhead` : 'Clearhead';
  renderSync();
}

function renderSync() {
  const el = $('#sync-dot');
  if (!sync.connected) { el.hidden = true; return; }
  el.hidden = false;
  const st = sync.status;
  el.dataset.state = st.state;
  el.title = { syncing: 'Syncing…', ok: 'Synced', error: `Sync error: ${st.message}`, offline: st.message, idle: 'Sync ready' }[st.state] || '';
}

// ---------- events ----------
const actions = {
  nav: (el) => go(el.dataset.view),
  'open-project': (el) => go('project', { projectId: el.dataset.pid }),
  'toggle-done': (el, id) => {
    const i = doc().items[id];
    store.updateItem(id, { done: !i.done });
    if (!i.done) toast('Done', () => store.updateItem(id, { done: false }));
  },
  'toggle-focus': (el, id) => store.updateItem(id, { focus: !doc().items[id].focus }),
  edit: (el, id) => openEditor(id),
  'now-ctx': (el) => {
    const c = el.dataset.ctx;
    const set = new Set(state.now.contexts);
    if (set.has(c)) set.delete(c); else set.add(c);
    state.now.contexts = [...set];
    saveNow();
  },
  'now-time': (el) => { const m = Number(el.dataset.min); state.now.timeMin = state.now.timeMin === m ? null : m; saveNow(); },
  'now-energy': (el) => { const e = el.dataset.energy; state.now.energy = state.now.energy === e ? null : e; saveNow(); },
  'now-clear': () => { state.now = { contexts: [], timeMin: null, energy: null }; saveNow(); },
  'now-all': () => { state.showAllNow = !state.showAllNow; render(); },
  'next-filter': (el) => { state.nextFilter = el.dataset.ctx || null; prefs.set('nextFilter', state.nextFilter); render(); },
  'process-start': processStart,
  'p-go': (el) => step(el.dataset.to),
  'p-back': () => { const p = state.process; readDraft(); p.step = p.history.pop(); render(); },
  'p-skip': () => { state.process.skipped.push(state.process.id); processNextItem(); },
  'p-stop': () => { state.process = null; render(); },
  'p-trash': () => { const id = state.process.id; const before = doc().items[id]; store.deleteItem(id); toast('Deleted', () => store.restoreItem(before)); processNextItem(); },
  'p-finish': (el) => {
    const list = el.dataset.list;
    readDraft();
    if (list === 'waiting' && !state.process.draft.waitingOn) { toast('Who are you waiting on?'); return; }
    finishItem({ list, waitingOn: list === 'waiting' ? state.process.draft.waitingOn : '' });
  },
  'p-did': () => { finishItem({ list: 'next', done: true }); toast('Nice, done in under 2 minutes'); },
  'p-project': () => {
    readDraft();
    const dr = state.process.draft;
    if (!dr.title) { toast('Add the very next action'); return; }
    const fields = { title: dr.outcome || doc().items[state.process.id].title, outcome: dr.outcome };
    const existing = dr.projectId && doc().projects[dr.projectId];
    // The store change re-renders this step, so don't read the (reset) inputs again.
    dr.projectId = existing && !existing.deleted ? store.updateProject(dr.projectId, fields).id : store.addProject(fields).id;
    step('two', { read: false });
  },
  'p-ctx': (el) => {
    readDraft();
    const dr = state.process.draft;
    const c = el.dataset.ctx;
    dr.contexts = dr.contexts.includes(c) ? dr.contexts.filter((x) => x !== c) : [...dr.contexts, c];
    render();
  },
  'p-time': (el) => { readDraft(); const m = Number(el.dataset.min); state.process.draft.timeMin = state.process.draft.timeMin === m ? null : m; render(); },
  'p-energy': (el) => { readDraft(); const e = el.dataset.energy; state.process.draft.energy = state.process.draft.energy === e ? null : e; render(); },
  'sweep-start': () => startWalk('sweep'),
  'dump-start': () => startWalk('dump'),
  'dump-dismiss': () => { prefs.set('dumpDismissed', true); render(); },
  'walk-next': (el) => walkMove(el.dataset.walk, 1),
  'walk-back': (el) => walkMove(el.dataset.walk, -1),
  'walk-finish': (el) => walkMove(el.dataset.walk, 0, { finish: true }),
  triage: (el, id) => triage(id, el.dataset.to),
  'review-finish': () => {
    store.completeReview(today());
    prefs.set('reviewChecks', null);
    prefs.set('sweep', null);
    toast('Weekly review logged. Your system is current.');
    go('now');
  },
  'project-status': (el) => {
    store.updateProject(state.projectId, { status: el.dataset.status });
    toast(`Project ${{ done: 'completed', someday: 'moved to Someday', active: 'active' }[el.dataset.status]}`);
  },
  'project-delete': () => {
    if (!confirm('Delete this project? Its actions are kept as standalone actions.')) return;
    store.deleteProject(state.projectId);
    go('projects');
  },
  activate: (el) => { store.updateItem(el.dataset.id, { list: 'next' }); toast('Moved to Next actions'); },
  'follow-up': (el, id) => {
    const i = doc().items[id];
    store.addItem({ title: `Follow up with ${i.waitingOn || 'them'}: ${i.title}`, list: 'next', contexts: ['phone'], timeMin: 5, projectId: i.projectId });
    store.updateItem(i.id, { waitingSince: Date.now() });
    toast('Follow-up added to Next actions');
  },
  'sync-now': () => sync.run(),
  'sync-disconnect': () => { if (confirm('Stop syncing this device? Data on this device is kept.')) { sync.disconnect(); render(); } },
  export: () => {
    const blob = new Blob([JSON.stringify(doc(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clearhead-backup-${today()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'editor-cancel': () => $('#editor').close(),
  'cal-add': (el, id) => openCalendar(id, el.dataset.kind),
  'editor-cal': (el) => {
    const id = saveEditor($('#editor-form'), { offer: false });
    const i = doc().items[id];
    if (!calKey(i, el.dataset.kind)) { toast(el.dataset.kind === 'due' ? 'Set a deadline first' : 'Set a time for the block first'); return; }
    openCalendar(id, el.dataset.kind);
  },
  'editor-delete': () => {
    const id = state.editingId;
    const before = doc().items[id];
    store.deleteItem(id);
    $('#editor').close();
    toast('Deleted', () => store.restoreItem(before));
  },
  undo: () => { const fn = toast.undo; $('#toast').hidden = true; if (fn) fn(); },
};

function saveNow() {
  state.showAllNow = false;
  prefs.set('nowCtx', state.now);
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  const id = el.closest('[data-id]')?.dataset.id;
  fn(el, id);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'review-check') {
    const rs = reviewStatus(doc(), today());
    const checks = { ...reviewChecks(rs.periodStart), [el.dataset.step]: el.checked };
    prefs.set('reviewChecks', { period: rs.periodStart, done: checks });
    render();
  } else if (el.dataset.action === 'cal-offer') {
    prefs.set('calOffer', el.checked);
  } else if (el.dataset.action === 'review-day') {
    store.updateSettings({ reviewDay: Number(el.value) });
  } else if (el.dataset.action === 'import') {
    const file = el.files[0];
    if (!file) return;
    file.text().then((txt) => {
      store.mergeIn(normalizeDoc(JSON.parse(txt)));
      sync.schedule(0);
      toast('Imported and merged');
    }).catch(() => toast('That file could not be read'));
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'capture-input') capturePreview();
  if (el.hasAttribute('data-vague')) {
    const hint = el.closest('form, .wizard')?.querySelector('.vague-hint');
    if (hint) hint.textContent = vagueHint(el.value) || '';
  }
  if (el.closest('#editor-form') && el.name === 'list') toggleWaitingField();
});

function toggleWaitingField() {
  const f = $('#editor-form');
  const w = f.querySelector('.waiting-field');
  if (w) w.hidden = f.elements.list.value !== 'waiting' && !f.elements.waitingOn.value;
}
document.addEventListener('change', (e) => { if (e.target.closest('#editor-form') && e.target.name === 'list') toggleWaitingField(); });

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'capture') {
    const input = $('#capture-input');
    const item = capture(input.value);
    if (!item) return;
    input.value = '';
    capturePreview();
    toast('Captured to Inbox', () => store.deleteItem(item.id));
    return;
  }
  if (form.id === 'editor-form') { saveEditor(form); return; }
  const kind = form.dataset.form;
  const val = (n) => form.elements[n]?.value.trim() ?? '';
  if (kind === 'new-project') {
    if (!val('title')) return;
    const p = store.addProject({ title: val('title') });
    go('project', { projectId: p.id });
    toast('Project created. Now add its very next action.');
  } else if (kind === 'project-action') {
    const text = val('title');
    if (!text) return;
    const parsed = parseCapture(text, today());
    const added = store.addItem({ title: parsed.title, list: 'next', projectId: form.dataset.pid, contexts: parsed.contexts, timeMin: parsed.timeMin, energy: parsed.energy, due: parsed.due, start: parsed.start, schedDate: parsed.schedDate, schedTime: parsed.schedTime });
    const hint = vagueHint(parsed.title);
    if (hint) toast(hint);
    else offerCalendar(added.id);
  } else if (kind === 'project-edit') {
    store.updateProject(form.dataset.pid, { title: val('title') || 'Untitled project', outcome: val('outcome'), notes: form.elements.notes.value });
    toast('Project saved');
  } else if (kind === 'contexts') {
    const list = [...new Set(val('contexts').split(',').map((c) => c.trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
    store.updateSettings({ contexts: list });
    state.now.contexts = state.now.contexts.filter((c) => list.includes(c));
    prefs.set('nowCtx', state.now);
    toast('Contexts saved');
  } else if (kind === 'dropbox') {
    sync.appKey = val('appKey');
    sync.connect().catch((err) => toast(err.message));
  }
});

document.addEventListener('focusout', () => {
  if (deferredRender) setTimeout(() => { if (deferredRender && !isEditingMain()) { deferredRender = false; render(); } }, 0);
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'walk-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); walkMove(e.target.dataset.walk, 1); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === 'Escape' && e.target.id === 'capture-input') { e.target.blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('#editor').open) return;
  if (state.view === 'triage') {
    const t = TRIAGE.find((x) => x.key === e.key.toLowerCase()) || (e.key === 'Enter' && TRIAGE[0]);
    const id = $('.triage-card')?.dataset.id;
    if (t && id) { e.preventDefault(); triage(id, t.to); return; }
  }
  if (e.key === 'n' || e.key === '/') { e.preventDefault(); $('#capture-input').focus(); return; }
  if (e.key === 'p') { processStart(); return; }
  const v = VIEWS.find((x) => x.key === e.key);
  if (v) go(v.id);
});

$('#editor').addEventListener('close', () => { state.editingId = null; });

// ---------- startup ----------
store.subscribe(({ local }) => {
  if (!local && isEditingMain()) deferredRender = true;
  else render();
  if (local) sync.schedule();
});
sync.onStatus(() => {
  renderSync();
  if (state.view === 'settings' && !isEditingMain()) render();
});

async function start() {
  if (!matchMedia('(pointer: fine)').matches) $('#capture-input').placeholder = 'Capture anything…';
  render();
  await sync.handleRedirect().catch((e) => toast(e.message));
  const params = new URLSearchParams(location.search);
  if (params.has('share')) {
    const text = [params.get('title'), params.get('text')].filter(Boolean).join(' ').trim();
    const url = params.get('url') || '';
    if (text || url) {
      capture(text || url, text && url ? url : '');
      toast('Shared item captured to Inbox');
    }
    history.replaceState(null, '', location.pathname);
  }
  if (params.has('capture')) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => $('#capture-input').focus(), 50);
  }
  if (params.has('process')) {
    history.replaceState(null, '', location.pathname);
    processStart();
  }
  render();
  sync.run();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); sync.run(); } });
  addEventListener('online', () => sync.run());
  setInterval(() => { if (document.visibilityState === 'visible') sync.run(); }, 5 * 60 * 1000);
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

start();
