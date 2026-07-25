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
  Practice,
  Session,
  Settings,
} from './types.ts';
import { achievementProgress, recordSession, reconcile } from './habit.ts';
import { clamp, dayKey } from './format.ts';

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

/**
 * The seed practice library.
 *
 * Left empty here on purpose: `src/data/` owns the content, and `Today.tsx`
 * already renders an explicit empty state. The app entry (or a data module)
 * calls `hydratePractices()` once at boot. Doing it this way means a missing or
 * late content module degrades to "no practices yet" rather than a build error.
 */
const SEED_PRACTICES: Practice[] = [];

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

export const defaultAppState = (): AppState => ({
  practices: [...SEED_PRACTICES],
  sessions: [],
  moods: [],
  habit: defaultHabit(),
  achievements: [],
  active: null,
  settings: defaultSettings(),
});

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

function sanitizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isObj(raw)) return base;
  const theme = str(raw.theme) as Settings['theme'];
  const soundscape = str(raw.soundscape) as Settings['soundscape'];
  return {
    theme: THEMES.includes(theme) ? theme : base.theme,
    reduceMotion: bool(raw.reduceMotion, base.reduceMotion),
    soundscape: SOUNDSCAPES.includes(soundscape) ? soundscape : base.soundscape,
    reminderAt: /^\d{2}:\d{2}$/.test(str(raw.reminderAt)) ? str(raw.reminderAt) : '',
    name: str(raw.name).slice(0, 60),
  };
}

function sanitizePractices(raw: unknown): Practice[] {
  if (!Array.isArray(raw)) return [];
  const out: Practice[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.title !== 'string') continue;
    const raw = Array.isArray(r.gradient) ? r.gradient : [];
    const gradient: [string, string] = [str(raw[0], '#6366f1'), str(raw[1], '#a855f7')];
    out.push({
      id: r.id,
      kind: str(r.kind, 'breathwork') as Practice['kind'],
      title: r.title,
      subtitle: str(r.subtitle),
      minutes: clamp(num(r.minutes, 5), 1, 120),
      intensity: str(r.intensity, 'gentle') as Practice['intensity'],
      gradient,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      ...(isObj(r.breath) ? { breath: r.breath as unknown as BreathPattern } : {}),
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
    paused: bool(raw.paused, true), // a session restored from disk is never live
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

export interface StoreActions {
  /** Install the seed practice library. Idempotent; custom practices are kept. */
  hydratePractices: (practices: Practice[]) => void;

  // session lifecycle -------------------------------------------------------
  startSession: (practiceId: string, now?: string) => Session | null;
  pauseSession: () => void;
  resumeSession: () => void;
  /** Advance the timer. The only action called on a loop — keep it cheap. */
  tick: (seconds: number) => void;
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
  setReminder: (hhmm: string) => void;

  /** Add a custom breathing pattern, wrapped as a playable breathwork practice. */
  addBreathPattern: (pattern: BreathPattern) => Practice;

  // maintenance -------------------------------------------------------------
  /** Recompute streak/grace/achievements against `now`. Safe to call any time. */
  refresh: (now?: string) => void;
  /** Wipe everything on this device. */
  reset: () => void;
  /** Clear the "your saved data was reset" notice once the UI has shown it. */
  acknowledgeRecovery: () => void;
}

export interface Store extends AppState, StoreActions {
  /** True when a corrupt saved blob was discarded on load. Surface this. */
  _recovered: boolean;
  /** True once persistence has finished restoring (or decided there is nothing). */
  _hydrated: boolean;
}

// ──────────────────────────────────────────────────────────────────── the store ──

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...defaultAppState(),
      _recovered: false,
      _hydrated: false,

      // ── practices ────────────────────────────────────────────────────────
      hydratePractices: (practices) =>
        set((s) => {
          const custom = s.practices.filter(isCustom);
          const seenCustom = new Set(custom.map((p) => p.id));
          return {
            practices: [...practices.filter((p) => !seenCustom.has(p.id)), ...custom],
          };
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

      tick: (seconds) =>
        set((s) => {
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
        set({ sessions, habit, active: null, achievements: withAchievements(next, now) });
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

      setReminder: (hhmm) =>
        set((s) => ({
          settings: { ...s.settings, reminderAt: /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '' },
        })),

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

      reset: () => {
        const fresh = defaultAppState();
        set({ ...fresh, achievements: withAchievements(fresh, nowIso()), _recovered: false });
      },

      acknowledgeRecovery: () => set({ _recovered: false }),
    }),
    {
      name: STORAGE_KEY,
      version: STATE_VERSION,
      storage: safeStorage,

      partialize: (s): PersistedState => ({
        // Only user-authored practices. Persisting the seed library would freeze
        // whatever shipped on the day of install and never update it again.
        practices: s.practices.filter(isCustom),
        sessions: s.sessions,
        moods: s.moods,
        habit: s.habit,
        achievements: s.achievements,
        active: s.active,
        settings: s.settings,
      }),

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
