/**
 * Instrument-like reference sounds for the tuner, synthesised in
 * code — no sample files are shipped with the app, so "realistic"
 * has to come from physical modelling:
 *
 *   • PLUCKED strings (guitar, bass, ukulele, banjo, mandolin) use an
 *     extended Karplus-Strong model: a filtered noise burst (the pick)
 *     fed into a delay-line loop with a two-tap averaging filter (the
 *     string) whose loss factor sets the decay. A pick-position comb
 *     removes the partials a real pick doesn't excite, and per-
 *     instrument brightness / decay / pick settings give a steel
 *     guitar, a dull bass, a nylon uke, a snappy banjo and a bright
 *     mandolin distinct voices. The result is rendered once into an
 *     AudioBuffer (a few ms of CPU) and looped so the note re-plucks
 *     every couple of seconds like a hardware tuner.
 *
 *   • BOWED strings (violin family) are a sawtooth through a resonant
 *     low-pass with a slow bow attack and a whisper of filtered bow
 *     noise — built from live Web Audio nodes since a bowed note is
 *     sustained rather than decaying.
 *
 * Pitch exactness: Karplus-Strong's integer delay quantises the
 * pitch (up to ±8 ¢ at A4 — useless for a tuning reference), so the
 * renderer reports the frequency it ACTUALLY produced and the player
 * corrects it with `playbackRate`. The correction is < 0.5 %, far too
 * small to change the timbre.
 */

export type PluckInstrument = 'guitar' | 'bass' | 'ukulele' | 'banjo' | 'mandolin';

export interface PluckParams {
  /** 0 = very mellow pick (heavy low-pass on the excitation), 1 = raw. */
  brightness: number;
  /** Nominal -60 dB decay time in seconds at ~110 Hz; scaled by
   *  frequency (higher strings die faster on every real instrument). */
  t60: number;
  /** Pick position as a fraction of the string length (0..0.5). */
  pickPos: number;
}

export const PLUCK_PRESETS: Record<PluckInstrument, PluckParams> = {
  guitar:   { brightness: 0.55, t60: 5.0, pickPos: 0.18 },
  bass:     { brightness: 0.28, t60: 6.5, pickPos: 0.24 },
  ukulele:  { brightness: 0.42, t60: 2.2, pickPos: 0.30 },
  banjo:    { brightness: 0.92, t60: 1.3, pickPos: 0.12 },
  mandolin: { brightness: 0.82, t60: 1.6, pickPos: 0.15 },
};

/** Decay time for a given frequency — strings ring shorter as pitch
 *  rises. Empirical exponent; clamped to a sane range. */
export function effectiveT60(baseT60: number, frequencyHz: number): number {
  const scaled = baseT60 * Math.pow(110 / Math.max(20, frequencyHz), 0.35);
  return Math.max(0.6, Math.min(8, scaled));
}

export interface RenderedPluck {
  samples: Float32Array;
  /** The frequency the delay loop really produced (integer-length
   *  delay); the caller corrects the difference with playbackRate. */
  actualHz: number;
  /** Seconds between re-plucks when looped. */
  loopSeconds: number;
}

/**
 * Render one plucked note. Deterministic (fixed-seed noise) so the
 * same note always sounds identical and the buffer can be cached.
 */
export function renderPluck(sampleRate: number, frequencyHz: number, p: PluckParams): RenderedPluck {
  // Delay-line length. The two-tap averaging filter in the loop adds
  // half a sample of delay, so the loop period is N + 0.5 samples.
  const N = Math.max(2, Math.round(sampleRate / frequencyHz - 0.5));
  const actualHz = sampleRate / (N + 0.5);

  const t60 = effectiveT60(p.t60, frequencyHz);
  // Loop until the note has decayed well past audibility, then loop
  // the buffer so it re-plucks — but never longer than 3 s so the
  // repeat feels like a tuner, not a metronome.
  const loopSeconds = Math.max(1.2, Math.min(3, t60 * 0.6));
  const len = Math.ceil(loopSeconds * sampleRate);
  const out = new Float32Array(len);

  // ── Excitation: pick noise burst ────────────────────────────────
  let seed = 0x9e3779b9;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const exc = new Float32Array(N);
  // One-pole low-pass on the noise: soft picks / thick strings excite
  // fewer high partials. brightness 1 → unfiltered.
  const lpCoef = 0.06 + 0.94 * p.brightness * p.brightness;
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += lpCoef * (rnd() - lp);
    exc[i] = lp;
  }
  // Pick-position comb: a string plucked at fraction d has no energy
  // in the partials with a node at that point — modelled as
  // e[n] -= e[n - d·N]. Walk backwards so each subtraction reads the
  // still-unmodified earlier sample.
  const D = Math.max(1, Math.round(p.pickPos * N));
  for (let i = N - 1; i >= D; i--) exc[i]! -= exc[i - D]!;
  // Remove DC so the loop doesn't carry a constant offset.
  let mean = 0;
  for (let i = 0; i < N; i++) mean += exc[i]!;
  mean /= N;
  for (let i = 0; i < N; i++) exc[i]! -= mean;

  // ── String loop ─────────────────────────────────────────────────
  // Amplitude falls by `rho` every period; -60 dB after t60 seconds
  // ⇒ rho^(f·t60) = 0.001. The averaging filter adds its own extra,
  // frequency-dependent loss, which is what makes the high partials
  // die first — exactly like a real string.
  const rho = Math.pow(0.001, 1 / (actualHz * t60));
  for (let n = 0; n < len; n++) {
    let v = n < N ? exc[n]! : 0;
    if (n >= N) {
      const a1 = out[n - N]!;
      const a2 = n - N - 1 >= 0 ? out[n - N - 1]! : 0;
      v += rho * 0.5 * (a1 + a2);
    }
    out[n] = v;
  }

  // ── Gentle top-end smoothing (the "body") ───────────────────────
  // One-pole low-pass around 6 kHz takes the fizz off the first few
  // milliseconds of noise without dulling the string.
  const bodyCoef = 1 - Math.exp(-2 * Math.PI * 6000 / sampleRate);
  let body = 0;
  for (let n = 0; n < len; n++) {
    body += bodyCoef * (out[n]! - body);
    out[n] = body;
  }

  // ── Normalise + loop-safe tail ──────────────────────────────────
  let peak = 0;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]!));
  const norm = peak > 0 ? 0.9 / peak : 1;
  for (let n = 0; n < len; n++) out[n]! *= norm;
  const fade = Math.min(len, Math.round(0.04 * sampleRate));
  for (let i = 0; i < fade; i++) {
    out[len - 1 - i]! *= i / fade;
  }

  return { samples: out, actualHz, loopSeconds };
}

/**
 * Bowed-string voice (violin / viola / cello). Returns the nodes the
 * caller must start / stop; everything is already connected into
 * `env`. The attack ramp is scheduled on `env` by the caller so the
 * bow "lands" over ~250 ms instead of clicking on.
 */
export function buildBowedVoice(
  ctx: AudioContext,
  frequencyHz: number,
  env: GainNode,
): { sources: AudioScheduledSourceNode[]; extra: AudioNode[] } {
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = frequencyHz;

  // Resonant low-pass shapes the buzzy saw into a string. The cutoff
  // tracks the pitch (a violin's brightness sits a few harmonics up)
  // and stays inside a musical range.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.max(900, Math.min(5000, frequencyHz * 6));
  filter.Q.value = 1.4;

  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.55;

  // Bow noise: a whisper of band-passed noise near the 4th partial —
  // the rosin "scrape" that makes a bowed tone read as bowed.
  const noiseLen = ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let seed = 0x1234567;
  for (let i = 0; i < noiseLen; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 4294967296 - 0.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = Math.min(8000, frequencyHz * 4);
  noiseFilter.Q.value = 1.2;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.035;

  saw.connect(filter);
  filter.connect(sawGain);
  sawGain.connect(env);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(env);

  return {
    sources: [saw, noise],
    extra: [filter, sawGain, noiseFilter, noiseGain],
  };
}
