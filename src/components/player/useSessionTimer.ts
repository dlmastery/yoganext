/**
 * useSessionTimer — the clock behind the immersive player.
 *
 * WHY NOT setInterval: `setInterval(fn, 1000)` is a *request*, not a promise. The
 * callback is queued behind whatever the main thread is doing, so every tick lands
 * a little late and the error accumulates — a 10-minute session routinely finishes
 * 3-6 seconds long. Worse, browsers clamp background timers to >=1000ms and Chrome
 * throttles hidden tabs to roughly one callback per minute, so a session left in a
 * background tab silently stops counting.
 *
 * THE STRATEGY IS TIMESTAMP-DIFFERENCE, NOT ACCUMULATION. We never do `elapsed++`.
 * We bank completed run segments in `baseRef` and, while running, derive
 *
 *     elapsed = baseRef + (now - segmentStart) / 1000
 *
 * from `performance.now()` on every animation frame. Frames may be late, coalesced,
 * or skipped entirely for ten minutes while the tab is hidden — the *next* frame
 * still reports the true elapsed time, because the value is read from the clock
 * rather than counted. Drift is therefore bounded by the resolution of
 * `performance.now()`, not by the frame budget.
 *
 * Two further consequences of that design:
 *
 *   - Backgrounded tabs self-heal. rAF stops firing when the tab is hidden, so we
 *     additionally listen for `visibilitychange` and sample immediately on return.
 *     Any whole seconds that accrued while hidden are flushed to the store in a
 *     single catch-up `tick(n)` rather than being lost.
 *   - Pausing is exact. On pause we bank the partial segment and clear the segment
 *     start; on resume we open a new segment. Nothing is estimated.
 *
 * Publishing is deliberately decoupled from sampling. React state updates at
 * `publishMs` (10 Hz by default) because that is all a clock readout needs; the orb
 * does NOT animate off this value (see BreathOrb — it runs composited animations
 * scheduled at phase boundaries), so a low publish rate costs nothing visually
 * while saving ~50 renders a second.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSessionTimerOptions {
  /** false when no session is mounted — the clock does not run and does not tick. */
  running: boolean;
  /** true while the user has paused. The clock freezes exactly, losing no fraction. */
  paused: boolean;
  /** Seconds already on the clock when the timer mounts (e.g. a rehydrated session). */
  initialElapsed?: number;
  /**
   * Called with WHOLE-second increments only, never fractional and never zero.
   * A tab that was hidden for 90s produces a single `onTick(90)`, so the store's
   * integer `elapsed` stays correct without receiving 90 separate calls.
   */
  onTick?: (seconds: number) => void;
  /** How often `elapsed` is published to React, in ms. Does not affect accuracy. */
  publishMs?: number;
}

export interface SessionTimer {
  /** Fractional seconds, published at `publishMs`. Safe to render. */
  elapsed: number;
  /** Fractional seconds, exact on every read. Never triggers a render. */
  elapsedRef: React.MutableRefObject<number>;
  /** Force the clock to a value (also re-bases the whole-second tick accounting). */
  reset: (toSeconds?: number) => void;
}

export function useSessionTimer({
  running,
  paused,
  initialElapsed = 0,
  onTick,
  publishMs = 100,
}: UseSessionTimerOptions): SessionTimer {
  const [elapsed, setElapsed] = useState(initialElapsed);

  const elapsedRef = useRef(initialElapsed);
  /** Seconds banked from completed run segments. */
  const baseRef = useRef(initialElapsed);
  /** performance.now() at the start of the current run segment, or null when idle. */
  const segmentStartRef = useRef<number | null>(null);
  /** Highest whole second already reported through onTick. */
  const wholeRef = useRef(Math.floor(initialElapsed));
  const publishedAtRef = useRef(-Infinity);
  const frameRef = useRef<number | null>(null);

  // Kept in a ref so a changing callback identity never restarts the rAF loop.
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  /** Read the clock, flush whole seconds to the store, publish if due. */
  const sample = useCallback(
    (now: number) => {
      const start = segmentStartRef.current;
      const value = start === null ? baseRef.current : baseRef.current + (now - start) / 1000;
      elapsedRef.current = value;

      const whole = Math.floor(value);
      if (whole > wholeRef.current) {
        const delta = whole - wholeRef.current;
        wholeRef.current = whole;
        onTickRef.current?.(delta);
      }

      if (now - publishedAtRef.current >= publishMs) {
        publishedAtRef.current = now;
        setElapsed(value);
      }
    },
    [publishMs],
  );

  // The run loop. Re-entered whenever the running/paused state flips; the cleanup
  // banks the partial segment so no time is lost across the transition.
  useEffect(() => {
    if (!running || paused) {
      // The previous effect's cleanup has already banked the segment; just publish
      // the frozen value so the readout settles on an exact number.
      elapsedRef.current = baseRef.current;
      setElapsed(baseRef.current);
      return;
    }

    segmentStartRef.current = performance.now();

    const loop = (now: number) => {
      sample(now);
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (segmentStartRef.current !== null) {
        baseRef.current += (performance.now() - segmentStartRef.current) / 1000;
        segmentStartRef.current = null;
        elapsedRef.current = baseRef.current;
      }
    };
  }, [running, paused, sample]);

  // rAF does not fire in a hidden tab. Sampling the moment we come back flushes the
  // catch-up tick immediately rather than waiting for the first frame to be served.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) {
        publishedAtRef.current = -Infinity; // force a publish on the catch-up sample
        sample(performance.now());
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [sample]);

  const reset = useCallback((toSeconds = 0) => {
    baseRef.current = toSeconds;
    elapsedRef.current = toSeconds;
    wholeRef.current = Math.floor(toSeconds);
    segmentStartRef.current = segmentStartRef.current === null ? null : performance.now();
    publishedAtRef.current = -Infinity;
    setElapsed(toSeconds);
  }, []);

  return { elapsed, elapsedRef, reset };
}

/**
 * `615.4` -> `"10 minutes 15 seconds"`, for screen readers.
 *
 * Visual clock formatting is `mmss()` from `lib/format.ts` — it grows an hours
 * field past 3600s, which matters because practices run up to 120 minutes and
 * "+1 min" can push any session past the hour.
 */
export function spokenClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}
