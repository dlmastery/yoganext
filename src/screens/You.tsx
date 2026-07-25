/**
 * You — settings, and the door out.
 *
 * Two principles: (1) every control shows its effect immediately (the theme
 * swatches preview the real palettes, the goal stepper restates the goal in
 * plain words), and (2) the destructive action is honest about what it destroys
 * and is never one tap away.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BellRing,
  Check,
  CloudRain,
  Download,
  Minus,
  Moon,
  Plus,
  Trash2,
  TreePine,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { useStore } from '../lib/store';
import type { Settings } from '../lib/types';
import { Card, SectionLabel } from '../components/ui/Card';
import { Chip, ChipRow } from '../components/ui/Chip';
import { Sheet } from '../components/ui/Sheet';
import { useAppState } from '../components/ui/useAppData';

// ─────────────────────────────────────────────────────────────────── palettes ──

/**
 * Preview swatches only. The real palettes live in the design system as CSS
 * variables; these three stops are a faithful thumbnail so the choice can be
 * made by eye rather than by name.
 */
const THEMES: Array<{ id: Settings['theme']; label: string; note: string; stops: [string, string, string] }> = [
  { id: 'aurora', label: 'Aurora', note: 'Deep indigo, violet light', stops: ['#0b1020', '#6d5efc', '#22d3ee'] },
  { id: 'dusk', label: 'Dusk', note: 'Warm dark, ember accents', stops: ['#150f14', '#e0724f', '#f2b28c'] },
  { id: 'forest', label: 'Forest', note: 'Cool green, moss and mist', stops: ['#0a1512', '#2f9e73', '#a7e8c8'] },
  { id: 'sand', label: 'Sand', note: 'Light, paper and clay', stops: ['#f4efe7', '#c08457', '#7a6a55'] },
];

const SOUNDSCAPES: Array<{ id: Settings['soundscape']; label: string; icon: typeof Waves }> = [
  { id: 'none', label: 'Silence', icon: VolumeX },
  { id: 'rain', label: 'Rain', icon: CloudRain },
  { id: 'ocean', label: 'Ocean', icon: Waves },
  { id: 'forest', label: 'Forest', icon: TreePine },
  { id: 'singing-bowl', label: 'Singing bowl', icon: Volume2 },
];

const GOAL_PRESETS = [5, 10, 15, 20, 30];
const GOAL_MIN = 3;
const GOAL_MAX = 60;

// ──────────────────────────────────────────────────────────────────── switch ──

function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex flex-col gap-1">
        <span className="text-[15px] font-medium text-fg">{label}</span>
        {description && <span className="text-sm leading-relaxed text-fg-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-300',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          checked ? 'bg-accent/80' : 'bg-white/10',
        ].join(' ')}
      >
        <motion.span
          aria-hidden="true"
          layout
          transition={{ type: 'spring', stiffness: 560, damping: 34 }}
          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm"
          style={{ left: checked ? 26 : 4 }}
        />
      </button>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────── screen ──

export default function You() {
  const state = useAppState();
  const setTheme = useStore((s) => s.setTheme);
  const setSoundscape = useStore((s) => s.setSoundscape);
  const setIntention = useStore((s) => s.setIntention);
  const setReduceMotion = useStore((s) => s.setReduceMotion);
  const setName = useStore((s) => s.setName);
  const setReminder = useStore((s) => s.setReminder);
  const reset = useStore((s) => s.reset);

  const [confirmReset, setConfirmReset] = useState(false);
  const [exported, setExported] = useState(false);

  const goal = Math.min(GOAL_MAX, Math.max(GOAL_MIN, state.habit.dailyGoalMinutes || 10));
  const reminderOn = Boolean(state.settings.reminderAt);

  const exportPayload = useMemo(
    () =>
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          app: 'yoganext',
          sessions: state.sessions,
          moods: state.moods,
          habit: state.habit,
          achievements: state.achievements,
          settings: state.settings,
        },
        null,
        2,
      ),
    [state],
  );

  function download() {
    const blob = new Blob([exportPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yoganext-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 2600);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 pb-8 pt-10 sm:px-8 sm:pt-16"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">You</h1>
        <p className="text-base text-fg-muted">Make it yours. Everything here is local to you.</p>
      </header>

      {/* Name */}
      <Card className="flex flex-col gap-3">
        <SectionLabel>What should we call you?</SectionLabel>
        <input
          type="text"
          value={state.settings.name ?? ''}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={40}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[15px] text-fg placeholder:text-fg-muted/60 outline-none transition-colors focus-visible:border-white/20 focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-fg-muted">Used only in the greeting. Leave it blank if you'd rather not.</p>
      </Card>

      {/* Theme */}
      <Card className="flex flex-col gap-4">
        <SectionLabel>Atmosphere</SectionLabel>
        <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => {
            const active = state.settings.theme === t.id;
            return (
              <motion.button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(t.id)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 440, damping: 28 }}
                className={[
                  'relative flex flex-col gap-2 rounded-2xl p-2 text-left',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active ? 'ring-2 ring-accent' : 'ring-1 ring-white/10 hover:ring-white/20',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className="h-14 w-full rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${t.stops[0]} 0%, ${t.stops[1]} 62%, ${t.stops[2]} 100%)`,
                  }}
                />
                <span className="flex items-center gap-1.5 px-0.5">
                  <span className="text-sm font-semibold text-fg">{t.label}</span>
                  {active && <Check size={13} aria-hidden="true" className="text-accent" />}
                </span>
                <span className="px-0.5 pb-1 text-[11px] leading-snug text-fg-muted">{t.note}</span>
              </motion.button>
            );
          })}
        </div>
      </Card>

      {/* Soundscape */}
      <Card className="flex flex-col gap-3">
        <SectionLabel>Soundscape during practice</SectionLabel>
        <ChipRow label="Soundscape">
          {SOUNDSCAPES.map((s) => {
            const SIcon = s.icon;
            return (
              <Chip
                key={s.id}
                groupId="sound"
                selected={state.settings.soundscape === s.id}
                onClick={() => setSoundscape(s.id)}
              >
                <SIcon size={14} aria-hidden="true" />
                {s.label}
              </Chip>
            );
          })}
        </ChipRow>
      </Card>

      {/* Daily goal */}
      <Card className="flex flex-col gap-4">
        <SectionLabel>Daily intention</SectionLabel>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-3xl font-semibold tabular-nums leading-none text-fg">
              {goal} <span className="text-base font-normal text-fg-muted">min a day</span>
            </span>
            <span className="text-xs text-fg-muted">
              {goal <= 5
                ? 'Small enough to keep on a bad day — which is the point.'
                : goal <= 15
                  ? 'A realistic daily dose.'
                  : 'Ambitious. Make sure it survives a hard week.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIntention(Math.max(GOAL_MIN, goal - 1))}
              disabled={goal <= GOAL_MIN}
              aria-label="Decrease daily goal by one minute"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-fg transition-colors hover:bg-white/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setIntention(Math.min(GOAL_MAX, goal + 1))}
              disabled={goal >= GOAL_MAX}
              aria-label="Increase daily goal by one minute"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-fg transition-colors hover:bg-white/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ChipRow label="Common daily goals">
          {GOAL_PRESETS.map((m) => (
            <Chip key={m} groupId="goal" selected={goal === m} onClick={() => setIntention(m)}>
              {m} min
            </Chip>
          ))}
        </ChipRow>
      </Card>

      {/* Reminder */}
      <Card className="flex flex-col gap-4">
        <SectionLabel>Reminder</SectionLabel>
        <Switch
          label="Nudge me once a day"
          description="A single gentle prompt. Never a guilt trip about a missed streak."
          checked={reminderOn}
          onChange={(v) => setReminder(v ? '20:00' : '')}
        />
        {reminderOn && (
          <motion.label
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center justify-between gap-4 overflow-hidden"
          >
            <span className="inline-flex items-center gap-2 text-[15px] text-fg">
              <BellRing size={15} aria-hidden="true" className="text-fg-muted" />
              Time
            </span>
            <input
              type="time"
              value={state.settings.reminderAt || '20:00'}
              onChange={(e) => setReminder(e.target.value)}
              aria-label="Reminder time"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[15px] tabular-nums text-fg outline-none focus-visible:border-white/20 focus-visible:ring-2 focus-visible:ring-ring"
            />
          </motion.label>
        )}
      </Card>

      {/* Motion */}
      <Card>
        <Switch
          label="Reduce motion"
          description="Turns off the drifting background and entrance animations. Also respected automatically if your system asks for it."
          checked={Boolean(state.settings.reduceMotion)}
          onChange={setReduceMotion}
        />
      </Card>

      {/* Data */}
      <Card className="flex flex-col gap-4">
        <SectionLabel>Your data</SectionLabel>
        <p className="text-sm leading-relaxed text-fg-muted">
          {state.sessions.length} session{state.sessions.length === 1 ? '' : 's'} and{' '}
          {state.moods.length} mood check-in{state.moods.length === 1 ? '' : 's'} are stored on this
          device.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {exported ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {exported ? 'Downloaded' : 'Export JSON'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-2 rounded-full border border-red-400/25 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 size={15} aria-hidden="true" />
            Reset everything
          </button>
        </div>
      </Card>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-fg-muted">
        <Moon size={12} aria-hidden="true" />
        yoganext — this app is not a substitute for professional care.
      </p>

      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset everything?"
        description="This deletes every session, mood check-in, streak and milestone on this device. It cannot be undone."
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-fg-muted">
            If you might want this history later, export it first — the download takes a second and
            the file is plain JSON.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-red-500/90 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 size={15} aria-hidden="true" />
              Yes, delete it all
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="flex-1 rounded-full border border-white/10 px-4 py-3 text-sm font-medium text-fg transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Keep my history
            </button>
          </div>
        </div>
      </Sheet>
    </motion.div>
  );
}
