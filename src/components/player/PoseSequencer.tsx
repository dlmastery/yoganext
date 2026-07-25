/**
 * PoseSequencer — the yoga counterpart to BreathOrb.
 *
 * The sequence is *derived*, never stepped. Given the session clock we compute
 * which pose we are in from cumulative offsets, so auto-advance is a consequence of
 * the arithmetic rather than a timer that can fall out of sync with the session, and
 * a backgrounded tab returns to the correct pose rather than to a stale one.
 *
 * "Hold longer" is the one piece of local state, and it is the reason offsets are
 * recomputed rather than precomputed: extending the current pose has to push every
 * later boundary out by the same amount. Extensions are keyed by pose index, so a
 * pose the user has already left cannot be retroactively lengthened.
 *
 * The glyph token is documented as "simple svg path/emoji". We sniff it: a string
 * that starts with a path command and contains digits is rendered as SVG geometry,
 * anything else as text. Guessing wrong degrades to showing the token, never to a
 * blank frame.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { Pose } from '../../lib/types';
import { formatClock } from './useSessionTimer';

const EXTEND_SECONDS = 15;

export interface PoseSequencerProps {
  poses: Pose[];
  /** Session seconds. */
  elapsed: number;
  reduceMotion?: boolean;
  colors?: [string, string];
  /**
   * Called when the user extends a pose, so the player can grow the session length
   * to match. The sequencer tracks its own offsets regardless.
   */
  onExtend?: (seconds: number) => void;
  className?: string;
}

interface SequenceState {
  index: number;
  pose: Pose;
  duration: number;
  elapsedInPose: number;
  remaining: number;
  progress: number;
  /** true once the clock has run past the end of the last pose */
  finished: boolean;
}

function resolve(poses: Pose[], extensions: number[], t: number): SequenceState {
  const time = Math.max(0, t);
  let cursor = 0;

  for (let i = 0; i < poses.length; i++) {
    const duration = Math.max(1, poses[i].seconds + (extensions[i] ?? 0));
    if (time < cursor + duration || i === poses.length - 1) {
      const elapsedInPose = Math.min(Math.max(time - cursor, 0), duration);
      return {
        index: i,
        pose: poses[i],
        duration,
        elapsedInPose,
        remaining: Math.max(0, duration - elapsedInPose),
        progress: elapsedInPose / duration,
        finished: i === poses.length - 1 && time >= cursor + duration,
      };
    }
    cursor += duration;
  }

  // Only reachable for an empty pose list, which the component guards against.
  throw new Error('PoseSequencer: empty pose list');
}

export function PoseSequencer({
  poses,
  elapsed,
  reduceMotion = false,
  colors,
  onExtend,
  className,
}: PoseSequencerProps) {
  const [extensions, setExtensions] = useState<number[]>(() => poses.map(() => 0));

  const state = useMemo(() => {
    if (poses.length === 0) return null;
    return resolve(poses, extensions, elapsed);
  }, [poses, extensions, elapsed]);

  const holdLonger = useCallback(() => {
    if (!state) return;
    setExtensions((prev) => {
      const next = prev.length === poses.length ? [...prev] : poses.map(() => 0);
      next[state.index] = (next[state.index] ?? 0) + EXTEND_SECONDS;
      return next;
    });
    onExtend?.(EXTEND_SECONDS);
  }, [state, poses, onExtend]);

  if (!state) return null;

  // Theme tokens are RGB triplets, not colors — see BreathOrb.
  const c1 = colors?.[0] ?? 'rgb(var(--accent))';
  const c2 = colors?.[1] ?? 'rgb(var(--accent-2))';
  const upcoming = poses.slice(state.index, state.index + 5);

  return (
    <div className={clsx('flex w-full flex-col items-center gap-7', className)}>
      <div className="relative grid aspect-square w-full place-items-center">
        {/* Ambient wash behind the glyph, tinted by the practice gradient. */}
        <div
          className="pointer-events-none absolute h-[86%] w-[86%] rounded-full"
          style={{
            background: `radial-gradient(circle,
              color-mix(in oklab, ${c1} 22%, transparent) 0%,
              color-mix(in oklab, ${c2} 10%, transparent) 48%,
              transparent 72%)`,
          }}
          aria-hidden
        />

        <CountdownRing progress={state.progress} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state.pose.id + state.index}
            className="absolute flex flex-col items-center gap-3 px-8 text-center"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.05 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <PoseGlyph glyph={state.pose.glyph} />
            <div className="flex flex-col items-center gap-1">
              <h2 className="text-[clamp(1.1rem,3.6vw,1.6rem)] font-light tracking-wide text-fg">
                {state.pose.name}
              </h2>
              {state.pose.sanskrit && (
                <p className="text-xs italic tracking-[0.16em] text-fg-muted">
                  {state.pose.sanskrit}
                </p>
              )}
            </div>
            <p className="max-w-[24ch] text-sm font-light leading-relaxed text-fg-muted">
              {state.pose.cue}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-none absolute bottom-[4%] text-sm font-light tabular-nums tracking-[0.2em] text-fg-muted">
          {formatClock(state.remaining)}
        </div>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {`${state.pose.name}${state.pose.sanskrit ? `, ${state.pose.sanskrit}` : ''}. ${state.pose.cue}`}
      </span>

      <button
        type="button"
        onClick={holdLonger}
        className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-light tracking-[0.14em] text-fg-muted uppercase transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Hold ${state.pose.name} for ${EXTEND_SECONDS} more seconds`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Hold longer
      </button>

      {/* Timeline. The current pose leads; what is coming is legible at a glance,
          which is what stops a sequence feeling like a black box. */}
      <ol className="flex w-full items-stretch gap-2 overflow-x-auto pb-1" aria-label="Pose sequence">
        {upcoming.map((pose, offset) => {
          const at = state.index + offset;
          const current = offset === 0;
          const seconds = Math.max(1, pose.seconds + (extensions[at] ?? 0));
          return (
            <li
              key={pose.id + at}
              className={clsx(
                'glass flex min-w-[7.5rem] flex-1 flex-col gap-1 rounded-xl px-3 py-2 transition-opacity',
                current ? 'opacity-100 ring-1 ring-ring' : 'opacity-45',
              )}
              aria-current={current ? 'step' : undefined}
            >
              <span className="truncate text-xs font-light tracking-wide text-fg">{pose.name}</span>
              <span className="text-[0.65rem] tabular-nums tracking-[0.14em] text-fg-muted uppercase">
                {current ? 'Now' : formatClock(seconds)}
              </span>
            </li>
          );
        })}
        {state.finished && (
          <li className="glass flex min-w-[7.5rem] items-center gap-2 rounded-xl px-3 py-2 text-xs font-light text-fg-muted">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Sequence complete
          </li>
        )}
      </ol>
    </div>
  );
}

/**
 * Countdown for the current pose. Driven declaratively at the parent's publish rate
 * with a short linear tween, which interpolates the gaps into a continuous sweep.
 */
const CountdownRing = memo(function CountdownRing({ progress }: { progress: number }) {
  return (
    <svg className="absolute h-[94%] w-[94%] -rotate-90" viewBox="0 0 100 100" fill="none" aria-hidden>
      <circle
        cx="50"
        cy="50"
        r="47"
        stroke="currentColor"
        strokeWidth="0.5"
        className="text-fg-muted opacity-20"
      />
      <motion.circle
        cx="50"
        cy="50"
        r="47"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        className="text-accent"
        initial={false}
        animate={{ pathLength: Math.min(1, Math.max(0, progress)) }}
        transition={{ duration: 0.14, ease: 'linear' }}
      />
    </svg>
  );
});

/** A path token draws; anything else (emoji, a word) is set as type. */
const PoseGlyph = memo(function PoseGlyph({ glyph }: { glyph: string }) {
  const isPath = /^[Mm]\s*-?[\d.]/.test(glyph.trim());

  if (isPath) {
    return (
      <svg
        className="h-16 w-16 text-accent"
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={glyph} />
      </svg>
    );
  }

  return (
    <span className="text-5xl leading-none" aria-hidden>
      {glyph}
    </span>
  );
});

export default PoseSequencer;
