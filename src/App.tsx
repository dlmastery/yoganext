/**
 * App — the shell.
 *
 * Responsibilities, and nothing else: paint the atmosphere, route between the
 * four views, hand the running session the whole screen, and keep the coach one
 * tap away. No domain logic lives here — every action this shell can reach is a
 * store action, which is also an agent tool.
 *
 * Navigation is a real ARIA tablist with roving focus and arrow-key movement.
 * A bottom bar on phones, a left rail from `sm` up: the same tablist, laid out
 * twice, so there is exactly one source of truth for which view is showing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Activity, CircleUser, Flower2, MessageCircleHeart, Sun, X } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { useStore } from './lib/store';
import Today from './screens/Today';
import Practice from './screens/Practice';
import Progress from './screens/Progress';
import You from './screens/You';
import { SessionPlayer } from './components/player/SessionPlayer';
import AgentConsole from './components/AgentConsole';

type ViewId = 'today' | 'practice' | 'progress' | 'you';

const VIEWS: Array<{ id: ViewId; label: string; icon: (p: LucideProps) => JSX.Element }> = [
  { id: 'today', label: 'Today', icon: Sun as (p: LucideProps) => JSX.Element },
  { id: 'practice', label: 'Practice', icon: Flower2 as (p: LucideProps) => JSX.Element },
  { id: 'progress', label: 'Progress', icon: Activity as (p: LucideProps) => JSX.Element },
  { id: 'you', label: 'You', icon: CircleUser as (p: LucideProps) => JSX.Element },
];

// ───────────────────────────────────────────────────────────────── background ──

/**
 * The aurora. Three slow blurred fields plus a vignette — cheap (no canvas, no
 * rAF) and it reads as *weather* rather than decoration. Frozen entirely when
 * the user has asked for reduced motion.
 */
function Aurora({ still }: { still: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-bg" />
      <div
        className={[
          'absolute -left-[18vw] -top-[22vh] h-[62vh] w-[62vh] rounded-full blur-[110px]',
          still ? '' : 'animate-float',
        ].join(' ')}
        style={{
          background:
            'radial-gradient(circle at 35% 35%, var(--accent, #6d5efc) 0%, transparent 68%)',
          opacity: 0.38,
        }}
      />
      <div
        className={[
          'absolute -right-[16vw] top-[8vh] h-[54vh] w-[54vh] rounded-full blur-[120px]',
          still ? '' : 'animate-breathe',
        ].join(' ')}
        style={{
          background:
            'radial-gradient(circle at 60% 40%, var(--accent-2, #22d3ee) 0%, transparent 66%)',
          opacity: 0.3,
        }}
      />
      <div
        className={[
          'absolute bottom-[-24vh] left-[22vw] h-[58vh] w-[58vh] rounded-full blur-[130px]',
          still ? '' : 'animate-float',
        ].join(' ')}
        style={{
          background:
            'radial-gradient(circle at 50% 50%, var(--accent, #6d5efc) 0%, transparent 70%)',
          opacity: 0.22,
          animationDelay: '-6s',
        }}
      />
      {/* vignette keeps text legible over the brightest part of the field */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_25%,rgba(0,0,0,0.45)_100%)]" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────── tab bar ──

function Tabs({
  view,
  setView,
  orientation,
}: {
  view: ViewId;
  setView: (v: ViewId) => void;
  orientation: 'horizontal' | 'vertical';
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const vertical = orientation === 'vertical';

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
      const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
      const i = VIEWS.findIndex((v) => v.id === view);
      let j = -1;
      if (e.key === nextKey) j = (i + 1) % VIEWS.length;
      else if (e.key === prevKey) j = (i - 1 + VIEWS.length) % VIEWS.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = VIEWS.length - 1;
      if (j >= 0) {
        e.preventDefault();
        setView(VIEWS[j].id);
        refs.current[j]?.focus();
      }
    },
    [view, setView, vertical],
  );

  return (
    <div
      role="tablist"
      aria-label="Main sections"
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={vertical ? 'flex flex-col gap-1.5' : 'flex items-stretch justify-around gap-1'}
    >
      {VIEWS.map((v, i) => {
        const Icon = v.icon;
        const active = view === v.id;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={active}
            aria-controls="view-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => setView(v.id)}
            className={[
              'group relative isolate flex items-center rounded-2xl transition-colors duration-200',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              vertical ? 'gap-3 px-4 py-3' : 'flex-1 flex-col justify-center gap-1 px-2 py-2.5',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {active && (
              <motion.span
                layoutId={`tab-pill-${orientation}`}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-2xl bg-white/[0.08] ring-1 ring-white/10"
                transition={{ type: 'spring', stiffness: 480, damping: 38 }}
              />
            )}
            <motion.span
              aria-hidden="true"
              animate={{ scale: active ? 1.06 : 1, y: active && !vertical ? -1 : 0 }}
              transition={{ type: 'spring', stiffness: 460, damping: 26 }}
            >
              <Icon size={vertical ? 18 : 20} />
            </motion.span>
            <span
              className={
                vertical ? 'text-sm font-medium' : 'text-[10px] font-semibold tracking-wide'
              }
            >
              {v.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────── app ──

const SCREENS: Record<ViewId, () => JSX.Element> = {
  today: Today,
  practice: Practice,
  progress: Progress,
  you: You,
};

export default function App() {
  const [view, setView] = useState<ViewId>('today');
  const [coachOpen, setCoachOpen] = useState(false);
  /**
   * The store has no `cancelSession` by design — the only way out of an active
   * session is to complete it. So "leave the player" cannot mean "end the
   * session"; it means park it and hand the screen back. That is shell state,
   * and it must reset whenever a *new* session begins.
   */
  const [playerParked, setPlayerParked] = useState(false);

  const active = useStore((s) => s.active);
  const resumeSession = useStore((s) => s.resumeSession);
  const settings = useStore((s) => s.settings);
  const reduceMotion = Boolean(settings?.reduceMotion);

  const startedAt = active?.startedAt;
  useEffect(() => {
    if (startedAt) setPlayerParked(false);
  }, [startedAt]);

  // The palette lives in CSS; the shell only says which one is on.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings?.theme ?? 'aurora';
    root.dataset.reduceMotion = reduceMotion ? 'true' : 'false';
  }, [settings?.theme, reduceMotion]);

  const Screen = SCREENS[view];

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className="relative min-h-dvh text-fg antialiased">
        <Aurora still={reduceMotion} />

        <a
          href="#view-panel"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg"
        >
          Skip to content
        </a>

        {/* Desktop rail */}
        <aside className="fixed left-0 top-0 z-30 hidden h-dvh w-56 flex-col justify-between px-4 py-8 sm:flex">
          <div className="flex flex-col gap-8">
            <div className="px-2">
              <p className="text-lg font-semibold tracking-tight">
                <span className="text-gradient">yoganext</span>
              </p>
              <p className="mt-0.5 text-[11px] text-fg-muted">a quieter hour</p>
            </div>
            <nav aria-label="Main">
              <Tabs view={view} setView={setView} orientation="vertical" />
            </nav>
          </div>
          <button
            type="button"
            onClick={() => setCoachOpen(true)}
            className="flex items-center gap-2.5 rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-fg transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageCircleHeart size={17} aria-hidden="true" className="text-accent" />
            Ask your coach
          </button>
        </aside>

        {/* Content */}
        <main
          id="view-panel"
          role="tabpanel"
          aria-labelledby={`tab-${view}`}
          tabIndex={-1}
          className="relative pb-28 sm:ml-56 sm:pb-12"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <Screen />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom bar */}
        <nav
          aria-label="Main"
          className="glass-strong fixed inset-x-0 bottom-0 z-30 border-t border-white/5 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 sm:hidden"
        >
          <Tabs view={view} setView={setView} orientation="horizontal" />
        </nav>

        {/* Coach FAB (mobile; the rail has its own button) */}
        <motion.button
          type="button"
          onClick={() => setCoachOpen((o) => !o)}
          aria-expanded={coachOpen}
          aria-label={coachOpen ? 'Close your coach' : 'Ask your coach'}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.93 }}
          transition={{ type: 'spring', stiffness: 480, damping: 26 }}
          className="glass-strong fixed bottom-24 right-5 z-40 grid h-14 w-14 place-items-center rounded-full shadow-lg shadow-black/30 ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={coachOpen ? 'x' : 'coach'}
              initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
              transition={{ duration: 0.16 }}
            >
              {coachOpen ? (
                <X size={22} aria-hidden="true" />
              ) : (
                <MessageCircleHeart size={22} aria-hidden="true" className="text-accent" />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>

        <AgentConsole open={coachOpen} onClose={() => setCoachOpen(false)} />

        {/* A parked session must stay findable — otherwise it is silently lost. */}
        <AnimatePresence>
          {active && playerParked && (
            <motion.div
              key="parked"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="fixed inset-x-0 bottom-[5.5rem] z-40 flex justify-center px-5 pr-24 sm:bottom-6 sm:pl-56 sm:pr-5"
            >
              <button
                type="button"
                onClick={() => {
                  setPlayerParked(false);
                  resumeSession();
                }}
                className="glass-strong inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm font-medium text-fg shadow-lg shadow-black/30 ring-1 ring-white/10 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="animate-breathe h-2 w-2 rounded-full bg-accent"
                />
                Session paused — resume
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* A running session owns the screen. */}
        <AnimatePresence>
          {active && !playerParked && (
            <SessionPlayer key="player" onExit={() => setPlayerParked(true)} />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
