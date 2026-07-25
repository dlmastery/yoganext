/**
 * theme.ts — the four palettes, as data.
 *
 * The CSS in `styles/globals.css` is the source of truth at runtime: every token
 * lives as an `R G B` triplet custom property on `[data-theme]`, so switching a
 * palette is one attribute write and the whole surface transitions at once. This
 * file mirrors those values in TypeScript for the things CSS cannot reach — the
 * `<meta name="theme-color">` tag, canvas/SVG painting, the theme picker's own
 * swatches, and any agent that wants to *describe* a palette rather than apply it.
 *
 * Keep the two in sync. If you change a hex here, change the triplet there.
 */

import type { Settings } from './types';

export type ThemeName = Settings['theme'];

export const THEME_NAMES = ['aurora', 'dusk', 'forest', 'sand'] as const;

/** Every colour token a theme defines. Hex, for JS consumers. */
export interface ThemeTokens {
  /** page ground */
  bg: string;
  /** raised surfaces: cards, sheets, the player */
  bgElev: string;
  /** primary text */
  fg: string;
  /** secondary text — held at >= 4.5:1 on `bg` in all four palettes */
  fgMuted: string;
  /** hairlines and card borders */
  line: string;
  /** the lead accent: primary actions, active states */
  accent: string;
  /** the counter accent: the far end of every gradient */
  accent2: string;
  /** focus rings and glows */
  ring: string;
}

export interface Theme {
  name: ThemeName;
  /** shown in the theme picker */
  label: string;
  /** one line on the mood it sets — user-facing copy */
  mood: string;
  /** 'dark' | 'light' — drives `color-scheme` and native form controls */
  scheme: 'dark' | 'light';
  tokens: ThemeTokens;
  /** the multi-stop gradient, ready to drop into a `background-image` */
  gradient: string;
  /** the three gradient stops, for callers that need them separately */
  stops: [string, string, string];
  /** value for `<meta name="theme-color">` */
  metaColor: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  aurora: {
    name: 'aurora',
    label: 'Aurora',
    mood: 'Deep night, lit from below. The default.',
    scheme: 'dark',
    tokens: {
      bg: '#090818',
      bgElev: '#14122b',
      fg: '#edeafb',
      fgMuted: '#a29cc4',
      line: '#2b2748',
      accent: '#8b7cff',
      accent2: '#e879c7',
      ring: '#a78bfa',
    },
    stops: ['#8b7cff', '#a855f7', '#e879c7'],
    gradient: 'linear-gradient(120deg, #8b7cff 0%, #a855f7 46%, #e879c7 100%)',
    metaColor: '#090818',
  },

  dusk: {
    name: 'dusk',
    label: 'Dusk',
    mood: 'The last warm hour, held a little longer.',
    scheme: 'dark',
    tokens: {
      bg: '#1a0b14',
      bgElev: '#2a1220',
      fg: '#fcede9',
      fgMuted: '#c4a0ac',
      line: '#452032',
      accent: '#fb7185',
      accent2: '#f3a559',
      ring: '#fb7185',
    },
    stops: ['#fb7185', '#f3a559', '#a9648f'],
    gradient: 'linear-gradient(120deg, #fb7185 0%, #f3a559 48%, #a9648f 100%)',
    metaColor: '#1a0b14',
  },

  forest: {
    name: 'forest',
    label: 'Forest',
    mood: 'Under the canopy, after rain.',
    scheme: 'dark',
    tokens: {
      bg: '#071512',
      bgElev: '#0f241e',
      fg: '#e4f3ec',
      fgMuted: '#8fb2a5',
      line: '#1c3b32',
      accent: '#45c58e',
      accent2: '#a8ce73',
      ring: '#45c58e',
    },
    stops: ['#45c58e', '#2fb8b0', '#a8ce73'],
    gradient: 'linear-gradient(120deg, #45c58e 0%, #2fb8b0 44%, #a8ce73 100%)',
    metaColor: '#071512',
  },

  sand: {
    name: 'sand',
    label: 'Sand',
    mood: 'Daylight on paper. The one light palette.',
    scheme: 'light',
    tokens: {
      bg: '#f5efe6',
      bgElev: '#fffbf4',
      fg: '#2a2320',
      fgMuted: '#6f625a',
      line: '#e2d7c7',
      accent: '#6f5f91',
      accent2: '#c08a4e',
      ring: '#6f5f91',
    },
    stops: ['#6f5f91', '#c08a4e', '#d9a38c'],
    gradient: 'linear-gradient(120deg, #6f5f91 0%, #c08a4e 52%, #d9a38c 100%)',
    metaColor: '#f5efe6',
  },
};

export const THEME_LIST: Theme[] = THEME_NAMES.map((n) => THEMES[n]);

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

export function getTheme(name: ThemeName): Theme {
  return THEMES[name] ?? THEMES.aurora;
}

/**
 * Apply a theme to the document. The CSS variables live in globals.css keyed on
 * `[data-theme]`, so this only has to set the attribute — plus the browser-chrome
 * colour, which CSS cannot reach.
 *
 * Call this from the store whenever `settings.theme` changes.
 */
export function applyTheme(name: ThemeName, doc: Document = document): void {
  const theme = getTheme(name);
  doc.documentElement.dataset.theme = theme.name;

  doc
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((tag) => tag.setAttribute('content', theme.metaColor));
}

/**
 * Mirror the user's `reduceMotion` setting onto the document. Every ambient
 * animation in globals.css is switched off by `[data-reduce-motion="true"]`, and
 * separately by the OS-level `prefers-reduced-motion` media query — the app
 * setting can only ever add stillness, never override the system into motion.
 */
export function applyReduceMotion(reduce: boolean, doc: Document = document): void {
  doc.documentElement.dataset.reduceMotion = String(reduce);
}
