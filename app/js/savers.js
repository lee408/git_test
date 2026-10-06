// Miracle Morning "Life SAVERS" (Hal Elrod): Silence, Affirmations, Visualization, Exercise,
// Reading, Scribing. Pure logic, unit-tested in tests/savers.test.mjs.
import { addDays, live } from './model.js';

export const STEPS = [
  { id: 'silence', letter: 'S', name: 'Silence',
    intro: 'Sit comfortably, breathe slowly, and let your mind settle. Meditation, prayer or quiet reflection.' },
  { id: 'affirmations', letter: 'A', name: 'Affirmations',
    intro: 'Read your affirmations out loud, with feeling: what you want, why it matters, who you are committed to being, and what you will do.' },
  { id: 'visualization', letter: 'V', name: 'Visualization',
    intro: 'Close your eyes. See yourself achieving your goals, then rehearse doing today\'s actions well, enjoying the process, even the hard parts.' },
  { id: 'exercise', letter: 'E', name: 'Exercise',
    intro: 'Get your heart rate up and wake your body. Follow the routine, at your own pace.' },
  { id: 'reading', letter: 'R', name: 'Reading',
    intro: 'Read a few pages of a book that helps you grow. Even 10 pages a day is 18 books a year.' },
  { id: 'scribing', letter: 'S', name: 'Scribing',
    intro: 'Write in your journal: what you\'re grateful for, what you\'re proud of, and what would make today great.' },
];

export const SCRIBING_PROMPTS = [
  'Three things I\'m grateful for…',
  'Something I\'m proud of from yesterday…',
  'What would make today great?',
  'One action today that moves me toward my vision…',
];

// Minutes per step, in STEPS order.
export const PRESETS = {
  express: { label: '6-minute express', minutes: [1, 1, 1, 1, 1, 1] },
  half: { label: '30 minutes', minutes: [5, 5, 5, 5, 5, 5] },
  full: { label: '60 minutes', minutes: [10, 5, 5, 10, 20, 10] },
};

export const DEFAULT_EXERCISES = ['Jumping jacks', 'Push-ups', 'Bodyweight squats', 'Lunges', 'Plank', 'Stretch: reach for the sky, touch your toes'];

export const DEFAULT_SAVERS = {
  preset: 'half',
  custom: [5, 5, 5, 5, 5, 5],
  affirmations: '',
  vision: '',
  exercises: DEFAULT_EXERCISES.join('\n'),
  breathing: true,
  autoAdvance: false,
  nowPrompt: true,
};

export function saversSettings(settings) {
  return { ...DEFAULT_SAVERS, ...(settings?.savers || {}) };
}

// Minutes per step for a preset name or 'custom'; each clamped to 0–60.
export function durations(cfg, preset = cfg.preset) {
  const raw = preset === 'custom' ? cfg.custom : (PRESETS[preset] || PRESETS.half).minutes;
  return STEPS.map((_, i) => Math.max(0, Math.min(60, Math.round(Number(raw?.[i]) || 0))));
}

export function exerciseList(cfg) {
  const list = String(cfg.exercises || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_EXERCISES;
}

// Which exercise to show after `elapsed` seconds of a `total`-second step: equal slices.
export function exerciseAt(list, elapsed, total) {
  if (!list.length || total <= 0) return 0;
  return Math.min(list.length - 1, Math.floor((elapsed / total) * list.length));
}

// Box breathing 4-4-4-4: phase label and progress for a given second.
export function breathPhase(seconds) {
  const phases = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
  const t = ((Math.floor(seconds) % 16) + 16) % 16;
  return { label: phases[Math.floor(t / 4)], count: 4 - (t % 4) };
}

export function dayRecord(doc, day) {
  const r = doc.practice?.[day];
  return r && !r.deleted ? r : null;
}

export const stepsDone = (rec) => (rec ? STEPS.filter((s) => rec.done?.[s.id]).length : 0);

// A day counts when the session was finished (reached the end), whatever was skipped.
// The streak runs back from today, or from yesterday if today isn't done yet.
export function saversStreak(doc, today) {
  const done = (d) => !!dayRecord(doc, d)?.finished;
  let day = done(today) ? today : addDays(today, -1);
  let streak = 0;
  while (done(day)) { streak++; day = addDays(day, -1); }
  return streak;
}

export function lastDays(doc, today, n = 30) {
  return Array.from({ length: n }, (_, k) => {
    const day = addDays(today, k - n + 1);
    const rec = dayRecord(doc, day);
    return { day, steps: stepsDone(rec), finished: !!rec?.finished };
  });
}

export function totalSessions(doc) {
  return live(doc.practice || {}).filter((r) => r.finished).length;
}
