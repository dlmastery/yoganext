/**
 * Soundscape — ambience synthesised in the browser. No audio files, no network.
 *
 * Every texture here is noise pushed through a filter, because that is what these
 * sounds physically are:
 *
 *   rain          white noise, highpassed. Rain is broadband and bright; the
 *                 "hiss" is literally unshaped noise minus the low end. A slow
 *                 random walk on the filter gain gives the gusting.
 *   ocean         brown-ish noise, lowpassed hard, with an LFO sweeping the cutoff.
 *                 The swell *is* the cutoff sweep — a wave is a low-frequency
 *                 amplitude and brightness envelope, not a sample loop.
 *   forest        quiet lowpassed noise for leaf-rustle, plus sparse bandpassed
 *                 chirps scheduled at random intervals so it never loops audibly.
 *   singing-bowl  a struck bowl is *inharmonic*: partials at ratios 1, 2.7, 5.4,
 *                 8.9 rather than 1, 2, 3. Each partial gets its own exponential
 *                 decay (higher partials die first, as they do in metal), over a
 *                 near-silent sustaining drone. Struck every ~28s.
 *
 * Constraints honoured:
 *   - Autoplay policy: an AudioContext created before a user gesture starts
 *     `suspended` and stays silent. We only construct on an explicit `active`
 *     transition (driven by the play button) and additionally arm a one-shot
 *     pointer/key listener to resume a context the browser suspended anyway.
 *   - Fades: every start ramps up and every stop ramps down before teardown. A
 *     hard stop on noise is an audible click, which is a terrible thing to do to
 *     someone who has just closed their eyes.
 *   - Degrade silently: no WebAudio, or a context that refuses to start, means no
 *     sound and no error surfaced to a meditating user.
 */

import { useEffect, useRef } from 'react';
import type { Settings } from '../../lib/types';

export type SoundscapeKind = Settings['soundscape'];

const FADE_IN = 2.5;
const FADE_OUT = 1.2;

/** Everything one running soundscape owns, so teardown is exhaustive. */
interface Voice {
  ctx: AudioContext;
  master: GainNode;
  nodes: AudioScheduledSourceNode[];
  timers: number[];
  disposed: boolean;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * A few seconds of noise, looped. `spectrum` shapes it at generation time:
 * 'white' is uncorrelated, 'brown' integrates the sample stream (a random walk),
 * which rolls off at ~6 dB/octave and is what gives ocean its weight.
 */
function noiseBuffer(ctx: AudioContext, seconds: number, spectrum: 'white' | 'brown'): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (spectrum === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

function loopSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

// ────────────────────────────────────────────────────────────────── textures ──

function buildRain(v: Voice) {
  const { ctx, master } = v;
  const src = loopSource(ctx, noiseBuffer(ctx, 4, 'white'));

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 700;

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 8200;

  // Gusting: a very slow LFO on level. Without it, filtered noise reads as static.
  const gust = ctx.createGain();
  gust.gain.value = 0.75;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.22;
  lfo.connect(lfoDepth).connect(gust.gain);
  lfo.start();

  src.connect(high).connect(low).connect(gust).connect(master);
  src.start();
  v.nodes.push(src, lfo);
}

function buildOcean(v: Voice) {
  const { ctx, master } = v;
  const src = loopSource(ctx, noiseBuffer(ctx, 6, 'brown'));

  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 480;
  body.Q.value = 0.6;

  // The swell. ~11s period: slower than a real wave, which is what makes it
  // restful rather than urgent.
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.09;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 320;
  swell.connect(swellDepth).connect(body.frequency);
  swell.start();

  const level = ctx.createGain();
  level.gain.value = 0.6;
  const levelLfo = ctx.createOscillator();
  levelLfo.frequency.value = 0.09;
  const levelDepth = ctx.createGain();
  levelDepth.gain.value = 0.3;
  levelLfo.connect(levelDepth).connect(level.gain);
  levelLfo.start();

  src.connect(body).connect(level).connect(master);
  src.start();
  v.nodes.push(src, swell, levelLfo);
}

function buildForest(v: Voice) {
  const { ctx, master } = v;

  // Leaf bed.
  const src = loopSource(ctx, noiseBuffer(ctx, 5, 'white'));
  const leaves = ctx.createBiquadFilter();
  leaves.type = 'lowpass';
  leaves.frequency.value = 2400;
  const leafLevel = ctx.createGain();
  leafLevel.gain.value = 0.28;
  src.connect(leaves).connect(leafLevel).connect(master);
  src.start();
  v.nodes.push(src);

  // Birdsong: two or three quick bandpassed noise blips with a rising pitch, at
  // irregular intervals so the ear never finds a loop point.
  const chirp = () => {
    if (v.disposed) return;
    const t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 2);
    const base = 1900 + Math.random() * 1700;

    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.09 + Math.random() * 0.06);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (1 + i * 0.11), at);
      osc.frequency.exponentialRampToValueAtTime(base * (1.24 + i * 0.11), at + 0.07);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.06, at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);

      osc.connect(env).connect(master);
      osc.start(at);
      osc.stop(at + 0.14);
    }

    v.timers.push(window.setTimeout(chirp, 4000 + Math.random() * 9000));
  };
  v.timers.push(window.setTimeout(chirp, 1500 + Math.random() * 3000));
}

function buildSingingBowl(v: Voice) {
  const { ctx, master } = v;

  // Barely-there drone so the silence between strikes is not dead air.
  const droneSrc = loopSource(ctx, noiseBuffer(ctx, 6, 'brown'));
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'bandpass';
  droneFilter.frequency.value = 210;
  droneFilter.Q.value = 5;
  const droneLevel = ctx.createGain();
  droneLevel.gain.value = 0.22;
  droneSrc.connect(droneFilter).connect(droneLevel).connect(master);
  droneSrc.start();
  v.nodes.push(droneSrc);

  // Inharmonic partial ratios measured off struck idiophones. The 2.7 is what
  // makes it read as metal rather than as a flute.
  const RATIOS = [1, 2.7, 5.4, 8.9];
  const strike = () => {
    if (v.disposed) return;
    const t = ctx.currentTime + 0.02;
    const root = 196 + Math.random() * 24;

    RATIOS.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * ratio;
      // A tiny detune per partial gives the slow beating a real bowl has.
      osc.detune.value = (Math.random() - 0.5) * 6;

      const env = ctx.createGain();
      const peak = 0.16 / (i + 1.3);
      const decay = 9 / (i * 0.85 + 1);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.008 + i * 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);

      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.1);
    });

    v.timers.push(window.setTimeout(strike, 26000 + Math.random() * 8000));
  };
  strike();
}

const BUILDERS: Record<Exclude<SoundscapeKind, 'none'>, (v: Voice) => void> = {
  rain: buildRain,
  ocean: buildOcean,
  forest: buildForest,
  'singing-bowl': buildSingingBowl,
};

// ────────────────────────────────────────────────────────────────── the hook ──

export interface UseSoundscapeOptions {
  kind: SoundscapeKind;
  /** Must only become true as the result of a user gesture (the play button). */
  active: boolean;
  /** 0..1 */
  volume?: number;
}

export function useSoundscape({ kind, active, volume = 0.34 }: UseSoundscapeOptions) {
  const voiceRef = useRef<Voice | null>(null);

  useEffect(() => {
    if (!active || kind === 'none') return;

    const Ctor = getAudioContextCtor();
    if (!Ctor) return; // no WebAudio: degrade silently, as promised.

    let voice: Voice | null = null;
    let detachGesture: (() => void) | undefined;

    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      voice = { ctx, master, nodes: [], timers: [], disposed: false };
      voiceRef.current = voice;

      BUILDERS[kind](voice);

      // exponentialRamp cannot originate from 0, hence the 0.0001 floor above.
      master.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume),
        ctx.currentTime + FADE_IN,
      );

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
        // Belt and braces: if the browser still would not start it, the next real
        // interaction anywhere on the page will.
        const onGesture = () => void ctx.resume().catch(() => undefined);
        window.addEventListener('pointerdown', onGesture, { once: true });
        window.addEventListener('keydown', onGesture, { once: true });
        detachGesture = () => {
          window.removeEventListener('pointerdown', onGesture);
          window.removeEventListener('keydown', onGesture);
        };
      }
    } catch {
      voice = null;
      voiceRef.current = null;
    }

    return () => {
      detachGesture?.();
      const v = voice;
      if (!v || v.disposed) return;
      v.disposed = true;
      voiceRef.current = null;
      v.timers.forEach((t) => window.clearTimeout(t));

      try {
        const end = v.ctx.currentTime + FADE_OUT;
        v.master.gain.cancelScheduledValues(v.ctx.currentTime);
        v.master.gain.setValueAtTime(Math.max(0.0002, v.master.gain.value), v.ctx.currentTime);
        v.master.gain.exponentialRampToValueAtTime(0.0001, end);
        // Let the fade finish before tearing the graph down, or the ramp is moot.
        window.setTimeout(() => {
          v.nodes.forEach((n) => {
            try {
              n.stop();
            } catch {
              /* already stopped */
            }
          });
          void v.ctx.close().catch(() => undefined);
        }, FADE_OUT * 1000 + 120);
      } catch {
        void v.ctx.close().catch(() => undefined);
      }
    };
  }, [kind, active, volume]);

  // Volume changes that do not warrant rebuilding the graph.
  useEffect(() => {
    const v = voiceRef.current;
    if (!v || v.disposed) return;
    try {
      v.master.gain.cancelScheduledValues(v.ctx.currentTime);
      v.master.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume),
        v.ctx.currentTime + 0.3,
      );
    } catch {
      /* ignore */
    }
  }, [volume]);
}

/**
 * Declarative wrapper. Renders nothing; mount it inside the player and flip
 * `active` when the user presses play.
 */
export function Soundscape(props: UseSoundscapeOptions) {
  useSoundscape(props);
  return null;
}

export default Soundscape;
