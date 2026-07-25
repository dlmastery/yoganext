/**
 * Icon — resolve an achievement's lucide icon by NAME.
 *
 * Achievements carry `icon: string` (chosen in `lib/habit.ts`), so the UI cannot
 * import them statically at the call site. The obvious fix — `import * as Lucide`
 * and index the namespace — WORKS but defeats tree-shaking: it drags all ~1500
 * lucide icons into the bundle (measured: +~700 kB raw on this app). So we keep
 * an explicit registry of the icons the data layer actually names.
 *
 * ADDING AN ACHIEVEMENT? Register its icon here too, or it will silently render
 * the fallback glyph. `Icon.test` cases and the dev warning below exist to make
 * that failure loud rather than quiet.
 */
import {
  Anchor,
  Award,
  Bird,
  CalendarCheck,
  CloudSun,
  Feather,
  Flower2,
  Footprints,
  Moon,
  MoonStar,
  RotateCcw,
  Sparkles,
  Sunrise,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconComponent = (props: LucideProps) => JSX.Element;

/** Keys are PascalCase lucide names, matching `lib/habit.ts`. */
const REGISTRY: Record<string, unknown> = {
  Anchor,
  Award,
  Bird,
  CalendarCheck,
  CloudSun,
  Feather,
  Flower2,
  Footprints,
  Moon,
  MoonStar,
  RotateCcw,
  Sparkles,
  Sunrise,
};

/** Accept kebab-case / snake_case / PascalCase so a data-layer typo still lands. */
function toPascal(name: string): string {
  return name
    .replace(/[_\s]+/g, '-')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function resolveIcon(name: string | undefined): IconComponent {
  if (!name) return Sparkles as unknown as IconComponent;
  const hit = REGISTRY[name] ?? REGISTRY[toPascal(name)];
  if (!hit) {
    if (import.meta.env?.DEV) {
      // Loud in dev, harmless in production — a missing milestone glyph is a
      // cosmetic bug, never a reason to break the Progress screen.
      console.warn(`[Icon] "${name}" is not registered in src/components/ui/Icon.tsx`);
    }
    return Sparkles as unknown as IconComponent;
  }
  return hit as IconComponent;
}

export function Icon({ name, ...props }: { name: string | undefined } & LucideProps) {
  const Cmp = resolveIcon(name);
  return <Cmp aria-hidden="true" {...props} />;
}
