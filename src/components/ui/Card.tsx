/**
 * Card — the surface primitive.
 *
 * Two variants, deliberately: `Card` is a passive surface (a div), `CardButton`
 * is a pressable one (a real <button>, so it is focusable, Enter/Space activated
 * and announced correctly). We do NOT put onClick on a div — a card you can tap
 * is a button, and pretending otherwise breaks every keyboard user.
 */
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

export type CardTone = 'glass' | 'strong' | 'bare';

const toneClass: Record<CardTone, string> = {
  glass: 'glass',
  strong: 'glass-strong',
  bare: 'bg-bg-elev border border-white/5',
};

const padClass = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6 sm:p-7',
} as const;

export interface CardBaseProps {
  tone?: CardTone;
  pad?: keyof typeof padClass;
  className?: string;
  children?: ReactNode;
}

export type CardProps = CardBaseProps & Omit<HTMLMotionProps<'div'>, 'children' | 'className'>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'glass', pad = 'md', className, children, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={clsx('rounded-3xl', toneClass[tone], padClass[pad], className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
});

export type CardButtonProps = CardBaseProps & {
  /** renders a soft glow ring when true — used for the "chosen for you" card */
  featured?: boolean;
} & Omit<HTMLMotionProps<'button'>, 'children' | 'className' | 'ref'>;

/**
 * A card you can press. Lifts on hover, settles on press — the depth cue is what
 * makes a flat surface feel touchable.
 */
export const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(function CardButton(
  { tone = 'glass', pad = 'md', featured = false, className, children, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      whileHover={{ y: -4, scale: 1.012 }}
      whileTap={{ y: -1, scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={clsx(
        'group relative w-full rounded-3xl text-left',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] transition-shadow duration-300',
        'hover:shadow-[0_18px_50px_-24px_rgba(0,0,0,0.85)]',
        toneClass[tone],
        padClass[pad],
        featured && 'ring-1 ring-white/10',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
});

/** Small uppercase section label. Used above every group on every screen. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={clsx(
        'text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-muted',
        className,
      )}
    >
      {children}
    </h2>
  );
}
