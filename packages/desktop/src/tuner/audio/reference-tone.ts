/**
 * Reference-note player. Plays a perceptually-even reference across
 * the full instrument range — same apparent loudness from a bass low
 * B (~31 Hz) up through a violin high E (~660 Hz) — in one of three
 * voices:
 *
 *   • `pluck`  — a synthesised plucked string (guitar / bass / uke /
 *                banjo / mandolin), see instrument-voice.ts. Rendered
 *                once per note, cached, looped so it re-plucks.
 *   • `bowed`  — a sustained bowed string (violin family).
 *   • `pure`   — the classic reference tone: a sine fundamental with
 *                a softer octave + twelfth mixed in on low notes so
 *                small speakers still convey the pitch.
 *
 * Two problems make a naive sine player sound wildly uneven and are
 * handled for every voice:
 *
 *   1. EQUAL-LOUDNESS — the human ear is ~20 dB less sensitive at
 *      80 Hz than at 1 kHz (Fletcher-Munson). We boost low notes and
 *      gently roll off the highs (`loudnessCompensation`).
 *   2. SPECTRAL MASS — laptop speakers can't move enough air for a
 *      pure 80 Hz sine; the harmonic content (natural in the string
 *      models, added explicitly in the pure tone) carries the pitch.
 *
 * Single-tone-at-a-time semantics: starting a new note replaces the
 * current one with a tiny overlap so the transition is click-free
 * even when the user mashes between chips. Each voice carries its
 * own teardown closure — no shared timer that could leave a node
 * connected at gain 0 during rapid switching.
 */

import {
  PLUCK_PRESETS,
  buildBowedVoice,
  renderPluck,
  type PluckInstrument,
} from './instrument-voice';

export type VoiceSpec =
  | { model: 'pure' }
  | { model: 'pluck'; instrument: PluckInstrument }
  | { model: 'bowed' };

/**
 * The voice that best matches a tuner instrument preset. Chromatic /
 * voice modes have no physical instrument to imitate and keep the
 * pure tone (the cleanest thing to match a pitch against by ear).
 */
export function voiceForInstrument(instrumentId: string, style: 'instrument' | 'pure'): VoiceSpec {
  if (style === 'pure') return { model: 'pure' };
  switch (instrumentId) {
    case 'guitar':
    case 'bass':
    case 'ukulele':
    case 'banjo':
    case 'mandolin':
      return { model: 'pluck', instrument: instrumentId };
    case 'violin':
      return { model: 'bowed' };
    default:
      return { model: 'pure' };
  }
}

interface Voice {
  /** Every scheduled source (oscillators / buffer sources) to stop. */
  sources: AudioScheduledSourceNode[];
  /** Intermediate nodes to disconnect on teardown. */
  extra: AudioNode[];
  /** Envelope gain for click-free start/stop. */
  env: GainNode;
}

/**
 * Equal-loudness compensation factor: how much to boost the OUTPUT
 * level of a given frequency so all notes sound the same loudness.
 *
 * Approximates the inverse of the 60-phon Fletcher-Munson curve,
 * normalised to 1.0 at 1 kHz, kept modest so the headroom math works
 * with the limiter downstream:
 *   60  Hz  → ~1.8× boost
 *   100 Hz  → ~1.55× boost
 *   200 Hz  → ~1.3× boost
 *   440 Hz  → ~1.1× boost
 *   1000 Hz → 1.0   reference
 *   2000 Hz → ~0.95×
 */
export function loudnessCompensation(freqHz: number): number {
  if (freqHz <= 0) return 1;
  const logF = Math.log10(freqHz);
  const pts: Array<[number, number]> = [
    [1.30, 2.0],
    [1.78, 1.8],
    [2.00, 1.55],
    [2.30, 1.3],
    [2.64, 1.1],
    [3.00, 1.0],
    [3.30, 0.95],
  ];
  if (logF <= pts[0]![0]) return pts[0]![1];
  if (logF >= pts[pts.length - 1]![0]) return pts[pts.length - 1]![1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if (logF >= x0 && logF <= x1) {
      const t = (logF - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 1;
}

/**
 * Harmonic mix for the PURE voice: relative amplitude of the
 * fundamental, octave (×2) and twelfth (×3), normalised to sum to 1
 * so the summed waveform can't exceed unity at the envelope. Lower
 * notes get more reinforcement because small speakers cut off below
 * ~120 Hz — the brain reconstructs the bass pitch from the harmonic
 * series (missing-fundamental effect).
 */
function harmonicMix(freqHz: number): { fundamental: number; octave: number; twelfth: number } {
  let f: number, o: number, t: number;
  if (freqHz >= 260) {
    f = 1.0; o = 0; t = 0;
  } else if (freqHz >= 130) {
    const k = (260 - freqHz) / (260 - 130);
    f = 1.0; o = 0.25 * k; t = 0;
  } else {
    f = 0.55; o = 0.30; t = 0.15;
  }
  const sum = f + o + t;
  if (sum <= 0) return { fundamental: 1, octave: 0, twelfth: 0 };
  return { fundamental: f / sum, octave: o / sum, twelfth: t / sum };
}

export class ReferenceTonePlayer {
  private ctx: AudioContext;
  /** Per-instance master gain — every voice routes through this. */
  private master: GainNode;
  /** Brick-wall safety limiter so the loudness boost on low notes
   *  never clips the output. */
  private limiter: DynamicsCompressorNode;
  /** Current voice (null when silent). */
  private voice: Voice | null = null;
  /** Rendered pluck buffers, keyed by instrument + frequency. A
   *  render costs a few ms; replaying the same string is instant. */
  private pluckCache = new Map<string, { buffer: AudioBuffer; actualHz: number }>();

  constructor(ctx: AudioContext, masterGain = 0.7) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = masterGain;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
  }

  /** True while a tone is playing. */
  get playing(): boolean {
    return this.voice !== null;
  }

  /** Adjust the steady-state output level at runtime (0..1). */
  setMasterGain(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(clamped, now, 0.02);
  }

  /** Start (or replace) the tone at the given frequency in the given
   *  voice. Output level is computed from the frequency so every note
   *  sounds the same loudness. */
  play(frequencyHz: number, spec: VoiceSpec = { model: 'pure' }): void {
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    const peak = loudnessCompensation(frequencyHz);

    // Build the new voice FIRST so a racy teardown of the old one
    // can't touch it.
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.connect(this.master);

    let voice: Voice;
    let attackSec: number;
    switch (spec.model) {
      case 'pluck':
        voice = this.buildPluck(frequencyHz, spec.instrument, env);
        attackSec = 0.004; // the pick transient is the attack
        break;
      case 'bowed': {
        const { sources, extra } = buildBowedVoice(this.ctx, frequencyHz, env);
        voice = { sources, extra, env };
        attackSec = 0.25; // bow lands
        break;
      }
      default:
        voice = this.buildPure(frequencyHz, env);
        attackSec = 0.02;
    }

    const now = this.ctx.currentTime;
    env.gain.linearRampToValueAtTime(peak, now + attackSec);
    for (const src of voice.sources) src.start();

    // Fade the previous voice out in parallel with the new fade-in.
    if (this.voice) this.killVoice(this.voice, 0.03);
    this.voice = voice;
  }

  /** Fade out and stop the current tone. Safe to call when silent. */
  stop(): void {
    if (!this.voice) return;
    this.killVoice(this.voice, 0.05);
    this.voice = null;
  }

  // ── Voice builders ────────────────────────────────────────────────

  private buildPure(frequencyHz: number, env: GainNode): Voice {
    const mix = harmonicMix(frequencyHz);
    const extra: AudioNode[] = [];
    const make = (freq: number, level: number): OscillatorNode => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const partialGain = this.ctx.createGain();
      partialGain.gain.value = level;
      o.connect(partialGain);
      partialGain.connect(env);
      extra.push(partialGain);
      return o;
    };
    const sources = [
      make(frequencyHz, mix.fundamental),
      make(frequencyHz * 2, mix.octave),
      make(frequencyHz * 3, mix.twelfth),
    ];
    return { sources, extra, env };
  }

  private buildPluck(frequencyHz: number, instrument: PluckInstrument, env: GainNode): Voice {
    const sr = this.ctx.sampleRate;
    const key = `${instrument}:${sr}:${frequencyHz.toFixed(4)}`;
    let entry = this.pluckCache.get(key);
    if (!entry) {
      const rendered = renderPluck(sr, frequencyHz, PLUCK_PRESETS[instrument]);
      const buffer = this.ctx.createBuffer(1, rendered.samples.length, sr);
      buffer.getChannelData(0).set(rendered.samples);
      entry = { buffer, actualHz: rendered.actualHz };
      // Keep the cache bounded — a session rarely needs more than a
      // couple of tunings' worth of strings.
      if (this.pluckCache.size > 64) this.pluckCache.clear();
      this.pluckCache.set(key, entry);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.loop = true;
    // The delay line only hits integer periods; play the buffer
    // fractionally faster / slower so the pitch is EXACT.
    src.playbackRate.value = frequencyHz / entry.actualHz;
    src.connect(env);
    return { sources: [src], extra: [], env };
  }

  /** Schedule a click-free teardown for one voice. */
  private killVoice(v: Voice, fadeSec: number): void {
    const now = this.ctx.currentTime;
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setValueAtTime(v.env.gain.value, now);
    v.env.gain.linearRampToValueAtTime(0, now + fadeSec);
    window.setTimeout(() => {
      for (const s of v.sources) {
        try { s.stop(); } catch { /* already stopped */ }
        try { s.disconnect(); } catch { /* ignore */ }
      }
      for (const n of v.extra) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
      try { v.env.disconnect(); } catch { /* ignore */ }
    }, Math.ceil(fadeSec * 1000) + 20);
  }
}
