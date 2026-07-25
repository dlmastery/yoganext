/**
 * habit.ts — the habit engine. Pure, deterministic, exhaustively testable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FORGIVING STREAK
 * ─────────────────────────────────────────────────────────────────────────────
 * A streak that shatters on one missed day punishes exactly the people the
 * practice is for. The person who misses Tuesday because they were anxious and
 * exhausted is the person who most needs to open the app on Wednesday — and a
 * zeroed counter is a reason not to. So (per `types.ts`) we absorb misses with
 * a weekly **grace** allowance. Three rules define it:
 *
 *   1. **One absorbed miss per calendar week** (Monday-anchored). Spend it and
 *      the week is out; the next week brings a fresh one. Refill is structural —
 *      it falls out of bucketing misses by week, so there is no "last refilled"
 *      timestamp to drift or to lose on a reload.
 *   2. **Two missed days in a row always break the streak**, whatever the
 *      allowance says. Without this, a Sunday+Monday miss would straddle two
 *      week buckets and be absorbed twice. Two days off is a genuine break, and
 *      the model should not pretend otherwise — forgiving is not dishonest.
 *   3. **Today is never a miss.** The day is not over. Not having practised yet
 *      leaves the streak intact and flags it `atRisk`; the walk starts at
 *      yesterday.
 *
 * Everything is derived from `practiceDays` alone. `HabitState.streak`, `.grace`
 * and `.bestStreak` are caches of that derivation, so a corrupt or partial
 * restore can always be recomputed rather than trusted.
 *
 * No function here reads the clock: `today` is always a parameter.
 */

import type { AppState, Achievement, HabitState, PracticeKind, Session } from './types.ts';
import { addDays, clamp01, dayKey, daysBetween, hourOf, isDayKey, round, weekStart } from './format.ts';

/** Absorbed misses allowed per calendar week. `types.ts` pins the max at 1. */
export const GRACE_PER_WEEK = 1;

/** Guard rail on the backward walk — ~10 years is far past any real streak. */
export const MAX_LOOKBACK_DAYS = 3_650;

/** A gap of this many days or more makes coming back "The Return". */
export const RETURN_GAP_DAYS = 3;

export interface StreakResult {
  /** Consecutive days including today, grace applied. */
  streak: number;
  /** Weekly allowance left in the week containing `today` (0..GRACE_PER_WEEK). */
  graceRemaining: number;
  /** Misses absorbed anywhere inside the current streak, newest first. */
  absorbed: string[];
  /** Whether a session has already been recorded for `today`. */
  practisedToday: boolean;
  /** True when skipping the rest of today would end the streak. */
  atRisk: boolean;
  /** Most recent practice day at or before `today`, or `null`. */
  lastPracticeDay: string | null;
}

const EMPTY_STREAK: StreakResult = {
  streak: 0,
  graceRemaining: GRACE_PER_WEEK,
  absorbed: [],
  practisedToday: false,
  atRisk: false,
  lastPracticeDay: null,
};

/** Matches a bare date, valid or not — `2026-02-30` included. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Deduplicated, validated, ascending day keys. Junk is dropped, never thrown on. */
export function normaliseDays(practiceDays: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of practiceDays ?? []) {
    if (typeof raw !== 'string') continue;

    // A string that is SHAPED like a day key must be a real one. Falling back to
    // `dayKey()` here would hand '2026-02-30' to `new Date()`, which rolls it
    // forward to 1 March — inventing a practice day the user never had. A
    // corrupt entry must vanish, never become plausible data.
    const key = BARE_DATE.test(raw) ? raw : dayKey(raw);
    if (key && isDayKey(key)) seen.add(key);
  }
  // 'YYYY-MM-DD' sorts correctly as a plain string — no Date allocation needed.
  return [...seen].sort();
}

/**
 * The forgiving streak as of `today`.
 *
 * @param grace the weekly ALLOWANCE (not a remaining balance). Remaining is
 *   derived from the days themselves and returned as `graceRemaining`; passing a
 *   stored balance here would wrongly apply this week's exhaustion to every past
 *   week. Callers should leave it at the default.
 */
export function computeStreak(
  practiceDays: readonly string[],
  today: string,
  grace: number = GRACE_PER_WEEK,
): StreakResult {
  if (!isDayKey(today)) return { ...EMPTY_STREAK };

  const days = normaliseDays(practiceDays);
  if (days.length === 0) return { ...EMPTY_STREAK };

  const set = new Set(days);
  const allowance = Math.max(0, Math.floor(grace));
  const earliest = days[0];
  const currentWeek = weekStart(today);

  const practisedToday = set.has(today);
  let streak = practisedToday ? 1 : 0;

  // Absorbed misses bucketed by the Monday of their week. This map IS the
  // weekly refill: a new week simply has no entry yet.
  const spent = new Map<string, number>();
  const absorbed: string[] = [];
  let consecutiveMisses = 0;

  let cursor = addDays(today, -1);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    // Nothing before the first ever practice can extend or break anything —
    // without this, a brand-new user's first session would burn their grace on
    // the empty days behind it.
    if (!cursor || cursor < earliest) break;

    if (set.has(cursor)) {
      streak++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses >= 2) break; // rule 2: two in a row is a real break

      const bucket = weekStart(cursor);
      const used = spent.get(bucket) ?? 0;
      if (used >= allowance) break; // rule 1: that week's forgiveness is spent

      spent.set(bucket, used + 1);
      absorbed.push(cursor);
    }
    cursor = addDays(cursor, -1);
  }

  const graceRemaining = Math.max(0, allowance - (spent.get(currentWeek) ?? 0));
  const yesterdayPractised = set.has(addDays(today, -1));

  return {
    streak,
    graceRemaining,
    absorbed,
    practisedToday,
    // Missing today ends the run if yesterday was already a (grace-absorbed)
    // miss, or if this week has no forgiveness left to spend.
    atRisk: !practisedToday && streak > 0 && (!yesterdayPractised || graceRemaining === 0),
    lastPracticeDay: practisedToday ? today : (days.filter((d) => d <= today).pop() ?? null),
  };
}

/**
 * The longest forgiving streak ever achieved, recomputed from scratch.
 * Used to repair `bestStreak` after a restore rather than trusting the cache.
 */
export function bestStreakEver(practiceDays: readonly string[]): number {
  const days = normaliseDays(practiceDays);
  let best = 0;
  for (const day of days) {
    // Each practice day is a candidate streak end; days after it cannot help.
    const run = computeStreak(days, day).streak;
    if (run > best) best = run;
  }
  return best;
}

export interface RecordSessionInput {
  /** Local day key the session belongs to. */
  day: string;
  /** Seconds actually practised (may be 0, e.g. a journal entry). */
  seconds: number;
  /** Today's local day key — supplied by the caller, never read from the clock. */
  today: string;
}

/**
 * Fold a completed session into the habit state. Pure: returns a new object and
 * never mutates the input.
 */
export function recordSession(habit: HabitState, input: RecordSessionInput): HabitState {
  const day = isDayKey(input.day) ? input.day : dayKey(input.day);
  const today = isDayKey(input.today) ? input.today : dayKey(input.today);
  const seconds = Number.isFinite(input.seconds) ? Math.max(0, input.seconds) : 0;

  const practiceDays = normaliseDays(day ? [...habit.practiceDays, day] : habit.practiceDays);
  const result = computeStreak(practiceDays, today || day);

  return {
    ...habit,
    practiceDays,
    // Kept at one decimal: rounding to whole minutes on every session would
    // silently erase every practice under 30 seconds.
    totalMinutes: round(Math.max(0, habit.totalMinutes ?? 0) + seconds / 60, 1),
    streak: result.streak,
    bestStreak: Math.max(habit.bestStreak ?? 0, result.streak),
    grace: result.graceRemaining,
  };
}

/** Recompute every derived field from `practiceDays`. The repair path. */
export function reconcile(habit: HabitState, today: string): HabitState {
  const practiceDays = normaliseDays(habit.practiceDays);
  const result = computeStreak(practiceDays, today);
  return {
    ...habit,
    practiceDays,
    streak: result.streak,
    // bestStreak is monotonic by contract, so take the larger of the cached
    // value and the recomputed one rather than overwriting it.
    bestStreak: Math.max(habit.bestStreak ?? 0, bestStreakEver(practiceDays)),
    grace: result.graceRemaining,
  };
}

// ──────────────────────────────────────────────────────────────── observations ──

/** Distinct practice days within the `days`-long window ending at `today`. */
export function daysPractisedIn(
  practiceDays: readonly string[],
  today: string,
  days: number,
): number {
  if (!isDayKey(today) || days <= 0) return 0;
  const from = addDays(today, -(days - 1));
  return normaliseDays(practiceDays).filter((d) => d >= from && d <= today).length;
}

/** The densest `window`-day stretch anywhere in the history, as a day count. */
export function bestWindowDensity(practiceDays: readonly string[], window: number): number {
  const days = normaliseDays(practiceDays);
  if (days.length === 0 || window <= 0) return 0;
  let best = 0;
  let left = 0;
  for (let right = 0; right < days.length; right++) {
    while (daysBetween(days[left], days[right]) >= window) left++;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

/** Practice days that followed a gap of `>= minGap` days — every comeback. */
export function returns(practiceDays: readonly string[], minGap = RETURN_GAP_DAYS): string[] {
  const days = normaliseDays(practiceDays);
  const out: string[] = [];
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) >= minGap) out.push(days[i]);
  }
  return out;
}

/** Times the streak survived exactly one missed day — grace doing its job. */
export function gracesUsed(practiceDays: readonly string[]): number {
  const days = normaliseDays(practiceDays);
  let count = 0;
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) === 2) count++;
  }
  return count;
}

/** A `days`-long calendar strip ending at `today`, oldest first — for the UI heatmap. */
export function calendarStrip(
  practiceDays: readonly string[],
  today: string,
  days = 28,
): Array<{ day: string; practised: boolean }> {
  if (!isDayKey(today) || days <= 0) return [];
  const set = new Set(normaliseDays(practiceDays));
  const out: Array<{ day: string; practised: boolean }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    out.push({ day, practised: set.has(day) });
  }
  return out;
}

/** Minutes practised today against `dailyGoalMinutes`, as a 0..1 fraction. */
export function goalProgress(sessions: readonly Session[], habit: HabitState, today: string): number {
  const goal = Math.max(1, habit.dailyGoalMinutes || 10);
  const minutes = sessions
    .filter((s) => s.completed && dayKey(s.startedAt) === today)
    .reduce((sum, s) => sum + s.seconds / 60, 0);
  return clamp01(minutes / goal);
}

// ─────────────────────────────────────────────────────────────── achievements ──

interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Raw progress 0..1. Pure over state. */
  measure: (state: AppState, today: string) => number;
}

const frac = (value: number, target: number): number =>
  target <= 0 ? 0 : clamp01(value / target);

const completed = (state: AppState): Session[] =>
  (state.sessions ?? []).filter((s) => s && s.completed);

/**
 * Twelve achievements, every one of them rewarding CONSISTENCY over volume.
 *
 * There is deliberately no "practised 1000 minutes" badge. Volume rewards the
 * people who already have time; showing up rewards the people building a habit.
 * The two that matter most are `the-return` and `held-the-thread` — they fire
 * precisely when someone comes back after slipping, which is the single
 * behaviour most worth reinforcing in a practice app.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-breath',
    title: 'First Breath',
    description: 'Complete your first practice.',
    icon: 'Sparkles',
    measure: (s) => frac(completed(s).length, 1),
  },
  {
    id: 'twice-is-a-rhythm',
    title: 'Twice Is a Rhythm',
    description: 'Practise two days running — the first repetition is the hardest.',
    icon: 'Footprints',
    measure: (s) => frac(s.habit.bestStreak, 2),
  },
  {
    id: 'the-return',
    title: 'The Return',
    description: 'Come back after three or more days away. This is the one that counts.',
    icon: 'RotateCcw',
    measure: (s) => frac(returns(s.habit.practiceDays).length, 1),
  },
  {
    id: 'held-the-thread',
    title: 'Held the Thread',
    description: 'Miss a day and pick the practice straight back up.',
    icon: 'Anchor',
    measure: (s) => frac(gracesUsed(s.habit.practiceDays), 1),
  },
  {
    id: 'seven-mornings',
    title: 'Seven Mornings',
    description: 'Reach a seven-day streak.',
    icon: 'Sunrise',
    measure: (s) => frac(s.habit.bestStreak, 7),
  },
  {
    id: 'quiet-week',
    title: 'Quiet Week',
    description: 'Practise on five days inside a single week.',
    icon: 'Feather',
    measure: (s) => frac(bestWindowDensity(s.habit.practiceDays, 7), 5),
  },
  {
    id: 'steady-month',
    title: 'Steady Month',
    description: 'Practise on twenty days inside a thirty-day stretch.',
    icon: 'CalendarCheck',
    measure: (s) => frac(bestWindowDensity(s.habit.practiceDays, 30), 20),
  },
  {
    id: 'full-moon',
    title: 'Full Moon',
    description: 'Reach a thirty-day streak.',
    icon: 'Moon',
    measure: (s) => frac(s.habit.bestStreak, 30),
  },
  {
    id: 'night-owl',
    title: 'Night Owl',
    description: 'Practise five times after 9pm.',
    icon: 'MoonStar',
    measure: (s) => frac(completed(s).filter((x) => hourOf(x.startedAt) >= 21).length, 5),
  },
  {
    id: 'dawn-chorus',
    title: 'Dawn Chorus',
    description: 'Practise five times before 7am.',
    icon: 'Bird',
    measure: (s) => {
      const early = completed(s).filter((x) => {
        const h = hourOf(x.startedAt);
        return h >= 0 && h < 7;
      });
      return frac(early.length, 5);
    },
  },
  {
    id: 'whole-garden',
    title: 'The Whole Garden',
    description: 'Try all five kinds: meditation, breathwork, yoga, sleep, journal.',
    icon: 'Flower2',
    measure: (s) => {
      const kinds = new Set<PracticeKind>(completed(s).map((x) => x.kind));
      return frac(kinds.size, 5);
    },
  },
  {
    id: 'honest-weather',
    title: 'Honest Weather',
    description: 'Log how you felt before and after ten practices.',
    icon: 'CloudSun',
    measure: (s) =>
      frac(completed(s).filter((x) => x.moodBefore != null && x.moodAfter != null).length, 10),
  },
];

/**
 * Recompute every achievement from state.
 *
 * `unlockedAt` is sticky: once earned it keeps its original timestamp, so an
 * achievement can never silently un-unlock if the underlying window slides past
 * it. `now` is the timestamp stamped on anything crossing the line on this call.
 */
export function achievementProgress(state: AppState, now: string): Achievement[] {
  const previous = new Map((state.achievements ?? []).map((a) => [a.id, a]));
  const today = dayKey(now) || dayKey(new Date(0));

  return ACHIEVEMENTS.map((def) => {
    let progress = 0;
    try {
      progress = clamp01(def.measure(state, today));
    } catch {
      progress = 0; // a malformed session must never break the trophy shelf
    }
    const prior = previous.get(def.id);
    const unlockedAt = prior?.unlockedAt ?? (progress >= 1 ? now : undefined);

    return {
      id: def.id,
      title: def.title,
      description: def.description,
      icon: def.icon,
      progress: round(progress, 3),
      ...(unlockedAt ? { unlockedAt } : {}),
    };
  });
}

/** Achievements that crossed the line on this recompute — for the toast. */
export function newlyUnlocked(before: readonly Achievement[], after: readonly Achievement[]): Achievement[] {
  const had = new Set(before.filter((a) => a.unlockedAt).map((a) => a.id));
  return after.filter((a) => a.unlockedAt && !had.has(a.id));
}
