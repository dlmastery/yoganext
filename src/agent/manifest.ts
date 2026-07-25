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
