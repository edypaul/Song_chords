/**
 * Stabilisation layer that sits between raw pitch estimates and the
 * UI. A tuner that shows every YIN frame is unusable — the needle
 * jitters, octave errors flash through, and silence gives spurious
 * readings. This module fixes all three:
 *
 *   1. Silence gate by RMS — frames below the noise floor are
 *      ignored, the UI shows "—".
 *   2. Median filter (window=5) over the last few frequencies —
 *      kills single-frame outliers and octave errors.
 *   3. Exponential moving average (EMA) of the median output —
 *      smooths the needle so it glides instead of twitches.
 *   4. Note-stability latch — only "commit" a detected note once
 *      it's been the median pick for N consecutive frames. The UI
 *      reads the *latched* note for the big display but the *EMA*
 *      cents for the needle, so the needle is responsive but the
 *      note name doesn't flicker between, say, A and G# while
 *      bending into a string.
 */

import { centsBetween } from './note';

export interface SmootherOptions {
  /** Linear-amplitude RMS below which the input is treated as silence. */
  silenceRms?: number;
  /** Median filter window. Odd number, 3–7 is sensible. */
  medianWindow?: number;
  /** EMA smoothing factor for the cents needle, in (0, 1]. Higher =
   *  more responsive, lower = smoother. */
  emaAlpha?: number;
  /** A new note must be the median pick for this many consecutive
   *  frames before it replaces the latched note. */
  stabilityFrames?: number;
  /** Two frequencies within this many cents are considered "the
   *  same note" for stability counting. */
  stabilitySlackCents?: number;
}

export interface SmoothedReading {
  /** Smoothed frequency the needle should track, or null for silence.
   *  This is the EMA — moves fluidly with every frame so the needle
   *  glides. For NOTE IDENTITY (the big-letter display, the cents
   *  target) the caller should prefer `latched` when present. */
  frequency: number | null;
  /**
   * The LATCHED frequency — the pitch that's been the candidate for
   * at least `stabilityFrames` consecutive frames. Use this as the
   * anchor for the displayed note name and the cents target: it
   * doesn't flip on a single-frame YIN octave error, so the big
   * letter stays steady while you nudge the string into tune. Falls
   * back to null until the first latch happens.
   */
  latched: number | null;
  /** True once the latched note has settled (UI uses this to switch
   *  the big display colour from "searching" to "locked"). */
  stable: boolean;
  /** Confidence carried through from the latest YIN result. */
  clarity: number;
  /** Linear-amplitude RMS — drives the input level meter. */
  level: number;
  /** Progress toward "stable" in [0, 1] — how many consecutive
   *  same-pitch frames have arrived divided by the target frame
   *  count. UI can render this as a stability %. */
  stability: number;
}

export class PitchSmoother {
  private silenceRms: number;
  private readonly medianWindow: number;
  private readonly emaAlpha: number;
  private readonly stabilityFrames: number;
  private readonly stabilitySlackCents: number;

  private history: number[] = [];
  private ema: number | null = null;
  private latched: number | null = null;
  private candidate: number | null = null;
  private candidateCount = 0;
  private stable = false;

  constructor(opts: SmootherOptions = {}) {
    this.silenceRms = opts.silenceRms ?? 0.008;
    // Wider median (was 5) — 9 frames at ~60 fps ≈ 150 ms which
    // kills isolated YIN outliers without making the response feel
    // sluggish. Outliers were the main reason the needle "jumped
    // all over the place" even while playing a steady note.
    this.medianWindow = Math.max(1, opts.medianWindow ?? 9);
    // Calmer EMA (was 0.35) — the page now applies its own adaptive
    // smoothing in cents-space on top of this, so the upstream Hz
    // stream should be gently filtered, not snappy.
    this.emaAlpha = Math.min(1, Math.max(0.01, opts.emaAlpha ?? 0.22));
    // Bumped 4 → 6 frames. At 60 Hz detection that's ~100 ms — long
    // enough to defeat single-frame YIN errors (the "all notes
    // flash" bug) but short enough that a real pitch change still
    // commits in 1/10 of a second.
    this.stabilityFrames = Math.max(1, opts.stabilityFrames ?? 6);
    // Tightened 20 → 30 ¢. The candidate counter now treats anything
    // within ±30 ¢ as "the same note" — so micro pitch drift while
    // bending into tune doesn't keep resetting the candidate counter.
    this.stabilitySlackCents = Math.max(0.1, opts.stabilitySlackCents ?? 30);
  }

  /** Adjust the silence-RMS gate at runtime (driven by the
   *  sensitivity UI). Higher = stricter (ignores quiet input). */
  setSilenceRms(v: number): void {
    this.silenceRms = Math.max(0, v);
  }

  /** Reset all state — call when switching instrument / tuning so
   *  the latched note doesn't carry over. */
  reset(): void {
    this.history = [];
    this.ema = null;
    this.latched = null;
    this.candidate = null;
    this.candidateCount = 0;
    this.stable = false;
  }

  /**
   * Feed one YIN frame plus the buffer's RMS level. Returns the
   * smoothed reading the UI should render.
   */
  push(rawFrequency: number | null, clarity: number, level: number): SmoothedReading {
    // Silence / low-confidence → no reading, but level still flows
    // through so the input meter stays live.
    if (level < this.silenceRms || rawFrequency === null || clarity < 0.5) {
      // Decay the candidate run so the UI eventually shows "no signal".
      this.candidate = null;
      this.candidateCount = 0;
      // Keep the EMA history + latched note so a brief silence
      // between picks doesn't reset the displayed note. `stable`
      // stays true until a DIFFERENT pitch is confirmed by the
      // latch path below — that's why the note identity doesn't
      // flicker when the string decays between strums.
      return {
        frequency: this.ema,
        latched: this.latched,
        stable: this.stable,
        clarity, level,
        stability: 0,
      };
    }

    // ── Octave-error guard ────────────────────────────────────────
    // YIN occasionally locks onto a 2× or 0.5× partial for one or
    // two frames (especially on transients / fingerstyle attacks).
    // If we have an established latched note and the new raw frame
    // is more than ~600 ¢ away (more than a tritone — basically a
    // different note or a different octave), DROP it from the
    // median + EMA pipeline. We still count it as a "different
    // candidate" so a genuine pitch change eventually wins — but
    // it takes the full `stabilityFrames` of consistent off-pitch
    // frames to unseat the latch. Without this, a single bad frame
    // would dominate the small median window and pull the EMA out
    // of the right note, swinging the needle wildly.
    let useFrame = rawFrequency;
    const isOctaveOutlier =
      this.latched !== null &&
      Math.abs(centsBetween(rawFrequency, this.latched)) > 600;
    if (isOctaveOutlier) {
      // Pull the candidate counter toward "the latch should change",
      // but DON'T poison the EMA / median that drive the needle.
      // The candidate logic below will count consecutive outliers;
      // until the count hits stabilityFrames the displayed note
      // stays anchored to the latched pitch.
      useFrame = this.latched!;
    }

    // 1) Median filter on the (filtered) frame stream.
    this.history.push(useFrame);
    if (this.history.length > this.medianWindow) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    // 2) EMA for the needle. Operates on the median, NOT the raw
    //    YIN frame, so a single-frame outlier already lost most of
    //    its weight before reaching the EMA.
    this.ema = this.ema === null ? median : this.ema + this.emaAlpha * (median - this.ema);

    // 3) Candidate / latch update.
    //    The candidate is updated against the RAW frame so a real
    //    pitch change still accumulates frames toward unseating the
    //    latch. The median/EMA used by the needle is anchored to the
    //    latched note via the outlier guard above.
    if (this.candidate === null) {
      this.candidate = rawFrequency;
      this.candidateCount = 1;
    } else if (Math.abs(centsBetween(rawFrequency, this.candidate)) <= this.stabilitySlackCents) {
      this.candidateCount++;
    } else {
      this.candidate = rawFrequency;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= this.stabilityFrames) {
      // Promoting the candidate to the latched note. If it's an
      // actual pitch change (a different note), the EMA + median
      // were anchored to the old latch via the outlier guard, so
      // they're stale now — re-seed them from the new latch so the
      // needle snaps cleanly to the new note instead of drifting
      // through the old one.
      const isPitchChange =
        this.latched !== null &&
        Math.abs(centsBetween(this.candidate, this.latched)) > 600;
      this.latched = this.candidate;
      this.stable = true;
      if (isPitchChange) {
        this.ema = this.candidate;
        this.history = [this.candidate];
      }
    }

    // Stability percentage = how close the current candidate run is
    // to the latch threshold.
    const stability = Math.min(1, this.candidateCount / this.stabilityFrames);

    return {
      frequency: this.ema,
      latched: this.latched,
      stable: this.stable,
      clarity, level,
      stability,
    };
  }
}
