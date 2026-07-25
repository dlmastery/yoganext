/**
 * Ring — an SVG progress ring.
 *
 * Hand-rolled rather than pulled from a chart library: it is 40 lines, it
 * inherits our gradient tokens, and it animates the stroke offset with a spring
 * so progress *arrives* rather than snapping.
 *
 * The ring is `role="img"` with an explicit label. A ring with no text
 * alternative is decoration; a ring that encodes progress must say so.
 */
import { useId } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

export interface RingProps {
  /** 0..1, clamped */
  value: number;
  size?: number;
  stroke?: number;
  from?: string;
  to?: string;
  /** accessible description, e.g. "7 of 10 minutes practised today" */
  label: string;
  children?: ReactNode;
  className?: string;
  /** dim the track further for locked/inactive states */
  muted?: boolean;
}

export function Ring({
  value,
  size = 132,
  stroke = 10,
  // Fall back through the token chain so the ring still renders if a palette
  // omits the secondary accent.
  from = 'var(--accent, #8b5cf6)',
  to = 'var(--accent-2, var(--accent, #22d3ee))',
  label,
  children,
  className,
  muted = false,
}: RingProps) {
  const id = useId();
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      className={clsx('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="-rotate-90"
      >
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className={muted ? 'text-white/[0.04]' : 'text-white/[0.08]'}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: 'spring', stiffness: 60, damping: 18, delay: 0.12 }}
        />
      </svg>
      {children != null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
