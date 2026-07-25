/**
 * breath.ts — the breathing pattern library.
 *
 * Every pattern is four numbers in seconds: inhale, hold-in, exhale, hold-out.
 * A zero phase is skipped by the player, so `4-0-8-0` is a clean two-beat cycle
 * with nothing to brace against.
 *
 * The `why` line is shown to the user verbatim. Rules for writing one:
 *   - describe the *mechanism*, not an outcome ("lengthens the exhale", not
 *     "cures anxiety"). This is a wellbeing app, not a clinic.
 *   - one sentence, plain language, no jargon the user has to look up.
 *   - never promise a result. "Most people feel…" is honest; "you will feel…"
 *     is not.
 */

import type { BreathPattern } from '../lib/types.ts';

export const BREATH_PATTERNS: BreathPattern[] = [
  {
    id: 'even-ladder',
    name: 'Even Ladder',
    inhale: 4,
    holdIn: 0,
    exhale: 4,
    holdOut: 0,
    why: 'The plainest pattern there is — in for four, out for four, nothing to hold. Start here if breathwork has ever made you feel like you were doing it wrong.',
  },
  {
    id: 'box',
    name: 'Box Breathing',
    inhale: 4,
    holdIn: 4,
    exhale: 4,
    holdOut: 4,
    why: 'Four equal sides slow you to roughly four breaths a minute and give the mind a shape to walk around, which is easier than being told to stop thinking.',
  },
  {
    id: 'coherent',
    name: 'Coherent Breathing',
    inhale: 5.5,
    holdIn: 0,
    exhale: 5.5,
    holdOut: 0,
    why: 'About five and a half breaths a minute — the pace at which heart rate and breath tend to fall into step, and the most studied rhythm in the whole practice.',
  },
  {
    id: 'extended-exhale',
    name: 'Extended Exhale',
    inhale: 4,
    holdIn: 0,
    exhale: 8,
    holdOut: 0,
    why: 'The out-breath is double the in-breath, and the out-breath is the half that slows the heart — all of the effect, none of the breath-holding.',
  },
  {
    id: 'four-seven-eight',
    name: 'Four-Seven-Eight',
    inhale: 4,
    holdIn: 7,
    exhale: 8,
    holdOut: 0,
    why: 'A long hold, then an exhale twice the length of the inhale; the counting is deliberately awkward so there is no attention left over for anything else.',
  },
  {
    id: 'physiological-sigh',
    name: 'Physiological Sigh',
    inhale: 3,
    holdIn: 1,
    exhale: 7,
    holdOut: 0,
    why: 'A full breath, a small top-up sip, then one long release — the same double-inhale the body does on its own after crying, and the quickest pattern in this list.',
  },
  {
    id: 'ujjayi',
    name: 'Ujjayi',
    inhale: 5,
    holdIn: 0,
    exhale: 5,
    holdOut: 0,
    why: 'Narrow the back of the throat until the breath is faintly audible, like wind under a door; the sound is your metronome and it will tell you the moment you rush.',
  },
  {
    id: 'nadi-shodhana',
    name: 'Alternate Nostril',
    inhale: 4,
    holdIn: 4,
    exhale: 8,
    holdOut: 0,
    why: 'The classical nadi shodhana timing — in through one nostril, hold, out through the other for twice as long; the switching keeps the part of you that likes to argue busy.',
  },
  {
    id: 'kindling',
    name: 'Kindling',
    inhale: 6,
    holdIn: 0,
    exhale: 2,
    holdOut: 0,
    why: 'Inhale-led rather than exhale-led: a long slow draw and a quick release, which tilts the other way — toward alert rather than toward calm.',
  },
  {
    id: 'ocean-floor',
    name: 'Ocean Floor',
    inhale: 6,
    holdIn: 0,
    exhale: 10,
    holdOut: 2,
    why: 'An exhale at the far edge of comfortable, slow enough that most people lose count somewhere in the twenties — losing count is the point, not a failure.',
  },
];

/** Look a pattern up by id. Returns undefined rather than throwing. */
export const breathById = (id: string): BreathPattern | undefined =>
  BREATH_PATTERNS.find((p) => p.id === id);
