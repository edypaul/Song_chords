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
  /** Musical weight (≥ 0; lines with 0 are ignored). */
  w: number;
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
 * Build the time→reading-position knots. Reading starts at y = 0 (the
 * container top — the header block above the first line is crossed
 * during the first line's slice) and ends at the last content line's
 * bottom. Knots are strictly non-decreasing in both axes.
 */
export function buildKnots(entries: ProfileEntry[], sungDuration: number): Knot[] {
  const lines = entries.filter((e) => e.w > 0).sort((a, b) => a.y - b.y);
  if (lines.length === 0) return [];
  const totalW = lines.reduce((s, e) => s + e.w, 0);
  const knots: Knot[] = [{ t: 0, y: 0 }];
  let tAcc = 0;
  for (let i = 0; i < lines.length; i++) {
    tAcc += (lines[i]!.w / totalW) * sungDuration;
    // Each line's slice carries the reading position to the NEXT
    // line's top (crossing any zero-weight chrome in between); the
    // last line carries it to its own bottom edge.
    const targetY = i + 1 < lines.length ? lines[i + 1]!.y : lines[i]!.bottom;
    knots.push({ t: tAcc, y: Math.max(targetY, knots[knots.length - 1]!.y) });
  }
  return knots;
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
