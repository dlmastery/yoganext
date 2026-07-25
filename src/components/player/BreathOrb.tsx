/**
 * BreathOrb — the thing people stare at for ten minutes.
 *
 * ─────────────────────────────────────────────────────────── how it is driven ──
 *
 * The orb is NOT animated frame-by-frame from the session clock. Recomputing a
 * scale in React 60 times a second is how breathing orbs end up stuttering: every
 * frame becomes a render, a reconciliation and a style write, and the moment the
 * main thread is busy the breath visibly hitches — which is precisely the moment a
 * meditating user notices.
 *
 * Instead the orb is *scheduled*. When the breath phase changes we fire exactly one
 * declarative animation per motion value:
 *
 *     animate(coreScale, targetFor(phase), { duration: tick.remaining, ease })
 *
 * and then React does nothing at all until the next phase boundary. The animation
 * runs on the compositor as a transform; the main thread can stall and the breath
 * still glides.
 *
 * The duration is `remaining`, not the phase's nominal length. That single choice
 * makes the orb self-correcting: the clock publishes at 10 Hz, so we may learn about
 * a boundary up to 100 ms late, and animating over what is *left* of the phase means
 * every phase still lands exactly on its boundary. Errors cannot accumulate.
 *
 * ───────────────────────────────────────────────────────── what is animated ──
 *
 * Only `transform: scale` and `opacity` — the two properties the compositor can
 * animate without touching layout or paint. Never width/height (layout on every
 * frame), never filter or box-shadow (paint on every frame). The glow is a separate
 * pre-painted radial-gradient layer that is *scaled*, which looks identical to an
 * animated blur and costs nothing.
 *
 * Depth comes from lag, not from more layers: the aura rings track the core through
 * springs of decreasing stiffness, so they arrive fractionally after it, the way
 * something soft and large moves behind something small and firm.
 *
 * ──────────────────────────────────────────────────────────── reduced motion ──
 *
 * `reduceMotion` (from settings, OR the OS `prefers-reduced-motion` query) swaps the
 * scale animation for a gentle opacity pulse on a fixed-size orb, keeping the exact
 * same phase timing so the breath guidance is unchanged. Vestibular safety without
 * losing the instrument.
 */

import { memo, useEffect, useRef } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useSpring,
  type MotionValue,
} from 'framer-motion';
import type { BreathPattern } from '../../lib/types';

// ──────────────────────────────────────────────────────────── phase geometry ──

export type BreathPhaseName = 'inhale' | 'holdIn' | 'exhale' | 'holdOut';

export interface BreathSegment {
  phase: BreathPhaseName;
  duration: number;
}

export interface BreathTick {
  phase: BreathPhaseName;
  /** index into the segment list */
  index: number;
  /** how many complete cycles have finished */
  cycle: number;
  elapsedInPhase: number;
  duration: number;
  remaining: number;
  /** 0..1 through the current phase */
  progress: number;
  /** changes exactly once per phase — the scheduling key */
  key: string;
}

export const PHASE_LABEL: Record<BreathPhaseName, string> = {
  inhale: 'Inhale',
  holdIn: 'Hold',
  exhale: 'Exhale',
  holdOut: 'Hold',
};

/** Sine-like ease. Breath accelerates and settles; it does not start abruptly. */
export const BREATH_EASE: [number, number, number, number] = [0.37, 0, 0.63, 1];

/** Zero-length phases are skipped, per the BreathPattern contract. */
export function breathSegments(pattern: BreathPattern): BreathSegment[] {
  const all: BreathSegment[] = [
    { phase: 'inhale', duration: pattern.inhale },
    { phase: 'holdIn', duration: pattern.holdIn },
    { phase: 'exhale', duration: pattern.exhale },
    { phase: 'holdOut', duration: pattern.holdOut },
  ];
  const kept = all.filter((s) => Number.isFinite(s.duration) && s.duration > 0);
  // A pattern with every phase zeroed would divide by zero below. Fall back to a
  // calm 4-4 rather than crashing the player mid-session.
  return kept.length > 0
    ? kept
    : [
        { phase: 'inhale', duration: 4 },
        { phase: 'exhale', duration: 4 },
      ];
}

/** Where in the breath cycle does second `t` fall? Pure; cheap enough to call often. */
export function phaseAt(segments: BreathSegment[], t: number): BreathTick {
  const cycleLength = segments.reduce((sum, s) => sum + s.duration, 0);
  const time = Math.max(0, t);
  const cycle = Math.floor(time / cycleLength);
  let rest = time - cycle * cycleLength;

  for (let i = 0; i < segments.length; i++) {
    const { phase, duration } = segments[i];
    if (rest < duration || i === segments.length - 1) {
      const elapsedInPhase = Math.min(Math.max(rest, 0), duration);
      return {
        phase,
        index: i,
        cycle,
        elapsedInPhase,
        duration,
        remaining: Math.max(0, duration - elapsedInPhase),
        progress: duration > 0 ? elapsedInPhase / duration : 1,
        key: `${cycle}:${i}`,
      };
    }
    rest -= duration;
  }

  // Unreachable: the loop always returns on its final iteration. Present so the
  // function is total for the type checker.
  const last = segments[segments.length - 1];
  return {
    phase: last.phase,
    index: segments.length - 1,
    cycle,
    elapsedInPhase: last.duration,
    duration: last.duration,
    remaining: 0,
    progress: 1,
    key: `${cycle}:${segments.length - 1}`,
  };
}

// ─────────────────────────────────────────────────────────── animation targets ──

const SCALE_IN = 1;
const SCALE_OUT = 0.6;
/** A breath hold is not frozen — the body still has tone. A ~1% drift reads as alive. */
const HOLD_DRIFT = 0.014;
/** Fixed size used in reduced-motion mode, where scale never changes. */
const SCALE_STILL = 0.86;

function scaleFor(phase: BreathPhaseName): number {
  switch (phase) {
    case 'inhale':
      return SCALE_IN;
    case 'holdIn':
      return SCALE_IN * (1 + HOLD_DRIFT);
    case 'exhale':
      return SCALE_OUT;
    case 'holdOut':
      return SCALE_OUT * (1 - HOLD_DRIFT);
  }
}

/** Luminosity rides slightly ahead of size: full at the top of the inhale. */
function glowFor(phase: BreathPhaseName): number {
  switch (phase) {
    case 'inhale':
      return 1;
    case 'holdIn':
      return 0.92;
    case 'exhale':
      return 0.4;
    case 'holdOut':
      return 0.34;
  }
}

/** In reduced-motion mode the same envelope is expressed as opacity alone. */
function fadeFor(phase: BreathPhaseName): number {
  switch (phase) {
    case 'inhale':
      return 1;
    case 'holdIn':
      return 0.96;
    case 'exhale':
      return 0.45;
    case 'holdOut':
      return 0.4;
  }
}

// ─────────────────────────────────────────────────────────────────── the orb ──

export interface BreathOrbProps {
  pattern: BreathPattern;
  /** Session seconds. Fractional is fine; only phase *boundaries* are acted on. */
  elapsed: number;
  paused?: boolean;
  reduceMotion?: boolean;
  /** Practice gradient stops. Omitted -> the theme accent. Never hardcode here. */
  colors?: [string, string];
  /** Sizing is the caller's job; the orb fills its square. */
  className?: string;
}

export function BreathOrb({
  pattern,
  elapsed,
  paused = false,
  reduceMotion = false,
  colors,
  className,
}: BreathOrbProps) {
  const segmentsRef = useRef<BreathSegment[]>([]);
  const patternKey = `${pattern.id}:${pattern.inhale}:${pattern.holdIn}:${pattern.exhale}:${pattern.holdOut}`;
  const lastPatternKey = useRef<string | null>(null);
  if (lastPatternKey.current !== patternKey) {
    lastPatternKey.current = patternKey;
    segmentsRef.current = breathSegments(pattern);
  }
  const segments = segmentsRef.current;

  const tick = phaseAt(segments, elapsed);

  // Everything visual hangs off these four values. React writes them once per
  // phase; the compositor reads them every frame.
  const core = useMotionValue(reduceMotion ? SCALE_STILL : SCALE_OUT);
  const glow = useMotionValue(0.4);
  const fade = useMotionValue(0.6);
  const ring = useMotionValue(0);

  const scheduledKey = useRef<string | null>(null);

  useEffect(() => {
    if (paused) {
      // The cleanup below has already stopped the animations, freezing them
      // mid-flight. Clearing the key makes the resume re-schedule from wherever
      // the orb actually is, over whatever is left of the phase.
      scheduledKey.current = null;
      return;
    }
    if (scheduledKey.current === tick.key) return;
    scheduledKey.current = tick.key;

    // Never zero: a 0s duration makes framer snap, which reads as a glitch when a
    // phase boundary is crossed a few ms late.
    const duration = Math.max(0.08, tick.remaining);
    const moving = tick.phase === 'inhale' || tick.phase === 'exhale';
    const ease = moving ? BREATH_EASE : 'linear';

    ring.set(tick.progress);
    const running = [
      animate(ring, 1, { duration, ease: 'linear' }),
      animate(glow, glowFor(tick.phase), { duration, ease }),
      reduceMotion
        ? animate(fade, fadeFor(tick.phase), { duration, ease })
        : animate(core, scaleFor(tick.phase), { duration, ease }),
    ];

    return () => running.forEach((a) => a.stop());
    // `tick` is recomputed on every render but only `tick.key` may retrigger the
    // schedule — the other fields are read as the freshest values at the boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick.key, paused, reduceMotion, core, fade, glow, ring]);

  // Reduced motion pins the geometry so only opacity moves.
  useEffect(() => {
    if (reduceMotion) core.set(SCALE_STILL);
    else fade.set(1);
  }, [reduceMotion, core, fade]);

  // The theme tokens are RGB *triplets* ("139 124 255") so they compose with
  // Tailwind's <alpha-value>; they are not colors until wrapped in rgb().
  const c1 = colors?.[0] ?? 'rgb(var(--accent))';
  const c2 = colors?.[1] ?? 'rgb(var(--accent-2))';
  const label = PHASE_LABEL[tick.phase];
  const countdown = Math.max(1, Math.ceil(tick.remaining));

  return (
    <div className={className}>
      <div className="relative grid aspect-square w-full place-items-center">
        <Glow scale={glow} c1={c1} c2={c2} reduceMotion={reduceMotion} />
        {!reduceMotion && <Aura scale={core} c1={c1} c2={c2} />}
        <Shimmer reduceMotion={reduceMotion} />
        <PhaseRing progress={ring} />
        <Core scale={core} fade={fade} c1={c1} c2={c2} />

        {/* The label sits above the orb in z, centred in its own layer so the two
            crossfading copies never shift each other. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <AnimatePresence initial={false}>
            <motion.div
              key={tick.key}
              className="absolute flex flex-col items-center gap-1"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              aria-hidden
            >
              <span className="text-[clamp(1rem,3.4vw,1.35rem)] font-light tracking-[0.34em] text-fg uppercase drop-shadow">
                {label}
              </span>
              <span className="text-xs font-light tabular-nums tracking-[0.2em] text-fg-muted">
                {countdown}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Announced to assistive tech on change only — the visible label is aria-hidden
          because its crossfade would otherwise be read twice. */}
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── the layers ──
// Each layer is memoized and reads MotionValues directly, so the 10 Hz clock
// re-render of the parent never reaches them. They render once and then live
// entirely on the compositor.

const Core = memo(function Core({
  scale,
  fade,
  c1,
  c2,
}: {
  scale: MotionValue<number>;
  fade: MotionValue<number>;
  c1: string;
  c2: string;
}) {
  return (
    <motion.div
      className="absolute h-[62%] w-[62%] rounded-full"
      style={{
        scale,
        opacity: fade,
        // A specular highlight offset up-left reads as a lit sphere rather than a
        // flat disc. color-mix keeps this theme-aware without a single literal hex.
        background: `radial-gradient(circle at 34% 28%,
          color-mix(in oklab, ${c1} 74%, white) 0%,
          ${c1} 38%,
          ${c2} 74%,
          color-mix(in oklab, ${c2} 68%, transparent) 100%)`,
        willChange: 'transform, opacity',
      }}
      aria-hidden
    />
  );
});

/**
 * Three rings tracking the core through progressively softer springs. The lag is
 * the whole point — it is what makes the orb feel like it displaces something.
 */
const Aura = memo(function Aura({
  scale,
  c1,
  c2,
}: {
  scale: MotionValue<number>;
  c1: string;
  c2: string;
}) {
  const r1 = useSpring(scale, { stiffness: 46, damping: 20, mass: 1 });
  const r2 = useSpring(scale, { stiffness: 30, damping: 22, mass: 1.2 });
  const r3 = useSpring(scale, { stiffness: 19, damping: 24, mass: 1.5 });

  return (
    <>
      {[
        { s: r1, size: 72, alpha: 26, width: 1.25 },
        { s: r2, size: 84, alpha: 16, width: 1 },
        { s: r3, size: 97, alpha: 9, width: 1 },
      ].map(({ s, size, alpha, width }, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            scale: s,
            height: `${size}%`,
            width: `${size}%`,
            border: `${width}px solid color-mix(in oklab, ${i === 2 ? c2 : c1} ${alpha}%, transparent)`,
            willChange: 'transform',
          }}
          aria-hidden
        />
      ))}
    </>
  );
});

/**
 * The bloom. A pre-painted gradient that is *scaled* — visually indistinguishable
 * from an animated blur radius, but composited instead of repainted every frame.
 */
const Glow = memo(function Glow({
  scale,
  c1,
  c2,
  reduceMotion,
}: {
  scale: MotionValue<number>;
  c1: string;
  c2: string;
  reduceMotion: boolean;
}) {
  const spread = useSpring(scale, { stiffness: 24, damping: 26 });
  return (
    <motion.div
      className="absolute h-full w-full rounded-full"
      style={{
        scale: reduceMotion ? 1 : spread,
        opacity: scale,
        background: `radial-gradient(circle,
          color-mix(in oklab, ${c1} 34%, transparent) 0%,
          color-mix(in oklab, ${c2} 16%, transparent) 42%,
          transparent 68%)`,
        willChange: 'transform, opacity',
      }}
      aria-hidden
    />
  );
});

// Deterministic placement on the golden angle: even coverage, no clumping, and no
// Math.random() (which would resample on every render and jitter the field).
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i * 137.508 * Math.PI) / 180;
  const radius = 30 + (((i * 41) % 100) / 100) * 24;
  return {
    left: 50 + Math.cos(angle) * radius,
    top: 50 + Math.sin(angle) * radius,
    size: 1.5 + (i % 3) * 0.9,
    delay: (i % 9) * 0.7,
    duration: 5 + (i % 5),
  };
});

/**
 * Slow drift of the whole field (one composited rotation) plus an independent
 * twinkle per mote. Infinite declarative animations: started once, never
 * re-scheduled by a parent render.
 */
const Shimmer = memo(function Shimmer({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) return null;
  return (
    <motion.div
      className="pointer-events-none absolute h-full w-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 150, ease: 'linear', repeat: Infinity }}
      aria-hidden
    >
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-fg"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            height: p.size,
            width: p.size,
            willChange: 'transform, opacity',
          }}
          initial={{ opacity: 0.06, scale: 0.7 }}
          animate={{ opacity: [0.06, 0.42, 0.06], scale: [0.7, 1.25, 0.7] }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
        />
      ))}
    </motion.div>
  );
});

/**
 * Progress through the *current phase*, not the session. Rotated so it fills from
 * twelve o'clock. `pathLength` is a single stroke-dash write per frame on one thin
 * circle — cheap enough to be the one non-composited property here.
 */
const PhaseRing = memo(function PhaseRing({ progress }: { progress: MotionValue<number> }) {
  return (
    <svg
      className="absolute h-[92%] w-[92%] -rotate-90"
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r="48"
        stroke="currentColor"
        strokeWidth="0.5"
        className="text-fg-muted opacity-20"
      />
      <motion.circle
        cx="50"
        cy="50"
        r="48"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        className="text-accent"
        style={{ pathLength: progress }}
      />
    </svg>
  );
});

export default BreathOrb;
