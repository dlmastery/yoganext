/**
 * Practice — the library.
 *
 * Two filter dimensions only (kind, length), because a library you have to
 * *configure* is a library you stop opening. Cards carry their own gradient so
 * the grid reads as a set of moods rather than a spreadsheet of durations.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock3, Search } from 'lucide-react';
import { useStore } from '../lib/store';
import type { Practice as PracticeT, PracticeKind } from '../lib/types';
import { CardButton, SectionLabel } from '../components/ui/Card';
import { Chip, ChipRow } from '../components/ui/Chip';
import { INTENSITY_LABEL, KIND_LABEL } from '../components/ui/useAppData';

const KINDS: PracticeKind[] = ['meditation', 'breathwork', 'yoga', 'sleep', 'journal'];

const LENGTHS = [
  { id: 'any', label: 'Any length', test: () => true },
  { id: 'short', label: 'Under 5 min', test: (p: PracticeT) => p.minutes < 5 },
  { id: 'mid', label: '5–15 min', test: (p: PracticeT) => p.minutes >= 5 && p.minutes <= 15 },
  { id: 'long', label: 'Over 15 min', test: (p: PracticeT) => p.minutes > 15 },
] as const;

type LengthId = (typeof LENGTHS)[number]['id'];

const INTENSITY_BARS: Record<PracticeT['intensity'], number> = {
  restorative: 1,
  gentle: 2,
  balanced: 3,
  strong: 4,
};

function IntensityMeter({ intensity }: { intensity: PracticeT['intensity'] }) {
  const filled = INTENSITY_BARS[intensity];
  return (
    <span className="inline-flex items-center gap-1.5" title={INTENSITY_LABEL[intensity]}>
      <span aria-hidden="true" className="flex items-end gap-[3px]">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-current transition-opacity"
            style={{ height: 4 + i * 2, opacity: i <= filled ? 0.9 : 0.22 }}
          />
        ))}
      </span>
      <span className="text-xs">{INTENSITY_LABEL[intensity]}</span>
    </span>
  );
}

function PracticeCard({ practice, onStart }: { practice: PracticeT; onStart: () => void }) {
  const [a, b] = practice.gradient;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 280, damping: 30 }}
    >
      <CardButton pad="none" onClick={onStart} className="h-full overflow-hidden">
        {/* The gradient is the card's identity — a wash, not a block, so text stays readable. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.18] transition-opacity duration-500 group-hover:opacity-[0.28]"
          style={{
            background: `radial-gradient(130% 90% at 10% 0%, ${a} 0%, transparent 58%), radial-gradient(120% 110% at 100% 100%, ${b} 0%, transparent 60%)`,
          }}
        />
        <div className="relative flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: a }}
              />
              {KIND_LABEL[practice.kind]}
            </span>
            <span className="inline-flex items-center gap-1 text-xs tabular-nums text-fg-muted">
              <Clock3 size={13} aria-hidden="true" />
              {practice.minutes}m
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <h3 className="text-lg font-semibold leading-snug tracking-tight text-fg">
              {practice.title}
            </h3>
            <p className="text-sm leading-relaxed text-fg-muted">{practice.subtitle}</p>
          </div>

          <div className="flex items-center justify-between gap-3 text-fg-muted">
            <IntensityMeter intensity={practice.intensity} />
            <span className="text-xs font-semibold text-fg opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
              Begin →
            </span>
          </div>
        </div>
      </CardButton>
    </motion.li>
  );
}

export default function Practice() {
  const practices = useStore((s) => s.practices);
  const startSession = useStore((s) => s.startSession);

  const [kind, setKind] = useState<PracticeKind | 'all'>('all');
  const [length, setLength] = useState<LengthId>('any');

  const visible = useMemo(() => {
    const lengthTest = LENGTHS.find((l) => l.id === length)?.test ?? (() => true);
    return practices
      .filter((p) => (kind === 'all' ? true : p.kind === kind))
      .filter((p) => lengthTest(p))
      .sort((x, y) => x.minutes - y.minutes);
  }, [practices, kind, length]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 pb-8 pt-10 sm:px-8 sm:pt-16">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        className="flex flex-col gap-2"
      >
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Practices</h1>
        <p className="text-base text-fg-muted">
          {visible.length} of {practices.length} — pick by what you have time for, not by what you
          think you should do.
        </p>
      </motion.header>

      <div className="flex flex-col gap-3">
        <SectionLabel>Kind</SectionLabel>
        <ChipRow label="Filter by practice kind">
          <Chip groupId="kind" selected={kind === 'all'} onClick={() => setKind('all')}>
            Everything
          </Chip>
          {KINDS.map((k) => (
            <Chip key={k} groupId="kind" selected={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </Chip>
          ))}
        </ChipRow>

        <SectionLabel className="mt-2">Length</SectionLabel>
        <ChipRow label="Filter by length">
          {LENGTHS.map((l) => (
            <Chip
              key={l.id}
              groupId="length"
              selected={length === l.id}
              onClick={() => setLength(l.id)}
            >
              {l.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {visible.length > 0 ? (
        <motion.ul layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((p) => (
              <PracticeCard key={p.id} practice={p} onStart={() => startSession(p.id)} />
            ))}
          </AnimatePresence>
        </motion.ul>
      ) : (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
          <Search size={20} aria-hidden="true" className="text-fg-muted" />
          <p className="text-sm text-fg-muted">
            Nothing matches those two filters together.
          </p>
          <button
            type="button"
            onClick={() => {
              setKind('all');
              setLength('any');
            }}
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
