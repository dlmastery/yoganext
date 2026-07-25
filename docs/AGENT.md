# The agent surface

yoganext is an **agent-first** application. The distinction is not that it has a
chatbot bolted on — it is where the capability lives.

A conventional app puts its capability inside click-paths. Opening a practice
means finding a card, scrolling a list, tapping a button; the only way an agent
can do that is to pretend to be a mouse — screen-scraping a DOM that was designed
for eyes, breaking on every redesign, unable to tell you what it just did.

Here the capability **is** the tool surface. `src/agent/contract.ts` declares
twenty-four typed, documented tools; `src/agent/tools.ts` implements them against
the store; and the React UI is *one client of that surface*, with no privileged
path of its own. The rule that keeps it honest:

> Do not add a feature to a component that is not reachable as a tool.

An agent driving these twenty-four tools reaches 100% of the product without
touching a pixel.

That claim used to be aspirational. A UI audit — reading every React handler
against the tool list — found **ten capabilities the GUI had and the tool surface
did not**: navigation, library filters, "+1 min", abandoning a session, skipping
a pose, your name, the reminder, reduce-motion, mute, export and reset. Fourteen
tools became twenty-four, and every one of those handlers now calls the tool
rather than the store. See [Parity](#parity-everything-you-can-tap-you-can-say).

---

## The tools

| Tool | Mutates | What it does |
|---|---|---|
| `list_practices` | — | Browse the library, filtered by `kind`, `maxMinutes`, `tag`. |
| `recommend_practice` | — | Pick **one** practice for `mood` / `minutesAvailable` / `intent`, with the reasons it won. |
| `get_progress` | — | Streak, best streak, grace days, total minutes, daily goal, recent sessions. |
| `get_insights` | — | Observations derived from the user's own data, each carrying its `n`. |
| `export_data` | — | The user's complete history as JSON. Their data is theirs; never refuse it. |
| `start_session` | yes | Begin `practiceId`. The UI enters the immersive player. |
| `pause_session` | yes | Pause the running practice. |
| `resume_session` | yes | Resume a paused practice. |
| `extend_session` | yes | Add `minutes` to the practice in progress; for yoga, also holds the current pose longer. |
| `skip_pose` | yes | Advance a pose sequence to the next pose. |
| `complete_session` | yes | Finish and record the session, optionally with `moodAfter` and a `note`. |
| `abandon_session` | yes | Stop **without** recording a completion, with an optional private `reason`. No streak cost. |
| `log_mood` | yes | Record a 1–5 `score` with optional `feelings[]` and `note`, independent of a session. |
| `journal_entry` | yes | Store a written reflection; returns the entry id. |
| `navigate` | yes | Show a screen: `today` \| `practice` \| `progress` \| `you`. |
| `filter_library` | yes | Set the library's `kind` and `maxMinutes` filters. An omitted field **clears** that filter. |
| `set_intention` | yes | Set the daily goal in minutes (clamped to 3–60). |
| `set_theme` | yes | `aurora` \| `dusk` \| `forest` \| `sand`. |
| `set_soundscape` | yes | `none` \| `rain` \| `ocean` \| `forest` \| `singing-bowl`. |
| `set_profile` | yes | The `name` used in the greeting. An empty string clears it. |
| `set_reminder` | yes | Daily reminder `time` as `HH:MM`; an empty string turns it off. |
| `set_accessibility` | yes | `reduceMotion` and/or `muted`. Use immediately on any mention of motion sickness or vertigo. |
| `create_breath_pattern` | yes | Save a custom pattern (`inhale`/`holdIn`/`exhale`/`holdOut` in seconds). |
| `reset_data` | yes | Erase everything. Refuses unless `confirm === true`. |

Nineteen tools write, five read. The split matters to an agent: the read tools
are safe to call unprompted to *find out* something, and the write tools should
be confirmed with the user first. The manifest encodes this — since neither
vendor's tool schema permits custom top-level keys, the `mutates` flag is folded
into the description text, where the model will actually read it.

Two of the write tools carry extra weight. `reset_data` is the only irreversible
call on the surface and it **fails** unless `confirm: true`; the refusal message
is written as a script, so an agent asking for permission says what is actually
lost rather than a vague "are you sure?". And `abandon_session` exists so an
agent never has to choose between logging a false completion and leaving a
session hanging — someone who needs to stop should be able to stop.

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

But coverage compares the contract **to itself**. It was green — fourteen for
fourteen — while ten things a user could tap had no tool at all, because a
capability that never reached `contract.ts` is invisible to a check that starts
from `contract.ts`. So there is a second check.

---

## Parity: everything you can tap, you can say

`verifyUiParity()` in `src/agent/manifest.ts` holds `UI_CAPABILITIES`: an
inventory of every user-visible action and the tool that serves it. It asserts
each one resolves to a tool that is both declared and implemented.

```bash
npm run verify:agent    # coverage + parity; exits non-zero on failure
```

```
ok: true

coverage  24/24 tools implemented
parity    25/25 UI capabilities resolve to a tool
          19/24 tools are reachable from the GUI

Everything you can tap, you can say.
```

The list is hand-maintained on purpose. Deriving it from the source would only
prove that whatever the UI does is what it should do; a human writing down "the
user can do this here" is the actual check. Add a control, add a row — and if
that row has no tool, the build fails.

| You tap | Where | Tool |
|---|---|---|
| A tab in the bottom bar or side rail | `App.tsx` | `navigate` |
| "Session paused — resume" | `App.tsx` | `resume_session` |
| "Begin" on today's suggestion | `screens/Today.tsx` | `start_session` |
| A mood face on the check-in row | `screens/Today.tsx` | `log_mood` |
| The practice grid itself | `screens/Practice.tsx` | `list_practices` |
| A kind or length chip | `screens/Practice.tsx` | `filter_library` |
| "Clear filters" | `screens/Practice.tsx` | `filter_library` |
| A practice card | `screens/Practice.tsx` | `start_session` |
| The streak, totals and calendar | `screens/Progress.tsx` | `get_progress` |
| The observations panel | `screens/Progress.tsx` | `get_insights` |
| The play/pause button, or space | `player/SessionPlayer.tsx` | `pause_session` / `resume_session` |
| "+1 min" | `player/SessionPlayer.tsx` | `extend_session` |
| The speaker icon | `player/SessionPlayer.tsx` | `set_accessibility` |
| X, or Escape (the session parks, paused) | `player/SessionPlayer.tsx` | `pause_session` |
| "Finish" → the mood check-in → "Save" | `player/SessionPlayer.tsx` | `complete_session` |
| "Hold longer" on a pose | `player/PoseSequencer.tsx` | `extend_session` |
| Your name | `screens/You.tsx` | `set_profile` |
| A theme swatch | `screens/You.tsx` | `set_theme` |
| A soundscape chip | `screens/You.tsx` | `set_soundscape` |
| The daily-goal stepper or a preset | `screens/You.tsx` | `set_intention` |
| The reminder switch or its time field | `screens/You.tsx` | `set_reminder` |
| "Reduce motion" | `screens/You.tsx` | `set_accessibility` |
| "Export JSON" | `screens/You.tsx` | `export_data` |
| "Reset everything" → "Yes, delete it all" | `screens/You.tsx` | `reset_data` |

Read that table as a claim about the *code*: those handlers call `callTool(...)`,
not the store. The store action is no longer reachable from a component for any
of these. (The three read rows — the practice grid, the streak panel, the
observations panel — are the exception and are marked as such in the source:
those screens render straight from the store, and the row records that the tool
returns the same thing the screen shows.)

Two deliberate consequences:

**`tick` is not a tool.** The session clock fires once a second and is not
something a person asks for. It is plumbing, and it stays a direct store call.
Everything a user could *say* is a tool; the clock is not one of them.

**The length filter changed shape.** It used to offer bands — "5–15 min", "Over
15 min" — which read nicely and could not be expressed by `filter_library`, whose
argument is a `maxMinutes` ceiling. A control only the GUI can operate is exactly
the asymmetry this document is about, so the bands became ceilings: "Up to 5 /
15 / 30 min". Each chip is now one tool call, and it is closer to the question
people actually ask.

### The reverse direction is fine

Five tools have no GUI control at all: `recommend_practice`, `create_breath_pattern`,
`journal_entry`, `abandon_session` and `skip_pose`. That is not a gap — it is the
point. The agent being *more* capable than the screens is the direction an
agent-first app is supposed to lean; the screens being more capable than the
agent is the one that breaks the thesis. `verifyUiParity` reports these as
`agentOnly` and passes.

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

Verbatim output from the on-device coach, run against the seeded library.

> **you** — I'm anxious and have 10 minutes

*Read `mood ~2`, `10 min available`, `intent "calm"` from the message.*

```
recommend_practice   reads   ✓
{ "mood": 2, "minutesAvailable": 10, "intent": "calm" }

→ Because you are low and you have 10 minutes and you want calm, I would do
  **Feet on the Floor** — 5 min of meditation, gentle. when the room starts
  going somewhere without you

  Why this one: fits your 10 minutes (5 min); tagged anxiety, calm; gentle
  enough for a low day; breath and stillness settle the nervous system
  fastest; something you have not done lately.

  Say "start it" and I will begin.
```

> **you** — start it

*Resolved "it" to the practice I last recommended.*

```
start_session   writes   ✓
{ "practiceId": "med-ground-panic" }

→ Starting **Feet on the Floor** — 5 minutes of meditation. The player is
  open; I will stay quiet until you finish.
```

> **you** — done, feeling 4

*Asked to finish, with mood 4 attached.*

```
complete_session   writes   ✓
{ "moodAfter": 4 }

→ Logged **Feet on the Floor** — under a minute. That is 1 day in a row.
  You logged feeling good afterwards.
```

Note what it did *not* say. The session ran for seconds, so it reports "under a
minute" rather than rounding up to "1 min" — the sentence has to agree with the
ledger, or the praise is worthless.

> **you** — what have you noticed about me?

```
get_insights   reads   ✓
{}

→ - You have practised today. Best so far: 1 day. You have a grace day in hand
    this week. (confidence: high)
  - Your mood is 1.2 points higher after breathwork. Across 5 sessions where
    you logged mood before and after: 2.4 → 3.6 on the 1–5 scale. This is an
    association in your own data, not a cause. (confidence: medium)
  - You finish what you start in late at night. 67% of the 6 sessions you began
    in that window were completed. Other windows have fewer than 5 sessions, so
    they are not yet comparable. (confidence: medium)
```

Every claim carries its `n` and its confidence, and the causal disclaimer is
part of the sentence rather than a footnote. `get_insights` delegates to
`src/lib/insights.ts` rather than deriving anything itself — a second
derivation living in the tool layer is how an app ends up telling the user two
different truths.

> **you** — make it nicer

*No rule matched with enough confidence to act.*

```
no tool called

→ I am not sure what you need yet — and I would rather ask than guess. Tell me
  one of: how you feel (1-5 or in words), how many minutes you have, or what
  you want to change. You can also say "what can you do".
```

Every one of those blocks is what the console actually renders: the tool name, a
`reads`/`writes` badge, the exact arguments, and the raw `ToolResult` one click
away. That is the point. The agent's actions are legible because they are real
calls against the same surface the UI uses — not a narration of them.
