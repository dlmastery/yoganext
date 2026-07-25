# YogaNext

**A sanctuary for your nervous system — and the first meditation app an AI can actually *operate*.**

Meditation, breathwork, yoga, sleep and mood, built as an **agent-first application**:
every capability lives in a typed, documented tool surface, and the beautiful UI is
just one client of it.

```bash
npm install
npm run dev        # → http://localhost:5173
npm run agent:tools   # print the tool manifest an agent consumes
```

---

## Why "agent-first"?

A conventional app buries its capability inside click-paths. An agent can only
automate it by *pretending to be a mouse* — brittle, blind, and unable to explain
what it did.

YogaNext inverts that. The domain core (`src/lib/types.ts`) is operated through a
**14-tool surface** (`src/agent/contract.ts`) with model-facing descriptions and
JSON-Schema inputs, emitted in **both Anthropic and OpenAI formats**. The React UI
and the AI coach are *peer clients of the same store*.

The invariant is enforced, not aspirational:

```
$ verifyToolCoverage()
ok: true | declared: 14 | implemented: 14 | missing: 0 | undeclared: 0
```

If a feature exists in a component but not as a tool, coverage fails. That is the
whole architecture in one assertion.

**The console makes it legible.** Every turn the coach takes renders as an
inspectable chip — tool name, arguments, result — because an agent whose actions
you cannot audit is not a feature, it is a liability.

And it works **offline, with no API key**: `src/agent/local-agent.ts` is a
deterministic intent-matcher that maps "i'm anxious and have ten minutes" to
`recommend_practice{mood:2, minutesAvailable:10, intent:'calm'}`. Point a real model
at the manifest and it drives the same tools.

---

## What's inside

| | |
|---|---|
| **30 practices** | 8 meditation · 7 breathwork · 5 yoga · 5 sleep · 5 journal — *every one* with a written, paced guided script |
| **8 breath patterns** | box, 4-7-8, coherent 5.5, physiological sigh, extended exhale, ujjayi… each with an honest one-line rationale |
| **Yoga sequences** | Sun Salutation A, spine flow, hip opener, sleep wind-down, desk break — sanskrit names + real alignment cues |
| **4 themes** | aurora · dusk · forest · sand, as CSS custom properties so switching is instant |
| **The breath orb** | a genuinely mesmerising hero animation — transform-only, 60fps, with a reduced-motion fallback |
| **Soundscapes** | rain / ocean / forest / singing bowl, synthesised live via WebAudio — **no audio files** |

Practices are written for real states: panic, 3am waking, grief, burnout, chronic
pain, pre-presentation nerves, post-argument reset, doomscroll detox. Titles like
*Unclench*, *Feet on the Floor*, *Runway*, *Carrying It*.

---

## Two deliberate product decisions

**The streak forgives you.** Streaks that shatter on one missed day punish exactly
the people who most need the practice. One missed day per week is absorbed by
*grace*; achievements reward consistency over volume — including **The Return**, for
practising again after a gap, which is the single behaviour most worth reinforcing.

**The insights refuse to overclaim.** The engine only reports a mood-delta for a
practice type at **n ≥ 3** paired observations, and every insight carries a
confidence badge the UI must render. This is a mental-health surface; presenting a
one-sample average as a fact would be dishonest. `src/data/safety.ts` carries a
short, warm crisis note with real helplines and states plainly that this app is not
therapy or medical care.

---

## Architecture

```
src/lib/types.ts        the domain core — the UI never owns state or logic
src/agent/contract.ts   TOOL_SPECS: the canonical capability surface
src/agent/tools.ts      implementations (pure over the store, never throw)
src/agent/manifest.ts   Anthropic + OpenAI schemas · verifyToolCoverage()
src/agent/local-agent.ts offline deterministic coach (no network, no key)
src/lib/store.ts        zustand + localStorage, forgiving habit engine
src/lib/insights.ts     n-gated, confidence-tagged observations
src/components/player/  BreathOrb · PoseSequencer · rAF timer · WebAudio
src/screens/            Today · Practice · Progress · You
```

`useSessionTimer` drives the clock from timestamp deltas via `requestAnimationFrame`
— not `setInterval`, which drifts and stutters — so the session stays accurate even
when the tab is backgrounded.

See [`docs/AGENT.md`](docs/AGENT.md) for the full tool table and a worked transcript.

---

## Status

Built in one session by a six-agent team against a fixed interface spine. Builds
clean (1,964 modules). Not a medical device; makes no clinical claims.

MIT.
