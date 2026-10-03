// Mind sweep for the weekly review: guiding questions ("trigger list") to empty your head.
// Pure logic, unit-tested in tests/sweep.test.mjs.
import { live, projectHealth } from './model.js';

// Asked in this order: what's on your mind, calendar, projects, then life areas.
const OPENING = [
  { id: 'mind', area: 'Clear your head', q: 'What has been on your mind or nagging at you this week?',
    hints: ['Anything you keep remembering at odd moments', 'Worries, half-made decisions, things you said you would do', 'Don\'t filter: big, small, work, personal, all of it'] },
  { id: 'cal-back', area: 'Look back', q: 'Go through last week\'s calendar. What came out of it that isn\'t captured yet?',
    hints: ['Follow-ups from meetings, calls and events', 'Notes or promises made in passing', 'Things that got postponed or cancelled and need rescheduling'] },
  { id: 'cal-ahead', area: 'Look ahead', q: 'Look at the next 2 weeks. What needs preparing, booking or arranging?',
    hints: ['Meetings that need an agenda, slides or reading', 'Travel, tickets, childcare, lifts', 'Things you have to bring, buy or confirm beforehand'] },
  { id: 'horizon', area: 'Look ahead', q: 'What\'s coming up in the next few months?',
    hints: ['Deadlines, launches, exams, renewals', 'Holidays, trips, weddings, visits', 'Anything that will need work starting soon'] },
];

const NEW_PROJECTS = { id: 'proj-new', area: 'Projects', q: 'Have you started or committed to anything new that isn\'t a project yet?',
  hints: ['Outcomes you agreed to deliver', 'Ideas you have been talking about doing', 'Tip: "+Project_Name" on a line files it under that project'] };

const AREAS = [
  { id: 'w-promises', area: 'Work', q: 'What did you promise colleagues, your manager or clients?', hints: ['"I\'ll send you that…"', 'Actions you took away from meetings', 'Favours or reviews you agreed to do'] },
  { id: 'w-comms', area: 'Work', q: 'Which emails, messages or calls do you need to send or return?', hints: ['Unanswered threads you are avoiding', 'People waiting for a reply', 'Introductions or thank-yous'] },
  { id: 'w-docs', area: 'Work', q: 'What reports, documents or presentations need writing, finishing or reviewing?', hints: ['Drafts sitting half-done', 'Things others sent you to review', 'Documentation, notes or write-ups'] },
  { id: 'w-decisions', area: 'Work', q: 'What decisions are you putting off, or waiting on someone else to make?', hints: ['Approvals, budgets, hiring, priorities', 'Questions you need answered before you can move', 'Problems nobody has owned yet'] },
  { id: 'w-admin', area: 'Work', q: 'Any work admin to deal with?', hints: ['Expenses, timesheets, leave requests', 'Files to organise, tools or accounts to set up', 'Training, compliance, IT issues'] },
  { id: 'w-career', area: 'Work', q: 'What about your career and skills?', hints: ['Courses, certifications, things to learn', 'Conversations to have with your manager', 'CV, portfolio, networking, side projects'] },
  { id: 'h-repairs', area: 'Home & admin', q: 'What at home is broken, worn out or needs fixing?', hints: ['Appliances, leaks, lights, furniture', 'Car, bike, phone, computer', 'Things you have been "working around"'] },
  { id: 'h-money', area: 'Home & admin', q: 'Any money matters to handle?', hints: ['Bills, payments, refunds, taxes', 'Subscriptions to cancel or review', 'Savings, budget, pension, insurance'] },
  { id: 'h-paper', area: 'Home & admin', q: 'What paperwork or official stuff is waiting?', hints: ['Forms, letters, renewals (passport, licence, insurance)', 'Documents to file, scan or shred', 'Warranties, contracts, receipts'] },
  { id: 'h-appts', area: 'Home & admin', q: 'Which appointments need booking?', hints: ['Doctor, dentist, optician, haircut', 'Car service or MOT', 'Tradespeople, deliveries, viewings'] },
  { id: 'h-errands', area: 'Home & admin', q: 'What do you need to buy, return, collect or drop off?', hints: ['Groceries and household supplies', 'Returns and parcels', 'Things borrowed or lent'] },
  { id: 'h-home', area: 'Home & admin', q: 'Any home projects or clutter bothering you?', hints: ['Decluttering, cleaning, garden', 'Improvements or decorating', 'Digital clutter: photos, downloads, backups'] },
  { id: 'p-promises', area: 'People & personal', q: 'What did you promise family or friends?', hints: ['Plans you said you would make', 'Things to send, lend or help with', 'Visits or calls you owe'] },
  { id: 'p-contact', area: 'People & personal', q: 'Who do you need to call, reply to, thank or catch up with?', hints: ['Messages left unanswered', 'People you have been meaning to see', 'Anyone going through a hard time'] },
  { id: 'p-dates', area: 'People & personal', q: 'Any birthdays, anniversaries, gifts or celebrations coming up?', hints: ['Cards and presents to buy', 'Parties or dinners to organise', 'Things to RSVP to'] },
  { id: 'p-health', area: 'People & personal', q: 'What about your health and wellbeing?', hints: ['Exercise, sleep, diet', 'Check-ups, prescriptions, symptoms to look at', 'Rest, stress, things to stop doing'] },
  { id: 'p-fun', area: 'People & personal', q: 'What do you want to do for fun or growth?', hints: ['Hobbies, books, films, music', 'Trips, experiences, restaurants', 'Things to learn or make'] },
  { id: 'p-someday', area: 'People & personal', q: 'Any bigger dreams or "someday" ideas worth writing down?', hints: ['Places to go, skills to master', 'Changes you would like to make', 'They go to the inbox; park them in Someday/Maybe when processing'] },
];

const CLOSING = { id: 'last', area: 'Last sweep', q: 'Anything else at all? One last scan of your head.',
  hints: ['Check your notebook, desk, pockets, bag', 'Screenshots, downloads, browser tabs, voice notes', 'Messages and email you flagged but never acted on'] };

function projectPrompt(doc, p, today) {
  const h = projectHealth(doc, p, today);
  const hints = [];
  if (p.outcome && p.outcome.trim().toLowerCase() !== p.title.trim().toLowerCase()) hints.push(`Done looks like: ${p.outcome}`);
  if (h.stalled) hints.push('No next action yet: what is the very next physical step?');
  else if (h.nexts[0]) hints.push(`Current next action: "${h.nexts[0].title}". Is it still right? What comes after it?`);
  if (h.waiting.length) hints.push(`Waiting on: ${h.waiting.map((i) => i.waitingOn || i.title).join(', ')}. Anything to chase?`);
  hints.push('Anything to research, decide, buy, ask someone or schedule?');
  hints.push('Any risks, worries or ideas about this project?');
  return {
    id: `proj-${p.id}`, area: 'Project', projectId: p.id, stalled: h.stalled,
    q: `${p.title}: what's unfinished, unclear or not yet captured?`, hints,
  };
}

// The full list of sweep cards for this doc: opening, every active project, life areas, closing.
export function buildSweep(doc, today) {
  const projects = live(doc.projects).filter((p) => p.status === 'active')
    .map((p) => ({ p, h: projectHealth(doc, p, today) }))
    .sort((a, b) => (b.h.stalled - a.h.stalled) || a.p.title.localeCompare(b.p.title))
    .map(({ p }) => projectPrompt(doc, p, today));
  return [...OPENING, ...projects, NEW_PROJECTS, ...AREAS, CLOSING];
}

// One captured item per non-empty line; strips list bullets and checkboxes people paste in.
export function splitLines(text) {
  return String(text || '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s*/, '').trim())
    .filter(Boolean);
}
