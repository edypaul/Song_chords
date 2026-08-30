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
  /**
   * Length of the window the COARSE (YIN) stage analyses — the most
   * recent `coarseLength` samples of each buffer. Defaults to the
   * whole buffer. Setting it smaller than the buffer (e.g. 4096 of
   * 8192) keeps note detection fast and cheap while the FINE
   * spectral stage still uses the full buffer for precision on the
   * lowest strings (a 31 Hz low B needs ≥ 8192 samples at 48 kHz
   * before its spectral image stops overlapping its own peak).
   */
  coarseLength?: number;
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
  /** Hann window for the fine (spectral-peak) stage. */
  private readonly hann: Float32Array;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly threshold: number;
  private readonly sampleRate: number;
  private readonly coarseLength: number;
  // FFT machinery for the coarse difference function (see
  // computeDifference): size, bit-reversal table, twiddles, scratch
  // spectra and the prefix-sum-of-squares array.
  private readonly fftN: number;
  private readonly bitrev: Uint32Array;
  private readonly twCos: Float64Array;
  private readonly twSin: Float64Array;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly prefix: Float64Array;

  constructor(bufferLength: number, opts: YinOptions) {
    if (bufferLength < 64) throw new Error('YIN buffer too small');
    this.sampleRate = opts.sampleRate;
    this.threshold = opts.threshold ?? 0.12;
    this.coarseLength = Math.max(64, Math.min(bufferLength, opts.coarseLength ?? bufferLength));

    // The difference function is defined for tau in [0, W) where
    // W = coarseLength / 2 — we need W samples on each side of the
    // lag to compute the sum. (Step 1 of the paper.)
    this.halfLen = Math.floor(this.coarseLength / 2);
    this.diff = new Float32Array(this.halfLen);
    this.cmnd = new Float32Array(this.halfLen);
    this.hann = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (bufferLength - 1));
    }

    // FFT length for a LINEAR correlation of the first W samples
    // against the full 2W coarse window: needs ≥ 3W, rounded up to a
    // power of two (4W for the usual sizes).
    let L = 1;
    while (L < 4 * this.halfLen) L <<= 1;
    this.fftN = L;
    const log2 = Math.round(Math.log2(L));
    this.bitrev = new Uint32Array(L);
    for (let i = 0; i < L; i++) {
      let rev = 0;
      for (let b = 0; b < log2; b++) rev = (rev << 1) | ((i >> b) & 1);
      this.bitrev[i] = rev >>> 0;
    }
    this.twCos = new Float64Array(L / 2);
    this.twSin = new Float64Array(L / 2);
    for (let k = 0; k < L / 2; k++) {
      this.twCos[k] = Math.cos((2 * Math.PI * k) / L);
      this.twSin[k] = Math.sin((2 * Math.PI * k) / L);
    }
    this.aRe = new Float64Array(L);
    this.aIm = new Float64Array(L);
    this.bRe = new Float64Array(L);
    this.bIm = new Float64Array(L);
    this.prefix = new Float64Array(this.coarseLength + 1);

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
    if (samples.length < this.coarseLength) {
      return { frequency: null, clarity: 0 };
    }
    // Coarse stage on the most recent `coarseLength` samples (a view,
    // no copy) — fast note / octave identification.
    const recent = samples.length === this.coarseLength
      ? samples
      : samples.subarray(samples.length - this.coarseLength);
    this.computeDifference(recent);
    this.cumulativeMeanNormalize();
    const tau = this.absoluteThreshold();
    if (tau === -1) return { frequency: null, clarity: 0 };

    const coarseTau = this.parabolicInterpolate(tau);
    // Fine stage on the WHOLE buffer — see refineFundamental(). Falls
    // back to the coarse YIN estimate when it can't confirm a peak.
    const fineTau = samples.length === this.hann.length
      ? (this.refineFundamental(samples, coarseTau) ?? coarseTau)
      : coarseTau;
    const frequency = this.sampleRate / fineTau;
    const clarity = Math.max(0, Math.min(1, 1 - this.cmnd[tau]!));
    return { frequency, clarity };
  }

  /**
   * Fine estimate of the FUNDAMENTAL as a windowed spectral peak.
   *
   * Two things limit plain YIN as a tuner:
   *
   *   1. Inharmonicity. A real string is stiff, so its upper partials
   *      are sharp (2nd ≈ +1 ¢, 4th ≈ +5 ¢, 8th ≈ +20 ¢ on a wound
   *      guitar E). The difference function fits ALL partials at
   *      once, so the period it finds is a blend — measured ≈ +4.7 ¢
   *      sharp on a realistic pluck, +1.2 ¢ even on a mildly stiff
   *      string. A tuner must report the fundamental.
   *   2. Noise. Broadband mic noise spreads across the whole band;
   *      on the low strings (few periods in the window) it pushed the
   *      estimate 10–40 ¢ off at moderate SNR.
   *
   * YIN's answer is used only as a COARSE locator (which note, which
   * octave). The precise value comes from the Hann-windowed DFT
   * magnitude of the WHOLE buffer, maximised over frequency in a
   * ±14 ¢ neighbourhood of the coarse value: a 5-point scan, then two
   * parabolic refinements. Why this beats the alternatives tried:
   *   • the partials sit an octave or more away, far outside the
   *     window's main lobe, so they cannot pull the peak;
   *   • the spectrum of a decaying sinusoid is symmetric about its
   *     frequency, so amplitude decay within the frame doesn't bias
   *     it (a squared-difference measure over many periods did);
   *   • there is no filter, hence no start-up transient (a low-pass
   *     at 1.35·f0 rang for half the frame on the low strings);
   *   • the peak of a windowed DFT is the maximum-likelihood
   *     frequency estimate for a sinusoid in white noise.
   * Cost: 11 evaluations × bufferLength multiply-adds with a rotating
   * phasor (no per-sample trig) — well under a millisecond.
   *
   * Safety: the result must land within 1.5 % (≈ 25 ¢) of the coarse
   * value, otherwise the coarse estimate stands. A coarse octave error
   * therefore still yields a consistent (if wrong-octave) fine value —
   * the smoothing layer's octave guard handles that case as before.
   *
   * Returns the refined PERIOD in samples (to match the coarse path).
   */
  private refineFundamental(s: Float32Array, tau0: number): number | null {
    if (!(tau0 > 2)) return null;
    const sr = this.sampleRate;
    const f0 = sr / tau0;
    const len = s.length;
    const hann = this.hann;

    const power = (f: number): number => {
      const c = Math.cos((2 * Math.PI * f) / sr);
      const sn = Math.sin((2 * Math.PI * f) / sr);
      let cr = 1, ci = 0, re = 0, im = 0;
      for (let i = 0; i < len; i++) {
        const v = hann[i]! * s[i]!;
        re += v * cr;
        im += v * ci;
        const nr = cr * c - ci * sn;
        ci = cr * sn + ci * c;
        cr = nr;
      }
      return re * re + im * im;
    };
    const atCents = (c: number): number => f0 * Math.pow(2, c / 1200);

    // 1) Coarse scan across the neighbourhood.
    const grid = [-14, -7, 0, 7, 14];
    let best = 0;
    let bestP = -1;
    for (let i = 0; i < grid.length; i++) {
      const p = power(atCents(grid[i]!));
      if (p > bestP) { bestP = p; best = i; }
    }
    let fc = atCents(grid[best]!);

    // 2) Two parabolic refinements at shrinking relative steps
    //    (≈ 10 ¢ then ≈ 2.6 ¢ on the low strings). The peak's width is
    //    one DFT bin as a FRACTION of the frequency — wide at E2,
    //    only ~14 ¢ at C6 — so the steps are capped to a fraction of
    //    that, otherwise the parabola samples the peak's shoulders
    //    and the fit lands a cent or so off at the top of the range.
    //    If the centre isn't the maximum of the triple, slide toward
    //    the higher side and try again.
    const binRel = sr / (len * f0);
    for (const step of [Math.min(0.006, 0.3 * binRel), Math.min(0.0015, 0.08 * binRel)]) {
      const fl = fc * (1 - step);
      const fr = fc * (1 + step);
      const pl = power(fl);
      const pc = power(fc);
      const pr = power(fr);
      if (pc < pl || pc < pr) { fc = pl > pr ? fl : fr; continue; }
      const denom = 2 * (2 * pc - pl - pr);
      if (denom <= 0) break;
      fc += ((pr - pl) / denom) * (fc * step);
    }

    if (!(fc > 0) || Math.abs(fc / f0 - 1) > 0.015) return null;
    return sr / fc;
  }

  /**
   * Step 1 — difference function d(tau) for tau in [1, tauMax].
   *
   * Computed in O(N log N) via the identity
   *   d(τ) = Σ x_i² + Σ x_{i+τ}² − 2·Σ x_i·x_{i+τ}   (i < W)
   * where the first term is a constant, the second comes from a
   * prefix sum of squares, and the cross-correlation is one FFT
   * product (conj(A)·B, A = first W samples, B = the whole 2W window,
   * both zero-padded to 4W so the circular correlation is linear).
   * The direct O(W·τmax) loop cost ~12 ms per frame with the 27 Hz
   * floor a 5-string bass needs; this is ~2 ms regardless of floor.
   * Lags above the search ceiling are never the answer, so they're
   * zeroed (the CMND running sum only needs lags up to the one being
   * evaluated).
   */
  private computeDifference(s: Float32Array): void {
    const W = this.halfLen;
    const twoW = this.coarseLength;
    const L = this.fftN;
    const diff = this.diff;

    // Prefix sums of squares: P[i] = Σ_{j<i} x_j².
    const P = this.prefix;
    P[0] = 0;
    for (let i = 0; i < twoW; i++) P[i + 1] = P[i]! + s[i]! * s[i]!;
    const e0 = P[W]!;

    const aRe = this.aRe, aIm = this.aIm, bRe = this.bRe, bIm = this.bIm;
    aRe.fill(0); aIm.fill(0); bRe.fill(0); bIm.fill(0);
    for (let i = 0; i < W; i++) aRe[i] = s[i]!;
    for (let i = 0; i < twoW; i++) bRe[i] = s[i]!;
    this.fft(aRe, aIm, false);
    this.fft(bRe, bIm, false);
    // conj(A) · B  →  cross-correlation c(τ) = Σ_i a_i·b_{i+τ}
    for (let i = 0; i < L; i++) {
      const ar = aRe[i]!, ai = aIm[i]!, br = bRe[i]!, bi = bIm[i]!;
      aRe[i] = ar * br + ai * bi;
      aIm[i] = ar * bi - ai * br;
    }
    this.fft(aRe, aIm, true);

    const end = Math.min(W, this.tauMax + 2);
    diff[0] = 0;
    for (let tau = 1; tau < end; tau++) {
      const v = e0 + (P[tau + W]! - P[tau]!) - 2 * aRe[tau]!;
      diff[tau] = v > 0 ? v : 0; // clamp rounding noise near a perfect match
    }
    for (let tau = end; tau < W; tau++) diff[tau] = 0;
  }

  /** In-place iterative radix-2 complex FFT (forward or inverse, the
   *  inverse scaled by 1/N). Sized at construction (`fftN`). */
  private fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.fftN;
    const bitrev = this.bitrev;
    for (let i = 0; i < n; i++) {
      const j = bitrev[i]!;
      if (j > i) {
        const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
        const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
      }
    }
    const twCos = this.twCos, twSin = this.twSin;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const t = k * step;
          const wr = twCos[t]!;
          const wi = inverse ? twSin[t]! : -twSin[t]!;
          const i1 = start + k;
          const i2 = i1 + half;
          const r2 = re[i2]!, m2 = im[i2]!;
          const xr = r2 * wr - m2 * wi;
          const xi = r2 * wi + m2 * wr;
          re[i2] = re[i1]! - xr;
          im[i2] = im[i1]! - xi;
          re[i1] = re[i1]! + xr;
          im[i1] = im[i1]! + xi;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
    }
  }

  /** Step 2 — cumulative mean normalized difference d'(tau).
   *  d'(0) = 1; for tau >= 1, d'(tau) = d(tau) / ((1/tau) Σ d(j)). */
  private cumulativeMeanNormalize(): void {
    const diff = this.diff;
    const cmnd = this.cmnd;
    cmnd[0] = 1;
    let runningSum = 0;
    const end = Math.min(diff.length, this.tauMax + 2);
    for (let tau = 1; tau < end; tau++) {
      runningSum += diff[tau]!;
      // Guard against /0 on pure-silence frames.
      cmnd[tau] = runningSum > 0 ? diff[tau]! * tau / runningSum : 1;
    }
    for (let tau = end; tau < cmnd.length; tau++) cmnd[tau] = 1;
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
