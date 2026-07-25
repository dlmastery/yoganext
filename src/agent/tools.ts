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

import { useApp, VIEW_IDS } from '../lib/store.ts';
import type { ViewId } from '../lib/store.ts';
import { summarize } from '../lib/insights.ts';
import { clamp, humanMinutes } from '../lib/format.ts';
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

/**
 * Booleans arrive as `true`, `"true"`, `"yes"`, `"on"` or `1` depending on the
 * runtime. `undefined` means "not mentioned", which for a patch-style tool is
 * meaningfully different from `false` — so this deliberately does not default.
 */
function argBool(args: ToolArgs, key: string): boolean | undefined {
  const v = args[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', 'y', 'on', '1'].includes(s)) return true;
    if (['false', 'no', 'n', 'off', '0'].includes(s)) return false;
  }
  return undefined;
}

/**
 * A string argument that is allowed to be EMPTY. `argStr` folds `''` into
 * `undefined`, which is right for "you forgot to pass this" and wrong for
 * "clear it" — `set_profile('')` and `set_reminder('')` both mean *unset*.
 */
function argRawStr(args: ToolArgs, key: string): string | undefined {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** `"7:30"`, `"07:30"`, `"8pm"`, `"8:15 PM"` -> `"20:00"`. Undefined if unreadable. */
function asClockTime(input: string): string | undefined {
  const m = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\.?$/i);
  if (!m) return undefined;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Pick one of a fixed set, case-insensitively. Returns undefined if no match. */
function argEnum<T extends string>(args: ToolArgs, key: string, allowed: readonly T[]): T | undefined {
  const raw = argStr(args, key)?.toLowerCase();
  if (!raw) return undefined;
  return allowed.find((a) => a.toLowerCase() === raw);
}

/** Mood is deliberately coarse (1..5); round and clamp whatever we're handed. */
const asMood = (n: number): MoodScore => clamp(Math.round(n), 1, 5) as MoodScore;

/** What the user calls each screen. `navigate` reports the label, not the id. */
const VIEW_LABEL: Record<ViewId, string> = {
  today: 'Today',
  practice: 'Practices',
  progress: 'Progress',
  you: 'You',
};

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

    // The store wraps the pattern into a playable breathwork Practice and hands
    // it back. Surface that id: without it an agent can create a pattern and
    // then have no way to start the thing it just made.
    const practice = state().addBreathPattern(pattern);

    const cycle = pattern.inhale + pattern.holdIn + pattern.exhale + pattern.holdOut;
    const shape = [pattern.inhale, pattern.holdIn, pattern.exhale, pattern.holdOut].join('-');
    // The physiology is worth stating: a longer exhale is the actual mechanism.
    const note =
      pattern.exhale > pattern.inhale
        ? ' The exhale is longer than the inhale, which is what pulls you toward the parasympathetic side.'
        : '';
    return ok(
      `Saved **${name}** (${shape}) — one cycle is ${cycle}s, about ${Math.round(60 / cycle)} breaths a minute.${note} It is now in your library as a ${practice.minutes}-minute practice; say the word and I will start it.`,
      { pattern, cycleSeconds: cycle, practice: brief(practice) },
    );
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

  // ───────────────────────────────────────────────────────────────────────────
  // PARITY TOOLS. Ten things a user could do with a tap and an agent could not
  // do at all. Each one is now the ONLY path: the React handler behind the tap
  // calls the tool below, so there is a single implementation to be right about
  // and a single place the behaviour can drift from its description.
  // ───────────────────────────────────────────────────────────────────────────

  navigate: (args = {}) => {
    const view = argEnum(args, 'view', VIEW_IDS);
    if (!view) {
      return fail(
        `"${argStr(args, 'view') ?? ''}" is not a screen. Pick one of: ${VIEW_IDS.join(', ')}.`,
        'invalid_view',
      );
    }
    const s = state();
    if (s.view === view) return ok(`Already on **${VIEW_LABEL[view]}**.`, { view, changed: false });
    s.setView(view);
    return ok(`Opened **${VIEW_LABEL[view]}**.`, { view, from: s.view, changed: true });
  },

  filter_library: (args = {}) => {
    const rawKind = argStr(args, 'kind');
    const kind = argEnum(args, 'kind', KINDS);
    if (rawKind && !kind && rawKind.toLowerCase() !== 'all') {
      return fail(`"${rawKind}" is not a practice kind. Pick one of: ${KINDS.join(', ')}.`, 'invalid_kind');
    }
    const maxRaw = argNum(args, 'maxMinutes');

    const s = state();
    // Wholesale, not a patch: the contract says an omitted field CLEARS that
    // filter, so "show me breathwork" cannot silently keep yesterday's length cap.
    const applied = s.setLibraryFilter({
      kind: kind ?? 'all',
      ...(typeof maxRaw === 'number' ? { maxMinutes: maxRaw } : {}),
    });

    const matching = s.practices.filter(
      (p) =>
        (applied.kind === 'all' || p.kind === applied.kind) &&
        (applied.maxMinutes === null || p.minutes <= applied.maxMinutes),
    );

    const parts: string[] = [];
    if (applied.kind !== 'all') parts.push(applied.kind);
    if (applied.maxMinutes !== null) parts.push(`${applied.maxMinutes} min or under`);
    const scope = parts.length ? parts.join(', ') : 'everything';

    // The filters only exist on the Practices screen, so say so rather than
    // letting the agent claim a change the user cannot see.
    const hint =
      s.view === 'practice'
        ? ''
        : ' They are on the Practices screen — call navigate with view "practice" to show them.';
    const empty = matching.length === 0 ? ' Nothing matches that combination, so the grid is empty.' : '';

    return ok(
      `Library filtered to **${scope}** — ${matching.length} of ${s.practices.length} practice${
        s.practices.length === 1 ? '' : 's'
      }.${empty}${hint}`,
      { filter: applied, matching: matching.map(brief), matchCount: matching.length },
    );
  },

  extend_session: (args = {}) => {
    const s = state();
    if (!s.active) return fail('Nothing is running, so there is no session to extend.', 'no_active_session');

    const raw = argNum(args, 'minutes');
    const minutes = typeof raw === 'number' && raw > 0 ? Math.min(raw, 30) : 1;
    // Floor at 5s: the "hold this pose longer" control passes a fraction of a
    // minute, and rounding that to zero would make the button do nothing.
    const seconds = Math.max(5, Math.round(minutes * 60));

    const added = s.extendSession(seconds);
    if (!added) return fail('Nothing is running, so there is no session to extend.', 'no_active_session');

    const practice = s.practices.find((p) => p.id === s.active!.practiceId);
    const held = added.pose ? ` Holding **${added.pose}** for that much longer too.` : '';
    return ok(
      `Added ${humanMinutes(added.seconds / 60)} to **${practice?.title ?? 'your practice'}**.${held} No rush.`,
      { secondsAdded: added.seconds, pose: added.pose ?? null },
    );
  },

  abandon_session: (args = {}) => {
    const reason = argStr(args, 'reason');
    const s = state();
    if (!s.active) return fail('Nothing is running, so there is nothing to stop.', 'no_active_session');

    const practice = s.practices.find((p) => p.id === s.active!.practiceId);
    const seconds = Math.max(0, Math.round(s.active.elapsed));
    s.abandonSession(reason);

    const spent = seconds < 60 ? 'under a minute' : `${Math.round(seconds / 60)} min`;
    // Deliberately no streak talk and no "try again tomorrow". Stopping is a
    // legitimate outcome, and this is an app people open when they feel bad.
    return ok(
      `Stopped **${practice?.title ?? 'your practice'}** after ${spent}. It is not logged as finished and it does not cost you anything — knowing when to stop is part of the practice.`,
      { practiceId: practice?.id ?? null, seconds, reason: reason ?? null },
    );
  },

  skip_pose: () => {
    const s = state();
    if (!s.active) return fail('Nothing is running, so there is no pose to skip.', 'no_active_session');

    const practice = s.practices.find((p) => p.id === s.active!.practiceId);
    if (!practice?.poses?.length) {
      return fail(
        `**${practice?.title ?? 'This practice'}** is not a pose sequence, so there is nothing to skip. You can pause, extend or finish it instead.`,
        'not_a_pose_sequence',
      );
    }

    const skipped = s.skipPose();
    if (!skipped) {
      return ok('You are already at the end of the sequence — there is no next pose to move to.', {
        skipped: false,
      });
    }
    const next = skipped.to
      ? `Next: **${skipped.to.name}** — ${skipped.to.cue}`
      : 'That was the last pose, so the sequence is done; finish whenever you are ready.';
    return ok(`Moved on from **${skipped.from.name}**. ${next}`, {
      skipped: true,
      from: skipped.from.name,
      to: skipped.to?.name ?? null,
      secondsSkipped: skipped.secondsSkipped,
    });
  },

  set_profile: (args = {}) => {
    const raw = argRawStr(args, 'name');
    if (raw === undefined) return fail('Tell me what you would like to be called.', 'missing_name');
    const name = raw.trim().slice(0, 60);
    state().setProfileName(name);
    return name
      ? ok(`I will call you **${name}** — it only appears in the greeting.`, { name })
      : ok('Cleared your name. The greeting will just say hello.', { name: '' });
  },

  set_reminder: (args = {}) => {
    const raw = argRawStr(args, 'time');
    if (raw === undefined) {
      return fail('Give me a time as HH:MM, or an empty string to turn the reminder off.', 'missing_time');
    }
    if (!raw.trim()) {
      state().setReminder('');
      return ok('Daily reminder off. Nothing will nudge you.', { time: '' });
    }
    const time = asClockTime(raw);
    if (!time) {
      return fail(`"${raw.trim()}" is not a time I can read. Use 24-hour HH:MM, e.g. 07:30 or 20:00.`, 'invalid_time');
    }
    state().setReminder(time);
    return ok(`Daily reminder set for **${time}**. One gentle prompt — never a guilt trip about a missed streak.`, {
      time,
    });
  },

  set_accessibility: (args = {}) => {
    const reduceMotion = argBool(args, 'reduceMotion');
    const muted = argBool(args, 'muted');
    if (reduceMotion === undefined && muted === undefined) {
      return fail(
        'Tell me which to change: reduceMotion (calm the animation) or muted (silence the ambience).',
        'no_change_requested',
      );
    }

    state().setAccessibility({
      ...(reduceMotion === undefined ? {} : { reduceMotion }),
      ...(muted === undefined ? {} : { muted }),
    });

    const said: string[] = [];
    if (reduceMotion !== undefined) {
      said.push(
        reduceMotion
          ? 'Motion reduced — the drifting background and the entrance animations are off'
          : 'Motion restored',
      );
    }
    if (muted !== undefined) {
      said.push(muted ? 'ambience muted' : 'ambience unmuted');
    }
    const after = state().settings;
    return ok(`${said.join(', ')}.`, {
      reduceMotion: after.reduceMotion,
      muted: state().muted,
      soundscape: after.soundscape,
    });
  },

  export_data: () => {
    const s = state();
    const json = s.exportJSON();
    const kb = Math.max(1, Math.round(json.length / 1024));
    return ok(
      `Here is everything the app holds about you — ${s.sessions.length} session${
        s.sessions.length === 1 ? '' : 's'
      }, ${s.moods.length} mood check-in${s.moods.length === 1 ? '' : 's'}, ${kb} KB of plain JSON. It has never left this device, and it is yours to keep or move.`,
      {
        json,
        bytes: json.length,
        sessions: s.sessions.length,
        moods: s.moods.length,
        filename: `yoganext-${new Date().toISOString().slice(0, 10)}.json`,
      },
    );
  },

  reset_data: (args = {}) => {
    if (argBool(args, 'confirm') !== true) {
      // The refusal carries the script, so an agent asking for confirmation says
      // what is actually lost rather than a vague "are you sure?".
      return fail(
        'I will not erase anything without an explicit confirmation. Tell the user plainly that this deletes every session, mood check-in, streak and milestone on this device and cannot be undone, offer export_data first, and call reset_data again with confirm: true only if they say yes.',
        'confirmation_required',
      );
    }
    const s = state();
    const lost = {
      sessions: s.sessions.length,
      moods: s.moods.length,
      streak: s.habit.streak,
      totalMinutes: Math.round(s.habit.totalMinutes),
    };
    s.dangerouslyResetAll();
    return ok(
      `Erased. ${lost.sessions} session${lost.sessions === 1 ? '' : 's'} and ${lost.moods} mood check-in${
        lost.moods === 1 ? '' : 's'
      } are gone and the streak is back to zero. Nothing was sent anywhere — it was only ever on this device.`,
      lost,
    );
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
