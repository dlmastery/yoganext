/**
 * safety.ts — the one piece of copy in this app that must never be clever.
 *
 * Shown permanently in the You screen, and surfaced inline if a journal entry
 * or a run of low moods suggests someone is struggling. Rules it follows:
 *   - warm, not alarmed. Panic in the copy makes people close the app.
 *   - concrete numbers, not "seek professional help".
 *   - honest about what this app is. It is not care, and pretending otherwise
 *     is the single most harmful thing a wellbeing product can do.
 *   - no diagnosis, no treatment claim, no promise of an outcome. Anywhere.
 */

export const CRISIS_NOTE = `If things feel heavier than a practice can hold, please talk to a person.

In the US, call or text 988 — the Suicide & Crisis Lifeline, free and open all day and night. In the UK and Ireland, Samaritans answer on 116 123. Anywhere else, your local emergency number will connect you.

This app is a place to breathe and to notice how you are. It isn't therapy, and it isn't medical care — it doesn't replace a doctor, a therapist, or someone who knows you. Reaching for one of those is not giving up on this. It's the same instinct, aimed better.`;

/** Short form for tight surfaces (a sheet header, a toast). */
export const CRISIS_NOTE_SHORT = `Not a substitute for therapy or medical care. If you need someone now: 988 (US), 116 123 (UK & IE), or your local emergency number.`;

/** Rendered small under the practice library and the insights panel. */
export const WELLBEING_DISCLAIMER = `These practices are for general wellbeing. They aren't treatment for any condition, and nothing here is medical advice. If something hurts, stop — the pose is not more important than you are.`;
