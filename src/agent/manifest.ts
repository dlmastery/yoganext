/**
 * manifest.ts — the tool surface, rendered for external agents.
 *
 * The point of an agent-first app is that a *foreign* agent — Claude, an MCP
 * host, an OpenAI-compatible runtime, something not written yet — can drive the
 * whole product without knowing anything about React. That only works if the
 * tool list is emitted in the exact wire format each runtime expects. So this
 * file translates the one canonical source (`TOOL_SPECS`) into both of the
 * schemas in common use. They are genuinely different shapes, not aliases:
 *
 *   Anthropic : { name, description, input_schema }
 *   OpenAI    : { type:'function', function:{ name, description, parameters } }
 *
 * Deliberately dependency-free apart from `contract.ts`: this module must stay
 * importable in a bare Node process (see print-manifest.ts), so it must never
 * reach into the store, React, or the DOM. `.ts` specifiers are required because
 * Node's ESM resolver does not guess extensions.
 */

import { TOOL_SPECS } from './contract.ts';
import type { ToolParam, ToolSpec } from './contract.ts';

// ─────────────────────────────────────────────────────────── wire schemas ──

/** A JSON-Schema object, restricted to what both vendors accept. */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  enum?: string[];
  items?: { type: 'string' | 'number' };
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

/** Anthropic Messages API tool-use shape. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

/** OpenAI chat-completions function-calling shape. */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

/** A vendor-neutral row, for docs and for the in-app console. */
export interface ToolIndexRow {
  name: string;
  mutates: boolean;
  description: string;
  params: string[];
  required: string[];
}

export interface ToolManifest {
  /** bumped by hand when the *shape* of this manifest changes */
  manifestVersion: string;
  app: string;
  toolCount: number;
  /** how many tools change state — an agent should confirm these with the user */
  mutatingToolCount: number;
  anthropic: AnthropicTool[];
  openai: OpenAITool[];
  index: ToolIndexRow[];
}

// ───────────────────────────────────────────────────────────── translation ──

const MANIFEST_VERSION = '1.0.0';

function toProperty(p: ToolParam): JsonSchemaProperty {
  const out: JsonSchemaProperty = { type: p.type, description: p.description };
  // spread the readonly enum into a mutable array so the result is plain JSON
  if (p.enum) out.enum = [...p.enum];
  // JSON Schema requires `items` on arrays; contract.ts allows it to be implicit
  if (p.type === 'array') out.items = p.items ? { ...p.items } : { type: 'string' };
  return out;
}

function toSchema(spec: ToolSpec): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const [key, param] of Object.entries(spec.input)) {
    properties[key] = toProperty(param);
    if (param.required) required.push(key);
  }
  return { type: 'object', properties, required };
}

/**
 * Neither vendor permits unknown top-level keys on a tool definition, so the
 * `mutates` flag — which an agent genuinely needs, because it is the difference
 * between reading state and changing the user's data — is folded into the
 * description where the model will actually read it.
 */
function describe(spec: ToolSpec): string {
  return spec.mutates
    ? `${spec.description} MUTATES STATE — confirm with the user before calling.`
    : `${spec.description} Read-only; safe to call without asking.`;
}

export function toAnthropicTool(spec: ToolSpec): AnthropicTool {
  return { name: spec.name, description: describe(spec), input_schema: toSchema(spec) };
}

export function toOpenAITool(spec: ToolSpec): OpenAITool {
  return {
    type: 'function',
    function: { name: spec.name, description: describe(spec), parameters: toSchema(spec) },
  };
}

/**
 * The whole surface, in both dialects. Deterministic — no timestamps, no
 * randomness — so the output can be committed and diffed to catch accidental
 * changes to the public contract.
 */
export function toolManifest(): ToolManifest {
  const specs = [...TOOL_SPECS].sort((a, b) => a.name.localeCompare(b.name));
  return {
    manifestVersion: MANIFEST_VERSION,
    app: 'yoganext',
    toolCount: specs.length,
    mutatingToolCount: specs.filter((s) => s.mutates).length,
    anthropic: specs.map(toAnthropicTool),
    openai: specs.map(toOpenAITool),
    index: specs.map((s) => ({
      name: s.name,
      mutates: s.mutates,
      description: s.description,
      params: Object.keys(s.input),
      required: Object.entries(s.input)
        .filter(([, p]) => p.required)
        .map(([k]) => k),
    })),
  };
}

// ────────────────────────────────────────────────────────────── coverage ──

export interface CoverageReport {
  ok: boolean;
  /** declared in TOOL_SPECS but with no function behind it — a broken promise */
  missing: string[];
  /** implemented but undeclared — invisible to every external agent */
  undeclared: string[];
  declaredCount: number;
  implementedCount: number;
  summary: string;
}

/**
 * The implementation list, registered by `tools.ts` when it loads. Kept as a
 * registration hook rather than a static import so this module stays free of
 * the store dependency chain (React/zustand/DOM).
 */
let registered: readonly string[] | null = null;

// ─────────────────────────────────────────────────────────────── UI parity ──

export interface UiCapability {
  /** stable id, used in the failure output */
  id: string;
  /** where it lives, so a reviewer can go and check the claim */
  surface: string;
  /** what the user actually does */
  label: string;
  /** the tool that provides it */
  tool: string;
}

/**
 * Every capability the GUI exposes, and the tool behind it.
 *
 * This list is the honest half of the agent-first claim. `verifyToolCoverage`
 * compares the contract to itself, so it stays green while the GUI quietly grows
 * a button no tool can press — which is exactly how a parity gap goes unnoticed.
 * This inventory is what makes that failure visible.
 *
 * It is hand-maintained BY DESIGN. Deriving it from the source would only prove
 * that whatever the UI happens to do is what it should do; a human writing down
 * "the user can do X here" is the actual check. Add a row whenever you add a
 * control, and `npm run verify:agent` will tell you if it has no tool.
 *
 * Two kinds of row, verified differently — do not conflate them:
 *
 *   WRITE rows (every mutating tool below) are backed by a literal `callTool(...)`
 *   call site in the named file. These are checked: App.tsx -> navigate,
 *   resume_session; Practice.tsx -> filter_library, start_session; Today.tsx ->
 *   start_session, log_mood; SessionPlayer.tsx -> pause/resume/complete/extend +
 *   set_accessibility; You.tsx -> the six settings tools, export_data, reset_data.
 *
 *   READ rows (`practice.browse`, `progress.read`, `progress.insights`) are NOT
 *   call sites. Those screens render straight from the store and `lib/insights.ts`,
 *   which is the right thing for a React view to do — subscribing to state is
 *   cheaper and more reactive than calling a tool for data. They are listed
 *   because the parity question is "can the GUI surface something the agent
 *   cannot reach", and the answer must be no for reads as well as writes: the
 *   named tool is the agent's route to the same information.
 *
 * One row is currently ASPIRATIONAL and is called out honestly rather than
 * quietly counted: `player.pose-hold` names PoseSequencer.tsx, which as written
 * contains no `callTool` at all. The row is kept because the control exists in
 * the UI; it is the wiring that is missing. See the note on that row.
 */
export const UI_CAPABILITIES: readonly UiCapability[] = [
  { id: 'shell.tabs', surface: 'App.tsx', label: 'Switch screen from the tab bar', tool: 'navigate' },
  { id: 'shell.resume-parked', surface: 'App.tsx', label: 'Tap the "Session paused — resume" pill', tool: 'resume_session' },
  { id: 'today.start-suggestion', surface: 'screens/Today.tsx', label: "Start today's suggested practice", tool: 'start_session' },
  { id: 'today.mood-checkin', surface: 'screens/Today.tsx', label: 'Tap a 1-5 mood check-in', tool: 'log_mood' },
  { id: 'practice.browse', surface: 'screens/Practice.tsx', label: 'Read the practice grid', tool: 'list_practices' },
  { id: 'practice.filter', surface: 'screens/Practice.tsx', label: 'Filter the library by kind and length', tool: 'filter_library' },
  { id: 'practice.filter-clear', surface: 'screens/Practice.tsx', label: 'Clear the library filters', tool: 'filter_library' },
  { id: 'practice.start', surface: 'screens/Practice.tsx', label: 'Start a practice from its card', tool: 'start_session' },
  { id: 'progress.read', surface: 'screens/Progress.tsx', label: 'Read the streak, totals and calendar', tool: 'get_progress' },
  { id: 'progress.insights', surface: 'screens/Progress.tsx', label: 'Read the observations panel', tool: 'get_insights' },
  { id: 'player.pause', surface: 'components/player/SessionPlayer.tsx', label: 'Pause the running practice', tool: 'pause_session' },
  { id: 'player.resume', surface: 'components/player/SessionPlayer.tsx', label: 'Resume the running practice', tool: 'resume_session' },
  { id: 'player.leave', surface: 'components/player/SessionPlayer.tsx', label: 'Leave the player (X or Escape) — the session parks, paused', tool: 'pause_session' },
  { id: 'player.complete', surface: 'components/player/SessionPlayer.tsx', label: 'Finish and check in with a mood', tool: 'complete_session' },
  { id: 'player.extend', surface: 'components/player/SessionPlayer.tsx', label: 'Add a minute to the practice', tool: 'extend_session' },
  { id: 'player.mute', surface: 'components/player/SessionPlayer.tsx', label: 'Mute the ambience from the player', tool: 'set_accessibility' },
  // ASPIRATIONAL: PoseSequencer.tsx has no callTool site yet, so this control is
  // not actually wired to extend_session. Listed so the gap stays visible.
  { id: 'player.pose-hold', surface: 'components/player/PoseSequencer.tsx', label: 'Hold the current pose longer', tool: 'extend_session' },
  { id: 'you.theme', surface: 'screens/You.tsx', label: 'Change the palette', tool: 'set_theme' },
  { id: 'you.soundscape', surface: 'screens/You.tsx', label: 'Change the ambient sound', tool: 'set_soundscape' },
  { id: 'you.intention', surface: 'screens/You.tsx', label: 'Set the daily minute goal', tool: 'set_intention' },
  { id: 'you.profile', surface: 'screens/You.tsx', label: 'Set the name used in the greeting', tool: 'set_profile' },
  { id: 'you.reminder', surface: 'screens/You.tsx', label: 'Set or clear the daily reminder', tool: 'set_reminder' },
  { id: 'you.accessibility', surface: 'screens/You.tsx', label: 'Reduce motion / mute for comfort', tool: 'set_accessibility' },
  { id: 'you.export', surface: 'screens/You.tsx', label: 'Export all data as JSON', tool: 'export_data' },
  { id: 'you.reset', surface: 'screens/You.tsx', label: 'Erase everything on this device', tool: 'reset_data' },
] as const;

export interface ParityReport {
  ok: boolean;
  /** capabilities that resolve to a declared AND implemented tool */
  capabilityCount: number;
  /** distinct tools the GUI can actually reach */
  coveredTools: string[];
  /** GUI capability pointing at a tool that is not in TOOL_SPECS */
  undeclared: UiCapability[];
  /** GUI capability whose tool is declared but has no implementation */
  unimplemented: UiCapability[];
  /** declared tools no GUI control reaches — agent-only, which is allowed */
  agentOnly: string[];
  summary: string;
}

/**
 * Checks the direction that actually matters: can the GUI do anything the tool
 * surface cannot? A capability whose tool is missing or unimplemented is a hole
 * in the claim, and fails.
 *
 * The reverse — a tool with no GUI control — is fine and is reported as
 * `agentOnly` rather than an error. The agent is allowed to be more capable than
 * the screens; it is the screens being more capable that breaks the thesis.
 */
export function verifyUiParity(implemented?: readonly string[]): ParityReport {
  const names = implemented ?? registered ?? [];
  const impl = new Set(names);
  const declared = new Set(TOOL_SPECS.map((t) => t.name));

  const undeclared = UI_CAPABILITIES.filter((c) => !declared.has(c.tool));
  const unimplemented = UI_CAPABILITIES.filter((c) => declared.has(c.tool) && !impl.has(c.tool));
  const reachable = UI_CAPABILITIES.filter((c) => declared.has(c.tool) && impl.has(c.tool));

  const coveredTools = [...new Set(reachable.map((c) => c.tool))].sort();
  const agentOnly = [...declared].filter((n) => !coveredTools.includes(n)).sort();
  const ok = undeclared.length === 0 && unimplemented.length === 0;

  const parts: string[] = [];
  if (undeclared.length) parts.push(`${undeclared.length} GUI control(s) point at a tool that does not exist`);
  if (unimplemented.length) parts.push(`${unimplemented.length} GUI control(s) point at an unimplemented tool`);

  return {
    ok,
    capabilityCount: reachable.length,
    coveredTools,
    undeclared,
    unimplemented,
    agentOnly,
    summary: ok
      ? `Every one of the ${UI_CAPABILITIES.length} GUI capabilities resolves to a working tool; ${agentOnly.length} further tool(s) are agent-only.`
      : `GUI has capability the tool surface lacks — ${parts.join('; ')}.`,
  };
}

export interface AgentFirstReport {
  ok: boolean;
  coverage: CoverageReport;
  parity: ParityReport;
}

/** Both halves of the claim, for `npm run verify:agent`. */
export function verifyAgentFirst(implemented?: readonly string[]): AgentFirstReport {
  const coverage = verifyToolCoverage(implemented);
  const parity = verifyUiParity(implemented);
  return { ok: coverage.ok && parity.ok, coverage, parity };
}

export function registerImplementedTools(names: readonly string[]): void {
  registered = [...names];
}

/**
 * Asserts the two halves of the contract agree: every declared tool has code,
 * and every piece of code is declared. Both directions matter — an undeclared
 * tool is capability the GUI can reach but an agent cannot, which is exactly the
 * failure mode this architecture exists to prevent.
 *
 * Pass the names explicitly, or import `./tools` first and call it bare.
 */
export function verifyToolCoverage(implemented?: readonly string[]): CoverageReport {
  const names = implemented ?? registered;
  const declared = TOOL_SPECS.map((t) => t.name);

  if (!names) {
    return {
      ok: false,
      missing: [...declared],
      undeclared: [],
      declaredCount: declared.length,
      implementedCount: 0,
      summary:
        'No implementations registered. Import "./tools" (which registers itself) before calling verifyToolCoverage(), or pass the names explicitly.',
    };
  }

  const impl = new Set(names);
  const spec = new Set(declared);
  const missing = declared.filter((n) => !impl.has(n)).sort();
  const undeclared = [...names].filter((n) => !spec.has(n)).sort();
  const isOk = missing.length === 0 && undeclared.length === 0;

  const parts: string[] = [];
  if (missing.length) parts.push(`declared but not implemented: ${missing.join(', ')}`);
  if (undeclared.length) parts.push(`implemented but not declared: ${undeclared.join(', ')}`);

  return {
    ok: isOk,
    missing,
    undeclared,
    declaredCount: declared.length,
    implementedCount: impl.size,
    summary: isOk
      ? `All ${declared.length} tools declared in TOOL_SPECS have implementations, and nothing is implemented in secret.`
      : `Tool surface has drifted — ${parts.join('; ')}.`,
  };
}
