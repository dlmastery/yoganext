/**
 * SessionPlayer — the full-screen practice surface.
 *
 * Composition, not logic: this file owns no domain rules. It reads the active
 * session from the store, renders the right instrument for the practice kind
 * (BreathOrb for anything with a breath pattern, PoseSequencer for yoga), and calls
 * back into the store's tools. Everything a user can do here is reachable through
 * the agent tool surface — pause, resume, complete, and the mood/note that
 * `complete_session` accepts — which is the constraint `contract.ts` sets.
 *
 * Three details that carry the feel:
 *
 *   Ambient background. The wash behind the orb shifts with the breath: gradient
 *   layers are pre-painted and only their opacity and scale are animated, so the
 *   room appears to brighten on the inhale without a single per-frame repaint.
 *
 *   The guided line. Scripts are `[secondsFromStart, line]`, so the current line is
 *   the last entry at or before now. It crossfades rather than swapping, because a
 *   hard cut pulls attention exactly when the practice is asking you to soften it.
 *
 *   Ending. Sessions end into a mood check-in, not into a dismissal. The score is
 *   what powers `get_insights`, and it is the one moment the user has a real answer.
 *   It stays optional — "Just finish" completes without a score rather than holding
 *   the session hostage.
 *
 * Keyboard: space toggles pause, escape leaves (or backs out of the check-in).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Angry, Check, Frown, Laugh, Meh, Pause, Play, Plus, Smile, Volume2, VolumeX, X } from 'lucide-react';
import clsx from 'clsx';
import type { ActiveSession, MoodScore, Practice, Settings } from '../../lib/types';
import { useStore } from '../../lib/store';
import { BREATH_EASE, BreathOrb, breathSegments, phaseAt } from './BreathOrb';
import { PoseSequencer } from './PoseSequencer';
import { Soundscape } from './Soundscape';
import { formatClock, spokenClock, useSessionTimer } from './useSessionTimer';

export interface SessionPlayerProps {
  /** Called when the user leaves the player. The session is paused, not discarded. */
  onExit?: () => void;
}

export function SessionPlayer({ onExit }: SessionPlayerProps) {
  // The only store coupling in this file. If the store's shape moves, it moves here.
  const active = useStore((s) => s.active);
  const practices = useStore((s) => s.practices);
  const settings = useStore((s) => s.settings);
  const pauseSession = useStore((s) => s.pauseSession);
  const resumeSession = useStore((s) => s.resumeSession);
  const completeSession = useStore((s) => s.completeSession);
  const tick = useStore((s) => s.tick);

  const practice = active ? practices.find((p) => p.id === active.practiceId) : undefined;
  if (!active || !practice) return null;

  return (
    <PlayerStage
      // Remounting on a new session resets the clock, the bonus time and the
      // check-in in one move, instead of six reset effects.
      key={active.startedAt}
      active={active}
      practice={practice}
      settings={settings}
      onPause={pauseSession}
      onResume={resumeSession}
      onComplete={completeSession}
      onTick={tick}
      onExit={onExit}
    />
  );
}

interface PlayerStageProps {
  active: ActiveSession;
  practice: Practice;
  settings: Settings;
  onPause: () => void;
  onResume: () => void;
  onComplete: (moodAfter?: MoodScore, note?: string) => void;
  onTick: (seconds: number) => void;
  onExit?: () => void;
}

function PlayerStage({
  active,
  practice,
  settings,
  onPause,
  onResume,
  onComplete,
  onTick,
  onExit,
}: PlayerStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bonusSeconds, setBonusSeconds] = useState(0);
  const [checkIn, setCheckIn] = useState(false);
  const [muted, setMuted] = useState(false);

  const reduceMotion = settings.reduceMotion;
  const paused = active.paused;

  const { elapsed } = useSessionTimer({
    running: true,
    paused: paused || checkIn,
    initialElapsed: active.elapsed,
    onTick,
  });

  const total = practice.minutes * 60 + bonusSeconds;
  const remaining = Math.max(0, total - elapsed);
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  // Breath phase drives the ambience even when the orb is not the instrument, so a
  // yoga session still has a pulse. Falls back to a slow neutral cycle.
  const segments = useMemo(
    () => (practice.breath ? breathSegments(practice.breath) : null),
    [practice.breath],
  );
  const breath = segments ? phaseAt(segments, elapsed) : null;
  const inhaling = breath ? breath.phase === 'inhale' || breath.phase === 'holdIn' : false;

  const scriptLine = useMemo(() => {
    const script = practice.script;
    if (!script || script.length === 0) return null;
    let best: string | null = null;
    let bestAt = -1;
    for (const [at, line] of script) {
      if (at <= elapsed && at > bestAt) {
        bestAt = at;
        best = line;
      }
    }
    return best === null ? null : { at: bestAt, line: best };
    // Re-resolved once a second; sub-second precision would be meaningless here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.script, Math.floor(elapsed)]);

  const togglePlay = useCallback(() => {
    if (paused) onResume();
    else onPause();
  }, [paused, onPause, onResume]);

  const openCheckIn = useCallback(() => {
    if (!paused) onPause();
    setCheckIn(true);
  }, [paused, onPause]);

  /**
   * Leaving. The store has no `cancelSession` by design — the only exit from an
   * active session is `completeSession`, so a practice can never be silently
   * discarded. Escape therefore parks the session and offers the check-in, which
   * already carries both doors ("Keep going" and "Just finish"). A host that owns
   * its own routing can pass `onExit` and take over.
   */
  const handleExit = useCallback(() => {
    if (!paused) onPause();
    if (onExit) onExit();
    else setCheckIn(true);
  }, [paused, onPause, onExit]);

  const finish = useCallback(
    (moodAfter?: MoodScore, note?: string) => {
      onComplete(moodAfter, note);
      onExit?.();
    },
    [onComplete, onExit],
  );

  // Running past the nominal length opens the check-in rather than stopping dead.
  const overrun = elapsed >= total;
  useEffect(() => {
    if (overrun && !checkIn) openCheckIn();
  }, [overrun, checkIn, openCheckIn]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (typing) {
        if (event.key === 'Escape') target.blur();
        return;
      }

      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'k') {
        if (checkIn) return;
        event.preventDefault(); // space would otherwise scroll the page under us
        togglePlay();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (checkIn) setCheckIn(false);
        else handleExit();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkIn, togglePlay, handleExit]);

  const [c1, c2] = practice.gradient;
  const soundOn = !muted && settings.soundscape !== 'none';

  return (
    // A motion root so the host's <AnimatePresence> can play us out; the player
    // dissolves rather than being cut, which matters most at the end of a session.
    <motion.div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${practice.title} — practice player`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-fg focus:outline-none"
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.01 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <Ambience c1={c1} c2={c2} inhaling={inhaling} reduceMotion={reduceMotion} paused={paused} />

      <Soundscape kind={settings.soundscape} active={soundOn && !paused} />

      {/* ── chrome ─────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-start justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
        <IconButton label="Leave practice (Escape)" onClick={handleExit}>
          <X className="h-4 w-4" aria-hidden />
        </IconButton>

        <div className="flex min-w-0 flex-col items-center text-center">
          <h1 className="truncate text-sm font-light tracking-[0.22em] text-fg uppercase">
            {practice.title}
          </h1>
          <p className="truncate text-xs font-light text-fg-muted">{practice.subtitle}</p>
        </div>

        <IconButton
          label={soundOn ? 'Mute ambience' : 'Unmute ambience'}
          onClick={() => setMuted((m) => !m)}
          disabled={settings.soundscape === 'none'}
          pressed={soundOn}
        >
          {soundOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
        </IconButton>
      </header>

      {/* ── stage ──────────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-6 py-4">
        <div className="w-[min(78vw,46vh,380px)]">
          {practice.poses && practice.poses.length > 0 ? (
            <PoseSequencer
              poses={practice.poses}
              elapsed={elapsed}
              reduceMotion={reduceMotion}
              colors={practice.gradient}
              onExtend={(seconds) => setBonusSeconds((b) => b + seconds)}
            />
          ) : practice.breath ? (
            <BreathOrb
              pattern={practice.breath}
              elapsed={elapsed}
              paused={paused}
              reduceMotion={reduceMotion}
              colors={practice.gradient}
            />
          ) : (
            <StillPoint c1={c1} c2={c2} reduceMotion={reduceMotion} paused={paused} />
          )}
        </div>

        {/* The guided line lives in a fixed-height well so a two-line script entry
            never nudges the orb. */}
        <div className="flex h-16 w-full max-w-md items-start justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {scriptLine && (
              <motion.p
                key={scriptLine.at}
                className="text-balance text-center text-[0.95rem] font-light leading-relaxed text-fg-muted"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              >
                {scriptLine.line}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── transport ──────────────────────────────────────────────────────── */}
      <footer className="relative z-10 flex flex-col items-center gap-5 px-6 pb-8 sm:pb-10">
        <div className="flex w-full max-w-xs items-baseline justify-between text-xs font-light tabular-nums tracking-[0.18em] text-fg-muted">
          <span aria-label={`${spokenClock(elapsed)} elapsed`}>{formatClock(elapsed)}</span>
          <span aria-label={`${spokenClock(remaining)} remaining`}>−{formatClock(remaining)}</span>
        </div>

        <div className="flex items-center gap-6">
          <TextButton
            label={`Add one minute. ${spokenClock(remaining + 60)} would remain.`}
            onClick={() => setBonusSeconds((b) => b + 60)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            1 min
          </TextButton>

          <PlayControl paused={paused} progress={progress} onClick={togglePlay} />

          <TextButton label="Finish practice and check in" onClick={openCheckIn}>
            <Check className="h-3.5 w-3.5" aria-hidden />
            Finish
          </TextButton>
        </div>

        <p className="hidden text-[0.65rem] font-light tracking-[0.16em] text-fg-muted uppercase opacity-50 sm:block">
          Space to {paused ? 'resume' : 'pause'} · Esc to leave
        </p>
      </footer>

      <AnimatePresence>
        {checkIn && (
          <MoodCheckIn
            minutes={Math.round(elapsed / 60)}
            reduceMotion={reduceMotion}
            onDismiss={() => setCheckIn(false)}
            onFinish={finish}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────── ambience ──

/**
 * Two pre-painted gradient layers whose opacity and scale are crossfaded on the
 * breath. Animating `background` itself is not interpolatable and animating a blur
 * repaints the whole viewport every frame; this reads the same and costs nothing.
 */
const Ambience = memo(function Ambience({
  c1,
  c2,
  inhaling,
  reduceMotion,
  paused,
}: {
  c1: string;
  c2: string;
  inhaling: boolean;
  reduceMotion: boolean;
  paused: boolean;
}) {
  const lift = paused ? 0.18 : inhaling ? 0.5 : 0.22;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 50% 8%,
            color-mix(in oklab, ${c1} 40%, transparent) 0%,
            transparent 62%)`,
          willChange: 'transform, opacity',
        }}
        animate={{ opacity: lift, scale: reduceMotion ? 1 : inhaling ? 1.06 : 1 }}
        transition={{ duration: 3.2, ease: BREATH_EASE }}
      />
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(110% 80% at 50% 104%,
            color-mix(in oklab, ${c2} 34%, transparent) 0%,
            transparent 58%)`,
          willChange: 'opacity',
        }}
        animate={{ opacity: paused ? 0.14 : inhaling ? 0.24 : 0.4 }}
        transition={{ duration: 3.2, ease: BREATH_EASE }}
      />
    </div>
  );
});

/** For practices with neither breath pattern nor poses: a slow, silent pulse. */
const StillPoint = memo(function StillPoint({
  c1,
  c2,
  reduceMotion,
  paused,
}: {
  c1: string;
  c2: string;
  reduceMotion: boolean;
  paused: boolean;
}) {
  return (
    <div className="grid aspect-square w-full place-items-center">
      <motion.div
        className="h-[58%] w-[58%] rounded-full"
        style={{
          background: `radial-gradient(circle at 34% 28%,
            color-mix(in oklab, ${c1} 74%, white) 0%,
            ${c1} 40%,
            ${c2} 78%,
            color-mix(in oklab, ${c2} 60%, transparent) 100%)`,
          willChange: 'transform, opacity',
        }}
        animate={
          paused || reduceMotion
            ? { scale: 0.92, opacity: 0.7 }
            : { scale: [0.9, 1, 0.9], opacity: [0.65, 1, 0.65] }
        }
        transition={
          paused || reduceMotion
            ? { duration: 0.8, ease: 'easeOut' }
            : { duration: 11, ease: 'easeInOut', repeat: Infinity }
        }
        aria-hidden
      />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────── controls ──

const PlayControl = memo(function PlayControl({
  paused,
  progress,
  onClick,
}: {
  paused: boolean;
  progress: number;
  onClick: () => void;
}) {
  return (
    <div className="relative grid h-20 w-20 place-items-center">
      <svg className="absolute h-full w-full -rotate-90" viewBox="0 0 100 100" fill="none" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-fg-muted opacity-20"
        />
        <motion.circle
          cx="50"
          cy="50"
          r="46"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-accent"
          initial={false}
          animate={{ pathLength: progress }}
          transition={{ duration: 0.14, ease: 'linear' }}
        />
      </svg>
      <button
        type="button"
        onClick={onClick}
        aria-label={paused ? 'Resume practice (Space)' : 'Pause practice (Space)'}
        aria-pressed={paused}
        className="glass grid h-14 w-14 place-items-center rounded-full text-fg transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {paused ? (
          <Play className="h-5 w-5 translate-x-[1px]" aria-hidden />
        ) : (
          <Pause className="h-5 w-5" aria-hidden />
        )}
      </button>
    </div>
  );
});

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className="glass grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:text-fg disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function TextButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-light tracking-[0.14em] text-fg-muted uppercase transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────── mood check-in ──

const MOODS: Array<{ score: MoodScore; label: string; Icon: typeof Smile }> = [
  { score: 1, label: 'Rough', Icon: Angry },
  { score: 2, label: 'Low', Icon: Frown },
  { score: 3, label: 'Okay', Icon: Meh },
  { score: 4, label: 'Good', Icon: Smile },
  { score: 5, label: 'Wonderful', Icon: Laugh },
];

function MoodCheckIn({
  minutes,
  reduceMotion,
  onDismiss,
  onFinish,
}: {
  minutes: number;
  reduceMotion: boolean;
  onDismiss: () => void;
  onFinish: (moodAfter?: MoodScore, note?: string) => void;
}) {
  const [score, setScore] = useState<MoodScore | null>(null);
  const [note, setNote] = useState('');

  const submit = () => onFinish(score ?? undefined, note.trim() || undefined);

  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-end justify-center bg-bg/70 backdrop-blur-md sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      role="dialog"
      aria-modal="true"
      aria-label="How do you feel now?"
    >
      <motion.div
        className="glass flex w-full max-w-md flex-col gap-6 rounded-t-3xl p-7 sm:rounded-3xl"
        initial={{ y: reduceMotion ? 0 : 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: reduceMotion ? 0 : 24, opacity: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="flex flex-col gap-1 text-center">
          <p className="text-xs font-light tracking-[0.22em] text-fg-muted uppercase">
            {minutes < 1 ? 'Practice complete' : `${minutes} minute${minutes === 1 ? '' : 's'} practised`}
          </p>
          <h2 className="text-xl font-light text-fg">How do you feel now?</h2>
        </div>

        <fieldset className="flex items-end justify-between gap-1">
          <legend className="sr-only">Mood after practice, 1 to 5</legend>
          {MOODS.map(({ score: value, label, Icon }) => {
            const selected = score === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setScore(value)}
                aria-pressed={selected}
                aria-label={`${label} (${value} of 5)`}
                className={clsx(
                  'flex flex-1 flex-col items-center gap-2 rounded-2xl px-1 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'text-accent' : 'text-fg-muted opacity-55 hover:opacity-90',
                )}
              >
                <Icon
                  className={clsx('transition-transform', selected ? 'h-8 w-8 scale-110' : 'h-7 w-7')}
                  aria-hidden
                />
                <span className="text-[0.6rem] font-light tracking-[0.1em] uppercase">{label}</span>
              </button>
            );
          })}
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-[0.65rem] font-light tracking-[0.18em] text-fg-muted uppercase">
            One line, if you want one
          </span>
          <input
            type="text"
            value={note}
            maxLength={140}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="What stayed with you?"
            className="w-full rounded-xl bg-bg-elev px-4 py-3 text-sm font-light text-fg placeholder:text-fg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-3 py-2 text-xs font-light tracking-[0.14em] text-fg-muted uppercase transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Keep going
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-full bg-accent/15 px-6 py-3 text-xs font-light tracking-[0.16em] text-accent uppercase transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {score === null ? 'Just finish' : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default SessionPlayer;
