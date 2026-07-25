/**
 * habit.test.ts — self-test for the habit, insight and format engines.
 *
 *   node --experimental-strip-types src/lib/habit.test.ts
 *
 * No framework, no dependencies, no store, no DOM — the engines are pure, so
 * the test is just a program. Exits 0 on success and 1 with a list of failures,
 * so it drops into CI unchanged.
 *
 * Output is deliberately ASCII-only: the Windows cp1252 console throws
 * UnicodeEncodeError on the arrows and box characters used elsewhere.
 */

import type { AppState, HabitState, Session } from './types.ts';
import {
  ACHIEVEMENTS,
  GRACE_PER_WEEK,
  achievementProgress,
  bestStreakEver,
  bestWindowDensity,
  calendarStrip,
  computeStreak,
  gracesUsed,
  normaliseDays,
  recordSession,
  reconcile,
  returns,
} from './habit.ts';
import {
  BANDS,
  MIN_N,
  bandOf,
  bestTimeOfDay,
  confidenceFor,
  consistency,
  moodDelta,
  summarize,
} from './insights.ts';
import { addDays, dayKey, daysBetween, humanMinutes, isDayKey, mmss, weekStart } from './format.ts';

/**
 * Deliberately a local copy rather than an import from `store.ts`: the store
 * pulls in zustand, and the whole point of keeping these engines pure is that
 * they can be exercised with nothing installed. If this drifts from the store's
 * `defaultHabit()` the streak assertions below still hold — they only depend on
 * the zeroes.
 */
const defaultHabit = (): HabitState => ({
  streak: 0,
  bestStreak: 0,
  grace: 1,
  practiceDays: [],
  totalMinutes: 0,
  dailyGoalMinutes: 10,
});

/**
 * Declared locally rather than pulling in `@types/node`: the project types only
 * `vite/client`, and one test file should not widen the app's dependency
 * surface. `exitCode` is set instead of calling `exit()` so stdout flushes
 * before the process ends.
 */
declare const process: { exitCode: number };

// ────────────────────────────────────────────────────────────── tiny harness ──

const failures: string[] = [];
let checks = 0;
let currentGroup = '';

function group(name: string): void {
  currentGroup = name;
}

function ok(condition: boolean, what: string): void {
  checks++;
  if (!condition) failures.push(`[${currentGroup}] ${what}`);
}

function eq(actual: unknown, expected: unknown, what: string): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`[${currentGroup}] ${what}: expected ${e}, got ${a}`);
}

/** Strip anything the cp1252 console cannot print. */
const ascii = (s: string): string => s.replace(/[^\x20-\x7e]/g, '.');

// ───────────────────────────────────────────────────────────────── fixtures ──

/** A Monday, so every week-boundary assertion below is unambiguous. */
const MON = weekStart('2026-06-17');
/** `d(0)` is that Monday, `d(7)` the next. */
const d = (n: number): string => addDays(MON, n);

const habitWith = (practiceDays: string[]): HabitState => ({
  ...defaultHabit(),
  practiceDays,
});

function stateWith(partial: Partial<AppState>): AppState {
  return {
    practices: [],
    sessions: [],
    moods: [],
    habit: defaultHabit(),
    achievements: [],
    active: null,
    settings: {
      theme: 'aurora',
      reduceMotion: false,
      soundscape: 'none',
      reminderAt: '',
      name: '',
    },
    ...partial,
  };
}

/** A completed session at a given local day + hour. */
function session(day: string, hour: number, over: Partial<Session> = {}): Session {
  const [y, m, dd] = day.split('-').map(Number);
  return {
    id: `s_${day}_${hour}_${Math.random().toString(36).slice(2, 6)}`,
    practiceId: 'p1',
    kind: 'meditation',
    startedAt: new Date(y, m - 1, dd, hour, 0, 0).toISOString(),
    seconds: 600,
    completed: true,
    ...over,
  };
}

function main(): void {
  // ───────────────────────────────────────────────────────────── format ──
  group('format');
  ok(isDayKey('2026-06-17'), 'a real day key is accepted');
  ok(!isDayKey('2026-02-30'), 'Feb 30 is rejected rather than rolled over');
  ok(!isDayKey('2026-13-01'), 'month 13 is rejected');
  ok(!isDayKey('not-a-date'), 'junk is rejected');
  eq(addDays('2026-12-31', 1), '2027-01-01', 'addDays crosses a year boundary');
  eq(addDays('2026-03-01', -1), '2026-02-28', 'addDays crosses a month boundary');
  eq(daysBetween('2026-06-01', '2026-06-08'), 7, 'daysBetween counts forward');
  eq(daysBetween('2026-06-08', '2026-06-01'), -7, 'daysBetween counts backward');
  eq(mmss(0), '0:00', 'mmss at zero');
  eq(mmss(65), '1:05', 'mmss pads seconds');
  eq(mmss(3661), '1:01:01', 'mmss grows an hours field');
  eq(mmss(-5), '0:00', 'mmss clamps negatives');
  eq(humanMinutes(0.5), '30s', 'sub-minute durations read in seconds');
  eq(humanMinutes(90), '1h 30m', 'long durations read in hours');
  eq(dayKey('2026-06-17'), '2026-06-17', 'an existing day key passes through untouched');
  ok(weekStart(d(3)) === MON, 'weekStart resolves to the Monday of the week');
  ok(weekStart(d(6)) === MON, 'Sunday still belongs to its Monday-anchored week');
  ok(weekStart(d(7)) === d(7), 'the next Monday starts a new week');

  // DST: the arithmetic is done in UTC precisely so this cannot drift.
  eq(daysBetween('2026-03-28', '2026-03-30'), 2, 'a DST weekend is still two days');

  // ────────────────────────────────────────────────────── normalisation ──
  group('normaliseDays');
  eq(normaliseDays(['2026-06-18', '2026-06-17', '2026-06-18']), ['2026-06-17', '2026-06-18'],
    'days are deduplicated and sorted');
  eq(normaliseDays(['garbage', '2026-02-30', '2026-06-17']), ['2026-06-17'],
    'malformed entries are dropped, not thrown on');
  eq(normaliseDays([]), [], 'an empty history is empty');

  // ──────────────────────────────────────────────── the forgiving streak ──
  group('streak: basics');
  eq(computeStreak([], d(4)).streak, 0, 'no history means no streak');
  eq(computeStreak(['junk'], d(4)).streak, 0, 'junk history means no streak');

  const firstEver = computeStreak([d(4)], d(4));
  eq(firstEver.streak, 1, 'a first ever session is a 1-day streak');
  eq(firstEver.graceRemaining, GRACE_PER_WEEK,
    'a brand-new user does not burn grace on the empty days before they started');
  eq(firstEver.absorbed, [], 'nothing was absorbed');

  eq(computeStreak([d(0), d(1), d(2), d(3), d(4)], d(4)).streak, 5, 'five clean days is a 5-day streak');

  group('streak: today is never a miss');
  const notYetToday = computeStreak([d(0), d(1), d(2), d(3)], d(4));
  eq(notYetToday.streak, 4, 'not having practised YET today leaves the streak intact');
  eq(notYetToday.practisedToday, false, 'and it knows today is still open');
  eq(notYetToday.atRisk, false, 'with yesterday practised and grace in hand, it is not at risk');

  const riskyToday = computeStreak([d(0), d(1), d(2), d(3)], d(5));
  eq(riskyToday.streak, 4, 'yesterday absorbed by grace, the streak still stands');
  eq(riskyToday.atRisk, true, 'but skipping today too would break it, so it is flagged at risk');

  // THE headline behaviour: one miss is forgiven, two are not.
  group('streak: miss one day -> survives');
  const missedOne = computeStreak([d(0), d(1), d(2), d(4)], d(4)); // d(3) missed
  eq(missedOne.streak, 4, 'a single missed day is absorbed and the streak keeps counting');
  eq(missedOne.absorbed, [d(3)], 'the absorbed day is reported');
  eq(missedOne.graceRemaining, 0, 'this week has now spent its grace');

  group('streak: miss two days -> resets');
  const missedTwo = computeStreak([d(0), d(1), d(4)], d(4)); // d(2) and d(3) missed
  eq(missedTwo.streak, 1, 'two consecutive missed days break the streak back to today alone');
  eq(missedTwo.absorbed, [d(3)], 'only the first of the two was absorbed before the break');

  group('streak: one grace per week');
  // d(1) and d(3) both missed, both inside the same Monday-anchored week.
  const twoMissesOneWeek = computeStreak([d(0), d(2), d(4)], d(4));
  eq(twoMissesOneWeek.streak, 2, 'a second miss in the SAME week is not absorbed');

  group('streak: grace refills weekly');
  // Miss d(2) in week one and d(8) in week two. Non-consecutive, different weeks.
  const acrossWeeks = [d(0), d(1), d(3), d(4), d(5), d(6), d(7), d(9)];
  const refilled = computeStreak(acrossWeeks, d(9));
  eq(refilled.streak, 8, 'each week brings a fresh grace day, so both misses are absorbed');
  eq(refilled.absorbed.length, 2, 'two separate days were absorbed');
  ok(weekStart(refilled.absorbed[0]) !== weekStart(refilled.absorbed[1]),
    'the two absorbed days fall in different weeks - this is what refilling means');
  eq(refilled.graceRemaining, 0, 'the current week has spent its own allowance');

  // The counterfactual: with no allowance at all the same history collapses.
  eq(computeStreak(acrossWeeks, d(9), 0).streak, 1,
    'with grace disabled the identical history is worth a 1-day streak');

  group('streak: two misses across a week boundary still break');
  // d(6) is a Sunday and d(7) the next Monday - different weeks, but consecutive.
  const straddling = computeStreak([d(4), d(5), d(8)], d(8));
  eq(straddling.streak, 1,
    'two days off in a row break the streak even when they straddle a week boundary');

  group('streak: lastPracticeDay');
  eq(computeStreak([d(0), d(3)], d(5)).lastPracticeDay, d(3), 'reports the most recent practice day');
  eq(computeStreak([d(0), d(3)], d(3)).lastPracticeDay, d(3), 'today counts as the most recent');

  // ──────────────────────────────────────────────────────── recordSession ──
  group('recordSession');
  let habit = defaultHabit();
  habit = recordSession(habit, { day: d(0), seconds: 600, today: d(0) });
  eq(habit.streak, 1, 'first session sets a 1-day streak');
  eq(habit.bestStreak, 1, 'and the best streak with it');
  eq(habit.totalMinutes, 10, 'ten minutes were banked');

  habit = recordSession(habit, { day: d(1), seconds: 300, today: d(1) });
  eq(habit.streak, 2, 'a second consecutive day extends the streak');
  eq(habit.totalMinutes, 15, 'minutes accumulate');

  habit = recordSession(habit, { day: d(1), seconds: 300, today: d(1) });
  eq(habit.practiceDays.length, 2, 'a second session on the same day does not double-count the day');
  eq(habit.totalMinutes, 20, 'but its minutes still count');

  habit = recordSession(habit, { day: d(2), seconds: 30, today: d(2) });
  eq(habit.totalMinutes, 20.5, 'a 30-second practice is not rounded away to nothing');

  group('recordSession: bestStreak is monotonic');
  const peak = habit.bestStreak;
  eq(peak, 3, 'the streak peaked at three days');
  // Now a real break: nothing until d(9), which is a fresh 1-day streak.
  habit = recordSession(habit, { day: d(9), seconds: 600, today: d(9) });
  eq(habit.streak, 1, 'after a long gap the current streak restarts at one');
  ok(habit.bestStreak >= peak, 'bestStreak never decreases when the current streak falls');
  eq(habit.bestStreak, peak, 'and it holds at the previous peak');

  group('recordSession: purity');
  const before = defaultHabit();
  const snapshot = JSON.stringify(before);
  recordSession(before, { day: d(0), seconds: 600, today: d(0) });
  eq(JSON.stringify(before), snapshot, 'recordSession does not mutate its input');

  group('reconcile: self-heals a tampered cache');
  const tampered = { ...habitWith([d(2), d(3), d(4)]), streak: 9999, bestStreak: 9999, grace: 7 };
  const healed = reconcile(tampered, d(4));
  eq(healed.streak, 3, 'the streak is recomputed from the practice days');
  ok(healed.grace <= GRACE_PER_WEEK, 'grace is brought back inside its bound');
  eq(bestStreakEver([d(0), d(1), d(2), d(6), d(7)]), 3, 'bestStreakEver rescans the whole history');

  // ──────────────────────────────────────────────────────── observations ──
  group('observations');
  eq(returns([d(0), d(1), d(5)]).length, 1, 'a four-day gap counts as a return');
  eq(returns([d(0), d(1), d(2)]).length, 0, 'consecutive days are not a return');
  eq(gracesUsed([d(0), d(2), d(4)]), 2, 'each single-day gap is a grace that held the thread');
  eq(gracesUsed([d(0), d(1)]), 0, 'an unbroken run used no grace');
  eq(bestWindowDensity([d(0), d(1), d(2), d(3), d(4)], 7), 5, 'five days inside one week');
  eq(bestWindowDensity([d(0), d(8)], 7), 1, 'days more than a week apart never share a window');
  eq(calendarStrip([d(4)], d(4), 3).length, 3, 'the calendar strip is the requested length');
  eq(calendarStrip([d(4)], d(4), 3)[2], { day: d(4), practised: true }, 'and ends at today');

  // ─────────────────────────────────────────────────────── achievements ──
  group('achievements');
  const fresh = achievementProgress(stateWith({}), '2026-06-17T09:00:00.000Z');
  eq(fresh.length, ACHIEVEMENTS.length, 'every achievement is returned, locked or not');
  ok(fresh.every((a) => a.progress === 0), 'an empty state has zero progress everywhere');
  ok(fresh.every((a) => !a.unlockedAt), 'and nothing is unlocked');
  ok(fresh.every((a) => a.icon.length > 0), 'every achievement carries a lucide icon name');
  eq(new Set(fresh.map((a) => a.id)).size, ACHIEVEMENTS.length, 'achievement ids are unique');

  const oneSession = stateWith({ sessions: [session(d(0), 9)], habit: habitWith([d(0)]) });
  const afterFirst = achievementProgress(oneSession, '2026-06-17T09:00:00.000Z');
  const firstBreath = afterFirst.find((a) => a.id === 'first-breath')!;
  eq(firstBreath.progress, 1, 'First Breath completes on the first session');
  eq(firstBreath.unlockedAt, '2026-06-17T09:00:00.000Z', 'and is stamped with the unlock time');

  group('achievements: unlockedAt is sticky');
  const later = achievementProgress(
    { ...oneSession, achievements: afterFirst },
    '2026-07-01T09:00:00.000Z',
  );
  eq(later.find((a) => a.id === 'first-breath')!.unlockedAt, '2026-06-17T09:00:00.000Z',
    'an earned achievement keeps its ORIGINAL timestamp on later recomputes');

  group('achievements: The Return');
  const returned = stateWith({ habit: habitWith([d(0), d(5)]), sessions: [session(d(0), 9), session(d(5), 9)] });
  const returnBadge = achievementProgress(returned, '2026-06-23T09:00:00.000Z').find((a) => a.id === 'the-return')!;
  eq(returnBadge.progress, 1, 'coming back after a gap unlocks The Return');

  const noGap = achievementProgress(
    stateWith({ habit: habitWith([d(0), d(1)]) }),
    '2026-06-18T09:00:00.000Z',
  ).find((a) => a.id === 'the-return')!;
  eq(noGap.progress, 0, 'an unbroken run has not returned from anywhere');

  group('achievements: partial progress is proportional');
  const halfway = achievementProgress(
    stateWith({ habit: { ...defaultHabit(), bestStreak: 3 } }),
    '2026-06-17T09:00:00.000Z',
  ).find((a) => a.id === 'seven-mornings')!;
  // progress is stored rounded to 3dp, so compare within that tolerance.
  ok(Math.abs(halfway.progress - 3 / 7) < 5e-4, 'a 3-day best shows 3/7 of Seven Mornings');
  ok(!halfway.unlockedAt, 'and is not unlocked yet');

  group('achievements: never throws on malformed data');
  const junkState = stateWith({ sessions: [{ startedAt: 'nonsense' } as unknown as Session] });
  ok(achievementProgress(junkState, '2026-06-17T09:00:00.000Z').length === ACHIEVEMENTS.length,
    'a malformed session cannot break the trophy shelf');

  // ─────────────────────────────────────────────────────────── insights ──
  group('insights: moodDelta honesty gate');
  const twoPaired = [
    session(d(0), 9, { moodBefore: 2, moodAfter: 4 }),
    session(d(1), 9, { moodBefore: 2, moodAfter: 5 }),
  ];
  const under = moodDelta(twoPaired)[0];
  eq(under.n, 2, 'two paired sessions were counted');
  eq(under.insufficient, true, `n=2 is below the floor of ${MIN_N} and is marked insufficient`);
  eq(under.delta, 0, 'and no average is exposed for the caller to accidentally render');

  const threePaired = [...twoPaired, session(d(2), 9, { moodBefore: 3, moodAfter: 4 })];
  const over = moodDelta(threePaired)[0];
  eq(over.insufficient, false, 'a third paired session clears the floor');
  // deltas are +2, +3, +1 -> mean +2.0
  eq(over.delta, 2, 'and the mean delta is now reported');

  group('insights: unpaired sessions are not half-counted');
  const unpaired = moodDelta([session(d(0), 9, { moodBefore: 2 }), session(d(1), 9, { moodAfter: 5 })])[0];
  eq(unpaired.n, 0, 'a session missing either end of the pair contributes nothing');
  eq(unpaired.insufficient, true, 'so the kind stays unreportable');

  group('insights: confidence tracks n alone');
  eq(confidenceFor(2), 'low', 'n=2 is low confidence');
  eq(confidenceFor(5), 'medium', 'n=5 is medium');
  eq(confidenceFor(10), 'high', 'n=10 is high');

  group('insights: bestTimeOfDay');
  eq(bandOf(6), 'dawn', 'early hours are dawn');
  eq(bandOf(23), 'night', 'late hours are night');
  eq(bandOf(2), 'night', 'the night band wraps past midnight');
  eq(BANDS.length, 5, 'there are five bands');

  const thin = bestTimeOfDay([session(d(0), 9), session(d(1), 9)]);
  eq(thin.insufficient, true, 'two sessions in a band cannot support a completion RATE');
  eq(thin.band, null, 'so no winning band is named');

  const enough = bestTimeOfDay([
    session(d(0), 9), session(d(1), 9), session(d(2), 9), session(d(3), 9), session(d(4), 9),
    session(d(5), 19, { completed: false }), session(d(6), 19, { completed: false }),
  ]);
  eq(enough.insufficient, false, 'five sessions in a band clears the rate floor');
  eq(enough.band, 'morning', 'and the morning wins on completion rate');
  eq(enough.completionRate, 1, 'all five morning sessions were finished');

  group('insights: consistency clips to observed history');
  const threeDaysIn = consistency([d(0), d(1), d(2)], d(2), 28);
  eq(threeDaysIn.fraction, 1, 'three days in, three days practised is 100 percent, not 11');
  eq(threeDaysIn.window, 3, 'the window is clipped to the history that exists');
  eq(threeDaysIn.observed, 3, 'and the observed span is reported so callers can gate on it');
  eq(consistency([], d(4)).fraction, 0, 'no history is zero consistency');
  const half = consistency([d(0), d(2), d(4), d(6)], d(7), 28);
  eq(half.daysPractised, 4, 'four days practised');
  eq(half.window, 8, 'across the eight days observed');

  group('insights: summarize never overclaims');
  const empty = summarize(stateWith({}), '2026-06-17T09:00:00.000Z');
  eq(empty.length, 1, 'an empty app produces exactly one insight');
  eq(empty[0].id, 'no-data', 'and it says there is nothing to report');
  eq(empty[0].confidence, 'low', 'at low confidence');

  const thinState = stateWith({
    sessions: twoPaired,
    habit: habitWith([d(0), d(1)]),
  });
  const thinInsights = summarize(thinState, `${d(1)}T09:00:00.000Z`);
  ok(thinInsights.some((i) => i.id === 'mood-insufficient'),
    'with n=2 the feed states the data is insufficient rather than reporting an average');
  ok(!thinInsights.some((i) => i.id.startsWith('mood-') && i.confidence === 'high'),
    'and no mood claim is made at high confidence');
  ok(thinInsights.every((i) => i.headline.length > 0 && i.detail.length > 0),
    'every insight carries both a headline and its evidence');
  ok(thinInsights.every((i) => ['low', 'medium', 'high'].includes(i.confidence)),
    'every confidence value is one of the three allowed words');

  const richState = stateWith({
    sessions: threePaired,
    habit: { ...habitWith([d(0), d(1), d(2)]), bestStreak: 3, streak: 3 },
  });
  const rich = summarize(richState, `${d(2)}T09:00:00.000Z`);
  const moodLine = rich.find((i) => i.id.startsWith('mood-') && i.id !== 'mood-insufficient');
  ok(!!moodLine, 'at n=3 a mood observation is finally reported');
  ok(moodLine!.detail.includes('not a cause'),
    'and it explicitly disclaims causation - this is a mental-health app');
  ok(moodLine!.confidence === 'low', 'n=3 is reported at low confidence');

  // ──────────────────────────────────────────────────────────── summary ──
  const groups = [
    'format', 'normaliseDays', 'streak', 'recordSession', 'reconcile',
    'observations', 'achievements', 'insights',
  ];
  console.log(`ran ${checks} assertions across ${groups.length} areas`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILED:`);
    for (const f of failures) console.log(`  - ${ascii(f)}`);
    process.exitCode = 1;
    return;
  }

  console.log('habit engine self-test OK');
}

main();
