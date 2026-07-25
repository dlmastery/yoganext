/**
 * Today — the emotional centre of the app.
 *
 * Design brief: one clear action, generous whitespace, nothing that nags. A
 * person opening this screen is often not at their best, so the hierarchy is
 * (1) you are greeted, (2) here is one thing to do, (3) how are you, actually,
 * (4) here is your progress, stated gently and only if it is real.
 *
 * Everything here is reachable as an agent tool too — `recommend_practice`,
 * `start_session`, `log_mood` — this screen is just the prettiest client of them.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, Flame, Sparkles, Wind } from 'lucide-react';
import { callTool } from '../agent/tools';
import type { MoodScore, Practice } from '../lib/types';
import { Card, CardButton, SectionLabel } from '../components/ui/Card';
import { Ring } from '../components/ui/Ring';
import { ConfidenceBadge } from '../components/ui/Stat';
import {
  INTENSITY_LABEL,
  KIND_LABEL,
  dayKey,
  minutesToday,
  useAppState,
  useInsights,
} from '../components/ui/useAppData';

// ────────────────────────────────────────────────────────────────── greeting ──

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still awake';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Winding down';
}

/** A different, quiet line under the greeting depending on the hour. */
function subtitleFor(hour: number): string {
  if (hour < 5) return 'Something slow, then rest.';
  if (hour < 12) return 'A few minutes before the day takes over.';
  if (hour < 17) return 'A pause is not a detour.';
  if (hour < 22) return 'Let the day set down.';
  return 'Softly now.';
}

// ─────────────────────────────────────────────────── the day's recommendation ──

/** Kinds that suit the hour. Not a rule — a lean. */
function preferredKinds(hour: number): Practice['kind'][] {
  if (hour < 5) return ['sleep', 'breathwork'];
  if (hour < 11) return ['breathwork', 'yoga', 'meditation'];
  if (hour < 17) return ['meditation', 'breathwork', 'journal'];
  if (hour < 21) return ['yoga', 'meditation', 'journal'];
  return ['sleep', 'meditation', 'breathwork'];
}

/** Stable per-day pick so the suggestion doesn't reshuffle on every render. */
function hashDay(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pickSuggestion(
  practices: Practice[],
  hour: number,
  goalMinutes: number,
): Practice | undefined {
  if (practices.length === 0) return undefined;
  const kinds = preferredKinds(hour);
  const byKind = practices.filter((p) => kinds.includes(p.kind));
  const fits = byKind.filter((p) => p.minutes <= Math.max(goalMinutes, 10) + 5);
  const pool = fits.length > 0 ? fits : byKind.length > 0 ? byKind : practices;
  return pool[hashDay(dayKey() + String(kinds[0])) % pool.length];
}

// ───────────────────────────────────────────────────────────────── mood faces ──

const MOODS: Array<{ score: MoodScore; label: string; mouth: string; brow: number }> = [
  { score: 1, label: 'Rough', mouth: 'M 7.5 16.4 Q 12 12.6 16.5 16.4', brow: -1.2 },
  { score: 2, label: 'Low', mouth: 'M 7.5 16 Q 12 14.2 16.5 16', brow: -0.6 },
  { score: 3, label: 'Okay', mouth: 'M 7.5 15.6 Q 12 15.6 16.5 15.6', brow: 0 },
  { score: 4, label: 'Good', mouth: 'M 7.5 15.2 Q 12 17.6 16.5 15.2', brow: 0.4 },
  { score: 5, label: 'Great', mouth: 'M 7.5 14.8 Q 12 19.4 16.5 14.8', brow: 0.8 },
];

function MoodFace({ mouth, brow, active }: { mouth: string; brow: number; active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
      <motion.circle
        cx="8.6"
        cy={9.6 - brow * 0.4}
        r={active ? 1.25 : 1.05}
        fill="currentColor"
        animate={{ r: active ? 1.25 : 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      />
      <motion.circle
        cx="15.4"
        cy={9.6 - brow * 0.4}
        r={active ? 1.25 : 1.05}
        fill="currentColor"
        animate={{ r: active ? 1.25 : 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      />
      <motion.path
        d={mouth}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        animate={{ d: mouth }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────── entrance ──

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 28 } },
};

// ─────────────────────────────────────────────────────────────────── screen ──

export default function Today() {
  const state = useAppState();
  const insights = useInsights();
  const [justLogged, setJustLogged] = useState<MoodScore | null>(null);

  const hour = useMemo(() => new Date().getHours(), []);
  const name = state.settings.name?.trim();
  const goal = Math.max(1, state.habit.dailyGoalMinutes || 10);
  const done = minutesToday(state.sessions);
  const progress = Math.min(1, done / goal);

  const suggestion = useMemo(
    () => pickSuggestion(state.practices, hour, goal),
    [state.practices, hour, goal],
  );

  // Today's most recent mood, so returning to the screen shows what you said.
  const todaysMood = useMemo(() => {
    const today = dayKey();
    const entries = state.moods.filter((m) => dayKey(new Date(m.at)) === today);
    return entries.length > 0 ? entries[entries.length - 1].score : null;
  }, [state.moods]);

  const selectedMood = justLogged ?? todaysMood;
  const topInsight = insights[0];

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 pb-8 pt-10 sm:px-8 sm:pt-16"
    >
      {/* Greeting */}
      <motion.header variants={item} className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
          {greetingFor(hour)}
          {name ? <span className="text-gradient">, {name}</span> : null}
        </h1>
        <p className="text-base text-fg-muted">{subtitleFor(hour)}</p>
      </motion.header>

      {/* The one action */}
      {suggestion && (
        <motion.section variants={item} aria-labelledby="today-suggestion" className="flex flex-col gap-3">
          <SectionLabel>
            <span id="today-suggestion">Chosen for you</span>
          </SectionLabel>
          <CardButton
            featured
            pad="none"
            onClick={() => callTool('start_session', { practiceId: suggestion.id })}
            className="overflow-hidden"
          >
            {/* gradient field */}
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-[0.22] transition-opacity duration-500 group-hover:opacity-30"
              style={{
                background: `radial-gradient(120% 100% at 15% 0%, ${suggestion.gradient[0]} 0%, transparent 60%), radial-gradient(120% 100% at 90% 100%, ${suggestion.gradient[1]} 0%, transparent 62%)`,
              }}
            />
            <div
              aria-hidden="true"
              className="animate-breathe absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl"
              style={{
                background: `linear-gradient(135deg, ${suggestion.gradient[0]}, ${suggestion.gradient[1]})`,
                opacity: 0.28,
              }}
            />
            <div className="relative flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: suggestion.gradient[0] }}
                />
                {KIND_LABEL[suggestion.kind]}
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                {INTENSITY_LABEL[suggestion.intensity]}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-semibold leading-snug tracking-tight text-fg sm:text-3xl">
                  {suggestion.title}
                </h3>
                <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
                  {suggestion.subtitle}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
                  <Clock3 size={15} aria-hidden="true" />
                  {suggestion.minutes} min
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-fg px-5 py-2.5 text-sm font-semibold text-bg transition-transform duration-300 group-hover:translate-x-0.5">
                  Begin
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              </div>
            </div>
          </CardButton>
        </motion.section>
      )}

      {/* Mood check-in */}
      <motion.section variants={item} aria-labelledby="today-mood" className="flex flex-col gap-3">
        <SectionLabel>
          <span id="today-mood">How are you, really?</span>
        </SectionLabel>
        <Card pad="sm">
          <div role="radiogroup" aria-label="Mood check-in" className="flex items-stretch justify-between gap-1">
            {MOODS.map(({ score, label, mouth, brow }) => {
              const active = selectedMood === score;
              return (
                <motion.button
                  key={score}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${label} (${score} of 5)`}
                  onClick={() => {
                    callTool('log_mood', { score });
                    setJustLogged(score);
                  }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                  className={[
                    'relative flex flex-1 flex-col items-center gap-1.5 rounded-2xl px-1 py-3',
                    'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'text-accent' : 'text-fg-muted hover:text-fg',
                  ].join(' ')}
                >
                  {active && (
                    <motion.span
                      layoutId="mood-halo"
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-2xl bg-fg/[0.07] ring-1 ring-line"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <MoodFace mouth={mouth} brow={brow} active={active} />
                  <span className="text-[11px] font-medium">{label}</span>
                </motion.button>
              );
            })}
          </div>
        </Card>
        <p aria-live="polite" className="min-h-[1.25rem] px-1 text-xs text-fg-muted">
          {justLogged
            ? 'Logged. Thank you for checking in — this is what the insights are built from.'
            : todaysMood
              ? 'You checked in today. Tap again if it has changed.'
              : ''}
        </p>
      </motion.section>

      {/* Progress + insight */}
      <motion.section variants={item} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-stretch">
        <Card className="flex items-center gap-5 sm:flex-col sm:justify-center sm:gap-3 sm:px-8">
          <Ring
            value={progress}
            size={104}
            stroke={9}
            label={`${done} of ${goal} minutes practised today`}
          >
            <div className="flex flex-col items-center leading-none">
              <span className="text-2xl font-semibold tabular-nums text-fg">{done}</span>
              <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-fg-muted">
                of {goal}m
              </span>
            </div>
          </Ring>
          <div className="flex flex-col gap-1 sm:items-center sm:text-center">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Flame size={15} aria-hidden="true" className="text-accent" />
              {state.habit.streak} day{state.habit.streak === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-fg-muted">
              {state.habit.grace > 0
                ? 'One rest day in hand — streaks here forgive.'
                : 'Best: ' + state.habit.bestStreak + ' days'}
            </span>
          </div>
        </Card>

        <Card className="flex flex-col justify-center gap-2">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel>Noticed in your data</SectionLabel>
            {topInsight && <ConfidenceBadge confidence={topInsight.confidence} />}
          </div>
          {topInsight ? (
            <>
              <p className="text-[15px] font-medium leading-snug text-fg">{topInsight.headline}</p>
              <p className="text-sm leading-relaxed text-fg-muted">{topInsight.detail}</p>
            </>
          ) : (
            <div className="flex items-start gap-2.5">
              <Sparkles size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" />
              <p className="text-sm leading-relaxed text-fg-muted">
                Nothing to report yet — and we would rather say that than invent a pattern.
                Practise a few times and real observations will appear here.
              </p>
            </div>
          )}
        </Card>
      </motion.section>

      {state.practices.length === 0 && (
        <motion.p variants={item} className="flex items-center gap-2 text-sm text-fg-muted">
          <Wind size={15} aria-hidden="true" />
          The practice library is still loading.
        </motion.p>
      )}
    </motion.div>
  );
}
