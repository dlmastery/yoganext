/**
 * insights.ts — derived observations from the user's own data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HONESTY CONSTRAINT
 * ─────────────────────────────────────────────────────────────────────────────
 * This is a mental-health app, and both the UI and the agent render what comes
 * out of here **verbatim**. "Breathwork lifts your mood" is a claim about
 * someone's inner life; making it from one sample is not a rounding error, it is
 * a lie that a person may then organise their week around. So:
 *
 *   - Nothing is reported below `MIN_N` paired observations. Under the floor the
 *     result is returned marked `insufficient` — present, so the UI can say
 *     "not enough data yet", never silently dropped and never averaged.
 *   - `confidence` is a function of `n` alone. It is not a hedge word chosen for
 *     tone; `low` genuinely means "this could easily be noise".
 *   - Rates (completion by time of day) need a higher floor than means, because
 *     a 2-of-2 ratio reads as a confident 100% while carrying no information.
 *   - No insight ever states a cause. "Your mood is higher after breathwork" is
 *     reportable; "breathwork improves your mood" is not, and does not appear in
 *     any string in this file.
 *
 * Every function is pure and takes `now`/`today` as a parameter.
 */

import type { AppState, PracticeKind, Session } from './types.ts';
import { computeStreak, daysPractisedIn } from './habit.ts';
import { clamp01, dayKey, hourOf, mean, percent, plural, round } from './format.ts';

/** Paired observations required before a mean may be reported at all. */
export const MIN_N = 3;
/** Rates need more evidence than means — 2-of-2 looks certain and isn't. */
export const MIN_N_RATE = 5;

export type Confidence = 'low' | 'medium' | 'high';

export interface Insight {
  id: string;
  /** One short sentence. Rendered verbatim by the UI and the agent. */
  headline: string;
  /** The evidence behind it, including `n`. Also rendered verbatim. */
  detail: string;
  confidence: Confidence;
}

/** Confidence from sample size alone. No other input is permitted. */
export function confidenceFor(n: number): Confidence {
  if (n >= 10) return 'high';
  if (n >= 5) return 'medium';
  return 'low';
}

// ───────────────────────────────────────────────────────────────── mood delta ──

export interface MoodDelta {
  kind: PracticeKind;
  /** Sessions with BOTH moodBefore and moodAfter. Anything else is unusable. */
  n: number;
  /** Mean (after − before) on the 1..5 scale. Meaningless when `insufficient`. */
  delta: number;
  meanBefore: number;
  meanAfter: number;
  /** True when `n < MIN_N` — the caller must not present `delta`. */
  insufficient: boolean;
}

const PAIRED = (s: Session): boolean =>
  !!s && s.completed && s.moodBefore != null && s.moodAfter != null;

/**
 * Average mood change per practice kind.
 *
 * Returns a row for every kind actually attempted, including the ones under the
 * floor — an honest "we don't know yet" is an answer, and hiding the row would
 * let the caller assume the kind was never tried.
 */
export function moodDelta(sessions: readonly Session[]): MoodDelta[] {
  const byKind = new Map<PracticeKind, Session[]>();
  for (const s of sessions ?? []) {
    if (!s || !s.completed) continue;
    const bucket = byKind.get(s.kind) ?? [];
    bucket.push(s);
    byKind.set(s.kind, bucket);
  }

  const out: MoodDelta[] = [];
  for (const [kind, all] of byKind) {
    const paired = all.filter(PAIRED);
    const before = paired.map((s) => s.moodBefore as number);
    const after = paired.map((s) => s.moodAfter as number);
    const n = paired.length;
    out.push({
      kind,
      n,
      delta: n >= MIN_N ? round(mean(after) - mean(before), 2) : 0,
      meanBefore: n >= MIN_N ? round(mean(before), 2) : 0,
      meanAfter: n >= MIN_N ? round(mean(after), 2) : 0,
      insufficient: n < MIN_N,
    });
  }
  // Reportable rows first, strongest lift at the top; unusable rows sink.
  return out.sort((a, b) =>
    a.insufficient === b.insufficient ? b.delta - a.delta : a.insufficient ? 1 : -1,
  );
}

// ─────────────────────────────────────────────────────────────── time of day ──

export type BandId = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

interface Band {
  id: BandId;
  label: string;
  from: number;
  to: number; // exclusive; `night` wraps past midnight
}

export const BANDS: readonly Band[] = [
  { id: 'dawn', label: 'before 8am', from: 5, to: 8 },
  { id: 'morning', label: 'the morning', from: 8, to: 12 },
  { id: 'afternoon', label: 'the afternoon', from: 12, to: 17 },
  { id: 'evening', label: 'the evening', from: 17, to: 21 },
  { id: 'night', label: 'late at night', from: 21, to: 5 },
];

export function bandOf(hour: number): BandId | null {
  if (hour < 0 || hour > 23) return null;
  for (const b of BANDS) {
    const hit = b.from < b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to;
    if (hit) return b.id;
  }
  return null;
}

export interface TimeOfDayResult {
  band: BandId | null;
  label: string;
  /** Completed ÷ started within the winning band. */
  completionRate: number;
  /** Sessions STARTED in that band — the denominator, not the numerator. */
  n: number;
  insufficient: boolean;
  /** Every band, for the chart; bands under the floor are flagged too. */
  bands: Array<{ id: BandId; label: string; n: number; completionRate: number; insufficient: boolean }>;
}

/**
 * The time band where practices are most likely to be finished.
 *
 * Started-but-abandoned sessions are the whole point of the metric, so the
 * denominator is every session started in the band, not just completed ones.
 */
export function bestTimeOfDay(sessions: readonly Session[]): TimeOfDayResult {
  const tally = new Map<BandId, { started: number; done: number }>();
  for (const s of sessions ?? []) {
    if (!s) continue;
    const band = bandOf(hourOf(s.startedAt));
    if (!band) continue;
    const row = tally.get(band) ?? { started: 0, done: 0 };
    row.started++;
    if (s.completed) row.done++;
    tally.set(band, row);
  }

  const bands = BANDS.map((b) => {
    const row = tally.get(b.id) ?? { started: 0, done: 0 };
    return {
      id: b.id,
      label: b.label,
      n: row.started,
      completionRate: row.started > 0 ? round(row.done / row.started, 3) : 0,
      insufficient: row.started < MIN_N_RATE,
    };
  });

  const eligible = bands.filter((b) => !b.insufficient);
  if (eligible.length === 0) {
    const best = bands.reduce((a, b) => (b.n > a.n ? b : a), bands[0]);
    return {
      band: null,
      label: '',
      completionRate: 0,
      n: best?.n ?? 0,
      insufficient: true,
      bands,
    };
  }

  const winner = eligible.reduce((a, b) =>
    b.completionRate > a.completionRate || (b.completionRate === a.completionRate && b.n > a.n) ? b : a,
  );
  return {
    band: winner.id,
    label: winner.label,
    completionRate: winner.completionRate,
    n: winner.n,
    insufficient: false,
    bands,
  };
}

// ──────────────────────────────────────────────────────────────── consistency ──

export interface ConsistencyResult {
  /** Days practised ÷ days in the window. */
  fraction: number;
  daysPractised: number;
  /** Window length, clipped to the days actually observed since the first session. */
  window: number;
  /** Days of history available — small windows make the fraction jumpy. */
  observed: number;
}

/**
 * Fraction of the last `days` days on which a session was completed.
 *
 * `today` is a parameter (the brief's `consistency(practiceDays, days)` shape
 * cannot be pure — the window has to be anchored somewhere).
 *
 * The window is clipped to the history actually available: someone three days
 * into the app who practised all three days is at 100%, not 11%. Punishing a
 * new user for days that predate their first session would be both wrong and
 * discouraging. `observed` is exposed so the caller can gate its confidence.
 */
export function consistency(
  practiceDays: readonly string[],
  today: string,
  days = 28,
): ConsistencyResult {
  const sorted = [...new Set(practiceDays ?? [])].filter(Boolean).sort();
  if (sorted.length === 0) {
    return { fraction: 0, daysPractised: 0, window: days, observed: 0 };
  }
  const firstDay = sorted[0];
  const sinceStart = Math.max(1, daysInclusive(firstDay, today));
  const window = Math.max(1, Math.min(days, sinceStart));
  const daysPractised = daysPractisedIn(sorted, today, window);
  return {
    fraction: clamp01(daysPractised / window),
    daysPractised,
    window,
    observed: sinceStart,
  };
}

function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

// ───────────────────────────────────────────────────────────────── summarize ──

const KIND_LABEL: Record<PracticeKind, string> = {
  meditation: 'Meditation',
  breathwork: 'Breathwork',
  yoga: 'Yoga',
  sleep: 'Sleep practice',
  journal: 'Journalling',
};

/**
 * The insight feed. Every string here is rendered verbatim to a person who may
 * be having a hard day — plain, specific, and never more confident than `n`
 * allows. Ordered so the factual rows (streak, consistency) come before the
 * inferential ones (mood, timing).
 *
 * `now` defaults to the wall clock ONLY because the UI adapter
 * (`components/ui/useAppData.ts`) calls `summarize(state)` with one argument.
 * This is the presentation layer of the engine, not one of its primitives —
 * `computeStreak`, `moodDelta`, `bestTimeOfDay` and `consistency` all still
 * require the caller to supply the date, and the tests drive those directly.
 * Pass `now` explicitly wherever determinism matters.
 */
export function summarize(state: AppState, now: string = new Date().toISOString()): Insight[] {
  const today = dayKey(now);
  const out: Insight[] = [];
  const sessions = (state.sessions ?? []).filter(Boolean);
  const done = sessions.filter((s) => s.completed);

  // Nothing to say yet — say that, rather than reaching for a platitude.
  if (done.length === 0) {
    return [
      {
        id: 'no-data',
        headline: 'Nothing to report yet.',
        detail:
          'Insights appear once you have practised a few times — they are drawn from your own sessions, not from averages of other people.',
        confidence: 'low',
      },
    ];
  }

  // ── streak: an observation, not an inference. Confidence is high because we
  //    are reporting a count, not estimating anything.
  const streak = computeStreak(state.habit.practiceDays, today);
  if (streak.streak > 0) {
    out.push({
      id: 'streak',
      headline:
        streak.streak === 1
          ? 'You have practised today.'
          : `You are ${plural(streak.streak, 'day')} into a streak.`,
      detail:
        streak.absorbed.length > 0
          ? `${plural(streak.absorbed.length, 'missed day')} along the way ${streak.absorbed.length === 1 ? 'was' : 'were'} absorbed by grace, so the run held. Best so far: ${plural(state.habit.bestStreak, 'day')}.`
          : `Best so far: ${plural(state.habit.bestStreak, 'day')}. You have ${streak.graceRemaining > 0 ? 'a grace day in hand this week' : 'no grace left this week'}.`,
      confidence: 'high',
    });
  } else if (state.habit.bestStreak > 0) {
    out.push({
      id: 'streak-paused',
      headline: 'The streak has paused.',
      detail: `Your longest run was ${plural(state.habit.bestStreak, 'day')}. Starting again is the same action as continuing — one session resets the counter to one.`,
      confidence: 'high',
    });
  }

  // ── consistency
  const c = consistency(state.habit.practiceDays, today, 28);
  if (c.observed >= 7) {
    out.push({
      id: 'consistency',
      headline: `You practised on ${percent(c.fraction)} of the last ${plural(c.window, 'day')}.`,
      detail: `That is ${plural(c.daysPractised, 'day')} out of ${c.window}. Consistency moves this number far more than session length does.`,
      confidence: confidenceFor(c.window),
    });
  }

  // ── mood by kind: the strongest claim in the app, so the tightest gate
  const deltas = moodDelta(sessions);
  const reportable = deltas.filter((d) => !d.insufficient);
  if (reportable.length > 0) {
    const top = reportable[0];
    const direction = top.delta > 0 ? 'higher' : top.delta < 0 ? 'lower' : 'unchanged';
    out.push({
      id: `mood-${top.kind}`,
      headline:
        top.delta === 0
          ? `${KIND_LABEL[top.kind]} leaves your mood about where it started.`
          : `Your mood is ${Math.abs(top.delta).toFixed(1)} points ${direction} after ${KIND_LABEL[top.kind].toLowerCase()}.`,
      detail: `Across ${plural(top.n, 'session')} where you logged mood before and after: ${top.meanBefore.toFixed(1)} → ${top.meanAfter.toFixed(1)} on the 1–5 scale. This is an association in your own data, not a cause.`,
      confidence: confidenceFor(top.n),
    });
  } else {
    const pairedTotal = deltas.reduce((sum, d) => sum + d.n, 0);
    out.push({
      id: 'mood-insufficient',
      headline: 'Not enough mood data to say anything yet.',
      detail: `${plural(pairedTotal, 'session')} so far ${pairedTotal === 1 ? 'has' : 'have'} a mood logged both before and after. It takes ${MIN_N} of one kind before an average means anything.`,
      confidence: 'low',
    });
  }

  // ── time of day
  const timing = bestTimeOfDay(sessions);
  if (!timing.insufficient) {
    out.push({
      id: 'time-of-day',
      headline: `You finish what you start in ${timing.label}.`,
      detail: `${percent(timing.completionRate)} of the ${plural(timing.n, 'session')} you began in that window were completed. Other windows have fewer than ${MIN_N_RATE} sessions, so they are not yet comparable.`,
      confidence: confidenceFor(timing.n),
    });
  }

  // ── goal realism: a gentle, factual nudge rather than a scold
  const avgMinutes = mean(done.map((s) => s.seconds / 60));
  if (done.length >= MIN_N_RATE && state.habit.dailyGoalMinutes > 0) {
    const goal = state.habit.dailyGoalMinutes;
    if (avgMinutes < goal * 0.6) {
      out.push({
        id: 'goal-realism',
        headline: `Your goal is ${goal} minutes; your sessions average ${Math.round(avgMinutes)}.`,
        detail: `Across ${plural(done.length, 'completed session')}. A goal you clear most days builds the habit faster than one you miss — lowering it is a valid move.`,
        confidence: confidenceFor(done.length),
      });
    }
  }

  return out;
}
