/**
 * seed.ts — a believable three weeks of history.
 *
 * A wellbeing app with empty states is a wellbeing app nobody can evaluate: you
 * cannot see the insight engine, the streak logic, or the mood chart until there
 * is something in them. So a first-time visitor arrives to a populated, alive
 * app rather than five placeholder cards saying "no data yet".
 *
 * The history is deliberately *imperfect*, because a perfect one would be worse
 * than none — it would silently teach the user that the app expects perfection:
 *
 *   - two abandoned sessions (`completed: false`), one of them at 3am
 *   - scattered missed days in the first week
 *   - a five-day gap (13-17 July) and an unremarkable return
 *   - mood trending upward but never monotonically: two 1s, several 2s after
 *     good days, and the best day of week one is better than several days of
 *     week three
 *
 * Timestamps are local-naive ISO (no trailing Z) so `new Date(s)` reads them in
 * the viewer's own timezone — a 3am entry stays at 3am wherever it is opened.
 * Everything is anchored to SEED_ANCHOR_DATE; today itself is left empty on
 * purpose, so the home screen has something to invite.
 */

import type { MoodEntry, Session } from '../lib/types.ts';

/** The "today" this history was written against. */
export const SEED_ANCHOR_DATE = '2026-07-25';

export const SEED_SESSIONS: Session[] = [
  // ── week one: found the app on a bad night, kept poking at it ─────────
  {
    id: 's-01',
    practiceId: 'med-ground-panic',
    kind: 'meditation',
    startedAt: '2026-07-05T23:04:00',
    seconds: 300,
    completed: true,
    moodBefore: 2,
    moodAfter: 3,
    note: 'Found this at eleven at night. Was not expecting it to do anything.',
  },
  {
    id: 's-02',
    practiceId: 'breath-two-sips',
    kind: 'breathwork',
    startedAt: '2026-07-06T18:22:00',
    seconds: 180,
    completed: true,
    moodBefore: 2,
    moodAfter: 3,
  },
  {
    id: 's-03',
    practiceId: 'med-unclench',
    kind: 'meditation',
    startedAt: '2026-07-08T22:41:00',
    seconds: 190,
    completed: false,
    moodBefore: 2,
    note: 'Got interrupted. Left it running for a bit and then gave up.',
  },
  {
    id: 's-04',
    practiceId: 'breath-four-walls',
    kind: 'breathwork',
    startedAt: '2026-07-09T21:15:00',
    seconds: 360,
    completed: true,
    moodBefore: 3,
    moodAfter: 4,
    note: 'The counting is annoying in a useful way.',
  },
  {
    id: 's-05',
    practiceId: 'yoga-desk',
    kind: 'yoga',
    startedAt: '2026-07-11T15:47:00',
    seconds: 300,
    completed: true,
    moodBefore: 3,
    moodAfter: 3,
  },
  {
    id: 's-06',
    practiceId: 'breath-down-the-stairs',
    kind: 'breathwork',
    startedAt: '2026-07-12T23:38:00',
    seconds: 300,
    completed: true,
    moodBefore: 2,
    moodAfter: 3,
    note: 'Sunday night. Slept about the same but minded it less.',
  },

  // ── 13-17 July: nothing. Five days. It happens. ───────────────────────

  // ── week three: came back without making a ceremony of it ─────────────
  {
    id: 's-07',
    practiceId: 'journal-three-lines',
    kind: 'journal',
    startedAt: '2026-07-18T09:26:00',
    seconds: 240,
    completed: true,
    moodBefore: 2,
    moodAfter: 3,
    note: 'Back. Picked the shortest one so I could not talk myself out of it.',
  },
  {
    id: 's-08',
    practiceId: 'yoga-spine',
    kind: 'yoga',
    startedAt: '2026-07-19T10:52:00',
    seconds: 705,
    completed: true,
    moodBefore: 3,
    moodAfter: 4,
    note: 'Back feels like it belongs to me again.',
  },
  {
    id: 's-09',
    practiceId: 'breath-green-room',
    kind: 'breathwork',
    startedAt: '2026-07-20T10:44:00',
    seconds: 300,
    completed: true,
    moodBefore: 2,
    moodAfter: 4,
    note: 'Ten minutes before the review. Hands still shook. Got through it anyway.',
  },
  {
    id: 's-10',
    practiceId: 'med-focus-runway',
    kind: 'meditation',
    startedAt: '2026-07-21T08:31:00',
    seconds: 600,
    completed: true,
    moodBefore: 3,
    moodAfter: 3,
  },
  {
    id: 's-11',
    practiceId: 'sleep-three-am',
    kind: 'sleep',
    startedAt: '2026-07-23T03:14:00',
    seconds: 642,
    completed: false,
    moodBefore: 1,
    note: 'Do not remember the end of this one, which I think is the point.',
  },
  {
    id: 's-12',
    practiceId: 'med-unclench',
    kind: 'meditation',
    startedAt: '2026-07-23T21:38:00',
    seconds: 480,
    completed: true,
    moodBefore: 3,
    moodAfter: 4,
  },
  {
    id: 's-13',
    practiceId: 'breath-in-step',
    kind: 'breathwork',
    startedAt: '2026-07-24T20:05:00',
    seconds: 600,
    completed: true,
    moodBefore: 3,
    moodAfter: 4,
    note: 'Easiest one so far. No holds, nothing to get wrong.',
  },
];

export const SEED_MOODS: MoodEntry[] = [
  // ── week one ─────────────────────────────────────────────────────────
  {
    id: 'm-01',
    at: '2026-07-05T22:10:00',
    score: 2,
    feelings: ['anxious', 'wired'],
    note: 'Chest has been tight since about four.',
  },
  { id: 'm-02', at: '2026-07-06T08:30:00', score: 2, feelings: ['tired', 'flat'] },
  { id: 'm-03', at: '2026-07-06T21:40:00', score: 3, feelings: ['calmer'] },
  {
    id: 'm-04',
    at: '2026-07-07T19:15:00',
    score: 2,
    feelings: ['irritable', 'overloaded'],
    note: 'Everything is slightly too much today.',
  },
  { id: 'm-05', at: '2026-07-08T22:52:00', score: 2, feelings: ['restless'] },
  { id: 'm-06', at: '2026-07-09T12:05:00', score: 3, feelings: ['steady'] },
  {
    id: 'm-07',
    at: '2026-07-09T22:20:00',
    score: 4,
    feelings: ['calm', 'relieved'],
    note: 'First properly good evening in a while.',
  },
  { id: 'm-08', at: '2026-07-10T18:00:00', score: 2, feelings: ['flat', 'lonely'] },
  { id: 'm-09', at: '2026-07-11T10:15:00', score: 3, feelings: ['okay'] },
  {
    id: 'm-10',
    at: '2026-07-12T23:30:00',
    score: 2,
    feelings: ['anxious', 'tired'],
    note: 'The Sunday night thing.',
  },

  // ── the gap. Fewer entries, lower numbers. ───────────────────────────
  { id: 'm-11', at: '2026-07-14T08:05:00', score: 2, feelings: ['tired'] },
  {
    id: 'm-12',
    at: '2026-07-15T21:00:00',
    score: 1,
    feelings: ['low', 'numb'],
    note: 'Did not want to open this today.',
  },
  { id: 'm-13', at: '2026-07-16T20:30:00', score: 2, feelings: ['flat'] },
  {
    id: 'm-14',
    at: '2026-07-17T13:00:00',
    score: 2,
    feelings: ['guilty', 'tired'],
    note: 'Five days off. Trying not to make it mean anything.',
  },

  // ── the return ───────────────────────────────────────────────────────
  { id: 'm-15', at: '2026-07-18T09:20:00', score: 3, feelings: ['determined'] },
  { id: 'm-16', at: '2026-07-18T21:04:00', score: 3, feelings: ['okay', 'tired'] },
  {
    id: 'm-17',
    at: '2026-07-19T11:12:00',
    score: 4,
    feelings: ['light', 'grateful'],
    note: 'Went for a walk afterwards, which I had not planned.',
  },
  {
    id: 'm-18',
    at: '2026-07-20T08:45:00',
    score: 2,
    feelings: ['nervous'],
    note: 'Review at eleven.',
  },
  { id: 'm-19', at: '2026-07-20T13:30:00', score: 4, feelings: ['relieved', 'proud'] },
  { id: 'm-20', at: '2026-07-21T20:00:00', score: 3, feelings: ['scattered'] },
  {
    id: 'm-21',
    at: '2026-07-22T19:40:00',
    score: 2,
    feelings: ['drained'],
    note: 'Skipped today. Genuinely fine about it.',
  },
  {
    id: 'm-22',
    at: '2026-07-23T03:20:00',
    score: 1,
    feelings: ['awake', 'anxious'],
    note: 'Three in the morning again.',
  },
  {
    id: 'm-23',
    at: '2026-07-23T21:30:00',
    score: 4,
    feelings: ['softer'],
    note: 'Better evening than the night deserved.',
  },
  { id: 'm-24', at: '2026-07-24T08:10:00', score: 3, feelings: ['steady'] },
  { id: 'm-25', at: '2026-07-24T22:00:00', score: 4, feelings: ['calm', 'content'] },
  { id: 'm-26', at: '2026-07-25T08:34:00', score: 4, feelings: ['rested', 'hopeful'] },
];
