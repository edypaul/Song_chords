/**
 * Time→position mapping for duration-paced auto-scroll.
 *
 * The naive duration model (constant px/s over the whole scroll range)
 * treats every pixel as equal singing time — so section-title chips,
 * blank separators, and the extra height of inline chord diagrams all
 * "consume" song time, and {pause: N} holds are added ON TOP of the
 * full duration (the scroll finishes late by the sum of the pauses).
 *
 * This module builds a piecewise-linear map from ELAPSED SUNG TIME to
 * the READING position instead:
 *
 *   • Only content lines (chord/lyric lines, chord grids) carry
 *     musical time. Each line gets a share of the sung duration
 *     proportional to its weight (1 per line; a chord grid weighs its
 *     row count) — NOT to its pixel height, so a diagram-inflated
 *     line sings for the same time as its plain-text rendering.
 *   • Section titles, comments-as-chips, blank lines and pause chips
 *     get zero weight: the scroll glides over them inside the
 *     neighbouring lines' time slices.
 *   • The sung duration is the song duration MINUS the total
 *     {pause: N} seconds — the stored duration already includes those
 *     instrumental holds, which the scroller spends stopped at the
 *     markers instead.
 *   • Pixel positions are re-measured whenever the container geometry
 *     changes (zoom, inline-diagram toggle, window resize); elapsed
 *     sung time is the invariant that survives the remap.
 */

export interface ProfileEntry {
  /** Content-space y of the line's top (scrollTop coordinates). */
  y: number;
  /** Content-space y of the line's bottom. */
  bottom: number;
  /** Relative sung weight (syllable-based). Mutually exclusive with
   *  `seconds`; entries with neither (or 0/negative) are ignored. */
  w?: number;
  /** ABSOLUTE seconds for bar-timed instrumental blocks (chord grids,
   *  chord-only riff lines) computed from tempo × time signature.
   *  Takes precedence over `w`. */
  seconds?: number;
}

export interface Knot { t: number; y: number }

/** Minimum fraction of the song duration that must remain for reading
 *  even when the declared pauses add up to (nearly) the whole song —
 *  guards against a frozen scroll from over-declared pauses. */
export const MIN_SUNG_FRACTION = 0.2;

export function sungDurationFor(durationSeconds: number, totalPauseSeconds: number): number {
  return Math.max(durationSeconds - totalPauseSeconds, durationSeconds * MIN_SUNG_FRACTION);
}

/**
 * Rough syllable count for a lyric line — vowel-group counting, which
 * tracks Spanish closely and English well enough for RELATIVE line
 * weights (only ratios between lines matter here).
 */
export function estimateSyllables(text: string): number {
  const m = text.toLowerCase().match(/[aeiouyáéíóúüàèìòùâêîôûäëïöãõ]+/g);
  return m ? m.length : 0;
}

/** Smoothing added to each sung line's syllable count before it is
 *  used as a weight: every line also carries a fixed share of breath /
 *  fill time, so a 4-syllable interjection isn't paced 3× faster than
 *  a 12-syllable line. */
export const LINE_WEIGHT_SMOOTHING = 4;

export function lineWeightFromSyllables(syllables: number): number {
  return syllables + LINE_WEIGHT_SMOOTHING;
}

/** Seconds one bar lasts at the given tempo/time signature, or null
 *  when the tempo is missing/invalid (bar-timed blocks then fall back
 *  to relative weights). */
export function barSecondsFor(tempo: number | undefined, timeSig: string | undefined): number | null {
  if (!tempo || tempo <= 0) return null;
  const beats = parseInt((timeSig ?? '4/4').split('/')[0] ?? '4', 10);
  const beatsPerBar = Number.isFinite(beats) && beats > 0 ? beats : 4;
  return beatsPerBar * (60 / tempo);
}

/**
 * Fit the absolute (bar-timed) seconds into the budget that remains
 * after pauses. If the declared instrumental time would eat more than
 * 80 % of it (wrong tempo, over-long grids), every absolute slice is
 * scaled down so at least 20 % of the budget is left for the sung
 * lines. Returns the scale for absolute slices and the sung budget.
 */
export function fitBudget(
  durationSeconds: number,
  totalPauseSeconds: number,
  fixedSeconds: number,
): { fixedScale: number; sungDuration: number } {
  const avail = sungDurationFor(durationSeconds, totalPauseSeconds);
  const maxFixed = avail * 0.8;
  const fixedScale = fixedSeconds > maxFixed && fixedSeconds > 0 ? maxFixed / fixedSeconds : 1;
  const sungDuration = Math.max(avail - fixedSeconds * fixedScale, avail * 0.2);
  return { fixedScale, sungDuration };
}

/**
 * Build the time→reading-position knots. Reading starts at the FIRST
 * timed line's top — the title / artist / details header above it
 * occupies pixels but zero song time (the start ramp in
 * `anchorOffsetFor` bridges the visual gap) — and ends at the last
 * content line's bottom. Knots are strictly non-decreasing in both
 * axes.
 *
 * `sungDuration` is distributed across the WEIGHTED entries in
 * proportion to `w`; entries carrying `seconds` contribute exactly
 * that many seconds regardless.
 */
export function buildKnots(entries: ProfileEntry[], sungDuration: number): Knot[] {
  const lines = entries
    .filter((e) => (e.seconds ?? 0) > 0 || (e.w ?? 0) > 0)
    .sort((a, b) => a.y - b.y);
  if (lines.length === 0) return [];
  const totalW = lines.reduce((s, e) => s + (e.seconds !== undefined ? 0 : (e.w ?? 0)), 0);
  const knots: Knot[] = [{ t: 0, y: lines[0]!.y }];
  let tAcc = 0;
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i]!;
    tAcc += e.seconds !== undefined
      ? e.seconds
      : totalW > 0 ? ((e.w ?? 0) / totalW) * sungDuration : 0;
    // Each line's slice carries the reading position to the NEXT
    // line's top (crossing any zero-weight chrome in between); the
    // last line carries it to its own bottom edge.
    const targetY = i + 1 < lines.length ? lines[i + 1]!.y : lines[i]!.bottom;
    knots.push({ t: tAcc, y: Math.max(targetY, knots[knots.length - 1]!.y) });
  }
  return knots;
}

/**
 * Effective anchor offset between the reading position and scrollTop
 * (pos = readPos − offset). The reading position starts at the map's
 * first knot (`mapStart` — the first line's top, BELOW the title /
 * details header), while the page starts at scrollTop 0 — so the
 * offset starts at exactly `mapStart` (pos 0) and converges to the
 * regular anchor as reading progresses:
 *   • header shorter than the anchor → offset grows at half the
 *     reading rate (page moves immediately at half speed — the
 *     original lead-in ramp);
 *   • header taller than the anchor → offset shrinks (page catches
 *     up at 1.5× until the sung line rises to the anchor).
 */
export function anchorOffsetFor(readPos: number, mapStart: number, anchor: number): number {
  const progressed = Math.max(0, readPos - mapStart);
  return mapStart <= anchor
    ? Math.min(anchor, mapStart + progressed / 2)
    : Math.max(anchor, mapStart - progressed / 2);
}

/** Inverse of `anchorOffsetFor`: the reading position whose mapped
 *  scroll offset is `scrollTop`. Used to (re)seed after a manual
 *  scroll or at start so re-anchoring is continuous with the ramp. */
export function seedReadPosForScroll(scrollTop: number, mapStart: number, anchor: number): number {
  if (scrollTop <= 0) return mapStart;
  if (mapStart <= anchor) {
    const rampEndPos = anchor - mapStart; // scrollTop where the offset reaches the anchor
    return scrollTop < rampEndPos ? mapStart + 2 * scrollTop : scrollTop + anchor;
  }
  const rampEndPos = 3 * (mapStart - anchor);
  return scrollTop < rampEndPos ? mapStart + (2 / 3) * scrollTop : scrollTop + anchor;
}

/** Elapsed sung time → reading position (clamped, linear between knots). */
export function knotsTimeToPos(knots: Knot[], t: number): number {
  if (knots.length === 0) return 0;
  if (t <= knots[0]!.t) return knots[0]!.y;
  const last = knots[knots.length - 1]!;
  if (t >= last.t) return last.y;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.y;
      return a.y + ((t - a.t) / span) * (b.y - a.y);
    }
  }
  return last.y;
}

/** Reading position → elapsed sung time (inverse of the above). For an
 *  interior flat pixel span the EARLIEST matching time is returned; a
 *  position at/past the final knot returns the full sung duration. */
export function knotsPosToTime(knots: Knot[], y: number): number {
  if (knots.length === 0) return 0;
  if (y <= knots[0]!.y) return knots[0]!.t;
  const last = knots[knots.length - 1]!;
  if (y >= last.y) return last.t;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    if (y <= b.y) {
      const span = b.y - a.y;
      if (span <= 0) return a.t;
      return a.t + ((y - a.y) / span) * (b.t - a.t);
    }
  }
  return last.t;
}
