/**
 * tools.ts — THE CAPABILITY LAYER.
 *
 * This file *is* the product. Every behaviour a human can reach through the GUI
 * is reachable here as a named, typed, documented function — which is what makes
 * the app agent-first rather than agent-scraped. The React components in
 * `src/components` call these same functions; they are not a privileged path.
 *
 * Invariants (from contract.ts, enforced here):
 *   1. A tool NEVER throws. Every failure surfaces as `{ ok:false, error }`.
 *   2. A tool ALWAYS returns a `message` written for a human to read verbatim,
 *      so an agent can relay it without paraphrasing (and without hallucinating).
 *   3. A tool is pure w.r.t. the store: it reads `useApp.getState()` and calls
 *      store actions. It holds no state of its own.
 *   4. Arguments arrive from a *language model*, i.e. untrusted and loosely
 *      typed — "10 minutes", "3", true. Everything is coerced and clamped at the
 *      boundary (see the `arg*` helpers) rather than trusted.
 */

import { useApp } from '../lib/store.ts';
import { summarize } from '../lib/insights.ts';
import { clamp } from '../lib/format.ts';
import { TOOL_SPECS } from './contract.ts';
import { registerImplementedTools } from './manifest.ts';
import type { BreathPattern, MoodScore, Practice, PracticeKind, Settings, ToolResult } from '../lib/types.ts';

// ───────────────────────────────────────────────────────────────── plumbing ──

/** Loose bag of arguments as produced by a model's tool-call JSON. */
export type ToolArgs = Record<string, unknown>;

/** The uniform shape every tool has. Args are optional so `{}` tools call bare. */
export type ToolFn = (args?: ToolArgs) => ToolResult<unknown>;

const state = () => useApp.getState();

const ok = <T>(message: string, data?: T): ToolResult<T> => ({ ok: true, message, data });

const fail = (message: string, error?: string): ToolResult<never> => ({
  ok: false,
  message,
  error: error ?? message,
});

/**
 * The one place a thrown error can be caught. Wrapping at the registry boundary
 * (rather than try/catching inside each tool) is what actually guarantees
 * invariant #1 — including for bugs we haven't thought of.
 */
function safe(name: string, fn: ToolFn): ToolFn {
  return (args) => {
    try {
      return fn(args ?? {});
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return fail(`Something went wrong running ${name}, so nothing was changed. (${detail})`, detail);
    }
  };
}

let idCounter = 0;
/** Ids are readable and collision-free within a session; that is all we need. */
const mkId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ───────────────────────────────────────────────────── argument coercion ──
// Models send "3", 3, " calm ", ["a"] or nothing at all. Normalise, never throw.

function argStr(args: ToolArgs, key: string): string | undefined {
  const v = args[key];
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function argNum(args: ToolArgs, key: string): number | undefined {
  const v = args[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // tolerate "10 minutes", "about 5"
    const m = v.match(/-?\d+(\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function argStrArray(args: ToolArgs, key: string): string[] {
  const v = args[key];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  // a model will sometimes send "anxious, tired" instead of ["anxious","tired"]
  if (typeof v === 'string') {
    return v
      .split(/[,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

/** Pick one of a fixed set, case-insensitively. Returns undefined if no match. */
function argEnum<T extends string>(args: ToolArgs, key: string, allowed: readonly T[]): T | undefined {
  const raw = argStr(args, key)?.toLowerCase();
  if (!raw) return undefined;
  return allowed.find((a) => a.toLowerCase() === raw);
}

/** Mood is deliberately coarse (1..5); round and clamp whatever we're handed. */
const asMood = (n: number): MoodScore => clamp(Math.round(n), 1, 5) as MoodScore;

const THEMES = ['aurora', 'dusk', 'forest', 'sand'] as const;
const SOUNDSCAPES = ['none', 'rain', 'ocean', 'forest', 'singing-bowl'] as const;
const KINDS: readonly PracticeKind[] = ['meditation', 'breathwork', 'yoga', 'sleep', 'journal'];

const MOOD_WORDS: Record<MoodScore, string> = {
  1: 'having a hard time',
  2: 'low',
  3: 'even',
  4: 'good',
  5: 'bright',
};

/** The compact projection of a practice we hand back to a model. */
const brief = (p: Practice) => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  minutes: p.minutes,
  intensity: p.intensity,
  subtitle: p.subtitle,
  tags: p.tags,
});

const listLine = (p: Practice) => `- ${p.title} (${p.id}) — ${p.kind}, ${p.minutes} min, ${p.intensity}`;

// ─────────────────────────────────────────────────────────── recommendation ──

/**
 * Intent -> the tags that satisfy it. Kept as data (not a chain of ifs) so the
 * recommender stays inspectable: you can read off exactly why a practice won.
 */
const INTENT_TAGS: Record<string, string[]> = {
  calm: ['anxiety', 'calm', 'stress', 'grounding', 'soothe'],
  focus: ['focus', 'clarity', 'concentration', 'morning'],
  sleep: ['sleep', 'night', 'rest', 'insomnia', 'wind-down'],
  energy: ['energy', 'morning', 'vitality', 'wake', 'activate'],
  grief: ['grief', 'heart', 'compassion', 'loss', 'metta'],
  pain: ['pain', 'body', 'release', 'restorative', 'tension'],
};

/** Map loose user language onto a canonical intent. Deterministic, no model. */
export function normaliseIntent(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (INTENT_TAGS[s]) return s;
  if (/anx|stress|panic|worr|overwhelm|tense|nerv|calm|settle/.test(s)) return 'calm';
  if (/sleep|insomn|night|bed|awake|tired.*night/.test(s)) return 'sleep';
  if (/focus|concentr|distract|scatter|clarity|work/.test(s)) return 'focus';
  if (/energ|tired|sluggish|flat|wake|morning|letharg/.test(s)) return 'energy';
  if (/grief|loss|sad|heartbreak|lonely|mourn/.test(s)) return 'grief';
  if (/pain|ache|sore|back|neck|tight|stiff/.test(s)) return 'pain';
  return undefined;
}

interface Scored {
  practice: Practice;
  score: number;
  /** the human-readable reasons, in the order they were applied */
  because: string[];
}

/**
 * Deterministic scoring. Exported so the per-practice "why this one" panel in
 * the UI and the agent's explanation are literally the same computation — the
 * agent cannot claim a reason the app didn't use.
 */
export function scorePractices(
  practices: Practice[],
  opts: { mood?: MoodScore; minutesAvailable?: number; intent?: string; recentPracticeIds?: string[] },
): Scored[] {
  const { mood, minutesAvailable, intent, recentPracticeIds = [] } = opts;
  const wanted = intent ? (INTENT_TAGS[intent] ?? [intent]) : [];

  const scored = practices.map<Scored>((p) => {
    let score = 0;
    const because: string[] = [];

    if (typeof minutesAvailable === 'number' && minutesAvailable > 0) {
      if (p.minutes <= minutesAvailable) {
        // closer to the available time is better, but never at the cost of fitting
        const fit = 1 - (minutesAvailable - p.minutes) / minutesAvailable;
        score += 2 + fit * 2;
        because.push(`fits your ${minutesAvailable} minutes (${p.minutes} min)`);
      } else {
        score -= 6;
      }
    }

    const hits = p.tags.filter((t) => wanted.includes(t.toLowerCase()));
    if (hits.length) {
      score += Math.min(3, hits.length) * 3;
      because.push(`tagged ${hits.join(', ')}`);
    }

    if (typeof mood === 'number') {
      if (mood <= 2) {
        if (p.intensity === 'restorative' || p.intensity === 'gentle') {
          score += 2.5;
          because.push('gentle enough for a low day');
        }
        if (p.kind === 'breathwork' || p.kind === 'meditation') {
          score += 1.5;
          because.push('breath and stillness settle the nervous system fastest');
        }
        if (p.intensity === 'strong') score -= 2;
      } else if (mood >= 4) {
        if (p.intensity === 'balanced' || p.intensity === 'strong') {
          score += 1.5;
          because.push('you have the energy for something fuller');
        }
      }
    }

    // gentle nudge toward variety, so the recommender doesn't loop on one card
    if (recentPracticeIds.includes(p.id)) {
      score -= 1;
    } else if (recentPracticeIds.length) {
      score += 0.5;
      because.push('something you have not done lately');
    }

    return { practice: p, score, because };
  });

  // stable, fully-deterministic ordering: score desc, then shorter, then id
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.practice.minutes - b.practice.minutes ||
      a.practice.id.localeCompare(b.practice.id),
  );
}

// ───────────────────────────────────────────────────────────────── the tools ──

const impl: Record<string, ToolFn> = {
  list_practices: (args = {}) => {
    const kind = argEnum(args, 'kind', KINDS);
    const maxMinutes = argNum(args, 'maxMinutes');
    const tag = argStr(args, 'tag')?.toLowerCase();

    let rows = state().practices;
    const filters: string[] = [];
    if (kind) {
      rows = rows.filter((p) => p.kind === kind);
      filters.push(kind);
    }
    if (typeof maxMinutes === 'number') {
      rows = rows.filter((p) => p.minutes <= maxMinutes);
      filters.push(`under ${maxMinutes} min`);
    }
    if (tag) {
      rows = rows.filter((p) => p.tags.some((t) => t.toLowerCase().includes(tag)));
      filters.push(`tagged "${tag}"`);
    }

    rows = [...rows].sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id));
    const scope = filters.length ? ` matching ${filters.join(', ')}` : '';

    if (!rows.length) {
      return ok(
        `Nothing in the library${scope}. Try widening the filter — call list_practices with no arguments to see everything.`,
        { practices: [], filters },
      );
    }
    return ok(`${rows.length} practice${rows.length === 1 ? '' : 's'}${scope}:\n${rows.map(listLine).join('\n')}`, {
      practices: rows.map(brief),
      filters,
    });
  },

  recommend_practice: (args = {}) => {
    const moodRaw = argNum(args, 'mood');
    const mood = typeof moodRaw === 'number' ? asMood(moodRaw) : undefined;
    const minutesAvailable = argNum(args, 'minutesAvailable');
    const intent = normaliseIntent(argStr(args, 'intent'));

    const s = state();
    if (!s.practices.length) return fail('The practice library is empty, so there is nothing to recommend yet.');

    const recentPracticeIds = [...s.sessions]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 3)
      .map((x) => x.practiceId);

    const ranked = scorePractices(s.practices, { mood, minutesAvailable, intent, recentPracticeIds });
    const top = ranked[0];
    const alternatives = ranked.slice(1, 3).map((r) => brief(r.practice));

    const context: string[] = [];
    if (mood) context.push(`you are ${MOOD_WORDS[mood]}`);
    if (minutesAvailable) context.push(`you have ${minutesAvailable} minutes`);
    if (intent) context.push(`you want ${intent}`);

    const reason = top.because.length ? top.because.join('; ') : 'it is the best all-round fit in the library';
    const lead = context.length ? `Because ${context.join(' and ')}, ` : '';
    const overrun =
      typeof minutesAvailable === 'number' && top.practice.minutes > minutesAvailable
        ? ` Note: nothing fits inside ${minutesAvailable} minutes, so this is the shortest close option at ${top.practice.minutes} min.`
        : '';

    return ok(
      `${lead}I would do **${top.practice.title}** — ${top.practice.minutes} min of ${top.practice.kind}, ${top.practice.intensity}. ${top.practice.subtitle}\n\nWhy this one: ${reason}.${overrun}\n\nSay "start it" and I will begin.`,
      {
        practice: brief(top.practice),
        reason: top.because,
        alternatives,
        interpreted: { mood, minutesAvailable, intent },
      },
    );
  },

  start_session: (args = {}) => {
    const practiceId = argStr(args, 'practiceId');
    if (!practiceId) {
      return fail(
        'I need a practiceId to start. Call list_practices or recommend_practice first.',
        'missing_practice_id',
      );
    }

    const s = state();
    if (s.active) {
      const running = s.practices.find((p) => p.id === s.active!.practiceId);
      return fail(
        `${running?.title ?? 'A practice'} is already running. Complete or pause it before starting another.`,
        'session_already_active',
      );
    }
    const practice = s.practices.find((p) => p.id === practiceId);
    if (!practice) {
      return fail(
        `There is no practice with id "${practiceId}". Call list_practices to see the valid ids.`,
        'unknown_practice',
      );
    }

    s.startSession(practice.id);
    return ok(
      `Starting **${practice.title}** — ${practice.minutes} minutes of ${practice.kind}. The player is open; I will stay quiet until you finish.`,
      { practice: brief(practice) },
    );
  },

  pause_session: () => {
    const s = state();
    if (!s.active) return fail('Nothing is running, so there is nothing to pause.', 'no_active_session');
    if (s.active.paused) return ok('That practice is already paused. Say "resume" when you are ready.');
    s.pauseSession();
    const mins = Math.floor(s.active.elapsed / 60);
    const secs = s.active.elapsed % 60;
    return ok(`Paused at ${mins}:${String(secs).padStart(2, '0')}. Take the time you need.`, {
      elapsed: s.active.elapsed,
    });
  },

  resume_session: () => {
    const s = state();
    if (!s.active) return fail('Nothing is paused — there is no session to resume.', 'no_active_session');
    if (!s.active.paused) return ok('That practice is already running.');
    s.resumeSession();
    return ok('Resuming. Settle back in — no need to catch up on anything.');
  },

  complete_session: (args = {}) => {
    const s = state();
    if (!s.active) return fail('There is no running practice to complete.', 'no_active_session');

    const moodRaw = argNum(args, 'moodAfter');
    const moodAfter = typeof moodRaw === 'number' ? asMood(moodRaw) : undefined;
    const note = argStr(args, 'note');

    const practice = s.practices.find((p) => p.id === s.active!.practiceId);
    const seconds = Math.round(s.active.elapsed);
    const minutes = Math.round(seconds / 60);
    // Do NOT round a 20-second sit up to "1 min". The store credits what was
    // actually practised, and the sentence has to agree with the ledger.
    const duration = seconds < 60 ? 'under a minute' : `${minutes} min`;

    s.completeSession(moodAfter, note);

    const after = state();
    const streakLine = after.habit.streak > 0 ? ` That is ${after.habit.streak} day${after.habit.streak === 1 ? '' : 's'} in a row.` : '';
    const moodLine = moodAfter ? ` You logged feeling ${MOOD_WORDS[moodAfter]} afterwards.` : '';
    const askMood = moodAfter ? '' : ' If you tell me how you feel now, the insight engine gets sharper.';

    return ok(
      `Logged **${practice?.title ?? 'your practice'}** — ${duration}.${streakLine}${moodLine}${askMood}`,
      { seconds, minutes, streak: after.habit.streak, totalMinutes: after.habit.totalMinutes, moodAfter },
    );
  },

  log_mood: (args = {}) => {
    const raw = argNum(args, 'score');
    if (typeof raw !== 'number') {
      return fail('I need a mood score from 1 (worst) to 5 (best) to log anything.', 'missing_score');
    }
    const score = asMood(raw);
    const feelings = argStrArray(args, 'feelings');
    const note = argStr(args, 'note');

    state().logMood(score, feelings, note);

    const feelingLine = feelings.length ? ` (${feelings.join(', ')})` : '';
    const offer =
      score <= 2
        ? ' That sounds heavy. Want me to find something short and gentle?'
        : score >= 4
          ? ' Good to hear. Want to use that energy on a fuller practice?'
          : '';
    return ok(`Noted — ${score}/5, ${MOOD_WORDS[score]}${feelingLine}.${offer}`, { score, feelings, note });
  },

  get_progress: () => {
    const s = state();
    const h = s.habit;
    const recent = [...s.sessions]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 5)
      .map((x) => ({
        practiceId: x.practiceId,
        kind: x.kind,
        startedAt: x.startedAt,
        minutes: Math.round(x.seconds / 60),
        completed: x.completed,
      }));

    const todayKey = new Date().toISOString().slice(0, 10);
    const practisedToday = h.practiceDays.includes(todayKey);
    const goalLine = practisedToday
      ? `You have already practised today against your ${h.dailyGoalMinutes}-minute intention.`
      : `Your intention is ${h.dailyGoalMinutes} minutes a day; today is still open.`;

    const streakLine =
      h.streak === 0
        ? 'No active streak right now — the next session starts one.'
        : `${h.streak}-day streak (best ever ${h.bestStreak}), with ${h.grace} grace day${h.grace === 1 ? '' : 's'} in hand.`;

    const unlocked = s.achievements.filter((a) => a.unlockedAt).length;

    return ok(
      `${streakLine} ${h.totalMinutes} minutes practised all time across ${s.sessions.length} session${s.sessions.length === 1 ? '' : 's'}. ${goalLine} ${unlocked}/${s.achievements.length} achievements unlocked.`,
      {
        streak: h.streak,
        bestStreak: h.bestStreak,
        grace: h.grace,
        totalMinutes: h.totalMinutes,
        dailyGoalMinutes: h.dailyGoalMinutes,
        practisedToday,
        sessionCount: s.sessions.length,
        achievementsUnlocked: unlocked,
        recent,
      },
    );
  },

  get_insights: () => {
    const s = state();
    // Delegated to lib/insights.ts on purpose. A second, competing derivation
    // here is how an app ends up telling the user two different truths — and
    // that module already gates every claim on sample size.
    const insights = summarize(s);
    if (!insights.length) {
      return ok(
        'Not enough data for an honest observation yet — log a mood before and after a few sessions and patterns will start to show. I would rather say nothing than invent a trend.',
        { insights: [], sessions: s.sessions.length, moods: s.moods.length },
      );
    }
    return ok(
      insights.map((i) => `- ${i.headline} ${i.detail} (confidence: ${i.confidence})`).join('\n'),
      { insights, sessions: s.sessions.length, moods: s.moods.length },
    );
  },

  set_intention: (args = {}) => {
    const raw = argNum(args, 'minutes');
    if (typeof raw !== 'number') return fail('Tell me the daily goal in minutes (3-60).', 'missing_minutes');
    const minutes = clamp(Math.round(raw), 3, 60);
    const clampNote =
      minutes !== Math.round(raw) ? ` (I clamped ${Math.round(raw)} into the supported 3-60 range.)` : '';

    state().setIntention(minutes);
    const encouragement =
      minutes <= 10 ? ' Small and daily beats big and occasional.' : ' Ambitious — protect the time in your calendar.';
    return ok(`Daily intention set to ${minutes} minutes.${clampNote}${encouragement}`, { minutes });
  },

  set_theme: (args = {}) => {
    const theme = argEnum(args, 'theme', THEMES);
    if (!theme) {
      return fail(`Pick one of: ${THEMES.join(', ')}.`, 'invalid_theme');
    }
    state().setTheme(theme as Settings['theme']);
    return ok(`Theme is now **${theme}**.`, { theme });
  },

  set_soundscape: (args = {}) => {
    const soundscape = argEnum(args, 'soundscape', SOUNDSCAPES);
    if (!soundscape) {
      return fail(`Pick one of: ${SOUNDSCAPES.join(', ')}.`, 'invalid_soundscape');
    }
    state().setSoundscape(soundscape as Settings['soundscape']);
    const msg = soundscape === 'none' ? 'Ambience off — just the guidance and silence.' : `Ambience set to **${soundscape}**.`;
    return ok(msg, { soundscape });
  },

  create_breath_pattern: (args = {}) => {
    const name = argStr(args, 'name');
    const inhale = argNum(args, 'inhale');
    const exhale = argNum(args, 'exhale');
    if (!name) return fail('A breath pattern needs a name.', 'missing_name');
    if (typeof inhale !== 'number' || typeof exhale !== 'number') {
      return fail('A breath pattern needs at least an inhale and an exhale length in seconds.', 'missing_phase');
    }

    const phase = (n: number | undefined) => clamp(Math.round(n ?? 0), 0, 60);
    const pattern: BreathPattern = {
      id: mkId('breath'),
      name,
      inhale: clamp(Math.round(inhale), 1, 60),
      holdIn: phase(argNum(args, 'holdIn')),
      exhale: clamp(Math.round(exhale), 1, 60),
      holdOut: phase(argNum(args, 'holdOut')),
      why: argStr(args, 'why') ?? 'A custom rhythm.',
    };

    state().addBreathPattern(pattern);

    const cycle = pattern.inhale + pattern.holdIn + pattern.exhale + pattern.holdOut;
    const shape = [pattern.inhale, pattern.holdIn, pattern.exhale, pattern.holdOut].join('-');
    // The physiology is worth stating: a longer exhale is the actual mechanism.
    const note =
      pattern.exhale > pattern.inhale
        ? ' The exhale is longer than the inhale, which is what pulls you toward the parasympathetic side.'
        : '';
    return ok(`Saved **${name}** (${shape}) — one cycle is ${cycle}s, about ${Math.round(60 / cycle)} breaths a minute.${note}`, {
      pattern,
      cycleSeconds: cycle,
    });
  },

  journal_entry: (args = {}) => {
    const text = argStr(args, 'text');
    if (!text) return fail('There is nothing to save — give me the reflection text.', 'empty_entry');
    const id = state().addJournalEntry(text);
    const words = text.split(/\s+/).filter(Boolean).length;
    return ok(`Saved to your journal (${words} word${words === 1 ? '' : 's'}). It is stored on this device only.`, {
      id,
      words,
    });
  },
};

// ───────────────────────────────────────────────────────────────── registry ──

/**
 * The registry. Wrapping happens once, here, so no call path can bypass the
 * never-throw guarantee. Frozen because the tool surface is a contract, not a
 * plugin point — adding a tool means adding it to TOOL_SPECS first.
 */
export const TOOLS: Readonly<Record<string, ToolFn>> = Object.freeze(
  Object.fromEntries(Object.entries(impl).map(([name, fn]) => [name, safe(name, fn)])),
);

/** Every implemented tool name. Consumed by `verifyToolCoverage()`. */
export const IMPLEMENTED_TOOL_NAMES: readonly string[] = Object.freeze(Object.keys(impl));

// Hand the list to the manifest so `verifyToolCoverage()` works with no args
// anywhere this module has been loaded. The dependency points this way (tools ->
// manifest) so that manifest.ts stays free of the store/React/DOM chain.
registerImplementedTools(IMPLEMENTED_TOOL_NAMES);

/**
 * The single entry point an agent (or the console) uses. Unknown names fail
 * exactly like any other tool error — never an exception.
 */
export function callTool(name: string, args: ToolArgs = {}): ToolResult<unknown> {
  const fn = TOOLS[name];
  if (!fn) {
    return fail(
      `There is no tool called "${name}". Available: ${TOOL_SPECS.map((t) => t.name).join(', ')}.`,
      'unknown_tool',
    );
  }
  return fn(args);
}

/** True if the tool mutates state — the UI uses this to style the call chip. */
export function toolMutates(name: string): boolean {
  return TOOL_SPECS.find((t) => t.name === name)?.mutates ?? false;
}
