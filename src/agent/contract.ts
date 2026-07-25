/**
 * contract.ts — THE AGENT SURFACE. This is what makes the app *agent-first*.
 *
 * The thesis (per "How and why to build agent-first applications"): a conventional
 * app buries its capability inside click-paths, so an agent can only automate it by
 * pretending to be a mouse. An agent-first app inverts that — the capability lives
 * in a typed, documented tool surface, and the GUI is one *client* of it. The agent
 * is a first-class user, not a screen-scraper.
 *
 * Consequences enforced across this codebase:
 *   1. Every user-reachable behaviour has a tool here. No exceptions.
 *   2. Tools are pure w.r.t. the store: (state, args) -> (state', ToolResult).
 *   3. Tools never throw. Failure is a ToolResult with ok:false.
 *   4. Every tool carries a natural-language `description` and JSON-Schema-ish
 *      `input` so it can be dropped into any model's tool-calling API unmodified.
 *
 * `src/agent/tools.ts` implements these; `src/agent/manifest.ts` emits the JSON
 * manifest an external agent (Claude, MCP host, anything) consumes.
 */

export interface ToolParam {
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  /** allowed values, for enums */
  enum?: readonly string[];
  required?: boolean;
  items?: { type: 'string' | 'number' };
}

export interface ToolSpec {
  name: string;
  /** written FOR A MODEL: say when to use it and what changes. */
  description: string;
  input: Record<string, ToolParam>;
  /** if true the tool mutates state (agents should confirm with the user first) */
  mutates: boolean;
}

/**
 * The canonical tool list. Implementations in tools.ts MUST match these names
 * exactly — `verifyToolCoverage()` fails the build if they drift.
 */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'list_practices',
    description:
      'Browse the practice library. Use this first when the user asks "what should I do" or names a feeling. Returns practices with kind, length and intensity so you can match one to their state.',
    input: {
      kind: { type: 'string', description: 'filter by practice kind', enum: ['meditation', 'breathwork', 'yoga', 'sleep', 'journal'] },
      maxMinutes: { type: 'number', description: 'only practices at or under this length' },
      tag: { type: 'string', description: 'match a tag such as anxiety, focus, sleep, morning' },
    },
    mutates: false,
  },
  {
    name: 'recommend_practice',
    description:
      'Pick ONE practice for the user right now, given how they feel and how much time they have. Prefer this over list_practices when the user wants to be told what to do. Explains the reason for the pick.',
    input: {
      mood: { type: 'number', description: 'current mood 1 (worst) to 5 (best)' },
      minutesAvailable: { type: 'number', description: 'time they can give, in minutes' },
      intent: { type: 'string', description: 'what they want: calm, focus, sleep, energy, grief, pain' },
    },
    mutates: false,
  },
  {
    name: 'start_session',
    description:
      'Begin a practice. The UI immediately enters the immersive player. Only call after the user has agreed to a specific practice.',
    input: { practiceId: { type: 'string', description: 'id from list_practices', required: true } },
    mutates: true,
  },
  { name: 'pause_session', description: 'Pause the running practice.', input: {}, mutates: true },
  { name: 'resume_session', description: 'Resume a paused practice.', input: {}, mutates: true },
  {
    name: 'complete_session',
    description:
      'Finish the running practice and record it. Ask for mood afterwards if you have it; it powers the insight engine.',
    input: {
      moodAfter: { type: 'number', description: 'mood 1-5 after practising' },
      note: { type: 'string', description: 'optional reflection to store with the session' },
    },
    mutates: true,
  },
  {
    name: 'log_mood',
    description:
      'Record how the user feels right now, independent of a session. Use whenever they volunteer an emotional state.',
    input: {
      score: { type: 'number', description: 'mood 1 (worst) to 5 (best)', required: true },
      feelings: { type: 'array', description: 'short tags e.g. anxious, tired, grateful', items: { type: 'string' } },
      note: { type: 'string', description: 'optional free text' },
    },
    mutates: true,
  },
  {
    name: 'get_progress',
    description:
      'Read the habit state: streak, best streak, grace remaining, total minutes, goal, and recent sessions. Use before any encouragement so the praise is accurate rather than generic.',
    input: {},
    mutates: false,
  },
  {
    name: 'get_insights',
    description:
      'Derived, evidence-based observations from the user\'s own data (e.g. "breathwork lifts your mood +1.2 on average; yoga +0.4"). Never invent an insight — only report what this returns.',
    input: {},
    mutates: false,
  },
  {
    name: 'set_intention',
    description: 'Set the daily practice goal in minutes. Keep it achievable; small goals build habits.',
    input: { minutes: { type: 'number', description: 'daily goal, 3-60', required: true } },
    mutates: true,
  },
  {
    name: 'set_theme',
    description: 'Change the visual atmosphere of the app.',
    input: { theme: { type: 'string', description: 'palette', enum: ['aurora', 'dusk', 'forest', 'sand'], required: true } },
    mutates: true,
  },
  {
    name: 'set_soundscape',
    description: 'Change the ambient sound played during practice.',
    input: { soundscape: { type: 'string', description: 'ambience', enum: ['none', 'rain', 'ocean', 'forest', 'singing-bowl'], required: true } },
    mutates: true,
  },
  {
    name: 'create_breath_pattern',
    description:
      'Define a custom breathing pattern (e.g. 4-7-8, box breathing) and add it to the library. Phase lengths are seconds; use 0 to skip a phase.',
    input: {
      name: { type: 'string', description: 'display name', required: true },
      inhale: { type: 'number', description: 'seconds', required: true },
      holdIn: { type: 'number', description: 'seconds, 0 to skip' },
      exhale: { type: 'number', description: 'seconds', required: true },
      holdOut: { type: 'number', description: 'seconds, 0 to skip' },
      why: { type: 'string', description: 'one line on what it does physiologically' },
    },
    mutates: true,
  },
  {
    name: 'journal_entry',
    description: 'Store a written reflection. Returns the entry id.',
    input: { text: { type: 'string', description: 'the reflection', required: true } },
    mutates: true,
  },
] as const;

export type ToolName = (typeof TOOL_SPECS)[number]['name'];
