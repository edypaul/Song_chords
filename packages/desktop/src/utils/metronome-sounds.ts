import type { MetronomeSound } from '@song-chords/shared';

/**
 * Metronome click synthesis — PRE-RENDERED sample approach.
 *
 * Instead of wiring oscillators live at schedule time (which caps
 * quality at "test tone" and made click character depend on node
 * timing), each (sound, accent) pair is rendered ONCE into a PCM
 * buffer with proper DSP — modal partials at measured inharmonic
 * ratios, real biquad filters for noise shaping, raised-cosine
 * attacks, per-partial decay times — then peak-normalized and cached.
 * Playback is a plain AudioBufferSourceNode through a static gain:
 * every click is bit-identical, starts from ~zero amplitude (no pop),
 * and costs nothing at schedule time.
 *
 * All clicks still feed a shared master bus (gain → gentle
 * compressor → destination) so overlapping clicks after a mid-bar
 * tempo restart can't stack into a spike.
 */

export interface ClickOptions {
  sound: MetronomeSound;
  /** Is this the accented downbeat? */
  accent: boolean;
  /** Master volume 0–1. */
  volume: number;
}

/* ── Master bus ────────────────────────────────────────────────────── */

interface Bus { input: GainNode }
const busByCtx = new WeakMap<AudioContext, Bus>();

function getBus(ctx: AudioContext): Bus {
  let bus = busByCtx.get(ctx);
  if (bus) return bus;
  const input = ctx.createGain();
  input.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.001;
  comp.release.value = 0.08;
  input.connect(comp);
  comp.connect(ctx.destination);
  bus = { input };
  busByCtx.set(ctx, bus);
  return bus;
}

/* ── Sample-domain DSP helpers ─────────────────────────────────────── */

/** RBJ-cookbook biquad, processed in place over a Float32Array. */
function biquad(
  data: Float32Array, sampleRate: number,
  type: 'bandpass' | 'highpass' | 'lowpass', freq: number, q: number,
): void {
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const na1 = a1 / a0, na2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    data[i] = y0;
  }
}

/** Decaying sine partial with raised-cosine attack, optional pitch
 *  drop (freq glides from freq*dropRatio to freq with time constant
 *  dropTau — the "knock" of struck wood). Adds into `out`. */
function addPartial(
  out: Float32Array, sampleRate: number,
  freq: number, amp: number, tau: number,
  attack = 0.0012, dropRatio = 1, dropTau = 0.008,
): void {
  const nyquist = sampleRate * 0.45;
  if (freq >= nyquist) return;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const f = dropRatio === 1 ? freq : freq * (1 + (dropRatio - 1) * Math.exp(-t / dropTau));
    phase += 2 * Math.PI * f / sampleRate;
    const att = t >= attack ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t / attack);
    out[i]! += amp * att * Math.exp(-t / tau) * Math.sin(phase);
  }
}

/** Decaying white-noise burst (filter it afterwards with `biquad`). */
function noiseBurst(len: number, sampleRate: number, tau: number, attack = 0.0008): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const att = t >= attack ? 1 : t / attack;
    out[i] = (Math.random() * 2 - 1) * att * Math.exp(-t / tau);
  }
  return out;
}

function mixInto(out: Float32Array, src: Float32Array, amp: number): void {
  for (let i = 0; i < out.length; i++) out[i]! += src[i]! * amp;
}

/* ── Click recipes ─────────────────────────────────────────────────── */

/** Map a stored sound id to the current union — the first release
 *  shipped a 'cowbell' option that was replaced by 'clave'. */
export function normalizeMetronomeSound(v: string | undefined): MetronomeSound {
  if (v === 'wood' || v === 'tick' || v === 'clave' || v === 'beep') return v;
  if (v === 'cowbell') return 'clave';
  return 'beep';
}

/** Render one click as raw PCM. Exported for tests.
 *
 *  Design rule (user feedback 2026-10-11): these must sound like
 *  METRONOME clicks — percussive, transient-dominated, 25–60 ms,
 *  with hardly any tonal ring. Decay times are per-partial and all
 *  under ~20 ms except the gated digital beep.
 */
export function renderClickSamples(sampleRate: number, sound: MetronomeSound, accent: boolean): Float32Array {
  let dur: number;
  let out: Float32Array;

  switch (normalizeMetronomeSound(sound)) {
    case 'wood': {
      // Dry woodblock "tock": free-bar modal ratios (1 : 2.76 : 5.40)
      // but with very fast decays and a dominant stick-contact snap —
      // closer to a drum-machine click track than a ringing block.
      dur = 0.055;
      out = new Float32Array(Math.ceil(dur * sampleRate));
      const f0 = accent ? 1800 : 1270;
      addPartial(out, sampleRate, f0, 1.0, 0.016, 0.0008, 1.14, 0.005);
      addPartial(out, sampleRate, f0 * 2.76, 0.5, 0.007);
      addPartial(out, sampleRate, f0 * 5.40, 0.22, 0.0035);
      const snap = noiseBurst(out.length, sampleRate, 0.003);
      biquad(snap, sampleRate, 'bandpass', f0 * 1.7, 2.5);
      mixInto(out, snap, 2.2);
      break;
    }
    case 'clave': {
      // Rosewood clave "pok": essentially one strong resonant mode
      // with a tiny pitch drop and the faintest upper partial —
      // bright, round, and gone in 50 ms. The classic drum-machine /
      // click-track voice.
      dur = 0.06;
      out = new Float32Array(Math.ceil(dur * sampleRate));
      const f = accent ? 2500 : 1850;
      addPartial(out, sampleRate, f, 1.0, 0.02, 0.0008, 1.08, 0.006);
      addPartial(out, sampleRate, f * 3.3, 0.12, 0.006);
      const snap = noiseBurst(out.length, sampleRate, 0.002);
      biquad(snap, sampleRate, 'bandpass', f, 4);
      mixInto(out, snap, 0.8);
      break;
    }
    case 'tick': {
      // Mechanical metronome click (the Wittner "tick-tock"): almost
      // pure transient — a hard noise snap, a short bright ping and a
      // low case "knock" for body, low-passed so it stays dry.
      dur = 0.03;
      out = new Float32Array(Math.ceil(dur * sampleRate));
      const snap = noiseBurst(out.length, sampleRate, 0.0022);
      biquad(snap, sampleRate, 'highpass', 2200, 0.8);
      mixInto(out, snap, 1.3);
      addPartial(out, sampleRate, accent ? 3400 : 2700, 0.8, 0.005);
      addPartial(out, sampleRate, accent ? 1150 : 950, 0.5, 0.007);
      biquad(out, sampleRate, 'lowpass', 11000, 0.7);
      break;
    }
    case 'beep':
    default: {
      // Digital metronome blip (Korg/Boss style): a GATED sine —
      // near-flat 1 kHz burst, over in ~35 ms. Percussive through
      // sheer brevity; the global 3 ms fade-out is the gate release.
      dur = 0.035;
      out = new Float32Array(Math.ceil(dur * sampleRate));
      const f = accent ? 1000 : 800;
      addPartial(out, sampleRate, f, 1.0, 0.5 /* ≈flat over 35 ms */, 0.0015);
      break;
    }
  }

  // Peak-normalize to a common level so timbres sit at equal loudness,
  // then a 3 ms raised-cosine fade-out so the buffer ends at zero.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const scale = peak > 0 ? 0.9 / peak : 0;
  const fade = Math.min(Math.floor(0.003 * sampleRate), out.length);
  for (let i = 0; i < out.length; i++) {
    let s = out[i]! * scale;
    const fromEnd = out.length - 1 - i;
    if (fromEnd < fade) s *= 0.5 - 0.5 * Math.cos(Math.PI * fromEnd / fade);
    out[i] = s;
  }
  return out;
}

/* ── Buffer cache + playback ───────────────────────────────────────── */

const bufferCache = new WeakMap<AudioContext, Map<string, AudioBuffer>>();

function getClickBuffer(ctx: AudioContext, sound: MetronomeSound, accent: boolean): AudioBuffer {
  let cache = bufferCache.get(ctx);
  if (!cache) { cache = new Map(); bufferCache.set(ctx, cache); }
  const key = sound + (accent ? '|a' : '|n');
  let buf = cache.get(key);
  if (buf) return buf;
  const samples = renderClickSamples(ctx.sampleRate, sound, accent);
  buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  cache.set(key, buf);
  return buf;
}

/** Schedule one metronome click at `time` on the context's clock. */
export function scheduleMetronomeClick(ctx: AudioContext, time: number, opts: ClickOptions): void {
  // Accent ≈ +4 dB over regular beats.
  const vol = Math.max(0, Math.min(1, opts.volume)) * (opts.accent ? 1 : 0.62);
  if (vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = getClickBuffer(ctx, opts.sound, opts.accent);
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(getBus(ctx).input);
  src.start(time);
}

/** Play a one-bar preview (4 beats at 104 BPM) — used by the Settings
 *  page so sound/volume/accent changes can be auditioned instantly.
 *  Returns the preview's total duration in seconds so the caller can
 *  lock out re-triggers while it plays. */
export function previewMetronome(ctx: AudioContext, opts: Omit<ClickOptions, 'accent'> & { accentFirst: boolean }): number {
  if (ctx.state === 'suspended') void ctx.resume();
  const lead = 0.06;
  const start = ctx.currentTime + lead;
  const beatDur = 60 / 104;
  for (let i = 0; i < 4; i++) {
    scheduleMetronomeClick(ctx, start + i * beatDur, {
      sound: opts.sound,
      volume: opts.volume,
      accent: i === 0 && opts.accentFirst,
    });
  }
  return lead + 3 * beatDur + 0.25; // last click start + longest tail
}
