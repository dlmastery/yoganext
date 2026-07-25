/**
 * Stat — one number with its unit and meaning.
 *
 * The `n` prop is not decoration. This app draws conclusions from a user's own
 * small dataset, and a figure computed from four sessions must not look like a
 * figure computed from four hundred. Anything derived shows how much it rests on.
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

export function Stat({ label, value, unit, hint, icon, className }: StatProps) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5 text-fg-muted">
        {icon && (
          <span aria-hidden="true" className="opacity-70">
            {icon}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums leading-none text-fg">{value}</span>
        {unit && <span className="text-sm text-fg-muted">{unit}</span>}
      </div>
      {hint && <p className="text-xs leading-snug text-fg-muted">{hint}</p>}
    </div>
  );
}

export type Confidence = 'low' | 'medium' | 'high';

/**
 * Two sets of tints, not one. The `-200` shades read beautifully on the three
 * dark palettes and are almost invisible on the light `sand` one — and this is
 * the badge that qualifies every claim the app makes about a person's own
 * wellbeing, so "hard to read in one theme" is not an acceptable failure mode.
 * Base = light theme; `dark:` = the three dark palettes (see tailwind darkMode).
 */
const confidenceStyle: Record<Confidence, string> = {
  low: 'border-amber-700/30 bg-amber-500/15 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200/90',
  medium:
    'border-sky-700/30 bg-sky-500/15 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200/90',
  high: 'border-emerald-700/30 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200/90',
};

const confidenceTitle: Record<Confidence, string> = {
  low: 'Low confidence — based on very little data so far. Treat as a hunch, not a fact.',
  medium: 'Medium confidence — a pattern is forming, but it could still shift.',
  high: 'High confidence — consistent across enough of your own sessions.',
};

/**
 * The badge every insight must carry. `summarize()` may express confidence as a
 * word or a 0..1 number; both are accepted and normalised here so the UI cannot
 * accidentally render an unqualified claim.
 */
export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: Confidence | number | string | undefined;
  className?: string;
}) {
  const level = normaliseConfidence(confidence);
  return (
    <span
      title={confidenceTitle[level]}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[10px] font-semibold uppercase tracking-[0.12em]',
        confidenceStyle[level],
        className,
      )}
    >
      <span className="sr-only">Confidence: </span>
      {level}
    </span>
  );
}

export function normaliseConfidence(c: Confidence | number | string | undefined): Confidence {
  if (typeof c === 'number') return c >= 0.75 ? 'high' : c >= 0.45 ? 'medium' : 'low';
  if (c === 'high' || c === 'medium' || c === 'low') return c;
  // Unknown or missing confidence is treated as LOW on purpose: an observation we
  // cannot qualify is the one we should be most careful about showing.
  return 'low';
}
