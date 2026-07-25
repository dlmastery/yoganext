/**
 * print-manifest.ts — `npm run agent:tools`
 *
 * Prints the tool surface as JSON on stdout so it can be piped straight into an
 * agent runtime:
 *
 *   npm run agent:tools > tools.json
 *   npm run agent:tools | jq '.anthropic'          # paste into a Messages call
 *   npm run agent:tools | jq '.openai'             # paste into a completions call
 *
 * Runs under `node --experimental-strip-types`, so: no bundler, no DOM, and
 * relative imports carry an explicit `.ts` extension (Node's ESM resolver does
 * not guess). Human-readable notes go to stderr, so stdout stays pure JSON.
 */

import { toolManifest, verifyToolCoverage } from './manifest.ts';

/**
 * The app's tsconfig pins `types: ["vite/client"]`, so Node's globals are not in
 * scope — correct for a browser app, and not worth pulling @types/node in for
 * one script. Declaring the two streams we touch keeps this file self-contained
 * and typechecking under the same config as everything else. Module-scoped, so
 * it shadows nothing if @types/node ever does arrive.
 */
declare const process: {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  exitCode?: number;
};

async function main(): Promise<void> {
  const manifest = toolManifest();

  // Coverage needs the implementations, which drag in the store (and therefore
  // React/zustand). That is fine in a normal app process but must never be able
  // to break the manifest itself — so it is a best-effort dynamic import.
  let coverage: ReturnType<typeof verifyToolCoverage> | null = null;
  try {
    const tools = await import('./tools.ts');
    coverage = verifyToolCoverage(tools.IMPLEMENTED_TOOL_NAMES);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    process.stderr.write(`note: skipped coverage check (could not load ./tools.ts outside the app: ${detail})\n`);
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);

  process.stderr.write(
    `\n${manifest.toolCount} tools (${manifest.mutatingToolCount} mutating) emitted in Anthropic and OpenAI formats.\n`,
  );
  if (coverage) {
    process.stderr.write(`${coverage.summary}\n`);
    if (!coverage.ok) process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`failed to emit tool manifest: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
