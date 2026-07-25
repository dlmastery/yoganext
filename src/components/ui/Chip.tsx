/**
 * Chip — a filter toggle.
 *
 * Rendered as a real button with `aria-pressed`, so a screen reader announces
 * "Breathwork, toggle button, pressed" rather than leaving the user to infer
 * selection from colour alone. The selected pill is a shared-layout element:
 * pass the same `groupId` to every chip in a row and the highlight *slides*
 * between them instead of blinking.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

export interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  /** shared layoutId namespace so the active pill animates across the row */
  groupId?: string;
  className?: string;
  /** optional leading dot colour, e.g. a practice-kind hue */
  dot?: string;
}

export function Chip({ selected, onClick, children, groupId, className, dot }: ChipProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={clsx(
        'relative isolate inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2',
        'text-sm font-medium transition-colors duration-200',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        selected ? 'text-bg' : 'text-fg-muted hover:text-fg',
        className,
      )}
    >
      {selected && groupId && (
        <motion.span
          layoutId={`chip-${groupId}`}
          className="absolute inset-0 -z-10 rounded-full bg-fg"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      )}
      {selected && !groupId && <span className="absolute inset-0 -z-10 rounded-full bg-fg" />}
      {!selected && (
        <span className="absolute inset-0 -z-10 rounded-full border border-white/10 bg-white/[0.03]" />
      )}
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: dot, opacity: selected ? 0.55 : 1 }}
        />
      )}
      {children}
    </motion.button>
  );
}

/** A horizontally scrollable, keyboard-reachable row of chips. */
export function ChipRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'flex gap-2 overflow-x-auto pb-1',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}
