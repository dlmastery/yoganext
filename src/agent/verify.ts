/**
 * verify.ts — `npm run verify:agent`
 *
 * The agent-first claim, checked instead of asserted. Two questions, both of
 * which have to be yes:
 *
 *   1. **Coverage** — does every tool declared in `contract.ts` have code behind
 *      it, and is nothing implemented in secret? (`verifyToolCoverage`)
 *   2. **Parity** — can the GUI do anything the tool surface cannot?
 *      (`verifyUiParity`) This is the one that matters: coverage compares the
 *      contract to itself and stays green while ten UI capabilities have no tool
 *      at all, which is precisely how this app's parity gap went unnoticed.
 *
 * Exits non-zero on failure, so it can gate a commit or a build. Runs under
 * `node --experimental-strip-types`: no bundler, no DOM, and relative imports
 * carry an explicit `.ts` extension because Node's ESM resolver does not guess.
 */

// Importing for the side effect: tools.ts registers its implementation list with
// the manifest on load, which is what makes both checks work with no arguments.
import './tools.ts';
import { UI_CAPABILITIES, verifyAgentFirst } from './manifest.ts';

/**
 * `types: ["vite/client"]` in tsconfig means Node's globals are out of scope —
 * correct for a browser app, and not worth pulling @types/node in for one
 * script. Declaring the two streams we touch keeps this file typechecking under
 * the same config as everything else (see print-manifest.ts, same trick).
 */
declare const process: {
  stdout: { write(chunk: string): boolean };
  exitCode?: number;
};

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

const report = verifyAgentFirst();
const { coverage, parity } = report;

out(`ok: ${report.ok}`);
out();
out(`coverage  ${coverage.implementedCount}/${coverage.declaredCount} tools implemented`);
out(`          ${coverage.summary}`);
if (coverage.missing.length) out(`          MISSING: ${coverage.missing.join(', ')}`);
if (coverage.undeclared.length) out(`          UNDECLARED: ${coverage.undeclared.join(', ')}`);

out();
out(`parity    ${parity.capabilityCount}/${UI_CAPABILITIES.length} UI capabilities resolve to a tool`);
out(`          ${parity.coveredTools.length}/${coverage.declaredCount} tools are reachable from the GUI`);
out(`          ${parity.summary}`);
for (const row of parity.undeclared) out(`          UNDECLARED: ${row.id} -> ${row.tool}`);
for (const row of parity.unimplemented) out(`          UNIMPLEMENTED: ${row.id} -> ${row.tool}`);

out();
out(
  report.ok
    ? 'Everything you can tap, you can say.'
    : 'FAILED — the GUI and the tool surface have drifted apart.',
);

if (!report.ok) process.exitCode = 1;
