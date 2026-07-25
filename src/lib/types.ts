/**
 * types.ts — the DOMAIN CORE.
 *
 * This file is the spine of an *agent-first* application. The rule that follows
 * from that architecture: **the UI never owns state or logic.** Everything a user
 * can do is a pure operation over these types, exposed as a tool in
 * `src/agent/tools.ts`. The React layer is a *view*; an agent driving the tool
 * surface can reach 100% of the product's capability without touching a pixel.
 *
 * Do not add a feature to a component that is not reachable as a tool.
 */

// ─────────────────────────────────────────────────────────────── practices ──

export type PracticeKind = 'meditation' | 'breathwork' | 'yoga' | 'sleep' | 'journal';

export type Intensity = 'restorative' | 'gentle' | 'balanced' | 'strong';

/** A breathing pattern in seconds. Zero-length phases are simply skipped. */
export interface BreathPattern {
  id: string;
  name: string;
  /** inhale, hold-in, exhale, hold-out — seconds */
  inhale: number;
  holdIn: number;
  exhale: number;
  holdOut: number;
  /** one-line physiological rationale shown to the user */
  why: string;
}

export interface Practice {
  id: string;
  kind: PracticeKind;
  title: string;
  /** short poetic subtitle shown on the card */
  subtitle: string;
  minutes: number;
  intensity: Intensity;
  /** tailwind gradient stops, e.g. ['#6366f1','#a855f7'] */
  gradient: [string, string];
  /** optional guided script: [secondsFromStart, line] */
  script?: Array<[number, string]>;
  breath?: BreathPattern;
  /** yoga only */
  poses?: Pose[];
  tags: string[];
}

export interface Pose {
  id: string;
  name: string;
  sanskrit?: string;
  seconds: number;
  cue: string;
  /** simple svg path/emoji token used by the pose illustration */
  glyph: string;
}

// ──────────────────────────────────────────────────────────────── sessions ──

export interface Session {
  id: string;
  practiceId: string;
  kind: PracticeKind;
  /** ISO timestamp */
  startedAt: string;
  /** seconds actually practised (not the nominal length) */
  seconds: number;
  completed: boolean;
  moodBefore?: MoodScore;
  moodAfter?: MoodScore;
  note?: string;
}

/** 1 = worst, 5 = best. Deliberately coarse: precision here is false. */
export type MoodScore = 1 | 2 | 3 | 4 | 5;

export interface MoodEntry {
  id: string;
  at: string;
  score: MoodScore;
  /** free-form tags the user taps: 'anxious', 'grateful', ... */
  feelings: string[];
  note?: string;
}

// ─────────────────────────────────────────────────────────────────── habit ──

/**
 * The habit engine. Deliberately *forgiving*: streaks that shatter on one missed
 * day punish exactly the people who need the practice most. We use a "grace"
 * model — one missed day is absorbed, and the streak is measured in weeks
 * practised rather than perfect consecutive days.
 */
export interface HabitState {
  /** consecutive days including today, grace applied */
  streak: number;
  /** longest streak ever reached */
  bestStreak: number;
  /** unused grace days remaining this week (max 1) */
  grace: number;
  /** ISO date strings 'YYYY-MM-DD' on which a session completed */
  practiceDays: string[];
  /** minutes practised, all time */
  totalMinutes: number;
  /** the user's chosen daily intention, e.g. 10 (minutes) */
  dailyGoalMinutes: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** lucide icon name */
  icon: string;
  unlockedAt?: string;
  /** progress 0..1 toward unlocking */
  progress: number;
}

// ────────────────────────────────────────────────────────────────── agent ──

/** Result envelope every tool returns. Never throw across the tool boundary. */
export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** human-readable, shown verbatim in the agent transcript */
  message: string;
  error?: string;
}

export interface AppState {
  practices: Practice[];
  sessions: Session[];
  moods: MoodEntry[];
  habit: HabitState;
  achievements: Achievement[];
  /** currently running session, if any */
  active: ActiveSession | null;
  settings: Settings;
}

export interface ActiveSession {
  practiceId: string;
  startedAt: string;
  /** seconds elapsed */
  elapsed: number;
  paused: boolean;
}

export interface Settings {
  theme: 'aurora' | 'dusk' | 'forest' | 'sand';
  reduceMotion: boolean;
  soundscape: 'none' | 'rain' | 'ocean' | 'forest' | 'singing-bowl';
  /** HH:MM local, empty = off */
  reminderAt: string;
  name: string;
}
