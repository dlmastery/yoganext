/**
 * format.ts — small, pure, dependency-free helpers.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. **Nothing here reads the clock.** Every function that needs "now" takes it
 *      as an argument. The impure boundary is the store's actions; the engines
 *      below them must be replayable, which means deterministic.
 *   2. **A "day key" is `'YYYY-MM-DD'` in the user's LOCAL timezone.** A habit
 *      streak is a lived, local thing — practising at 23:30 must count for that
 *      evening, not for tomorrow in UTC. So the *conversion* from a timestamp to
 *      a key uses local calendar fields, while *arithmetic between keys* is done
 *      in UTC so that a DST transition can never add or drop a day.
 */

// ────────────────────────────────────────────────────────────────── day keys ──

export const MS_PER_DAY = 86_400_000;

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True if `s` is a well-formed, real calendar day key. */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string' || !KEY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  // rejects 2025-02-30 and friends, which Date.UTC would silently roll over
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * Local `'YYYY-MM-DD'` for a Date or ISO timestamp.
 * A string that is already a day key is returned untouched — parsing it through
 * `new Date()` would treat it as UTC midnight and shift it a day west of GMT.
 */
export function dayKey(input: Date | string): string {
  if (typeof input === 'string') {
    if (isDayKey(input)) return input;
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return '';
    return dayKey(parsed);
  }
  if (Number.isNaN(input.getTime())) return '';
  return `${input.getFullYear()}-${pad2(input.getMonth() + 1)}-${pad2(input.getDate())}`;
}

/** A day key as a UTC-midnight Date, for safe arithmetic. `null` if malformed. */
export function parseDayKey(key: string): Date | null {
  if (!isDayKey(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Shift a day key by `n` days (negative goes back). Returns `''` if malformed. */
export function addDays(key: string, n: number): string {
  const base = parseDayKey(key);
  if (!base) return '';
  const moved = new Date(base.getTime() + n * MS_PER_DAY);
  return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
}

/** Whole days from `from` to `to` (positive when `to` is later). `0` if malformed. */
export function daysBetween(from: string, to: string): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * The Monday that begins `key`'s week, as a day key. Used as the bucket for the
 * weekly grace allowance — a plain Monday key rather than an ISO week *number*,
 * because week numbering has year-boundary edge cases we gain nothing from.
 */
export function weekStart(key: string): string {
  const d = parseDayKey(key);
  if (!d) return '';
  const dow = d.getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7;
  return addDays(key, -backToMonday);
}

/** Inclusive list of day keys from `from` to `to`. Empty if reversed or malformed. */
export function dayRange(from: string, to: string): string[] {
  const span = daysBetween(from, to);
  if (span < 0 || !isDayKey(from) || !isDayKey(to)) return [];
  const out: string[] = [];
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}

/** Local hour (0–23) of an ISO timestamp; `-1` if unparseable. */
export function hourOf(iso: string): number {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? -1 : d.getHours();
}

// ─────────────────────────────────────────────────────────────────── display ──

/** Seconds as `m:ss`, or `h:mm:ss` past an hour. Negatives clamp to zero. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Today" / "Yesterday" / "3 days ago" / "in 2 days" / "12 Mar".
 * Deliberately warm and short — this is read on a card, not in a log.
 */
export function relativeDay(key: string, today: string): string {
  if (!isDayKey(key) || !isDayKey(today)) return '';
  const delta = daysBetween(today, key);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  if (delta < 0 && delta >= -6) return `${-delta} days ago`;
  if (delta > 0 && delta <= 6) return `in ${delta} days`;
  const d = parseDayKey(key)!;
  const stamp = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return sameYear ? stamp : `${stamp} ${d.getUTCFullYear()}`;
}

/** "45s" / "12 min" / "1h 20m". Input is minutes and may be fractional. */
export function humanMinutes(minutes: number): string {
  const m = Math.max(0, Number.isFinite(minutes) ? minutes : 0);
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${Math.round(m)} min`;
  const hours = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `0.42 -> "42%"`. Clamped to 0..1 first so a bad ratio cannot render as "830%". */
export function percent(fraction: number, digits = 0): string {
  const f = clamp01(Number.isFinite(fraction) ? fraction : 0);
  return `${(f * 100).toFixed(digits)}%`;
}

/** Ordinal-free plural helper: `plural(1,'day') -> '1 day'`. */
export function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

// ──────────────────────────────────────────────────────────────────── numeric ──

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/** Round to `places` decimals without the `0.1+0.2` tail. */
export function round(n: number, places = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Mean of a list; `0` for an empty list (callers gate on `n` before reporting). */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}
