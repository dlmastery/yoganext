# The agent surface

yoganext is an **agent-first** application. The distinction is not that it has a
chatbot bolted on — it is where the capability lives.

A conventional app puts its capability inside click-paths. Opening a practice
means finding a card, scrolling a list, tapping a button; the only way an agent
can do that is to pretend to be a mouse — screen-scraping a DOM that was designed
for eyes, breaking on every redesign, unable to tell you what it just did.

Here the capability **is** the tool surface. `src/agent/contract.ts` declares
thirteen typed, documented tools; `src/agent/tools.ts` implements them against
the store; and the React UI is *one client of that surface*, with no privileged
path of its own. The rule that keeps it honest:

> Do not add a feature to a component that is not reachable as a tool.

An agent driving these thirteen tools reaches 100% of the product without
touching a pixel.

---

## The tools

| Tool | Mutates | What it does |
|---|---|---|
| `list_practices` | — | Browse the library, filtered by `kind`, `maxMinutes`, `tag`. |
| `recommend_practice` | — | Pick **one** practice for `mood` / `minutesAvailable` / `intent`, with the reasons it won. |
| `start_session` | yes | Begin `practiceId`. The UI enters the immersive player. |
| `pause_session` | yes | Pause the running practice. |
| `resume_session` | yes | Resume a paused practice. |
| `complete_session` | yes | Finish and record the session, optionally with `moodAfter` and a `note`. |
| `log_mood` | yes | Record a 1–5 `score` with optional `feelings[]` and `note`, independent of a session. |
| `get_progress` | — | Streak, best streak, grace days, total minutes, daily goal, recent sessions. |
| `get_insights` | — | Observations derived from the user's own data, each carrying its `n`. |
| `set_intention` | yes | Set the daily goal in minutes (clamped to 3–60). |
| `set_theme` | yes | `aurora` \| `dusk` \| `forest` \| `sand`. |
| `set_soundscape` | yes | `none` \| `rain` \| `ocean` \| `forest` \| `singing-bowl`. |
| `create_breath_pattern` | yes | Save a custom pattern (`inhale`/`holdIn`/`exhale`/`holdOut` in seconds). |
| `journal_entry` | yes | Store a written reflection; returns the entry id. |

Nine tools write, four read. The split matters to an agent: the read tools are
safe to call unprompted to *find out* something, and the write tools should be
confirmed with the user first. The manifest encodes this — since neither vendor's
tool schema permits custom top-level keys, the `mutates` flag is folded into the
description text, where the model will actually read it.

### Three guarantees every tool makes

1. **It never throws.** Failure is a value: `{ ok: false, message, error }`. The
   wrapping happens once, at the registry boundary in `tools.ts`, so no call path
   can bypass it — including for bugs nobody anticipated.
2. **It always returns a human-readable `message`.** Written to be shown verbatim,
   so an agent relays it instead of paraphrasing it. Paraphrase is where
   hallucination gets in.
3. **It is pure with respect to the store.** Read state, call an action, return a
   result. Tools hold no state of their own.

Arguments arrive from a language model, so they are treated as untrusted: every
value is coerced and clamped at the boundary. `"10 minutes"` becomes `10`,
a mood of `7` clamps to `5`, `"anxious, tired"` becomes `["anxious","tired"]`.

---

## Pointing an external agent at it

```bash
npm run agent:tools              # the whole manifest as JSON on stdout
npm run agent:tools > tools.json
npm run agent:tools | jq '.anthropic'   # Anthropic Messages format
npm run agent:tools | jq '.openai'      # OpenAI function-calling format
```

The manifest is deterministic — no timestamps, no ordering churn — so you can
commit `tools.json` and let a diff tell you when the public contract changed.

**Anthropic / Claude / MCP hosts.** Take `.anthropic` and pass it straight
through as `tools`:

```ts
import { toolManifest } from './src/agent/manifest.ts';
import { callTool } from './src/agent/tools';

const { anthropic } = toolManifest();

const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 1024,
  tools: anthropic,
  messages: [{ role: 'user', content: "I'm anxious and have ten minutes" }],
});

// then, for each tool_use block the model emits:
for (const block of res.content) {
  if (block.type === 'tool_use') {
    const result = callTool(block.name, block.input as Record<string, unknown>);
    // feed result.message back as a tool_result block
  }
}
```

**OpenAI-compatible runtimes.** Take `.openai` and pass it as `tools`; the shape
is `{ type: 'function', function: { name, description, parameters } }`, which is a
genuinely different envelope from Anthropic's `{ name, description, input_schema }`
— hence emitting both rather than one and a converter.

**Anything else.** `callTool(name, args)` is the single entry point. Unknown tool
names fail like any other tool error, never as an exception, so a misbehaving
model cannot crash the host.

### Keeping the two halves honest

```ts
import './src/agent/tools';                     // registers its implementations
import { verifyToolCoverage } from './src/agent/manifest.ts';

const report = verifyToolCoverage();
// { ok, missing, undeclared, declaredCount, implementedCount, summary }
```

It checks **both** directions. `missing` is a declared tool with no code behind
it — a promise the manifest makes and the app breaks. `undeclared` is code with
no declaration — capability the GUI can reach but every external agent is blind
to, which is precisely the failure this architecture exists to prevent.
`npm run agent:tools` runs the check and exits non-zero if the surface has
drifted.

---

## The on-device coach

`src/agent/local-agent.ts` is a coach that needs no network, no API key and no
backend. It is not a language model — it is a deterministic intent matcher, and
it is the proof of the architecture: because the capability is in the tool layer,
a few hundred lines of rules can drive the entire product. Swap in Claude and
nothing beneath that file changes; both go through `callTool`.

It reads four things out of an utterance — minutes available, an explicit 1–5
mood, an implied mood from feeling words, and an intent (`calm`, `focus`, `sleep`,
`energy`, `grief`, `pain`) — then runs an ordered rule list, first match wins.

One distinction is worth calling out. An **explicit number** is a fact about how
someone feels, so it gets logged: *"I feel 4 today"* → `log_mood`. A **feeling
word** implies something they want changed, so it gets acted on: *"I'm anxious"* →
`recommend_practice`.

And when nothing matches, it asks. It never guesses at an action. A confidently
wrong mutation costs the user real data, in an app people open when they are not
at their best — so `respond()` returns a clarifying question and `call: null`.
The console renders that absence explicitly rather than hiding it.

---

## A worked transcript

> **you** — I'm anxious and have 10 minutes

Read `mood ~2`, `10 min available`, `intent "calm"` from the message.

```
recommend_practice  reads                                    ✓
{ "mood": 2, "minutesAvailable": 10, "intent": "calm" }
→ "Because you are low and you have 10 minutes and you want calm, I would do
   Settling Breath — 8 min of breathwork, gentle. …
   Why this one: fits your 10 minutes (8 min); tagged anxiety, calm; gentle
   enough for a low day. Say 'start it' and I will begin."
```

> **you** — start it

Resolved *"it"* to the practice last recommended.

```
start_session  writes                                        ✓
{ "practiceId": "settling-breath" }
→ "Starting Settling Breath — 8 minutes of breathwork. The player is open;
   I will stay quiet until you finish."
```

> **you** — done, feeling 4

Asked to finish, with mood 4 attached.

```
complete_session  writes                                     ✓
{ "moodAfter": 4 }
→ "Logged Settling Breath — 8 min. That is 3 days in a row. You logged feeling
   good afterwards."
```

> **you** — what have you noticed about me?

```
get_insights  reads                                          ✓
{}
→ "- breathwork lifts your mood +1.2 on average (n=6), ahead of yoga +0.4.
   - 62% of your practice happens in the evening — that is where the habit is
     actually sticking."
```

> **you** — make it nicer

No rule matched with enough confidence to act.

```
no tool called
→ "I am not sure what you need yet — and I would rather ask than guess. Tell me
   one of: how you feel (1-5 or in words), how many minutes you have, or what
   you want to change."
```

Every one of those blocks is what the console actually renders: the tool name, a
`reads`/`writes` badge, the exact arguments, and the raw `ToolResult` one click
away. That is the point. The agent's actions are legible because they are real
calls against the same surface the UI uses — not a narration of them.
