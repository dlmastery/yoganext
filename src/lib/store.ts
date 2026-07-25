/**
 * store.ts — the STATE LAYER.
 *
 * One zustand store holding `AppState` plus the actions that mutate it. The
 * actions map 1:1 onto the tools in `agent/contract.ts`: `agent/tools.ts` wraps
 * each one in a `ToolResult` envelope, and the React screens call the very same
 * functions. Neither path is privileged, which is the whole thesis of the app.
 *
 * Three properties this file is responsible for:
 *
 *   1. **The clock lives here, and only here.** `habit.ts` and `insights.ts` are
 *      pure and take dates as arguments; the actions below are the impure
 *      boundary that reads `new Date()` once and passes it down. Every action
 *      accepts an optional `now` so tests and replays can drive it.
 *   2. **Bad persisted data never crashes the app.** localStorage is a hostile
 *      input: users edit it, extensions corrupt it, and older builds wrote older
 *      shapes. Every slice is validated on the way in and falls back to a clean
 *      default; a blob we cannot use is discarded and `_recovered` is raised so
 *      the UI can say so honestly rather than silently losing someone's streak.
 *   3. **Derived fields are never trusted.** `streak`, `grace`, `bestStreak` and
 *      the achievements are all recomputed from `practiceDays` and `sessions` on
 *      rehydrate, so a stale or tampered cache self-heals.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  Achievement,
  ActiveSession,
  AppState,
  BreathPattern,
  HabitState,
  MoodEntry,
  MoodScore,
  Pose,
  Practice,
  PracticeKind,
  Session,
  Settings,
} from './types.ts';
import { achievementProgress, recordSession, reconcile } from './habit.ts';
import { clamp, dayKey } from './format.ts';
import { PRACTICES } from '../data/practices.ts';
import { SEED_MOODS, SEED_SESSIONS } from '../data/seed.ts';

// ────────────────────────────────────────────────────────────────── constants ──

export const STORAGE_KEY = 'yoganext.v1';

/** Bump when the persisted SHAPE changes, and add a step to `migrate`. */
export const STATE_VERSION = 1;

/** A mood logged this recently before starting counts as that session's `moodBefore`. */
const MOOD_CARRY_MINUTES = 30;

/** Tag marking a practice the user created, so it survives seed-library updates. */
const CUSTOM_TAG = 'custom';

const THEMES: Settings['theme'][] = ['aurora', 'dusk', 'forest', 'sand'];
const SOUNDSCAPES: Settings['soundscape'][] = ['none', 'rain', 'ocean', 'forest', 'singing-bowl'];
const KINDS: PracticeKind[] = ['meditation', 'breathwork', 'yoga', 'sleep', 'journal'];

// ───────────────────────────────────────────────────────── the shell's state ──

/**
 * Below is the SHELL's state — which screen is showing, how the library is
 * filtered, and the ephemera of the running player (bonus time, per-pose
 * extensions, mute). It deliberately does NOT live in `types.ts`: `AppState` and
 * `Settings` describe the practice *domain*, and a tab index is not part of it.
 *
 * It lives in the store rather than in `useState` for exactly one reason: each
 * of these is now a user-visible capability with a tool behind it (`navigate`,
 * `filter_library`, `extend_session`, `skip_pose`, `set_accessibility`), and a
 * capability hidden in component state is a capability no agent can reach. That
 * asymmetry — GUI can, agent cannot — is the parity gap `verifyUiParity()`
 * exists to catch. None of it is persisted: a tab, a filter and a bonus minute
 * are all things a fresh page load should forget.
 */
export type ViewId = 'today' | 'practice' | 'progress' | 'you';

export const VIEW_IDS: readonly ViewId[] = ['today', 'practice', 'progress', 'you'];

export interface LibraryFilter {
  /** `'all'` means no kind filter. */
  kind: PracticeKind | 'all';
  /** Longest practice to show, or `null` for any length. */
  maxMinutes: number | null;
}

/** Everything the player accumulates that is not part of the domain session. */
export interface PlayerState {
  /** Seconds added to the running practice by `extend_session`. */
  bonusSeconds: number;
  /** Extra seconds granted to individual poses, keyed by pose index. */
  poseExtensions: Record<number, number>;
  /** Seconds of the pose timeline jumped over by `skip_pose`. */
  poseSkipSeconds: number;
}

export const defaultLibraryFilter = (): LibraryFilter => ({ kind: 'all', maxMinutes: null });

export const defaultPlayer = (): PlayerState => ({
  bonusSeconds: 0,
  poseExtensions: {},
  poseSkipSeconds: 0,
});

/**
 * The seed practice library, owned by `src/data/`. It is deliberately NOT
 * persisted (see `partialize`): writing it to disk would freeze whatever
 * shipped on the day of install and never update it again. `hydratePractices()`
 * remains available for tests and for swapping the library at runtime.
 */
const SEED_PRACTICES: Practice[] = PRACTICES;

// ──────────────────────────────────────────────────────────────────── defaults ──

export const defaultHabit = (): HabitState => ({
  streak: 0,
  bestStreak: 0,
  grace: 1,
  practiceDays: [],
  totalMinutes: 0,
  dailyGoalMinutes: 10,
});

export const defaultSettings = (): Settings => ({
  theme: 'aurora',
  reduceMotion: false,
  soundscape: 'none',
  reminderAt: '',
  name: '',
});

/** A genuinely blank slate — what `reset()` produces. */
export const defaultAppState = (): AppState => ({
  practices: [...SEED_PRACTICES],
  sessions: [],
  moods: [],
  habit: defaultHabit(),
  achievements: [],
  active: null,
  settings: defaultSettings(),
});

/**
 * What a first-time visitor sees: three weeks of imperfect history from
 * `data/seed.ts`.
 *
 * This is the store's INITIAL state, not a fallback — the moment a persisted
 * blob exists, `merge()` replaces every history slice with the user's own data,
 * including when that data is legitimately empty. So a returning user never
 * sees the demo, and `reset()` goes to `defaultAppState()` rather than here:
 * "wipe everything on this device" has to actually mean wiped.
 *
 * The habit fields are folded from the seed sessions rather than hardcoded, so
 * the streak, grace and achievements shown are the ones the real engine derives.
 */
export function firstRunState(): AppState {
  const base = defaultAppState();
  const sessions = [...SEED_SESSIONS];
  const today = dayKey(new Date());

  let habit = base.habit;
  const chronological = sessions
    .filter((s) => s.completed)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const s of chronological) {
    const day = dayKey(s.startedAt);
    if (day) habit = recordSession(habit, { day, seconds: s.seconds, today: day });
  }
  // Re-anchor streak and grace on the actual current date; the loop above ends
  // anchored to the last seeded session, which may be days ago.
  habit = reconcile(habit, today);

  const state: AppState = { ...base, sessions, moods: [...SEED_MOODS], habit };
  return { ...state, achievements: achievementProgress(state, new Date().toISOString()) };
}

// ───────────────────────────────────────────────────────────────────── helpers ──

let idCounter = 0;

/** Readable, collision-free within a device. Not a security token. */
function uid(prefix: string): string {
  idCounter += 1;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}_${rand}`;
}

const nowIso = (): string => new Date().toISOString();

const isMood = (v: unknown): v is MoodScore =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

const asMood = (v: number): MoodScore => clamp(Math.round(v), 1, 5) as MoodScore;

const isCustom = (p: Practice): boolean => p.tags?.includes(CUSTOM_TAG) ?? false;

/**
 * Write the live timer's elapsed seconds back onto its session record.
 *
 * Called on every state transition rather than on every tick: mirroring per
 * second would replace the `sessions` array 60 times a minute and re-render
 * every subscriber. Transitions are enough to make abandoned sessions carry
 * honest durations, which is what the completion-rate insight depends on.
 */
function flushActive(sessions: Session[], active: ActiveSession | null): Session[] {
  if (!active) return sessions;
  let touched = false;
  const next = sessions.map((s) => {
    if (s.completed || s.startedAt !== active.startedAt || s.practiceId !== active.practiceId) return s;
    touched = true;
    return { ...s, seconds: Math.max(s.seconds, Math.round(active.elapsed)) };
  });
  return touched ? next : sessions;
}

/** Where a pose sequence is at time `t`, given any per-pose extensions. */
export interface PoseAtTime {
  index: number;
  pose: Pose;
  /** the pose's length including its extension */
  duration: number;
  elapsedInPose: number;
  remaining: number;
  progress: number;
  /** true once the clock has run past the end of the last pose */
  finished: boolean;
}

/**
 * The pose timeline, DERIVED rather than stepped: cumulative offsets are walked
 * from the session clock, so auto-advance is arithmetic instead of a timer that
 * can drift out of sync, and a backgrounded tab returns to the right pose.
 *
 * It lives here, next to `skipPose`, because the skip action and the sequencer
 * component must agree exactly on where the current pose ends — two copies of
 * this loop would be two answers to "how much is left".
 */
export function poseAt(
  poses: Pose[],
  extensions: Record<number, number>,
  t: number,
): PoseAtTime | null {
  if (poses.length === 0) return null;
  const time = Math.max(0, Number.isFinite(t) ? t : 0);
  let cursor = 0;

  for (let i = 0; i < poses.length; i++) {
    const duration = Math.max(1, poses[i].seconds + (extensions[i] ?? 0));
    if (time < cursor + duration || i === poses.length - 1) {
      const elapsedInPose = Math.min(Math.max(time - cursor, 0), duration);
      return {
        index: i,
        pose: poses[i],
        duration,
        elapsedInPose,
        remaining: Math.max(0, duration - elapsedInPose),
        progress: elapsedInPose / duration,
        finished: i === poses.length - 1 && time >= cursor + duration,
      };
    }
    cursor += duration;
  }
  return null;
}

/**
 * Drop an active session whose practice is not in the library.
 *
 * `active` only names a `practiceId`, so it can outlive the practice it points
 * at — after a restore that dropped it, or a library swap. The resulting state
 * is a trap: the player can render nothing, and `completeSession` is the only
 * action that clears `active`, so the app believes a session is running that
 * the user can neither see nor stop.
 */
function liveActive(practices: Practice[], active: ActiveSession | null): ActiveSession | null {
  if (!active) return null;
  return practices.some((p) => p.id === active.practiceId) ? active : null;
}

/** Recompute achievements against a state snapshot. Never throws. */
function withAchievements(state: AppState, now: string): Achievement[] {
  try {
    return achievementProgress(state, now);
  } catch {
    return state.achievements ?? [];
  }
}

// ────────────────────────────────────────────────────────── persisted sanitising ──

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

function sanitizeSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  const out: Session[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.startedAt !== 'string' || typeof r.practiceId !== 'string') continue;
    out.push({
      id: str(r.id) || uid('sess'),
      practiceId: r.practiceId,
      kind: (str(r.kind, 'meditation') as Session['kind']),
      startedAt: r.startedAt,
      seconds: Math.max(0, num(r.seconds)),
      completed: bool(r.completed),
      ...(isMood(r.moodBefore) ? { moodBefore: r.moodBefore } : {}),
      ...(isMood(r.moodAfter) ? { moodAfter: r.moodAfter } : {}),
      ...(typeof r.note === 'string' ? { note: r.note } : {}),
    });
  }
  return out;
}

function sanitizeMoods(raw: unknown): MoodEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MoodEntry[] = [];
  for (const r of raw) {
    if (!isObj(r) || !isMood(r.score) || typeof r.at !== 'string') continue;
    out.push({
      id: str(r.id) || uid('mood'),
      at: r.at,
      score: r.score,
      feelings: Array.isArray(r.feelings) ? r.feelings.filter((f): f is string => typeof f === 'string') : [],
      ...(typeof r.note === 'string' ? { note: r.note } : {}),
    });
  }
  return out;
}

function sanitizeHabit(raw: unknown): HabitState {
  const base = defaultHabit();
  if (!isObj(raw)) return base;
  return {
    streak: Math.max(0, Math.floor(num(raw.streak))),
    bestStreak: Math.max(0, Math.floor(num(raw.bestStreak))),
    grace: clamp(num(raw.grace, 1), 0, 1),
    practiceDays: Array.isArray(raw.practiceDays)
      ? raw.practiceDays.filter((d): d is string => typeof d === 'string')
      : [],
    totalMinutes: Math.max(0, num(raw.totalMinutes)),
    dailyGoalMinutes: clamp(num(raw.dailyGoalMinutes, 10), 3, 60),
  };
}

/**
 * @param base what an invalid field falls back to. On a restore this is the
 *   factory default; on `updateSettings` it is the CURRENT settings, so one bad
 *   value in a patch cannot quietly reset the user's other choices.
 */
function sanitizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  if (!isObj(raw)) return base;
  const theme = str(raw.theme) as Settings['theme'];
  const soundscape = str(raw.soundscape) as Settings['soundscape'];
  const reminderAt = str(raw.reminderAt);
  return {
    theme: THEMES.includes(theme) ? theme : base.theme,
    reduceMotion: bool(raw.reduceMotion, base.reduceMotion),
    soundscape: SOUNDSCAPES.includes(soundscape) ? soundscape : base.soundscape,
    // An empty string is a valid value here: it means "reminder off".
    reminderAt: reminderAt === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(reminderAt) ? reminderAt : '',
    name: str(raw.name, base.name).slice(0, 60),
  };
}

const INTENSITIES: Practice['intensity'][] = ['restorative', 'gentle', 'balanced', 'strong'];

/** `[secondsFromStart, line]` pairs. Anything not shaped like one is dropped. */
function validateScript(raw: unknown): Practice['script'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<[number, string]> = [];
  for (const cue of raw) {
    if (!Array.isArray(cue) || cue.length < 2) continue;
    const at = num(cue[0], -1);
    if (at < 0 || typeof cue[1] !== 'string') continue;
    out.push([at, cue[1]]);
  }
  // Cues are consumed by time, so restore them ordered regardless of how they
  // were written.
  return out.length ? out.sort((a, b) => a[0] - b[0]) : undefined;
}

function validatePoses(raw: unknown): Pose[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Pose[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.name !== 'string') continue;
    out.push({
      id: str(p.id) || uid('pose'),
      name: p.name,
      // A zero-second pose would make the sequencer divide by zero.
      seconds: clamp(num(p.seconds, 30), 1, 3600),
      cue: str(p.cue),
      glyph: str(p.glyph, 'circle'),
      ...(typeof p.sanskrit === 'string' ? { sanskrit: p.sanskrit } : {}),
    });
  }
  return out.length ? out : undefined;
}

function validateBreath(raw: unknown): BreathPattern | undefined {
  if (!isObj(raw) || typeof raw.name !== 'string') return undefined;
  const phase = (v: unknown) => clamp(num(v), 0, 600);
  const pattern: BreathPattern = {
    id: str(raw.id) || uid('breath'),
    name: raw.name,
    inhale: phase(raw.inhale),
    holdIn: phase(raw.holdIn),
    exhale: phase(raw.exhale),
    holdOut: phase(raw.holdOut),
    why: str(raw.why),
  };
  // An all-zero pattern is an infinite loop in the breath orb, not a pattern.
  return pattern.inhale + pattern.exhale > 0 ? pattern : undefined;
}

/**
 * A Practice must survive a persist/restore round-trip LOSSLESSLY. Rebuilding
 * field-by-field is what keeps a malformed blob from becoming a live object,
 * but it means every optional field has to be carried explicitly — miss one and
 * a custom practice quietly loses its script or its whole pose sequence on the
 * next page load, with no error anywhere. `script`, `poses` and `breath` are
 * validated element-by-element rather than cast, for the same reason: a cast
 * would let `{poses: [{}, 3, null]}` reach the sequencer.
 */
function sanitizePractices(raw: unknown): Practice[] {
  if (!Array.isArray(raw)) return [];
  const out: Practice[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.title !== 'string') continue;

    const stops = Array.isArray(r.gradient) ? r.gradient : [];
    const gradient: [string, string] = [str(stops[0], '#6366f1'), str(stops[1], '#a855f7')];

    const kind = str(r.kind) as PracticeKind;
    const intensity = str(r.intensity) as Practice['intensity'];
    const script = validateScript(r.script);
    const poses = validatePoses(r.poses);
    const breath = validateBreath(r.breath);

    out.push({
      id: r.id,
      kind: KINDS.includes(kind) ? kind : 'breathwork',
      title: r.title,
      subtitle: str(r.subtitle),
      minutes: clamp(num(r.minutes, 5), 1, 120),
      intensity: INTENSITIES.includes(intensity) ? intensity : 'gentle',
      gradient,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      ...(script ? { script } : {}),
      ...(poses ? { poses } : {}),
      ...(breath ? { breath } : {}),
    });
  }
  return out;
}

function sanitizeActive(raw: unknown): ActiveSession | null {
  if (!isObj(raw) || typeof raw.practiceId !== 'string' || typeof raw.startedAt !== 'string') return null;
  return {
    practiceId: raw.practiceId,
    startedAt: raw.startedAt,
    elapsed: Math.max(0, num(raw.elapsed)),
    // Always paused, never merely defaulted to it. Someone who closed the tab
    // mid-practice was persisted with `paused: false`; restoring that verbatim
    // an hour later shows a live session whose timer stopped when the tab did.
    // The elapsed time is kept — the choice to resume is the user's.
    paused: true,
  };
}

function sanitizeAchievements(raw: unknown): Achievement[] {
  if (!Array.isArray(raw)) return [];
  const out: Achievement[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== 'string') continue;
    out.push({
      id: r.id,
      title: str(r.title),
      description: str(r.description),
      icon: str(r.icon, 'Award'),
      progress: clamp(num(r.progress), 0, 1),
      ...(typeof r.unlockedAt === 'string' ? { unlockedAt: r.unlockedAt } : {}),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── safe storage ──

interface StoredValue<S> {
  state: S;
  version?: number;
}

/**
 * Raised when a persisted blob was unreadable and had to be discarded. Module
 * scope because it is set during `getItem`, which runs before the store exists.
 */
let recoveredFromBadBlob = false;

const memoryFallback = new Map<string, string>();

/** localStorage, or an in-memory stand-in under SSR / a locked-down browser. */
function backing(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Safari in private mode exposes localStorage but throws on write.
      const probe = '__yoganext_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryFallback.set(k, v),
    removeItem: (k: string) => void memoryFallback.delete(k),
  };
}

/**
 * A storage adapter that cannot throw across the persist boundary. A malformed
 * blob is dropped rather than parsed into an unusable store — losing a corrupt
 * cache is recoverable, rendering a half-parsed one is not.
 */
const safeStorage = {
  getItem(name: string): StoredValue<PersistedState> | null {
    try {
      const raw = backing().getItem(name);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isObj(parsed) || !isObj(parsed.state)) {
        recoveredFromBadBlob = true;
        backing().removeItem(name);
        return null;
      }
      return parsed as unknown as StoredValue<PersistedState>;
    } catch {
      recoveredFromBadBlob = true;
      try {
        backing().removeItem(name);
      } catch {
        /* nothing further we can do */
      }
      return null;
    }
  },
  setItem(name: string, value: StoredValue<PersistedState>): void {
    try {
      backing().setItem(name, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage disabled. Dropping the write is correct:
      // the in-memory store stays usable and the session is not interrupted.
    }
  },
  removeItem(name: string): void {
    try {
      backing().removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

// ──────────────────────────────────────────────────────────────── store shape ──

/** The slice written to disk. Seed practices are excluded — only custom ones persist. */
interface PersistedState {
  practices: Practice[];
  sessions: Session[];
  moods: MoodEntry[];
  habit: HabitState;
  achievements: Achievement[];
  active: ActiveSession | null;
  settings: Settings;
}

/**
 * The projection written to disk. Shared by `partialize` and `exportJSON` so an
 * export can never drift from what is actually persisted.
 *
 * Only user-authored practices are included: persisting the seed library would
 * freeze whatever shipped on the day of install and never update it again.
 */
function toPersisted(s: AppState): PersistedState {
  return {
    practices: s.practices.filter(isCustom),
    sessions: s.sessions,
    moods: s.moods,
    habit: s.habit,
    achievements: s.achievements,
    active: s.active,
    settings: s.settings,
  };
}

export interface StoreActions {
  /** Install the seed practice library. Idempotent; custom practices are kept. */
  hydratePractices: (practices: Practice[]) => void;

  // the shell ---------------------------------------------------------------
  /** Show a screen. The tab bar and `navigate` are the same call. */
  setView: (view: ViewId) => void;
  /**
   * Replace the library filters WHOLESALE — an omitted field clears that filter,
   * matching `filter_library`'s contract ("pass null/omit to clear"). Returns
   * the filter actually applied, after validation.
   */
  setLibraryFilter: (next: Partial<LibraryFilter>) => LibraryFilter;

  // session lifecycle -------------------------------------------------------
  startSession: (practiceId: string, now?: string) => Session | null;
  pauseSession: () => void;
  resumeSession: () => void;
  /**
   * Give the running practice more time. For a pose sequence the current pose
   * is held for the same amount, otherwise the extra minute would be spent on
   * an already-finished sequence. Returns null when nothing is running.
   */
  extendSession: (seconds: number) => { seconds: number; pose?: string } | null;
  /**
   * Stop without recording a completion. The session row STAYS in the log,
   * incomplete and carrying its real duration — deleting it would quietly
   * inflate the completion rate `insights.ts` reports. No streak credit.
   */
  abandonSession: (reason?: string, now?: string) => Session | null;
  /** Jump a pose sequence to the next pose. Null if there is no sequence running. */
  skipPose: () => { from: Pose; to: Pose | null; secondsSkipped: number } | null;
  /**
   * Advance the timer by `seconds`, which may be FRACTIONAL — a rAF loop can
   * call `tick(0.016)` every frame and the deltas accumulate exactly. Defaults
   * to 1 so a plain `tick()` from a `setInterval` means "one second".
   *
   * The only action called on a loop, so it is deliberately the cheapest one
   * here: it touches `active` and nothing else. Elapsed time is mirrored onto
   * the session record at transitions (pause/complete/start), not per tick.
   */
  tick: (seconds?: number) => void;
  completeSession: (moodAfter?: MoodScore, note?: string, now?: string) => Session | null;

  // logging -----------------------------------------------------------------
  logMood: (score: MoodScore, feelings?: string[], note?: string, now?: string) => MoodEntry;
  /** Returns the new entry's id — `journal_entry` reports it back to the agent. */
  addJournalEntry: (text: string, now?: string) => string;

  // settings ----------------------------------------------------------------
  setIntention: (minutes: number) => void;
  setTheme: (theme: Settings['theme']) => void;
  setSoundscape: (soundscape: Settings['soundscape']) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setName: (name: string) => void;
  /** Alias of `setName`, named for the `set_profile` tool that calls it. */
  setProfileName: (name: string) => void;
  setReminder: (hhmm: string) => void;
  /**
   * Comfort controls, patched together because a user who says "I get motion
   * sick" usually wants both. `reduceMotion` is a persisted domain setting;
   * `muted` is shell state (it silences the player without forgetting which
   * soundscape they chose).
   */
  setAccessibility: (patch: { reduceMotion?: boolean; muted?: boolean }) => void;
  /**
   * Patch any subset of settings in one call — the You screen's general path.
   * The result is run through the same validator as a restore, so an invalid
   * theme or a malformed `reminderAt` is discarded rather than stored.
   */
  updateSettings: (patch: Partial<Settings>) => void;

  /** Add a custom breathing pattern, wrapped as a playable breathwork practice. */
  addBreathPattern: (pattern: BreathPattern) => Practice;

  // maintenance -------------------------------------------------------------
  /** Recompute streak/grace/achievements against `now`. Safe to call any time. */
  refresh: (now?: string) => void;
  /**
   * Erase all history on this device: sessions, moods, habit, achievements and
   * custom practices. Named to be hard to call by accident — it is not
   * undoable, so the UI must confirm first. The seed practice library remains,
   * and the demo history does NOT come back (a wipe means wiped).
   */
  dangerouslyResetAll: () => void;
  /** Alias of `dangerouslyResetAll`. Prefer the explicit name in new code. */
  reset: () => void;
  /**
   * The user's own data as pretty-printed JSON, for the You screen's export.
   * Same shape as the persisted blob, plus an `exportedAt` stamp — so an export
   * can be read back by a human and is not a private format.
   */
  exportJSON: () => string;
  /** Clear the "your saved data was reset" notice once the UI has shown it. */
  acknowledgeRecovery: () => void;
}

export interface Store extends AppState, StoreActions {
  /** Which screen is showing. Not persisted — every visit starts on Today. */
  view: ViewId;
  /** The practice library's kind/length filters, as the user currently sees them. */
  libraryFilter: LibraryFilter;
  /** Bonus time and pose adjustments for the running session. */
  player: PlayerState;
  /** Player ambience silenced, without discarding the chosen soundscape. */
  muted: boolean;
  /** True when a corrupt saved blob was discarded on load. Surface this. */
  _recovered: boolean;
  /** True once persistence has finished restoring (or decided there is nothing). */
  _hydrated: boolean;
}

// ──────────────────────────────────────────────────────────────────── the store ──

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...firstRunState(),
      view: 'today',
      libraryFilter: defaultLibraryFilter(),
      player: defaultPlayer(),
      muted: false,
      _recovered: false,
      _hydrated: false,

      // ── the shell ────────────────────────────────────────────────────────
      setView: (view) => set(() => (VIEW_IDS.includes(view) ? { view } : {})),

      setLibraryFilter: (next) => {
        const kind = next.kind;
        const max = next.maxMinutes;
        const applied: LibraryFilter = {
          kind: kind && kind !== 'all' && KINDS.includes(kind) ? kind : 'all',
          // A filter nobody can satisfy is worse than no filter: clamp rather
          // than store a 0- or 10 000-minute ceiling.
          maxMinutes:
            typeof max === 'number' && Number.isFinite(max) ? clamp(Math.round(max), 1, 240) : null,
        };
        set({ libraryFilter: applied });
        return applied;
      },

      // ── practices ────────────────────────────────────────────────────────
      hydratePractices: (practices) =>
        set((s) => {
          const custom = s.practices.filter(isCustom);
          const seenCustom = new Set(custom.map((p) => p.id));
          const next = [...practices.filter((p) => !seenCustom.has(p.id)), ...custom];
          // Swapping the library can orphan a running session the same way a
          // restore can, so it gets the same guard.
          return { practices: next, active: liveActive(next, s.active) };
        }),

      // ── session lifecycle ────────────────────────────────────────────────
      startSession: (practiceId, now = nowIso()) => {
        const s = get();
        const practice = s.practices.find((p) => p.id === practiceId);
        if (!practice) return null;

        // A mood logged a moment ago is this session's "before" reading. Without
        // this bridge nothing would ever populate moodBefore, and the entire
        // mood-delta insight would stay permanently insufficient — there is no
        // start_session argument for it in the tool contract.
        const recentMood = [...s.moods]
          .sort((a, b) => b.at.localeCompare(a.at))
          .find((m) => {
            const gap = Date.parse(now) - Date.parse(m.at);
            return Number.isFinite(gap) && gap >= 0 && gap <= MOOD_CARRY_MINUTES * 60_000;
          });

        const session: Session = {
          id: uid('sess'),
          practiceId: practice.id,
          kind: practice.kind,
          startedAt: now,
          seconds: 0,
          completed: false,
          ...(recentMood ? { moodBefore: recentMood.score } : {}),
        };

        set({
          // Recorded up front, incomplete. Abandoned sessions have to exist in
          // the data or "you finish 60% of what you start" would be unknowable.
          sessions: [...flushActive(s.sessions, s.active), session],
          active: { practiceId: practice.id, startedAt: now, elapsed: 0, paused: false },
          // A new practice starts with no bonus time and no pose adjustments;
          // inheriting the last session's would silently lengthen this one.
          player: defaultPlayer(),
        });
        return session;
      },

      pauseSession: () =>
        set((s) =>
          s.active && !s.active.paused
            ? { active: { ...s.active, paused: true }, sessions: flushActive(s.sessions, s.active) }
            : {},
        ),

      resumeSession: () => set((s) => (s.active?.paused ? { active: { ...s.active, paused: false } } : {})),

      extendSession: (seconds) => {
        const s = get();
        if (!s.active) return null;
        const add = clamp(Math.round(seconds), 1, 3600);

        const practice = s.practices.find((p) => p.id === s.active!.practiceId);
        const poses = practice?.poses ?? [];
        const player: PlayerState = { ...s.player, bonusSeconds: s.player.bonusSeconds + add };

        let pose: string | undefined;
        if (poses.length > 0) {
          const at = poseAt(poses, s.player.poseExtensions, s.active.elapsed + s.player.poseSkipSeconds);
          if (at) {
            // Keyed by INDEX, so a pose already left behind cannot be
            // retroactively lengthened by a later "one more minute".
            player.poseExtensions = {
              ...s.player.poseExtensions,
              [at.index]: (s.player.poseExtensions[at.index] ?? 0) + add,
            };
            pose = at.pose.name;
          }
        }

        set({ player });
        return pose ? { seconds: add, pose } : { seconds: add };
      },

      abandonSession: (reason) => {
        const s = get();
        if (!s.active) return null;

        const active = s.active;
        const seconds = Math.max(0, Math.round(active.elapsed));
        const isThisOne = (row: Session): boolean =>
          !row.completed && row.startedAt === active.startedAt && row.practiceId === active.practiceId;

        const open = s.sessions.find(isThisOne);
        const stopped: Session | null = open
          ? { ...open, seconds, completed: false, ...(reason ? { note: reason } : {}) }
          : null;
        const sessions = stopped ? s.sessions.map((row) => (isThisOne(row) ? stopped : row)) : s.sessions;

        // No `recordSession`: an abandoned practice earns no streak credit. It
        // costs nothing either — the grace model already forgives the day.
        set({ sessions, active: null, player: defaultPlayer() });
        return stopped;
      },

      skipPose: () => {
        const s = get();
        if (!s.active) return null;
        const practice = s.practices.find((p) => p.id === s.active!.practiceId);
        const poses = practice?.poses ?? [];
        if (poses.length === 0) return null;

        const at = poseAt(poses, s.player.poseExtensions, s.active.elapsed + s.player.poseSkipSeconds);
        if (!at || at.finished) return null;

        // Skipping = winding the pose clock forward to the next boundary, so the
        // sequence stays a pure function of time and nothing has to be stepped.
        const secondsSkipped = Math.max(1, Math.ceil(at.remaining));
        set({ player: { ...s.player, poseSkipSeconds: s.player.poseSkipSeconds + secondsSkipped } });
        return { from: at.pose, to: poses[at.index + 1] ?? null, secondsSkipped };
      },

      tick: (seconds = 1) =>
        set((s) => {
          // A paused timer must not advance, and `elapsed` must survive the
          // pause untouched — the player reads it straight back for display.
          if (!s.active || s.active.paused) return {};
          const step = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
          return { active: { ...s.active, elapsed: s.active.elapsed + step } };
        }),

      completeSession: (moodAfter, note, now = nowIso()) => {
        const s = get();
        if (!s.active) return null;

        const active = s.active;
        const seconds = Math.max(0, Math.round(active.elapsed));
        const day = dayKey(active.startedAt) || dayKey(now);

        const isThisOne = (row: Session): boolean =>
          !row.completed && row.startedAt === active.startedAt && row.practiceId === active.practiceId;

        const open = s.sessions.find(isThisOne);
        const finished: Session | null = open
          ? {
              ...open,
              seconds,
              completed: true,
              ...(moodAfter != null ? { moodAfter: asMood(moodAfter) } : {}),
              ...(note ? { note } : {}),
            }
          : null;

        const sessions = finished ? s.sessions.map((row) => (isThisOne(row) ? finished : row)) : s.sessions;

        const habit = recordSession(s.habit, { day, seconds, today: dayKey(now) });
        const next: AppState = { ...s, sessions, habit, active: null };
        set({
          sessions,
          habit,
          active: null,
          player: defaultPlayer(),
          achievements: withAchievements(next, now),
        });
        return finished;
      },

      // ── logging ──────────────────────────────────────────────────────────
      logMood: (score, feelings = [], note, now = nowIso()) => {
        const entry: MoodEntry = {
          id: uid('mood'),
          at: now,
          score: asMood(score),
          feelings: feelings.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim().toLowerCase()),
          ...(note ? { note } : {}),
        };
        set((s) => ({ moods: [...s.moods, entry] }));
        return entry;
      },

      /**
       * A journal entry is stored as a completed `Session` of kind 'journal'.
       * `types.ts` has no journal collection and the domain core is fixed, so
       * this is the modelling that keeps the tool surface complete without
       * editing the spine. Zero seconds, so it moves the calendar and the streak
       * (reflection is practice) without inflating `totalMinutes`.
       */
      addJournalEntry: (text, now = nowIso()) => {
        const s = get();
        const session: Session = {
          id: uid('journal'),
          practiceId: 'journal',
          kind: 'journal',
          startedAt: now,
          seconds: 0,
          completed: true,
          note: text,
        };
        const sessions = [...s.sessions, session];
        const today = dayKey(now);
        const habit = recordSession(s.habit, { day: today, seconds: 0, today });
        const next: AppState = { ...s, sessions, habit };
        set({ sessions, habit, achievements: withAchievements(next, now) });
        return session.id;
      },

      // ── settings ─────────────────────────────────────────────────────────
      setIntention: (minutes) =>
        set((s) => ({ habit: { ...s.habit, dailyGoalMinutes: clamp(Math.round(minutes), 3, 60) } })),

      setTheme: (theme) =>
        set((s) => (THEMES.includes(theme) ? { settings: { ...s.settings, theme } } : {})),

      setSoundscape: (soundscape) =>
        set((s) => (SOUNDSCAPES.includes(soundscape) ? { settings: { ...s.settings, soundscape } } : {})),

      setReduceMotion: (reduceMotion) => set((s) => ({ settings: { ...s.settings, reduceMotion } })),

      setName: (name) => set((s) => ({ settings: { ...s.settings, name: String(name).slice(0, 60) } })),

      setProfileName: (name) => get().setName(name),

      setAccessibility: (patch) =>
        set((s) => ({
          settings:
            typeof patch.reduceMotion === 'boolean'
              ? { ...s.settings, reduceMotion: patch.reduceMotion }
              : s.settings,
          muted: typeof patch.muted === 'boolean' ? patch.muted : s.muted,
        })),

      setReminder: (hhmm) =>
        set((s) => ({
          settings: { ...s.settings, reminderAt: /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '' },
        })),

      updateSettings: (patch) =>
        set((s) => ({ settings: sanitizeSettings({ ...s.settings, ...patch }, s.settings) })),

      addBreathPattern: (pattern) => {
        const cycle = Math.max(1, pattern.inhale + pattern.holdIn + pattern.exhale + pattern.holdOut);
        // Aim for a ~5-minute sit, but never fewer than 8 cycles or more than 20.
        const rounds = clamp(Math.round(300 / cycle), 8, 20);
        const practice: Practice = {
          id: `custom-${pattern.id}`,
          kind: 'breathwork',
          title: pattern.name,
          subtitle: `${pattern.inhale}-${pattern.holdIn}-${pattern.exhale}-${pattern.holdOut}, ${rounds} rounds`,
          minutes: Math.max(1, Math.round((cycle * rounds) / 60)),
          intensity: pattern.exhale > pattern.inhale ? 'restorative' : 'balanced',
          gradient: ['#38bdf8', '#818cf8'],
          breath: pattern,
          tags: [CUSTOM_TAG, 'breath', pattern.exhale > pattern.inhale ? 'calm' : 'focus'],
        };
        set((s) => ({ practices: [...s.practices, practice] }));
        return practice;
      },

      // ── maintenance ──────────────────────────────────────────────────────
      refresh: (now = nowIso()) =>
        set((s) => {
          const habit = reconcile(s.habit, dayKey(now));
          return { habit, achievements: withAchievements({ ...s, habit }, now) };
        }),

      dangerouslyResetAll: () => {
        // defaultAppState(), not firstRunState(): after someone deliberately
        // erases their history, repopulating the app with demo sessions would
        // look like the wipe had failed.
        const fresh = defaultAppState();
        set({
          ...fresh,
          achievements: withAchievements(fresh, nowIso()),
          // The shell goes back to its opening state too, so the screen the user
          // is left looking at matches the data they just erased.
          view: 'today',
          libraryFilter: defaultLibraryFilter(),
          player: defaultPlayer(),
          muted: false,
          _recovered: false,
        });
      },

      reset: () => get().dangerouslyResetAll(),

      exportJSON: () => {
        const s = get();
        return JSON.stringify(
          {
            app: 'yoganext',
            key: STORAGE_KEY,
            version: STATE_VERSION,
            exportedAt: nowIso(),
            state: toPersisted(s),
          },
          null,
          2,
        );
      },

      acknowledgeRecovery: () => set({ _recovered: false }),
    }),
    {
      name: STORAGE_KEY,
      version: STATE_VERSION,
      storage: safeStorage,

      partialize: (s): PersistedState => toPersisted(s),

      /**
       * Forward migration. Version 0 (any pre-versioning blob) is shape-checked
       * by `merge` anyway, so it passes through. An unknown FUTURE version means
       * the user has downgraded; we cannot understand that data, so we discard
       * it and flag a recovery rather than guess at its meaning.
       */
      migrate: (persisted: unknown, version: number) => {
        if (version > STATE_VERSION) {
          recoveredFromBadBlob = true;
          return undefined as unknown as PersistedState;
        }
        return persisted as PersistedState;
      },

      /**
       * Every slice is validated and every derived field recomputed. Whatever is
       * on disk, what lands in the store is a well-formed `AppState`.
       */
      merge: (persisted, current) => {
        const base = current as Store;
        if (!isObj(persisted)) return base;

        const p = persisted as Partial<PersistedState>;
        const habit = sanitizeHabit(p.habit);
        const sessions = sanitizeSessions(p.sessions);
        const active = sanitizeActive(p.active);

        const merged: Store = {
          ...base,
          // Seed library first, then the user's own patterns on top.
          practices: [...base.practices, ...sanitizePractices(p.practices).filter(isCustom)],
          sessions: flushActive(sessions, active),
          moods: sanitizeMoods(p.moods),
          habit,
          achievements: sanitizeAchievements(p.achievements),
          active,
          settings: sanitizeSettings(p.settings),
        };

        // An active session whose practice no longer exists is unreachable: the
        // player has nothing to render, so the user can neither see it nor stop
        // it, and `completeSession` is the only action that clears `active`.
        // Better to drop it than to leave the app insisting a session is running.
        merged.active = liveActive(merged.practices, merged.active);

        // Self-heal the caches. A tampered `streak: 9999` cannot survive this.
        const now = nowIso();
        merged.habit = reconcile(merged.habit, dayKey(now));
        merged.achievements = withAchievements(merged, now);
        return merged;
      },

      onRehydrateStorage: () => (state, error) => {
        const recovered = recoveredFromBadBlob || !!error;
        recoveredFromBadBlob = false;
        if (state) {
          // Mutating the rehydrated draft is the documented pattern, and it is
          // the only safe one here: for synchronous storage this callback runs
          // *during* `create()`, so `useStore` is still in its temporal dead
          // zone and referencing it would throw.
          if (recovered) {
            // The initial state carries the demo history, which is right for a
            // first-time visitor and wrong for someone whose data we just
            // failed to read — they would take the seeded sessions for their
            // own recovered ones. Clear to a blank slate and say so.
            Object.assign(state, defaultAppState());
          }
          state._hydrated = true;
          state._recovered = recovered;
        } else {
          // Rehydration failed outright — start clean rather than half-loaded.
          // Deferred by a microtask for the same TDZ reason.
          queueMicrotask(() => {
            useStore.setState({ ...defaultAppState(), _hydrated: true, _recovered: true });
          });
        }
      },
    },
  ),
);

/**
 * Alias. `agent/tools.ts` imports `useApp`, the React layer imports `useStore`;
 * they are the same store, named for how each side reads. Keeping both is
 * cheaper and safer than renaming across two already-written modules.
 */
export const useApp = useStore;

/** Non-reactive snapshot, for tools and tests. */
export const appState = (): Store => useStore.getState();
