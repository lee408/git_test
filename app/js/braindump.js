// The first, full brain dump: gather every pile of "stuff", then a deep trigger list.
// Pure data + helpers, unit-tested in tests/braindump.test.mjs.

const card = (stage, area, id, q, hints) => ({ id, stage, area, q, hints });
const gather = (area, id, q, hints) => card('gather', area, id, q, hints);
const trigger = (area, id, q, hints) => card('trigger', area, id, q, hints);

// Stage 1: collect physical and digital piles. Name each thing that needs a decision.
export const GATHER = [
  gather('Physical stuff', 'g-desk', 'Your desk and work surfaces', ['Papers, letters, receipts, things to file', 'Objects that "need doing" (broken, to return, to sell)', 'Put the physical items in one pile or tray, then type a line for each']),
  gather('Physical stuff', 'g-drawers', 'Drawers, shelves and cupboards', ['Old projects, half-finished things', 'Gadgets, cables or kit to fix, sell or give away', 'Manuals, warranties, documents']),
  gather('Physical stuff', 'g-bag', 'Wallet, bag, pockets and car', ['Receipts, business cards, tickets', 'Notes on scraps of paper', 'Things you meant to drop off or return']),
  gather('Physical stuff', 'g-notes', 'Notebooks, sticky notes, whiteboards, old to-do lists', ['Every unfinished list item', 'Ideas scribbled in margins', 'Notes from meetings or calls']),
  gather('Physical stuff', 'g-mail', 'Post and paperwork piles', ['Unopened letters, bills, statements', 'Forms to fill, things to sign', 'Magazines or reading you are keeping "for later"']),
  gather('Physical stuff', 'g-home', 'Walk around your home', ['Each room: anything broken, cluttered or bugging you', 'Fridge door, noticeboard, hallway pile', 'Garage, shed, garden']),
  gather('Digital stuff', 'g-email', 'Email inbox(es)', ['Flagged, starred or "unread on purpose" emails', 'Replies you owe', 'Don\'t process them now: just list what needs action']),
  gather('Digital stuff', 'g-messages', 'Messages and chat apps', ['WhatsApp, SMS, Slack, Teams, social DMs', 'Questions you haven\'t answered', 'Plans you agreed to in a chat']),
  gather('Digital stuff', 'g-phone', 'Your phone', ['Notes app, voice memos, reminders', 'Screenshots and photos taken "to remember"', 'Old task or reminder apps']),
  gather('Digital stuff', 'g-computer', 'Computer: desktop, downloads and documents', ['Files sitting on the desktop or in Downloads', 'Half-written documents', 'Things to back up or organise']),
  gather('Digital stuff', 'g-browser', 'Browser tabs, bookmarks and reading lists', ['Every open tab is a decision you haven\'t made', 'Saved articles, videos, courses', 'Online orders and accounts to deal with']),
  gather('Digital stuff', 'g-calendar', 'Calendar: past month and next 3 months', ['Follow-ups from past meetings and events', 'Things to prepare, book or buy for what\'s coming', 'Recurring commitments you want to change']),
];

// Stage 2: the deep trigger list. Work through each area and write down anything it brings to mind.
export const TRIGGERS = [
  trigger('Work', 't-w-started', 'Work projects you\'ve started but not finished', ['Anything "in progress" for weeks', 'Things you are quietly avoiding', 'Projects that just need closing off']),
  trigger('Work', 't-w-tostart', 'Work projects you need or want to start', ['Improvements you have been meaning to make', 'Things your manager or team expect', 'Ideas you have pitched or been asked for']),
  trigger('Work', 't-w-commit', 'Commitments to your manager, colleagues and clients', ['Promises made in meetings, calls, corridors', 'Deadlines you agreed to', 'Favours and reviews']),
  trigger('Work', 't-w-comms', 'Calls, emails and messages to make or return', ['People to update', 'Introductions to make', 'Difficult conversations you are putting off']),
  trigger('Work', 't-w-writing', 'Writing: reports, proposals, documentation, presentations', ['Drafts to finish', 'Things to review for others', 'Notes to write up']),
  trigger('Work', 't-w-meetings', 'Meetings to set up, request or prepare for', ['Agendas, slides, pre-reading', '1:1s you need', 'Meetings to cancel or decline']),
  trigger('Work', 't-w-read', 'Things to read, review or learn for work', ['Reports, specs, articles', 'Courses or certifications', 'Tools to try']),
  trigger('Work', 't-w-money', 'Work finances', ['Expenses and receipts to submit', 'Budgets, forecasts, invoices', 'Purchases or approvals needed']),
  trigger('Work', 't-w-planning', 'Planning and goals', ['Objectives, OKRs, performance review', 'Events or launches to plan', 'Strategy questions nobody has answered']),
  trigger('Work', 't-w-people', 'People: team, hiring, feedback', ['Feedback to give or ask for', 'Recruiting, onboarding, handovers', 'Someone who needs support']),
  trigger('Work', 't-w-admin', 'Work admin, systems and equipment', ['Files to organise, access to sort', 'IT problems, software, hardware', 'Leave, timesheets, HR forms']),
  trigger('Work', 't-w-waiting', 'Things you\'re waiting on at work', ['Replies, approvals, deliverables from others', 'Orders, quotes, decisions', 'They become "Waiting for" items when you clarify']),
  trigger('Work', 't-w-career', 'Your career', ['Skills to build, next role, promotion', 'CV, LinkedIn, portfolio', 'Mentors, networking, side projects']),
  trigger('Home', 't-h-repairs', 'Home repairs and maintenance', ['Leaks, lights, appliances, doors, windows', 'Servicing: boiler, smoke alarms, filters', 'Tradespeople to call']),
  trigger('Home', 't-h-improve', 'Home improvements, decorating, furniture', ['Rooms you would like to change', 'Things to buy, build or hang', 'Storage and organisation']),
  trigger('Home', 't-h-clutter', 'Clutter: things to sort, sell, donate or throw out', ['Clothes, books, toys, gadgets', 'Loft, garage, under the bed', 'Digital clutter: photos, old accounts']),
  trigger('Home', 't-h-garden', 'Garden, outdoor space, pets, plants', ['Seasonal jobs', 'Vet, food, insurance, grooming', 'Tools and equipment']),
  trigger('Home', 't-h-utilities', 'Utilities and household services', ['Energy, water, broadband, phone contracts', 'Deals to switch, meter readings', 'Cleaning, deliveries, bins']),
  trigger('Money & admin', 't-m-bills', 'Bills and payments', ['Anything unpaid or overdue', 'Direct debits to set up or cancel', 'Refunds you are owed']),
  trigger('Money & admin', 't-m-banking', 'Banking, savings, budget, debts', ['Accounts to open, close or move', 'A budget you keep meaning to do', 'Loans, credit cards, overdrafts']),
  trigger('Money & admin', 't-m-tax', 'Tax and official paperwork', ['Tax return, receipts, deadlines', 'Benefits, council, licences', 'Letters you need to respond to']),
  trigger('Money & admin', 't-m-insurance', 'Insurance, pensions, investments, wills', ['Renewals coming up', 'Policies to check or compare', 'Will, power of attorney, beneficiaries']),
  trigger('Money & admin', 't-m-subs', 'Subscriptions and memberships', ['Streaming, apps, gym, magazines', 'Free trials about to charge', 'Things you never use']),
  trigger('Money & admin', 't-m-docs', 'Important documents and IDs', ['Passport, driving licence, ID expiry dates', 'Birth/marriage certificates, deeds', 'Scanning and backing up key documents']),
  trigger('Health', 't-hl-appts', 'Health appointments and check-ups', ['GP, dentist, optician, specialists', 'Prescriptions, vaccinations, tests', 'Symptoms you keep ignoring']),
  trigger('Health', 't-hl-body', 'Exercise, food and sleep', ['Habits to start or stop', 'Gear, classes, plans', 'Meal planning, shopping']),
  trigger('Health', 't-hl-mind', 'Mental health and rest', ['Stress, worries, things weighing on you', 'Time off, holidays, breaks', 'Support you would like']),
  trigger('People', 't-p-partner', 'Partner and family', ['Promises to partner, kids, parents', 'Plans, conversations, decisions to make together', 'Family admin: school, childcare, care']),
  trigger('People', 't-p-friends', 'Friends and wider circle', ['People to call, visit, reply to', 'Things borrowed or lent', 'Thank-yous, apologies, congratulations']),
  trigger('People', 't-p-events', 'Birthdays, anniversaries and celebrations', ['Next 3 months: cards, gifts, parties', 'Weddings, christenings, reunions', 'RSVPs to send']),
  trigger('People', 't-p-community', 'Community, volunteering, clubs', ['Commitments to groups', 'Things you said you would help with', 'Causes you want to support']),
  trigger('Errands', 't-e-buy', 'Things to buy', ['Household, clothes, gifts', 'Replacements for broken or worn-out things', 'Bigger purchases to research']),
  trigger('Errands', 't-e-return', 'Things to return, collect, drop off, post', ['Parcels, returns, repairs', 'Library books, borrowed items', 'Dry cleaning, prescriptions']),
  trigger('Errands', 't-e-car', 'Car, bike and transport', ['Service, MOT, tax, insurance', 'Repairs, tyres, cleaning', 'Travel cards, parking permits']),
  trigger('Plans', 't-pl-travel', 'Holidays and travel', ['Trips to book or plan', 'Documents, visas, insurance', 'Places you want to go']),
  trigger('Plans', 't-pl-upcoming', 'Upcoming events and deadlines (next 6 months)', ['Anything with a date that needs preparation', 'Seasonal: tax year, Christmas, school terms', 'Renewals and expiries']),
  trigger('Plans', 't-pl-hobbies', 'Hobbies, creative projects, fun', ['Things you want to make, play, practise', 'Kit to fix or buy', 'Classes or groups to join']),
  trigger('Plans', 't-pl-learn', 'Learning and personal growth', ['Books, courses, languages, skills', 'Things to read, watch, listen to', 'Questions you want answered']),
  trigger('Plans', 't-pl-someday', 'Someday / maybe: dreams and bigger ideas', ['"One day I\'d like to…"', 'Experiences, adventures, big changes', 'They\'re safe in Someday/Maybe once sorted']),
  trigger('Last sweep', 't-last-worries', 'Worries, open questions and decisions', ['Anything you lie awake thinking about', 'Decisions you keep postponing', 'Things you are unsure who should handle']),
  trigger('Last sweep', 't-last-else', 'Anything else at all?', ['Look around the room one more time', 'Scroll back through your calendar and messages', 'If it has your attention, it goes in']),
];

export function buildBrainDump() {
  return [...GATHER, ...TRIGGERS];
}

// Rapid triage of a large inbox. 'keep' leaves the item in the inbox for full clarifying.
export const TRIAGE = [
  { to: 'keep', label: 'Action', help: 'Keep it: clarify later', key: 'a' },
  { to: 'project', label: 'Project', help: 'Needs several steps', key: 'p' },
  { to: 'done', label: 'Done', help: 'Did it (< 2 min)', key: 'd' },
  { to: 'someday', label: 'Someday', help: 'Maybe later', key: 's' },
  { to: 'reference', label: 'Reference', help: 'Just info', key: 'r' },
  { to: 'trash', label: 'Trash', help: 'Not needed', key: 't' },
];

// The store patch for a triage choice ('project' and 'trash' are handled by the caller).
export function triagePatch(to) {
  switch (to) {
    case 'keep': return { triaged: true };
    case 'done': return { done: true, triaged: true };
    case 'someday': return { list: 'someday', triaged: true };
    case 'reference': return { list: 'reference', triaged: true };
    default: return null;
  }
}
