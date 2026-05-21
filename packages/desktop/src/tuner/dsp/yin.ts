/**
 * YIN pitch detector — full implementation of the algorithm from
 * de Cheveigné & Kawahara (2002), "YIN, a fundamental frequency
 * estimator for speech and music".
 *
 * Why YIN (not FFT or naive autocorrelation): it is the de-facto
 * standard for monophonic instrument tuners. It avoids the
 * octave-doubling errors of plain autocorrelation, gives sub-sample
 * f0 precision via parabolic interpolation, and works well on guitar,
 * bass, ukulele, violin, piano, and voice — all the instruments this
 * module must support.
 *
 * Implemented steps from the paper:
 *   Step 1. Difference function d(tau).
 *   Step 2. Cumulative mean normalized difference function d'(tau).
 *   Step 3. Absolute threshold — first tau where d'(tau) < threshold
 *           and d' is at a local minimum.
 *   Step 4. Parabolic interpolation around the chosen tau for sub-
 *           sample precision (skipped step 5 "best local estimate"
 *           which only matters for off-line analysis).
 *
 * Returned `clarity` = 1 - d'(tau) so callers can gate on confidence
 * (low clarity = noisy / no clear pitch).
 */

export interface YinResult {
  /** Estimated fundamental frequency in Hz, or null if no clear
   *  pitch was found within the search range. */
  frequency: number | null;
  /** Confidence in [0, 1]. 1 - d'(tau) — values >= ~0.85 are very
   *  confident, < ~0.5 should usually be ignored. */
  clarity: number;
}

export interface YinOptions {
  /** Sample rate of the input buffer in Hz. */
  sampleRate: number;
  /** YIN absolute threshold. The paper recommends 0.10–0.15. Lower
   *  is stricter (fewer false positives, may miss soft notes). */
  threshold?: number;
  /** Minimum detectable frequency, in Hz. Defaults to 65 Hz (low
   *  bass C2 ≈ 65.4 Hz). Tightening this saves CPU. */
  minFrequency?: number;
  /** Maximum detectable frequency, in Hz. Defaults to 1500 Hz —
   *  covers everything up to a violin's high register. */
  maxFrequency?: number;
}

/**
 * Run YIN on a buffer of mono PCM samples. The buffer should be at
 * least 2 * sampleRate / minFrequency long (≈1500 samples at 48 kHz
 * for an 80 Hz floor); typical analyser buffer of 2048–4096 works.
 *
 * Allocates the difference-function array once per call. For a
 * realtime loop, prefer the `YinDetector` class below which reuses
 * its scratch buffer.
 */
export function yin(samples: Float32Array, opts: YinOptions): YinResult {
  const detector = new YinDetector(samples.length, opts);
  return detector.detect(samples);
}

export class YinDetector {
  private readonly halfLen: number;
  private readonly diff: Float32Array;
  private readonly cmnd: Float32Array;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly threshold: number;
  private readonly sampleRate: number;

  constructor(bufferLength: number, opts: YinOptions) {
    if (bufferLength < 64) throw new Error('YIN buffer too small');
    this.sampleRate = opts.sampleRate;
    this.threshold = opts.threshold ?? 0.12;

    // The difference function is defined for tau in [0, W) where
    // W = bufferLength / 2 — we need W samples on each side of the
    // lag to compute the sum. (Step 1 of the paper.)
    this.halfLen = Math.floor(bufferLength / 2);
    this.diff = new Float32Array(this.halfLen);
    this.cmnd = new Float32Array(this.halfLen);

    // Search range, converted from Hz to lag (tau = sampleRate / f).
    // tauMin must be > 0; clamp to >= 2 so the parabolic interpolation
    // around tau has neighbours on both sides.
    const fMin = opts.minFrequency ?? 65;
    const fMax = opts.maxFrequency ?? 1500;
    this.tauMin = Math.max(2, Math.floor(this.sampleRate / fMax));
    this.tauMax = Math.min(this.halfLen - 1, Math.ceil(this.sampleRate / fMin));
    if (this.tauMin >= this.tauMax) {
      throw new Error('YIN search range invalid for this sample rate / buffer length');
    }
  }

  /** Run one pitch estimate on the given buffer. Caller controls
   *  the cadence (typically once per animation frame on the latest
   *  audio buffer). */
  detect(samples: Float32Array): YinResult {
    if (samples.length < this.halfLen * 2) {
      return { frequency: null, clarity: 0 };
    }
    this.computeDifference(samples);
    this.cumulativeMeanNormalize();
    const tau = this.absoluteThreshold();
    if (tau === -1) return { frequency: null, clarity: 0 };

    const refinedTau = this.parabolicInterpolate(tau);
    const frequency = this.sampleRate / refinedTau;
    const clarity = Math.max(0, Math.min(1, 1 - this.cmnd[tau]!));
    return { frequency, clarity };
  }

  /** Step 1 — difference function d(tau) for tau in [tauMin, tauMax].
   *  We skip the [0, tauMin) range; it's never the answer. */
  private computeDifference(s: Float32Array): void {
    const W = this.halfLen;
    const diff = this.diff;
    diff[0] = 0;
    for (let tau = 1; tau < W; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const delta = s[i]! - s[i + tau]!;
        sum += delta * delta;
      }
      diff[tau] = sum;
    }
  }

  /** Step 2 — cumulative mean normalized difference d'(tau).
   *  d'(0) = 1; for tau >= 1, d'(tau) = d(tau) / ((1/tau) Σ d(j)). */
  private cumulativeMeanNormalize(): void {
    const diff = this.diff;
    const cmnd = this.cmnd;
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < diff.length; tau++) {
      runningSum += diff[tau]!;
      // Guard against /0 on pure-silence frames.
      cmnd[tau] = runningSum > 0 ? diff[tau]! * tau / runningSum : 1;
    }
  }

  /** Step 3 — find the first tau in [tauMin, tauMax] where the
   *  CMND falls below the threshold and is a local minimum. Falls
   *  through to the global minimum if no point clears the threshold
   *  (the paper's recommended behaviour for "no clear pitch"). */
  private absoluteThreshold(): number {
    const cmnd = this.cmnd;
    let tau = this.tauMin;
    while (tau <= this.tauMax) {
      if (cmnd[tau]! < this.threshold) {
        // Walk down to the local minimum at this dip.
        while (tau + 1 <= this.tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
        return tau;
      }
      tau++;
    }
    return -1; // no clear pitch
  }

  /** Step 4 — parabolic interpolation around (tau-1, tau, tau+1) of
   *  the CMND for sub-sample precision. Returns the refined tau as
   *  a real (non-integer) lag. */
  private parabolicInterpolate(tau: number): number {
    const cmnd = this.cmnd;
    const x0 = tau < 1 ? tau : tau - 1;
    const x2 = tau + 1 < cmnd.length ? tau + 1 : tau;
    if (x0 === tau) return cmnd[tau]! <= cmnd[x2]! ? tau : x2;
    if (x2 === tau) return cmnd[tau]! <= cmnd[x0]! ? tau : x0;
    const s0 = cmnd[x0]!;
    const s1 = cmnd[tau]!;
    const s2 = cmnd[x2]!;
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom === 0) return tau;
    return tau + (s2 - s0) / denom;
  }
}

/** RMS level of a buffer — used both for the input level meter and
 *  the silence gate (skip pitch detection on near-silent frames). */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}
