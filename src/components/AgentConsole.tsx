/**
 * AgentConsole.tsx — the console that makes the architecture visible.
 *
 * A normal chat UI hides what the assistant did behind prose. This one refuses
 * to: every assistant turn that changed or read anything renders the actual tool
 * call as an inspectable chip — name, arguments, raw result. That is the whole
 * argument of the app made literal. The coach is not driving the GUI; the coach
 * and the GUI are two clients of the same tool surface, and here you can watch
 * one of them work.
 *
 * Colours come from the CSS-variable-backed Tailwind theme (`bg-bg`, `text-fg`,
 * `text-accent`, `.glass`) so the console re-skins with the rest of the app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp,
  ChevronRight,
  CircleDot,
  Pencil,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { respond, SUGGESTED_PROMPTS } from '../agent/local-agent.ts';
import type { AgentToolCall, CoachContext } from '../agent/local-agent.ts';
import { toolMutates } from '../agent/tools.ts';
import { TOOL_SPECS } from '../agent/contract.ts';

// ────────────────────────────────────────────────────────────────── types ──

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  call: AgentToolCall | null;
  /** which rule in the local agent fired, and why — surfaced for auditability */
  intent?: string;
  rationale?: string;
}

export interface AgentConsoleProps {
  open: boolean;
  onClose: () => void;
}

// ───────────────────────────────────────────────────────── tiny markdown ──

/**
 * Tool messages are written for humans and use `**bold**`. Render it rather than
 * leaking the asterisks — but do not pull in a markdown library for two markers.
 */
function RichText({ text }: { text: string }) {
  const blocks = text.split('\n');
  return (
    <>
      {blocks.map((line, i) => (
        <span key={i} className="block">
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={j} className="font-semibold text-fg">
                {part.slice(2, -2)}
              </strong>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
          {line === '' ? ' ' : null}
        </span>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────── the call chip ──

function ToolCallChip({ call }: { call: AgentToolCall }) {
  const [open, setOpen] = useState(false);
  const mutates = toolMutates(call.name);
  const argEntries = Object.entries(call.args);

  return (
    <div
      className={`mt-2 overflow-hidden rounded-xl border text-[11px] ${
        call.result.ok ? 'border-fg/10' : 'border-red-500/40'
      } bg-bg-elev/60`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-fg/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-muted">
          <ChevronRight size={12} />
        </motion.span>

        <Terminal size={12} className="shrink-0 text-accent" />

        <code className="font-mono text-[11px] text-fg">{call.name}</code>

        {argEntries.length > 0 && !open && (
          <span className="truncate font-mono text-[10px] text-fg-muted">
            ({argEntries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
              mutates ? 'bg-accent/15 text-accent' : 'bg-fg/[0.07] text-fg-muted'
            }`}
          >
            {mutates ? 'writes' : 'reads'}
          </span>
          <CircleDot size={10} className={call.result.ok ? 'text-emerald-400' : 'text-red-400'} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden border-t border-fg/10"
          >
            <div className="space-y-2 px-2.5 py-2">
              <div>
                <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-fg-muted">arguments</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg/70 p-2 font-mono text-[10px] leading-relaxed text-fg-muted">
                  {argEntries.length ? JSON.stringify(call.args, null, 2) : '{}'}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-fg-muted">result</div>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg/70 p-2 font-mono text-[10px] leading-relaxed text-fg-muted">
                  {JSON.stringify(call.result, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ────────────────────────────────────────────────────────────── the panel ──

export default function AgentConsole({ open, onClose }: AgentConsoleProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<readonly string[]>(SUGGESTED_PROMPTS);
  const ctxRef = useRef<CoachContext>({});
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  const mutatingCount = useMemo(() => TOOL_SPECS.filter((t) => t.mutates).length, []);

  const send = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;

    const userTurn: Turn = { id: nextId.current++, role: 'user', text, call: null };
    // The coach is synchronous and local — there is no request in flight to
    // wait on, so no fake typing indicator. Honesty about latency is free here.
    const r = respond(text, ctxRef.current);
    ctxRef.current = r.context;

    const assistantTurn: Turn = {
      id: nextId.current++,
      role: 'assistant',
      text: r.text,
      call: r.call,
      intent: r.intent,
      rationale: r.rationale,
    };

    setTurns((prev) => [...prev, userTurn, assistantTurn]);
    setSuggestions(r.suggestions);
    setDraft('');
  }, []);

  // keep the newest turn in view
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [turns, reduce]);

  // focus on open, close on Escape
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { x: '100%', opacity: 0.6 },
        animate: { x: 0, opacity: 1 },
        exit: { x: '100%', opacity: 0.4 },
      };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />

          <motion.aside
            key="panel"
            {...slide}
            transition={{ type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }}
            role="dialog"
            aria-label="Agent console"
            aria-modal="true"
            className="glass-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-[27rem] flex-col border-l border-fg/10 text-fg shadow-2xl"
          >
            {/* ── header ─────────────────────────────────────────────── */}
            <header className="flex items-start gap-3 border-b border-fg/10 px-4 py-3.5">
              <span className="mt-0.5 rounded-xl bg-accent/15 p-2 text-accent">
                <Sparkles size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold leading-tight text-fg">Coach</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">
                  Runs on-device. Every reply shows the tool it called.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close console"
                className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={16} />
              </button>
            </header>

            {/* ── transcript ─────────────────────────────────────────── */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {turns.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="glass rounded-2xl border border-fg/10 p-4"
                >
                  <p className="text-sm leading-relaxed text-fg">
                    This app has no hidden buttons. Its {TOOL_SPECS.length} capabilities are exposed as tools —{' '}
                    {mutatingCount} that change things, {TOOL_SPECS.length - mutatingCount} that only read.
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
                    I call the same ones the screens do, and I show you each call with its arguments and its raw
                    result. Nothing is paraphrased. Run{' '}
                    <code className="rounded bg-fg/[0.07] px-1 py-0.5 font-mono text-[11px] text-accent">
                      npm run agent:tools
                    </code>{' '}
                    to hand this surface to any external model.
                  </p>
                </motion.div>
              )}

              {turns.map((turn) =>
                turn.role === 'user' ? (
                  <motion.div
                    key={turn.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-3.5 py-2 text-[13px] leading-relaxed text-fg ring-1 ring-inset ring-accent/20">
                      {turn.text}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={turn.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26, ease: 'easeOut', delay: 0.04 }}
                    className="max-w-[95%]"
                  >
                    <div className="text-[13px] leading-relaxed text-fg-muted">
                      <RichText text={turn.text} />
                    </div>

                    {turn.call ? (
                      <ToolCallChip call={turn.call} />
                    ) : (
                      // No call is itself information: the coach chose to ask
                      // rather than guess. Say so instead of hiding it.
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-fg-muted/70">
                        <Pencil size={10} />
                        <span>no tool called — {turn.rationale}</span>
                      </div>
                    )}
                  </motion.div>
                ),
              )}
            </div>

            {/* ── suggestions ────────────────────────────────────────── */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="shrink-0 whitespace-nowrap rounded-full border border-fg/10 bg-bg-elev/60 px-3 py-1.5 text-[11px] text-fg-muted transition-colors hover:border-accent/30 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {s}
                </button>
              ))}
            </div>

            {/* ── composer ───────────────────────────────────────────── */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="border-t border-fg/10 px-4 py-3"
            >
              <div className="flex items-center gap-2 rounded-2xl border border-fg/10 bg-bg-elev/70 px-3 py-1.5 focus-within:border-accent/40">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="How are you feeling, and how long do you have?"
                  aria-label="Message the coach"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className="rounded-xl bg-accent/20 p-1.5 text-accent transition-opacity disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-fg-muted/60">
                On-device and deterministic. Nothing leaves this browser.
              </p>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
