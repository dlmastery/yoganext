/**
 * Sheet — a bottom sheet on mobile, a centred modal on desktop.
 *
 * Accessibility is the whole point of having this as a primitive rather than a
 * div-with-position-fixed in four screens: one implementation gets the dialog
 * role, the labelled title, Escape-to-close, body scroll lock, focus-on-open and
 * focus-return-on-close right, and every caller inherits it.
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** optional sub-line under the title */
  description?: string;
  children: ReactNode;
  /** hide the visible title but keep it for assistive tech */
  hideTitle?: boolean;
}

export function Sheet({ open, onClose, title, description, children, hideTitle }: SheetProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    // Give the panel focus so Tab starts inside the dialog, not behind it.
    const t = window.setTimeout(() => panelRef.current?.focus(), 30);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      returnFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            className="glass-strong relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl p-6 outline-none sm:max-w-lg sm:rounded-3xl"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15 sm:hidden"
            />
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className={hideTitle ? 'sr-only' : ''}>
                <h2 id={titleId} className="text-lg font-semibold text-fg">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1 text-sm text-fg-muted">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-white/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
