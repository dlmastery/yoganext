/**
 * local-agent.ts — a coach that runs entirely on the device.
 *
 * This is NOT a language model. It is a deterministic intent matcher that turns
 * an utterance into a call against the same tool surface an external model would
 * use — no network, no API key, no telemetry. Two reasons it exists:
 *
 *   1. It proves the architecture. If the capability really lives in the tool
 *      layer rather than in click-paths, then a 400-line rule engine is enough to
 *      drive 100% of the product. Swap in Claude and nothing below this file
 *      changes: it calls `callTool` exactly the same way.
 *   2. It ships. The app has a working AI coach offline, on a plane, with no
 *      backend and no bill.
 *
 * Design rules:
 *   - Deterministic. The same utterance always produces the same call. This is
 *     testable in a way a model is not.
 *   - It talks to the app ONLY through `callTool`. It has no privileged access
 *     to the store — same door an external agent comes through.
 *   - It degrades gracefully. An unmatched utterance returns a clarifying
 *     question and calls nothing. A confident wrong action is worse than a
 *     question, especially in an app people open when they feel bad.
 */

import { callTool } from './tools.ts';
import type { ToolArgs } from './tools.ts';
import { TOOL_SPECS } from './contract.ts';
import type { ToolResult } from '../lib/types.ts';

// ───────────────────────────────────────────────────────────────── types ──

export interface AgentToolCall {
  name: string;
  args: ToolArgs;
  result: ToolResult<unknown>;
}

/** Small carried-forward memory. Enough to resolve "start it". */
export interface CoachContext {
  /** the practice the coach last put forward, so "yes, start it" has a referent */
  lastRecommendedPracticeId?: string;
  lastRecommendedTitle?: string;
}

export interface AgentReply {
  /** what the coach says. Safe to render verbatim. */
  text: string;
  /** the tool it actually ran, if any. Null for questions and small talk. */
  call: AgentToolCall | null;
  /** the rule that fired — shown in the console so the match is auditable */
  intent: string;
  /** why this rule fired, in one line */
  rationale: string;
  /** context to feed back into the next turn */
  context: CoachContext;
  /** follow-ups worth offering right now */
  suggestions: string[];
}

// ────────────────────────────────────────────────────────────── extractors ──

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Minutes available. Handles "10 min", "1 hour", "half an hour", "i have 20". */
export function extractMinutes(t: string): number | undefined {
  if (/\b(half an hour|half hour)\b/.test(t)) return 30;
  if (/\b(quarter of an hour|quarter hour)\b/.test(t)) return 15;
  if (/\ban hour\b|\bone hour\b/.test(t)) return 60;
  if (/\ba few minutes\b|\bcouple of minutes\b/.test(t)) return 5;

  const hours = t.match(/(\d{1,2})\s*(?:h\b|hrs?\b|hours?\b)/);
  if (hours) return Number(hours[1]) * 60;

  const mins = t.match(/(\d{1,3})\s*(?:m\b|mins?\b|minutes?\b)/);
  if (mins) return Number(mins[1]);

  // "i have 20", "got 15", "only 5 free"
  const bare = t.match(/\b(?:have|got|spare|free|only)\s+(?:about\s+|maybe\s+)?(\d{1,3})\b/);
  if (bare) return Number(bare[1]);

  return undefined;
}

/** An explicitly stated 1-5 score: "i feel 4", "mood is 2", "3/5". */
export function extractExplicitMood(t: string): number | undefined {
  const slash = t.match(/\b([1-5])\s*\/\s*5\b/);
  if (slash) return Number(slash[1]);
  const near = t.match(
    /\b(?:feel(?:ing)?|mood(?:\s+(?:is|of|at))?|rate(?:\s+it)?|i'm(?:\s+a)?|at\s+a)\s+(?:like\s+)?([1-5])\b(?!\s*(?:m\b|min|hour))/,
  );
  return near ? Number(near[1]) : undefined;
}

/**
 * Emotion words -> an implied 1-5 mood. Coarse on purpose: the app's own mood
 * scale is coarse, and pretending to read fine gradations from a sentence would
 * be false precision.
 */
const MOOD_HINTS: Array<[RegExp, number]> = [
  [/\b(terrible|awful|horrible|dreadful|worst|rock bottom|falling apart|can't cope|cannot cope)\b/, 1],
  [/\b(anxious|anxiety|panic|panicking|stressed|stress|overwhelmed|dread|scared|afraid|tense|wound up)\b/, 2],
  [/\b(sad|down|low|blue|grief|grieving|lonely|heartbroken|miserable|depressed)\b/, 2],
  [/\b(exhausted|drained|burnt out|burned out|knackered|shattered)\b/, 2],
  [/\b(tired|sluggish|flat|foggy|restless|unsettled|meh)\b/, 3],
  [/\b(ok|okay|fine|alright|so-so|average|neutral)\b/, 3],
  [/\b(good|content|calm|settled|steady|better|grateful)\b/, 4],
  [/\b(great|amazing|wonderful|brilliant|energised|energized|fantastic|joyful|buzzing)\b/, 5],
];

export function extractImpliedMood(t: string): number | undefined {
  for (const [re, score] of MOOD_HINTS) if (re.test(t)) return score;
  return undefined;
}

/** The feeling words themselves, for log_mood's tag list. */
const FEELING_WORDS = [
  'anxious', 'stressed', 'overwhelmed', 'panicky', 'tense', 'restless', 'scared',
  'sad', 'low', 'lonely', 'grieving', 'heartbroken', 'angry', 'frustrated',
  'tired', 'exhausted', 'drained', 'foggy', 'flat', 'sluggish',
  'calm', 'settled', 'grateful', 'content', 'hopeful', 'energised', 'energized', 'joyful',
  'sore', 'achy', 'tight', 'stiff',
];

export function extractFeelings(t: string): string[] {
  return FEELING_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(t));
}

/** Loose language -> a canonical intent the recommender understands. */
export function extractIntent(t: string): string | undefined {
  if (/\b(sleep|insomnia|can't sleep|cannot sleep|bed|awake at night|wind down)\b/.test(t)) return 'sleep';
  if (/\b(anxious|anxiety|panic|stress|stressed|overwhelmed|calm|settle|ground|relax|unwind|tense)\b/.test(t)) return 'calm';
  if (/\b(focus|concentrate|distracted|scattered|clarity|sharp|work)\b/.test(t)) return 'focus';
  if (/\b(energy|energise|energize|wake up|tired|sluggish|flat|lethargic|morning)\b/.test(t)) return 'energy';
  if (/\b(grief|grieving|loss|bereave|heartbroken|lonely|compassion)\b/.test(t)) return 'grief';
  if (/\b(pain|ache|achy|sore|back|neck|shoulders|tight|stiff|tension)\b/.test(t)) return 'pain';
  return undefined;
}

const THEME_WORDS = ['aurora', 'dusk', 'forest', 'sand'] as const;
const SOUND_WORDS = ['none', 'rain', 'ocean', 'forest', 'singing-bowl'] as const;
const KIND_WORDS = ['meditation', 'breathwork', 'yoga', 'sleep', 'journal'] as const;

// ─────────────────────────────────────────────────── practice name lookup ──

/**
 * Resolve "start the body scan" to an id — through `list_practices`, not through
 * the store. The coach is a tool client like any other; giving it a back door to
 * state would quietly undo the point of the architecture.
 */
function resolvePracticeByName(t: string): { id: string; title: string } | undefined {
  const res = callTool('list_practices');
  if (!res.ok) return undefined;
  const rows = (res.data as { practices?: Array<{ id: string; title: string }> } | undefined)?.practices ?? [];

  let best: { id: string; title: string; score: number } | undefined;
  for (const p of rows) {
    const title = p.title.toLowerCase();
    let score = 0;
    if (t.includes(title)) score = 100 + title.length;
    else {
      const words = title.split(/\s+/).filter((w) => w.length > 3);
      const hits = words.filter((w) => t.includes(w)).length;
      if (hits) score = (hits / Math.max(1, words.length)) * 50 + hits;
    }
    if (t.includes(p.id.toLowerCase())) score = 200;
    if (score > 0 && (!best || score > best.score)) best = { id: p.id, title: p.title, score };
  }
  return best && best.score >= 10 ? { id: best.id, title: best.title } : undefined;
}

// ──────────────────────────────────────────────────────────── the matcher ──

const AFFIRMATIVE = /^(yes|yep|yeah|sure|ok|okay|go on|please do|do it|sounds good|let's do it|lets do it)\b/;

const DEFAULT_SUGGESTIONS = [
  "I'm anxious and have 10 minutes",
  'How am I doing?',
  'What have you noticed about me?',
  'Show me everything under 15 minutes',
];

/** Prompts to show as chips in the console. Chosen to demo distinct tools. */
export const SUGGESTED_PROMPTS: readonly string[] = [
  "I'm anxious and have 10 minutes",
  'How am I doing?',
  'What have you noticed about me?',
  'I feel 4 today',
  'Set my daily goal to 12 minutes',
  'Make a 4-7-8 breathing pattern',
  'Switch the theme to dusk',
  'Play rain while I practise',
];

function reply(
  intent: string,
  rationale: string,
  text: string,
  call: AgentToolCall | null,
  context: CoachContext,
  suggestions: string[] = DEFAULT_SUGGESTIONS,
): AgentReply {
  return { intent, rationale, text, call, context, suggestions };
}

function run(name: string, args: ToolArgs): AgentToolCall {
  return { name, args, result: callTool(name, args) };
}

/**
 * The whole coach. Rules are ordered and the first match wins; the ordering is
 * the design, so read it top to bottom. Anything that falls through asks a
 * question rather than guessing.
 */
export function respond(utterance: string, ctxIn: CoachContext = {}): AgentReply {
  const raw = utterance ?? '';
  const t = norm(raw);
  const ctx: CoachContext = { ...ctxIn };

  if (!t) {
    return reply(
      'empty',
      'nothing to interpret',
      'I did not catch that. Tell me how you feel, how long you have, or ask what I can do.',
      null,
      ctx,
    );
  }

  const minutes = extractMinutes(t);
  const explicitMood = extractExplicitMood(t);
  const impliedMood = extractImpliedMood(t);
  const intent = extractIntent(t);

  // ── capability question ────────────────────────────────────────────────
  if (/\b(what can you do|help|capabilities|what are your tools|how does this work)\b/.test(t)) {
    const lines = TOOL_SPECS.map((s) => `- \`${s.name}\`${s.mutates ? ' (changes things)' : ''} — ${s.description.split('.')[0]}.`);
    return reply(
      'help',
      'asked what the coach can do',
      `Everything in this app is a tool I can call directly — ${TOOL_SPECS.length} of them:\n\n${lines.join('\n')}\n\nAsk in plain language; I will show you exactly which one I used.`,
      null,
      ctx,
    );
  }

  // ── progress / insight (read-only, so safe to run unprompted) ──────────
  if (/\b(how am i doing|my progress|my streak|streak|how many (days|minutes|sessions)|stats|total minutes)\b/.test(t)) {
    const call = run('get_progress', {});
    return reply('progress', 'asked about streak/progress', call.result.message, call, ctx);
  }

  // "pattern" alone is NOT an insight cue — "make a 4-7-8 breathing pattern"
  // would be swallowed by this rule, which sits above the breathwork one.
  if (/\b(insight|insights|what works|what have you noticed|noticed about me|my patterns?|any patterns?|trend|what helps me)\b/.test(t)) {
    const call = run('get_insights', {});
    return reply('insights', 'asked what the data shows', call.result.message, call, ctx);
  }

  // ── transport controls ─────────────────────────────────────────────────
  if (/\b(pause|hold on|wait a (sec|minute)|stop for a moment|freeze)\b/.test(t)) {
    const call = run('pause_session', {});
    return reply('pause', 'asked to pause', call.result.message, call, ctx);
  }

  if (/\b(resume|unpause|continue|carry on|keep going|i'm back|im back)\b/.test(t)) {
    const call = run('resume_session', {});
    return reply('resume', 'asked to resume', call.result.message, call, ctx);
  }

  if (/\b(done|finished|finish|complete|that's it|thats it|end (the )?session|i'm out|stop now)\b/.test(t)) {
    const args: ToolArgs = {};
    const after = explicitMood ?? impliedMood;
    if (after) args.moodAfter = after;
    const noteMatch = raw.match(/(?:note|felt|feeling)\s*[:,-]?\s*(.{4,})$/i);
    if (noteMatch) args.note = noteMatch[1].trim();
    const call = run('complete_session', args);
    return reply(
      'complete',
      after ? `asked to finish, with mood ${after} attached` : 'asked to finish the session',
      call.result.message,
      call,
      ctx,
    );
  }

  // ── ambience ───────────────────────────────────────────────────────────
  // Sits ABOVE `start` deliberately: "play rain while I practise" shares the
  // verb "play" with starting a session, and the more specific rule must win.
  // The guard keeps "play the ocean meditation" going to `start` instead.
  if (/\b(sound|soundscape|ambien|audio|noise|music|silence|rain|ocean|bowl|waves)\b/.test(t)) {
    const sound =
      /\b(silence|silent|no (sound|music|audio)|turn (it )?off|none)\b/.test(t)
        ? 'none'
        : /\b(bowl|bowls|singing)\b/.test(t)
          ? 'singing-bowl'
          : /\b(ocean|waves|sea)\b/.test(t)
            ? 'ocean'
            : SOUND_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (sound && !resolvePracticeByName(t)) {
      const call = run('set_soundscape', { soundscape: sound });
      return reply('soundscape', `matched soundscape "${sound}"`, call.result.message, call, ctx);
    }
  }

  // ── start ──────────────────────────────────────────────────────────────
  if (/\b(start|begin|play|let's go|lets go|take me through|run it)\b/.test(t) || AFFIRMATIVE.test(t)) {
    const named = resolvePracticeByName(t);
    const id = named?.id ?? ctx.lastRecommendedPracticeId;
    if (!id) {
      return reply(
        'start_unresolved',
        'wanted to start something, but no practice has been named or recommended yet',
        'Happy to start — which practice? Tell me how you feel and how long you have and I will pick one, or say "show me the library".',
        null,
        ctx,
        ['I have 10 minutes and feel anxious', 'Show me the library', 'What should I do?'],
      );
    }
    const call = run('start_session', { practiceId: id });
    return reply(
      'start',
      named ? `matched "${named.title}" by name` : `resolved "it" to the practice I last recommended`,
      call.result.message,
      call,
      ctx,
      ['Pause', "I'm done", 'How am I doing?'],
    );
  }

  // ── settings ───────────────────────────────────────────────────────────
  const theme = THEME_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (theme && /\b(theme|colou?r|palette|look|mood board|make it|switch to|change to)\b/.test(t)) {
    const call = run('set_theme', { theme });
    return reply('theme', `matched theme "${theme}"`, call.result.message, call, ctx);
  }

  if (/\b(goal|intention|target|aim)\b/.test(t) && typeof minutes === 'number') {
    const call = run('set_intention', { minutes });
    return reply('intention', `matched a daily goal of ${minutes} minutes`, call.result.message, call, ctx);
  }

  // ── breath pattern ─────────────────────────────────────────────────────
  if (/\b(breath|breathing)\b/.test(t) && /\b(make|create|add|new|save|set up|custom)\b|(\d+\s*[-:]\s*\d+)/.test(t)) {
    const box = /\bbox breath|box breathing|square breath/.test(t);
    const nums = t.match(/(\d{1,2})\s*[-–:]\s*(\d{1,2})\s*[-–:]\s*(\d{1,2})(?:\s*[-–:]\s*(\d{1,2}))?/);
    let args: ToolArgs | undefined;
    if (box) {
      args = { name: 'Box breathing', inhale: 4, holdIn: 4, exhale: 4, holdOut: 4, why: 'Equal phases steady the heart rate and quiet a racing mind.' };
    } else if (nums) {
      // "4-7-8" is inhale-hold-exhale; a fourth number adds the hold-out.
      args = {
        name: `${nums.slice(1).filter(Boolean).join('-')} breathing`,
        inhale: Number(nums[1]),
        holdIn: Number(nums[2]),
        exhale: Number(nums[3]),
        holdOut: nums[4] ? Number(nums[4]) : 0,
        why: 'A long exhale relative to the inhale shifts you toward the parasympathetic side.',
      };
    }
    if (args) {
      const call = run('create_breath_pattern', args);
      return reply('breath_pattern', box ? 'recognised box breathing' : 'parsed the phase lengths from the message', call.result.message, call, ctx);
    }
    return reply(
      'breath_unresolved',
      'wanted a breath pattern but no phase lengths were given',
      'I can save that — what are the phase lengths in seconds? For example "4-7-8" (inhale 4, hold 7, exhale 8) or "box breathing".',
      null,
      ctx,
      ['Make a 4-7-8 breathing pattern', 'Set up box breathing'],
    );
  }

  // ── journal ────────────────────────────────────────────────────────────
  const journalMatch = raw.match(/\b(?:journal|write down|note down|make a note|reflect(?:ion)?)\b[:,]?\s*(.*)$/i);
  if (journalMatch) {
    const text = journalMatch[1].trim().replace(/^(that|this|about)\s+/i, '');
    if (text.length >= 3) {
      const call = run('journal_entry', { text });
      return reply('journal', 'matched a journalling request with text to store', call.result.message, call, ctx);
    }
    return reply(
      'journal_empty',
      'asked to journal but gave no text',
      'Sure — what would you like me to write down?',
      null,
      ctx,
      ['Journal: today felt lighter than yesterday'],
    );
  }

  // ── mood logging vs recommendation ─────────────────────────────────────
  // An explicit number is a fact about how they feel: log it.
  // A feeling word implies something they want changed: recommend for it.
  if (typeof explicitMood === 'number') {
    const args: ToolArgs = { score: explicitMood };
    const feelings = extractFeelings(t);
    if (feelings.length) args.feelings = feelings;
    const call = run('log_mood', args);
    return reply('log_mood', `read an explicit mood of ${explicitMood}/5`, call.result.message, call, ctx, [
      'What should I do?',
      'What have you noticed about me?',
    ]);
  }

  if (/\b(log|record|track)\b.*\bmood\b|\bmood\b.*\b(log|record|track)\b/.test(t)) {
    return reply(
      'log_mood_unresolved',
      'asked to log a mood without a score',
      'I can log that — where are you on 1 to 5, where 1 is a hard day and 5 is a bright one?',
      null,
      ctx,
      ['I feel 2 today', 'I feel 4 today'],
    );
  }

  // ── browse the library ─────────────────────────────────────────────────
  if (/\b(list|library|show me|browse|what (do you have|have you got|is there)|options|everything|catalog(ue)?)\b/.test(t)) {
    const args: ToolArgs = {};
    const kind = KIND_WORDS.find((k) => new RegExp(`\\b${k}\\b`).test(t));
    if (kind) args.kind = kind;
    if (typeof minutes === 'number' && /\b(under|less than|below|at most|max|shorter than|within)\b/.test(t)) {
      args.maxMinutes = minutes;
    }
    if (intent) args.tag = intent;
    const call = run('list_practices', args);
    return reply(
      'list',
      Object.keys(args).length ? `browsing with filters ${JSON.stringify(args)}` : 'browsing the whole library',
      call.result.message,
      call,
      ctx,
      ['Start the first one', 'What should I do?'],
    );
  }

  // ── recommendation: the catch-all for "here is my state, help" ─────────
  const asking = /\b(what should i|recommend|suggest|need something|give me something|help me|pick|choose|any ideas|what would you)\b/.test(t);
  if (asking || intent || typeof impliedMood === 'number' || typeof minutes === 'number') {
    const args: ToolArgs = {};
    if (typeof impliedMood === 'number') args.mood = impliedMood;
    if (typeof minutes === 'number') args.minutesAvailable = minutes;
    if (intent) args.intent = intent;

    const call = run('recommend_practice', args);
    const picked = (call.result.data as { practice?: { id: string; title: string } } | undefined)?.practice;
    if (picked) {
      ctx.lastRecommendedPracticeId = picked.id;
      ctx.lastRecommendedTitle = picked.title;
    }
    const read = [
      typeof impliedMood === 'number' ? `mood ~${impliedMood}` : null,
      typeof minutes === 'number' ? `${minutes} min available` : null,
      intent ? `intent "${intent}"` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return reply(
      'recommend',
      read ? `read ${read} from the message` : 'asked for a recommendation with no constraints given',
      call.result.message,
      call,
      ctx,
      ['Start it', 'Something shorter', 'Show me the library'],
    );
  }

  // ── graceful failure ───────────────────────────────────────────────────
  // No rule fired. Ask rather than act: a wrong mutation costs the user real
  // data, and this is an app people open when they are not at their best.
  return reply(
    'clarify',
    'no intent matched with enough confidence to act',
    'I am not sure what you need yet — and I would rather ask than guess. Tell me one of: how you feel (1-5 or in words), how many minutes you have, or what you want to change. You can also say "what can you do".',
    null,
    ctx,
    DEFAULT_SUGGESTIONS,
  );
}
