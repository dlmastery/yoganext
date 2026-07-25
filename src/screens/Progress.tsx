/**
 * Progress — evidence, not cheerleading.
 *
 * Every chart here is hand-rolled SVG. That is a deliberate choice, not
 * asceticism: a charting library would add ~100 kB and a second design language
 * to a screen that needs exactly two marks (a day cell and a line), and the
 * hand-rolled versions inherit our palette tokens for free.
 *
 * The honesty rule that governs this screen: an observation derived from a
 * handful of sessions is shown WITH its confidence, never as a bare fact.
 */
import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Award, CalendarDays, Flame, Timer, TrendingUp } from 'lucide-react';
import type { Achievement, MoodEntry, Session } from '../lib/types';
import { Card, SectionLabel } from '../components/ui/Card';
import { Ring } from '../components/ui/Ring';
import { ConfidenceBadge, Stat } from '../components/ui/Stat';
import { Icon } from '../components/ui/Icon';
import { addDays, dayKey, useAppState, useInsights } from '../components/ui/useAppData';

// ─────────────────────────────────────────────────────────────────── heatmap ──

const WEEKS = 12;
const CELL = 13;
const GAP = 4;
const STEP = CELL + GAP;

/** Monday-start week containing `d`. */
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const dow = (out.getDay() + 6) % 7; // 0 = Monday
  out.setDate(out.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** minutes practised per local day, from the session log. */
function minutesByDay(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(new Date(s.startedAt));
    m.set(k, (m.get(k) ?? 0) + (s.seconds || 0) / 60);
  }
  return m;
}

function level(minutes: number, practised: boolean): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return practised ? 1 : 0;
  if (minutes < 5) return 1;
  if (minutes < 12) return 2;
  if (minutes < 25) return 3;
  return 4;
}

// Level 0 is drawn in plain white at low alpha (not a tinted class), so the
// empty cells stay visible as a grid rather than fading to nothing.
const LEVEL_OPACITY = [0.07, 0.3, 0.52, 0.74, 1] as const;

function Heatmap({ sessions, practiceDays }: { sessions: Session[]; practiceDays: string[] }) {
  const gradId = useId();
  const days = useMemo(() => new Set(practiceDays), [practiceDays]);
  const perDay = useMemo(() => minutesByDay(sessions), [sessions]);

  const gridStart = useMemo(() => addDays(startOfWeek(new Date()), -7 * (WEEKS - 1)), []);
  const todayKey = dayKey();

  const cells = useMemo(() => {
    const out: Array<{ key: string; col: number; row: number; date: Date; lvl: number; mins: number }> = [];
    for (let col = 0; col < WEEKS; col++) {
      for (let row = 0; row < 7; row++) {
        const date = addDays(gridStart, col * 7 + row);
        const key = dayKey(date);
        const mins = Math.round(perDay.get(key) ?? 0);
        out.push({ key, col, row, date, lvl: level(mins, days.has(key)), mins });
      }
    }
    return out;
  }, [gridStart, perDay, days]);

  // Month labels above the first column of each new month.
  const monthMarks = useMemo(() => {
    const marks: Array<{ col: number; label: string }> = [];
    let last = -1;
    for (let col = 0; col < WEEKS; col++) {
      const d = addDays(gridStart, col * 7);
      if (d.getMonth() !== last) {
        last = d.getMonth();
        marks.push({ col, label: d.toLocaleDateString(undefined, { month: 'short' }) });
      }
    }
    return marks;
  }, [gridStart]);

  const w = WEEKS * STEP - GAP;
  const h = 7 * STEP - GAP;
  const total = cells.filter((c) => c.lvl > 0).length;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">
        Practice calendar for the last {WEEKS} weeks. {total} days practised.
      </figcaption>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <svg
          viewBox={`0 -14 ${w} ${h + 14}`}
          width={w}
          height={h + 14}
          role="img"
          aria-label={`Practice heatmap: ${total} days practised in the last ${WEEKS} weeks`}
          className="max-w-full"
        >
          <defs>
            <linearGradient id={`hm-${gradId}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent, 139 124 255))" />
              <stop offset="100%" stopColor="rgb(var(--accent-2, 232 121 199))" />
            </linearGradient>
          </defs>

          {monthMarks.map((m) => (
            <text
              key={m.col}
              x={m.col * STEP}
              y={-4}
              className="fill-current text-fg-muted"
              style={{ fontSize: 9, letterSpacing: '0.08em' }}
              opacity={0.7}
            >
              {m.label}
            </text>
          ))}

          {cells.map((c) => (
            <motion.rect
              key={c.key}
              x={c.col * STEP}
              y={c.row * STEP}
              width={CELL}
              height={CELL}
              rx={3.5}
              fill={c.lvl === 0 ? 'currentColor' : `url(#hm-${gradId})`}
              className="text-fg"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: LEVEL_OPACITY[c.lvl], scale: 1 }}
              transition={{ delay: 0.004 * (c.col * 7 + c.row), duration: 0.35 }}
              stroke={c.key === todayKey ? 'currentColor' : undefined}
              strokeWidth={c.key === todayKey ? 1.25 : undefined}
              strokeOpacity={c.key === todayKey ? 0.55 : undefined}
            >
              <title>
                {c.date.toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
                {c.lvl === 0 ? ' — no practice' : ` — ${c.mins} min`}
              </title>
            </motion.rect>
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span>Less</span>
        {LEVEL_OPACITY.map((o, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{
              background:
                i === 0
                  ? 'rgb(var(--fg) / 0.09)'
                  : 'linear-gradient(135deg, rgb(var(--accent, 139 124 255)), rgb(var(--accent-2, 232 121 199)))',
              opacity: i === 0 ? 1 : o,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </figure>
  );
}

// ───────────────────────────────────────────────────────────────── sparkline ──

function MoodSparkline({ moods }: { moods: MoodEntry[] }) {
  const gradId = useId();
  const points = useMemo(() => moods.slice(-30), [moods]);

  if (points.length < 2) {
    return (
      <p className="text-sm leading-relaxed text-fg-muted">
        Two check-ins are not a trend. Log your mood a few more times and the line will mean
        something.
      </p>
    );
  }

  const W = 300;
  const H = 64;
  const pad = 4;
  const xs = (i: number) => pad + (i * (W - pad * 2)) / (points.length - 1);
  // mood 1..5 → bottom..top
  const ys = (v: number) => H - pad - ((v - 1) / 4) * (H - pad * 2);

  const line = points.map((m, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(m.score).toFixed(1)}`).join(' ');
  const area = `${line} L ${xs(points.length - 1).toFixed(1)} ${H} L ${xs(0).toFixed(1)} ${H} Z`;

  const first = points[0].score;
  const last = points[points.length - 1].score;
  const mean = points.reduce((a, m) => a + m.score, 0) / points.length;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Mood over your last ${points.length} check-ins, from ${first} to ${last} out of 5, averaging ${mean.toFixed(1)}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent, 139 124 255))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(var(--accent, 139 124 255))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#spark-${gradId})`} />
        <motion.path
          d={line}
          fill="none"
          stroke="rgb(var(--accent, 139 124 255))"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={xs(points.length - 1)} cy={ys(last)} r={3} fill="rgb(var(--accent, 139 124 255))" />
      </svg>
      <figcaption className="text-xs text-fg-muted">
        Last {points.length} check-ins · average {mean.toFixed(1)} / 5
      </figcaption>
    </figure>
  );
}

// ────────────────────────────────────────────────────────────── achievements ──

function AchievementTile({ a }: { a: Achievement }) {
  const unlocked = Boolean(a.unlockedAt);
  const pct = Math.round(Math.max(0, Math.min(1, a.progress)) * 100);

  return (
    <li>
      <div
        className={[
          'glass flex h-full flex-col items-center gap-2 rounded-2xl px-3 py-5 text-center',
          unlocked ? '' : 'opacity-70',
        ].join(' ')}
      >
        <Ring
          value={unlocked ? 1 : a.progress}
          size={58}
          stroke={4}
          muted={!unlocked}
          label={
            unlocked
              ? `${a.title}: unlocked`
              : `${a.title}: ${pct}% of the way there`
          }
        >
          <Icon
            name={a.icon}
            size={20}
            className={unlocked ? 'text-accent' : 'text-fg-muted opacity-40'}
          />
        </Ring>
        <p className={['text-xs font-semibold leading-snug', unlocked ? 'text-fg' : 'text-fg-muted'].join(' ')}>
          {a.title}
        </p>
        <p className="text-[11px] leading-snug text-fg-muted">
          {unlocked ? a.description : `${pct}%`}
        </p>
      </div>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────── screen ──

export default function Progress() {
  const state = useAppState();
  const insights = useInsights();

  const totalSessions = state.sessions.length;
  const completed = state.sessions.filter((s) => s.completed).length;
  const unlocked = state.achievements.filter((a) => a.unlockedAt).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 pb-8 pt-10 sm:px-8 sm:pt-16"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Progress</h1>
        <p className="text-base text-fg-muted">
          What actually happened — including the days it didn't.
        </p>
      </header>

      <Card className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat
          label="Streak"
          value={state.habit.streak}
          unit={state.habit.streak === 1 ? 'day' : 'days'}
          icon={<Flame size={13} />}
          hint={state.habit.grace > 0 ? '1 rest day in hand' : undefined}
        />
        <Stat
          label="Best"
          value={state.habit.bestStreak}
          unit="days"
          icon={<Award size={13} />}
        />
        <Stat
          label="Total"
          value={Math.round(state.habit.totalMinutes)}
          unit="min"
          icon={<Timer size={13} />}
        />
        <Stat
          label="Sessions"
          value={totalSessions}
          icon={<CalendarDays size={13} />}
          hint={totalSessions > 0 ? `${completed} finished` : undefined}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionLabel>Last 12 weeks</SectionLabel>
        <Heatmap sessions={state.sessions} practiceDays={state.habit.practiceDays} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Mood over time</SectionLabel>
        <MoodSparkline moods={state.moods} />
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="progress-insights">
        <div className="flex items-baseline justify-between gap-3">
          <SectionLabel>
            <span id="progress-insights">Observations</span>
          </SectionLabel>
          <span className="text-[11px] text-fg-muted">derived from your own data</span>
        </div>

        {insights.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {insights.map((ins, i) => (
              <motion.li
                key={ins.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, type: 'spring', stiffness: 280, damping: 30 }}
              >
                <Card className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-start gap-2 text-[15px] font-medium leading-snug text-fg">
                      <TrendingUp size={15} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
                      {ins.headline}
                    </p>
                    <ConfidenceBadge confidence={ins.confidence} />
                  </div>
                  <p className="pl-[23px] text-sm leading-relaxed text-fg-muted">{ins.detail}</p>
                </Card>
              </motion.li>
            ))}
          </ul>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-fg-muted">
              No observations yet. This section stays empty until there is enough of your own data
              to say something that isn't guesswork.
            </p>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="progress-achievements">
        <div className="flex items-baseline justify-between gap-3">
          <SectionLabel>
            <span id="progress-achievements">Milestones</span>
          </SectionLabel>
          <span className="text-[11px] text-fg-muted">
            {unlocked} of {state.achievements.length}
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {state.achievements.map((a) => (
            <AchievementTile key={a.id} a={a} />
          ))}
        </ul>
      </section>
    </motion.div>
  );
}
