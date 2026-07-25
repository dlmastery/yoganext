/**
 * useAppData — the read-side adapter between the store and my screens.
 *
 * `summarize()` takes an `AppState`, but the zustand store is AppState *plus*
 * actions. Rather than hand the insight engine a bag of functions (or re-render
 * every screen on every action-identity change), we select the seven data slices
 * and rebuild a clean AppState. It also means the screens have exactly one place
 * to look when the store's shape shifts.
 */
import { useMemo } from 'react';
import { useStore } from '../../lib/store';
import { summarize } from '../../lib/insights';
import type { AppState, Practice, Session } from '../../lib/types';
import type { Confidence } from './Stat';

/**
 * Structural shape we render. Declared locally on purpose: it keeps this file
 * from breaking if the insight module renames its exported type, and it accepts
 * `confidence` as either a word or a 0..1 number (ConfidenceBadge normalises).
 */
export interface UIInsight {
  id: string;
  headline: string;
  detail: string;
  confidence: Confidence | number | string;
}

export function useAppState(): AppState {
  const practices = useStore((s) => s.practices);
  const sessions = useStore((s) => s.sessions);
  const moods = useStore((s) => s.moods);
  const habit = useStore((s) => s.habit);
  const achievements = useStore((s) => s.achievements);
  const active = useStore((s) => s.active);
  const settings = useStore((s) => s.settings);

  return useMemo(
    () => ({ practices, sessions, moods, habit, achievements, active, settings }),
    [practices, sessions, moods, habit, achievements, active, settings],
  );
}

/**
 * Insights, defensively. A thrown error inside the derivation engine must not
 * take down the screen a person opened to feel calmer — we degrade to "no
 * observations yet", which is also the honest answer when there is no data.
 */
export function useInsights(): UIInsight[] {
  const state = useAppState();
  return useMemo(() => {
    try {
      const out = summarize(state) as unknown;
      return Array.isArray(out) ? (out as UIInsight[]) : [];
    } catch {
      return [];
    }
  }, [state]);
}

// ───────────────────────────────────────────────────────────────── date utils ──

/** Local 'YYYY-MM-DD'. Never use toISOString() here — it silently shifts a late-evening session into tomorrow. */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Minutes practised since local midnight — powers the daily-goal ring. */
export function minutesToday(sessions: Session[]): number {
  const today = dayKey();
  const secs = sessions
    .filter((s) => dayKey(new Date(s.startedAt)) === today)
    .reduce((a, s) => a + (s.seconds || 0), 0);
  return Math.round(secs / 60);
}

export function practiceById(practices: Practice[], id: string | undefined): Practice | undefined {
  return id ? practices.find((p) => p.id === id) : undefined;
}

export const KIND_LABEL: Record<Practice['kind'], string> = {
  meditation: 'Meditation',
  breathwork: 'Breathwork',
  yoga: 'Yoga',
  sleep: 'Sleep',
  journal: 'Journal',
};

export const INTENSITY_LABEL: Record<Practice['intensity'], string> = {
  restorative: 'Restorative',
  gentle: 'Gentle',
  balanced: 'Balanced',
  strong: 'Strong',
};
