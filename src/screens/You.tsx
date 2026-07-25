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
  LifeBuoy,
  Minus,
  Moon,
  Plus,
  Trash2,
  TreePine,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { callTool } from '../agent/tools';
import { useStore } from '../lib/store';
import { THEME_LIST } from '../lib/theme';
import type { Settings } from '../lib/types';
import { Card, SectionLabel } from '../components/ui/Card';
import { Chip, ChipRow } from '../components/ui/Chip';
import { Sheet } from '../components/ui/Sheet';
import { useAppState } from '../components/ui/useAppData';

// ─────────────────────────────────────────────────────────────────── palettes ──

/**
 * The swatches are read from `lib/theme`, not hand-copied here. A picker whose
 * previews can drift from the palettes they preview is worse than no preview:
 * `THEME_LIST` carries the real stops, label and one-line mood, so the thumbnail
 * is the palette by construction.
 */
const THEME_OPTIONS = THEME_LIST;

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
          checked ? 'bg-accent' : 'bg-fg/20',
        ].join(' ')}
      >
        <motion.span
          aria-hidden="true"
          layout
          transition={{ type: 'spring', stiffness: 560, damping: 34 }}
          className="absolute top-1 h-5 w-5 rounded-full bg-fg shadow-sm"
          style={{ left: checked ? 26 : 4 }}
        />
      </button>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────── screen ──

/**
 * Every control on this screen is a tool call. Nothing here reaches into the
 * store directly, which is what makes "call me Sam", "remind me at seven",
 * "I get motion sick" and "export my data" work identically whether they are
 * typed to the coach or tapped here.
 */
export default function You() {
  const state = useAppState();

  /**
   * The two exceptions to the tools-only rule above, and deliberately so:
   * `_recovered` is not a user capability, it is a report that a saved blob on
   * THIS device was unreadable and had to be discarded. Someone whose streak
   * silently went to zero deserves to be told that it was a storage fault and
   * not something they imagined — staying quiet about it is the one thing this
   * screen must not do. `acknowledgeRecovery` just dismisses that notice.
   */
  const recovered = useStore((s) => s._recovered);
  const acknowledgeRecovery = useStore((s) => s.acknowledgeRecovery);

  const [confirmReset, setConfirmReset] = useState(false);
  const [exported, setExported] = useState(false);

  const goal = Math.min(GOAL_MAX, Math.max(GOAL_MIN, state.habit.dailyGoalMinutes || 10));
  const reminderOn = Boolean(state.settings.reminderAt);

  /**
   * The tool owns the payload; this function owns the browser. `export_data`
   * returns the JSON string (the same projection that gets persisted), and the
   * only thing left for the GUI to do is the part an agent cannot do — put a
   * file in the user's downloads folder.
   */
  function download() {
    const res = callTool('export_data');
    const data = res.data as { json?: string; filename?: string } | undefined;
    if (!res.ok || !data?.json) return;

    const blob = new Blob([data.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename ?? `yoganext-${new Date().toISOString().slice(0, 10)}.json`;
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

      {/* Storage-fault notice. Calm, not alarming, and never silent. */}
      {recovered && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Card className="flex flex-col gap-3 border border-amber-700/30 dark:border-amber-400/25">
            <div className="flex items-start gap-2.5">
              <LifeBuoy
                size={17}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
              />
              <div className="flex flex-col gap-1.5">
                <p className="text-[15px] font-medium leading-snug text-fg">
                  Some of your saved history could not be read.
                </p>
                <p className="text-sm leading-relaxed text-fg-muted">
                  The data stored on this device was damaged, so it was discarded and the app
                  started fresh. If your streak or sessions look wrong, that is why — it was a
                  storage fault, not something you did or imagined.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={acknowledgeRecovery}
              className="self-start rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Understood
            </button>
          </Card>
        </motion.div>
      )}

      {/* Name */}
      <Card className="flex flex-col gap-3">
        <SectionLabel>What should we call you?</SectionLabel>
        <input
          type="text"
          value={state.settings.name ?? ''}
          onChange={(e) => callTool('set_profile', { name: e.target.value })}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={40}
          className="w-full rounded-2xl border border-line bg-fg/[0.04] px-4 py-3 text-[15px] text-fg placeholder:text-fg-muted/60 outline-none transition-colors focus-visible:border-fg/25 focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-fg-muted">Used only in the greeting. Leave it blank if you'd rather not.</p>
      </Card>

      {/* Theme */}
      <Card className="flex flex-col gap-4">
        <SectionLabel>Atmosphere</SectionLabel>
        <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEME_OPTIONS.map((t) => {
            const active = state.settings.theme === t.name;
            return (
              <motion.button
                key={t.name}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => callTool('set_theme', { theme: t.name })}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 440, damping: 28 }}
                className={[
                  'relative flex flex-col gap-2 rounded-2xl p-2 text-left',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active ? 'ring-2 ring-accent' : 'ring-1 ring-line hover:ring-fg/25',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className="h-14 w-full rounded-xl"
                  style={{
                    // Ground first, then both accents: this is what makes the
                    // light `sand` swatch read as light rather than as purple.
                    background: `linear-gradient(135deg, ${t.tokens.bg} 0%, ${t.tokens.accent} 58%, ${t.tokens.accent2} 100%)`,
                  }}
                />
                <span className="flex items-center gap-1.5 px-0.5">
                  <span className="text-sm font-semibold text-fg">{t.label}</span>
                  {active && <Check size={13} aria-hidden="true" className="text-accent" />}
                </span>
                <span className="px-0.5 pb-1 text-[11px] leading-snug text-fg-muted">{t.mood}</span>
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
                onClick={() => callTool('set_soundscape', { soundscape: s.id })}
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
              onClick={() => callTool('set_intention', { minutes: goal - 1 })}
              disabled={goal <= GOAL_MIN}
              aria-label="Decrease daily goal by one minute"
              className="grid h-10 w-10 place-items-center rounded-full border border-line text-fg transition-colors hover:bg-fg/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => callTool('set_intention', { minutes: goal + 1 })}
              disabled={goal >= GOAL_MAX}
              aria-label="Increase daily goal by one minute"
              className="grid h-10 w-10 place-items-center rounded-full border border-line text-fg transition-colors hover:bg-fg/5 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ChipRow label="Common daily goals">
          {GOAL_PRESETS.map((m) => (
            <Chip key={m} groupId="goal" selected={goal === m} onClick={() => callTool('set_intention', { minutes: m })}>
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
          onChange={(v) => callTool('set_reminder', { time: v ? '20:00' : '' })}
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
              onChange={(e) => callTool('set_reminder', { time: e.target.value })}
              aria-label="Reminder time"
              className="rounded-xl border border-line bg-fg/[0.04] px-3 py-2 text-[15px] tabular-nums text-fg outline-none focus-visible:border-fg/25 focus-visible:ring-2 focus-visible:ring-ring"
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
          onChange={(v) => callTool('set_accessibility', { reduceMotion: v })}
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
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {exported ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {exported ? 'Downloaded' : 'Export JSON'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            /* `dark:` here means "any palette except sand" (see tailwind.config
               darkMode). Base styles are the light-theme ones. */
            className="inline-flex items-center gap-2 rounded-full border border-red-600/35 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-600/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-red-400/25 dark:text-red-300 dark:hover:bg-red-400/10"
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
                callTool('reset_data', { confirm: true });
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
              className="flex-1 rounded-full border border-line px-4 py-3 text-sm font-medium text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Keep my history
            </button>
          </div>
        </div>
      </Sheet>
    </motion.div>
  );
}
