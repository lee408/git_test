// Pure GTD data logic: no DOM, no storage. Unit-tested in tests/model.test.mjs.

export const LISTS = ['inbox', 'next', 'waiting', 'someday', 'reference'];
export const DEFAULT_CONTEXTS = ['home', 'office', 'errands', 'computer', 'phone', 'deep', 'admin'];
export const ENERGY = ['low', 'med', 'high'];
const TOMBSTONE_TTL_DAYS = 180;
const COLLECTIONS = ['items', 'projects', 'reviews', 'practice'];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function emptyDoc() {
  return {
    version: 1,
    items: {},
    projects: {},
    reviews: {},
    practice: {}, // Miracle Morning (SAVERS) days, keyed by YYYY-MM-DD
    settings: { contexts: [...DEFAULT_CONTEXTS], reviewDay: 1, updatedAt: 0 },
  };
}

// Strictly increasing timestamp so a local edit always beats the version it replaced.
export function stamp(prev) {
  return Math.max(Date.now(), (prev?.updatedAt || 0) + 1);
}

// ---------- dates (local calendar days as YYYY-MM-DD) ----------

export function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Accepts: today, tod, tomorrow, tmr, mon..sun (next occurrence after today),
// +3d / +2w, YYYY-MM-DD, DD/MM. Returns YYYY-MM-DD or null.
export function parseDateWord(word, today) {
  const w = word.toLowerCase();
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tomorrow' || w === 'tmr' || w === 'tom') return addDays(today, 1);
  if (w === 'nextweek') return addDays(today, 7);
  const wd = WEEKDAYS.findIndex((d) => w.startsWith(d) && w.length >= 3);
  if (wd >= 0) {
    const cur = parseDay(today).getDay();
    let diff = (wd - cur + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  let m = w.match(/^\+(\d+)([dw])$/);
  if (m) return addDays(today, Number(m[1]) * (m[2] === 'w' ? 7 : 1));
  m = w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return w;
  m = w.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const year = parseDay(today).getFullYear();
    let s = isoDay(new Date(year, Number(m[2]) - 1, Number(m[1])));
    if (s < today) s = isoDay(new Date(year + 1, Number(m[2]) - 1, Number(m[1])));
    return s;
  }
  return null;
}

function parseDuration(s) {
  const m = s.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m?)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

// "14:00", "9am", "2:30pm", "0930" → "HH:MM" (24h) or null.
export function parseTime(s) {
  const m = String(s).toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (!m[2] && !m[3] && m[1].length > 2) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Time block: "14:00" (today), "fri-14:00", "tmr-9am", "2026-10-05-14:30" → { date, time } or null.
export function parseAt(s, today) {
  const t = parseTime(s);
  if (t) return { date: today, time: t };
  const m = String(s).match(/^(.+)[-@](.+)$/);
  if (!m) return null;
  const date = parseDateWord(m[1], today);
  const time = parseTime(m[2]);
  return date && time ? { date, time } : null;
}

// ---------- quick-capture shorthand ----------
// "Call Sam about invoice @phone +Tax_return ~10m !low due:fri start:+2d at:thu-14:00"
export function parseCapture(text, today) {
  const out = { title: '', contexts: [], project: null, timeMin: null, energy: null, due: null, start: null, schedDate: null, schedTime: null };
  const rest = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    let m;
    if ((m = tok.match(/^@([\w-]+)$/))) {
      const c = m[1].toLowerCase();
      if (!out.contexts.includes(c)) out.contexts.push(c);
    } else if ((m = tok.match(/^\+([\w-]+)$/)) && !/^\d+[dw]$/.test(m[1])) {
      out.project = m[1].replace(/_/g, ' ');
    } else if ((m = tok.match(/^~(\w+)$/)) && parseDuration(m[1]) !== null) {
      out.timeMin = parseDuration(m[1]);
    } else if ((m = tok.match(/^!(lo|low|med|mid|hi|high)$/i))) {
      const e = m[1].toLowerCase();
      out.energy = e.startsWith('l') ? 'low' : e.startsWith('h') ? 'high' : 'med';
    } else if ((m = tok.match(/^(due|start):(.+)$/i)) && parseDateWord(m[2], today)) {
      out[m[1].toLowerCase()] = parseDateWord(m[2], today);
    } else if ((m = tok.match(/^at:(.+)$/i)) && parseAt(m[1], today)) {
      ({ date: out.schedDate, time: out.schedTime } = parseAt(m[1], today));
    } else {
      rest.push(tok);
    }
  }
  out.title = rest.join(' ');
  return out;
}

// ---------- vague-action detector ----------
const FUZZY = ['sort', 'sort out', 'deal with', 'handle', 'look into', 'think about', 'work on',
  'organise', 'organize', 'plan', 'fix', 'finish', 'manage', 'figure out', 'tackle',
  'start', 'continue', 'improve', 'set up', 'setup', 'complete', 'address', 'follow up'];
const CONCRETE = ['call', 'email', 'text', 'message', 'buy', 'write', 'draft', 'read', 'book', 'pay',
  'send', 'review', 'print', 'ask', 'schedule', 'download', 'install', 'file', 'clean', 'cook', 'research',
  'phone', 'order', 'return', 'pick', 'drop', 'collect', 'submit', 'update', 'sign', 'fill', 'post',
  'reply', 'meet', 'discuss', 'search', 'google', 'list', 'outline', 'sketch', 'test', 'cancel', 'renew',
  'check', 'brainstorm', 'book', 'wash', 'tidy', 'move', 'upload', 'share', 'prepare', 'watch', 'listen',
  'visit', 'go', 'take', 'bring', 'find', 'compare', 'measure', 'try', 'practise', 'practice', 'mail',
  'scan', 'pack', 'remind', 'invite', 'confirm', 'register', 'apply', 'transfer', 'backup', 'back', 'add',
  'remove', 'delete', 'create', 'open', 'close', 'record', 'note', 'log', 'decide', 'choose', 'run'];

export function vagueHint(title) {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\s+/);
  const fuzzy = [...FUZZY].sort((a, b) => b.length - a.length).find((f) => t === f || t.startsWith(f + ' '));
  if (fuzzy) {
    return `"${fuzzy}" hides the real work. What would you physically do first? (e.g. call, email, draft, buy)`;
  }
  if (words.length <= 2 && !CONCRETE.includes(words[0])) {
    return 'Looks like a topic, not an action. Start with a verb you can picture doing: "Call…", "Draft…", "Buy…"';
  }
  return null;
}

// ---------- queries ----------

export function live(coll) {
  return Object.values(coll).filter((r) => !r.deleted);
}

export function openItems(doc) {
  return live(doc.items).filter((i) => !i.done);
}

export function isAvailable(item, today) {
  return !item.start || item.start <= today;
}

export function inboxItems(doc) {
  return openItems(doc).filter((i) => i.list === 'inbox').sort((a, b) => a.createdAt - b.createdAt);
}

export function nextActions(doc, today, { includeDeferred = false } = {}) {
  const activeProjects = new Set(live(doc.projects).filter((p) => p.status === 'active').map((p) => p.id));
  return openItems(doc).filter((i) => i.list === 'next'
    && (!i.projectId || activeProjects.has(i.projectId) || !doc.projects[i.projectId] || doc.projects[i.projectId].deleted)
    && (includeDeferred || isAvailable(i, today)));
}

export function projectActions(doc, projectId) {
  return openItems(doc).filter((i) => i.projectId === projectId);
}

export function projectHealth(doc, project, today) {
  const actions = projectActions(doc, project.id);
  const nexts = actions.filter((i) => i.list === 'next');
  const available = nexts.filter((i) => isAvailable(i, today));
  const waiting = actions.filter((i) => i.list === 'waiting');
  const stalled = project.status === 'active' && nexts.length === 0 && waiting.length === 0;
  return { actions, nexts, available, waiting, stalled };
}

// Ranks next actions for "what should I do now?". ctx: { contexts:[], timeMin, energy }.
export function suggestNow(doc, today, ctx = {}) {
  const want = new Set(ctx.contexts || []);
  const energyRank = { low: 0, med: 1, high: 2 };
  const candidates = nextActions(doc, today).filter((i) => {
    if (want.size && i.contexts?.length && !i.contexts.some((c) => want.has(c))) return false;
    if (ctx.timeMin && i.timeMin && i.timeMin > ctx.timeMin) return false;
    if (ctx.energy && i.energy && energyRank[i.energy] > energyRank[ctx.energy]) return false;
    return true;
  });
  const score = (i) => {
    let s = 0;
    if (i.focus) s += 100;
    if (i.due) {
      const d = daysBetween(today, i.due);
      if (d < 0) s += 80; else if (d === 0) s += 60; else if (d <= 2) s += 40; else if (d <= 7) s += 15;
    }
    if (want.size && i.contexts?.some((c) => want.has(c))) s += 10;
    if (ctx.timeMin && ctx.timeMin <= 15 && i.timeMin && i.timeMin <= 15) s += 8;
    s += Math.min(10, (Date.now() - (i.createdAt || Date.now())) / 86400000 / 3);
    return s;
  };
  return candidates
    .map((i) => ({ item: i, score: score(i) }))
    .sort((a, b) => b.score - a.score || a.item.createdAt - b.item.createdAt)
    .map((x) => x.item);
}

// ---------- weekly review ----------

// The review is due from the most recent reviewDay (0=Sun..6=Sat) on/before today
// until a review is completed on/after that day.
export function reviewStatus(doc, today) {
  const day = doc.settings.reviewDay ?? 1;
  const cur = parseDay(today).getDay();
  const periodStart = addDays(today, -((cur - day + 7) % 7));
  const done = live(doc.reviews).map((r) => r.day).sort();
  const last = done[done.length - 1] || null;
  const due = !last || last < periodStart;
  // Streak: consecutive review periods (weeks) with a completed review, counting back.
  let streak = 0;
  let start = due ? addDays(periodStart, -7) : periodStart;
  const daySet = done;
  for (;;) {
    const end = addDays(start, 7);
    if (daySet.some((d) => d >= start && d < end)) { streak++; start = addDays(start, -7); } else break;
  }
  return { due, last, periodStart, daysLate: due ? daysBetween(periodStart, today) : 0, streak };
}

// ---------- sync merge (per-record last-writer-wins with tombstones) ----------

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (a.updatedAt || 0) > (b.updatedAt || 0) ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b; // deterministic tie-break
}

function mergeColl(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) out[id] = newer(a[id], b[id]);
  return out;
}

export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    version: 1,
    items: mergeColl(a.items, b.items),
    projects: mergeColl(a.projects, b.projects),
    reviews: mergeColl(a.reviews, b.reviews),
    practice: mergeColl(a.practice, b.practice),
    settings: newer(a.settings, b.settings),
  };
}

export function sameDoc(a, b) {
  if (!a || !b) return false;
  for (const k of COLLECTIONS) {
    const ka = Object.keys(a[k] || {});
    if (ka.length !== Object.keys(b[k] || {}).length) return false;
    for (const id of ka) {
      if (!b[k][id] || b[k][id].updatedAt !== a[k][id].updatedAt) return false;
    }
  }
  return (a.settings?.updatedAt || 0) === (b.settings?.updatedAt || 0);
}

export function purgeTombstones(doc, nowMs = Date.now()) {
  const cutoff = nowMs - TOMBSTONE_TTL_DAYS * 86400000;
  for (const k of COLLECTIONS) {
    for (const [id, r] of Object.entries(doc[k])) if (r.deleted && r.updatedAt < cutoff) delete doc[k][id];
  }
  return doc;
}

export function normalizeDoc(raw) {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    items: raw.items || {},
    projects: raw.projects || {},
    reviews: raw.reviews || {},
    practice: raw.practice || {},
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
}
