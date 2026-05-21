/**
 * Reference-note player. Plays a perceptually-even reference tone
 * across the full instrument range — same apparent loudness from a
 * bass low B (~31 Hz) up through a violin high E (~660 Hz).
 *
 * Two problems make a naive sine player sound wildly uneven:
 *
 *   1. EQUAL-LOUDNESS — the human ear is ~20 dB less sensitive at
 *      80 Hz than at 1 kHz (Fletcher-Munson). A pure sine at the same
 *      electrical amplitude is nearly inaudible at E2 (82 Hz) while
 *      ear-splitting at E5 (660 Hz). We compensate by boosting low
 *      frequencies and gently rolling off the highs.
 *
 *   2. SPECTRAL MASS — laptop speakers and earbuds reproduce a pure
 *      sine at 80 Hz very poorly because the driver simply can't
 *      move enough air at that wavelength. A real guitar's low E
 *      sounds present because the fundamental is reinforced by a
 *      strong 2nd and 3rd harmonic. We synthesise the same: a sine
 *      fundamental + a softer octave + a soft 12th, all mixed into
 *      one voice. The lower the note, the heavier the harmonic
 *      content (since the speaker is reproducing the harmonics
 *      better than the fundamental anyway).
 *
 * Single-tone-at-a-time semantics: starting a new note replaces the
 * current one with a tiny overlap so the transition is click-free
 * even when the user mashes between chips. Each voice carries its
 * own teardown closure — no shared timer that could leave an
 * oscillator connected at gain 0 during rapid chip-switching.
 */

interface Voice {
  /** Fundamental oscillator. */
  osc: OscillatorNode;
  /** Octave oscillator (2× fundamental) — bolsters perceived
   *  loudness on low notes that the speaker can't reproduce well. */
  osc2: OscillatorNode;
  /** Twelfth oscillator (3× fundamental). */
  osc3: OscillatorNode;
  /** Envelope gain for click-free start/stop. */
  env: GainNode;
}

/**
 * Equal-loudness compensation factor: how much to boost the OUTPUT
 * level of a given frequency so all notes sound the same loudness.
 *
 * Approximates the inverse of the 60-phon Fletcher-Munson curve,
 * normalised to 1.0 at 1 kHz. The previous version returned values
 * up to 3.2× at 60 Hz which, multiplied by a harmonic mix that
 * itself summed to 1.5, drove the signal hard into clipping (the
 * "distorted low notes" the user heard). The numbers below are
 * MORE MODEST so the headroom math works:
 *   60  Hz  → ~1.8× boost
 *   100 Hz  → ~1.55× boost
 *   200 Hz  → ~1.3× boost
 *   440 Hz  → ~1.1× boost
 *   1000 Hz → 1.0   reference
 *   2000 Hz → ~0.95×
 *
 * The remaining low-frequency "loudness" comes from the harmonic
 * mix below — together they deliver enough perceived level without
 * pushing the summed waveform above the safe limiter ceiling.
 */
function loudnessCompensation(freqHz: number): number {
  if (freqHz <= 0) return 1;
  const logF = Math.log10(freqHz);
  // Anchor points (logF, factor):
  //   (1.30, 2.0)   → 20 Hz
  //   (1.78, 1.8)   → 60 Hz
  //   (2.00, 1.55)  → 100 Hz
  //   (2.30, 1.3)   → 200 Hz
  //   (2.64, 1.1)   → 440 Hz
  //   (3.00, 1.0)   → 1000 Hz
  //   (3.30, 0.95)  → 2000 Hz
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
 * Harmonic mix levels for a given frequency. Returns the relative
 * amplitude of the fundamental, octave (×2), and twelfth (×3),
 * normalised so the sum is exactly 1.0 — that's the key change
 * vs the previous version, which let the partials sum to ~1.5 and
 * blew past the clipping ceiling once the equal-loudness boost was
 * applied on top.
 *
 * Lower notes get more harmonic reinforcement because small
 * speakers cut off below ~120 Hz, so the harmonics ARE what the
 * user hears, and the brain "fills in" the bass pitch from the
 * harmonic series (the residue-pitch / missing-fundamental effect).
 *
 * For notes above ~250 Hz a pure sine is fine — added harmonics
 * just make the tone buzzy. The mix fades out linearly above C4.
 */
function harmonicMix(freqHz: number): { fundamental: number; octave: number; twelfth: number } {
  let f: number, o: number, t: number;
  if (freqHz >= 260) {
    // C4 and up — pure sine, no added partials.
    f = 1.0; o = 0; t = 0;
  } else if (freqHz >= 130) {
    // C3 – C4: a gentle octave for body, no twelfth.
    // Fade the octave amount from 0.25 at 130 Hz to 0 at 260 Hz.
    const k = (260 - freqHz) / (260 - 130);
    f = 1.0; o = 0.25 * k; t = 0;
  } else {
    // Below C3 — laptop speakers are losing the fundamental fast.
    // Heavier octave + softer twelfth restore the perceived pitch
    // even on tinny output.
    f = 0.55; o = 0.30; t = 0.15;
  }
  // Normalise so the partials sum to 1.0 — this guarantees that a
  // worst-case waveform (all three sines simultaneously at +1)
  // cannot exceed unity at the envelope input. Any residual peaks
  // are then caught by the limiter at the master stage.
  const sum = f + o + t;
  if (sum <= 0) return { fundamental: 1, octave: 0, twelfth: 0 };
  return { fundamental: f / sum, octave: o / sum, twelfth: t / sum };
}

export class ReferenceTonePlayer {
  private ctx: AudioContext;
  /** Per-instance master gain — every voice routes through this so
   *  external volume changes affect any subsequent tone uniformly. */
  private master: GainNode;
  /** Brick-wall safety limiter. The harmonic mix is normalised to
   *  sum ≤ 1.0 and the equal-loudness boost is modest (≤ 1.8×) but
   *  the master gain still allows transient peaks above unity. A
   *  compressor with a near-vertical ratio + a -3 dB threshold
   *  catches those peaks cleanly instead of letting the speaker
   *  clip. Without this stage the low notes audibly distorted
   *  whenever the summed signal crossed ±1.0. */
  private limiter: DynamicsCompressorNode;
  /** Current voice (null when silent). */
  private voice: Voice | null = null;

  constructor(ctx: AudioContext, masterGain = 0.7) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = masterGain;
    this.limiter = ctx.createDynamicsCompressor();
    // Tuned as a peak limiter, not a musical compressor:
    //   threshold -3 dB — anything louder gets reined in.
    //   knee 0         — hard knee, behaves like a limiter.
    //   ratio 20:1     — effectively brick-wall.
    //   attack 3 ms    — catches the transient before it audibly clips.
    //   release 100 ms — recovery slow enough to avoid pumping.
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

  /** Start (or replace) the tone at the given frequency. The output
   *  level is computed automatically from the frequency so all notes
   *  sound the same loudness. */
  play(frequencyHz: number): void {
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    // Per-frequency envelope peak = equal-loudness compensation
    // (1.0 at 1 kHz, up to 1.8× at 60 Hz). Multiplied by the master
    // gain (0.7) gives 0.7 at the mid-range and ~1.26 at the bottom
    // — any momentary peak above 1.0 is then caught by the limiter
    // before reaching the destination, so the signal stays clean
    // instead of audibly distorting on the low strings.
    const peak = loudnessCompensation(frequencyHz);
    const mix = harmonicMix(frequencyHz);

    // ── Build the new voice FIRST ────────────────────────────────
    // Any racy teardown of the old voice can't then touch this one.
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.connect(this.master);

    const make = (freq: number, level: number): OscillatorNode => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      // Per-partial gain in series with the shared envelope.
      const partialGain = this.ctx.createGain();
      partialGain.gain.value = level;
      o.connect(partialGain);
      partialGain.connect(env);
      return o;
    };

    const osc = make(frequencyHz, mix.fundamental);
    const osc2 = make(frequencyHz * 2, mix.octave);
    const osc3 = make(frequencyHz * 3, mix.twelfth);

    const now = this.ctx.currentTime;
    // 20 ms fade-in — short enough to feel instantaneous, long
    // enough to prevent the speaker pop.
    env.gain.linearRampToValueAtTime(peak, now + 0.02);
    osc.start();
    osc2.start();
    osc3.start();

    // Fade the previous voice out in parallel with the new fade-in.
    // Each voice carries its own teardown — no shared timer that
    // could clobber the wrong oscillator.
    if (this.voice) {
      this.killVoice(this.voice, 0.03);
    }

    this.voice = { osc, osc2, osc3, env };
  }

  /** Fade out and stop the current tone. Safe to call when silent. */
  stop(): void {
    if (!this.voice) return;
    this.killVoice(this.voice, 0.05);
    this.voice = null;
  }

  /** Schedule a click-free teardown for one voice. The voice's own
   *  oscillator + envelope nodes are torn down after `fadeSec` so
   *  rapid re-plays don't race a different voice's teardown. */
  private killVoice(v: Voice, fadeSec: number): void {
    const now = this.ctx.currentTime;
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setValueAtTime(v.env.gain.value, now);
    v.env.gain.linearRampToValueAtTime(0, now + fadeSec);
    window.setTimeout(() => {
      for (const o of [v.osc, v.osc2, v.osc3]) {
        try { o.stop(); } catch { /* already stopped */ }
        try { o.disconnect(); } catch { /* ignore */ }
      }
      try { v.env.disconnect(); } catch { /* ignore */ }
    }, Math.ceil(fadeSec * 1000) + 20);
  }
}
