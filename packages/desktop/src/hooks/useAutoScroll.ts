import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@song-chords/shared';
import {
  buildKnots, knotsTimeToPos, knotsPosToTime, sungDurationFor,
  type Knot, type ProfileEntry,
} from '../utils/duration-profile';

/** Fire offset for {pause: N} markers, measured from the viewport's top
 * edge. Zero = the marker fires the instant its bottom border meets the
 * top of the visible area (i.e., the chip has just scrolled out of view). */
const PAUSE_FIRE_OFFSET_PX = 0;

/**
 * Where the "line being sung" sits in the viewport during
 * duration-paced scrolling, as a fraction of the container height
 * from the top. Musicians read a bit above centre; keeping the sung
 * line ~35 % down leaves the upcoming lines visible below it.
 */
const READ_ANCHOR_FRACTION = 0.35;

function parseDurationToSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const parts = duration.split(':');
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0]!, 10);
  const secs = parseInt(parts[1]!, 10);
  if (isNaN(mins) || isNaN(secs) || secs >= 60) return null;
  return mins * 60 + secs;
}

export function useAutoScroll(containerRef: React.RefObject<HTMLElement>): void {
  const { autoScrollActive, autoScrollSpeed, autoScrollMode, activeSong, toggleAutoScroll, perfStop } = usePlayerStore();
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Force auto-scroll OFF when the host page unmounts (leaving the
  // Song view, Perform, or fullscreen page). Without this the store
  // would stay in `autoScrollActive: true` while no scroll container
  // exists; the next time the user opened a song the scroll would
  // already be "running" with nothing to scroll, which surfaces as a
  // jammed Play button and a stale toggle state. We write directly to
  // the store (rather than calling `toggleAutoScroll`) so it's
  // idempotent — if it was already off, nothing changes.
  useEffect(() => {
    return () => {
      if (usePlayerStore.getState().autoScrollActive) {
        usePlayerStore.setState({ autoScrollActive: false });
      }
    };
  }, []);
  // Fractional scroll position we're tracking internally (avoids rounding losing sub-pixel progress)
  const posRef = useRef<number>(0);
  // Duration mode tracks the READING position (the content y of the
  // line currently being sung), not the scrollTop. scrollTop follows
  // it, clamped so the sung line stays at the anchor point. See the
  // duration branch in `tick` for the full model.
  const readPosRef = useRef<number>(0);
  // The scrollTop we last programmatically set — used to detect manual scroll
  const lastSetRef = useRef<number>(0);
  // Duration-mode time→position profile, built from the rendered
  // content lines (see utils/duration-profile.ts). Rebuilt whenever
  // the container geometry changes — zoom, inline-diagram toggle,
  // window resize — with the elapsed sung time carried across the
  // rebuild so the reading position lands on the same LINE in the new
  // layout.
  const profileRef = useRef<{ knots: Knot[]; sungDuration: number; geomKey: string } | null>(null);
  // Elapsed SUNG seconds (excludes {pause} holds). null = derive from
  // the current reading position on the next frame (fresh start, or
  // the user scrolled manually).
  const elapsedRef = useRef<number | null>(null);
  // Timestamp (performance.now()) until which scrolling is paused because
  // we crossed a {pause: N} marker. 0 = no pause active.
  const pauseUntilRef = useRef<number>(0);
  // Markers we've already triggered this run so a single pause directive
  // doesn't keep firing every frame.
  const consumedMarkersRef = useRef<Set<Element>>(new Set());

  useEffect(() => {
    if (!autoScrollActive) {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
        lastTimeRef.current = null;
      }
      // Reset pause/consumed state so a fresh run from the top can fire
      // markers again.
      pauseUntilRef.current = 0;
      consumedMarkersRef.current = new Set();
      profileRef.current = null;
      elapsedRef.current = null;
      return;
    }

    // Sync internal position to wherever the page is right now when starting
    const container = containerRef.current;
    if (container) {
      posRef.current = container.scrollTop;
      lastSetRef.current = container.scrollTop;
      // Duration mode: seed the reading position consistently with the
      // anchor ramp in the tick below (anchorEff = min(anchor,
      // readPos/2)), so starting/resuming never jumps the page:
      //   • at the very top → 0 (the singer starts at the first line);
      //   • within the ramp zone (scrollTop < anchor) → 2·scrollTop;
      //   • below it → scrollTop + anchor (sung line at the anchor).
      const seedAnchor = container.clientHeight * READ_ANCHOR_FRACTION;
      readPosRef.current = container.scrollTop <= 2
        ? 0
        : container.scrollTop < seedAnchor
          ? 2 * container.scrollTop
          : container.scrollTop + seedAnchor;
      // Fresh run: rebuild the duration profile and re-derive elapsed
      // sung time from the seeded reading position on the first frame.
      profileRef.current = null;
      elapsedRef.current = null;
      // Consume any pause markers whose TOP edge is already at / above
      // the fire line at startup. We use getBoundingClientRect so the
      // measurement stays correct even when CSS `zoom` is applied to the
      // song body (perform-mode zoom) — offsetTop alone reports pre-zoom
      // layout coords and would mis-trigger when zoom ≠ 100%.
      const startMarkers = container.querySelectorAll<HTMLElement>('[data-pause]');
      const startContainerTop = container.getBoundingClientRect().top;
      for (const m of startMarkers) {
        const relTop = m.getBoundingClientRect().top - startContainerTop;
        if (relTop <= PAUSE_FIRE_OFFSET_PX) {
          consumedMarkersRef.current.add(m);
        }
      }
    }

    const durationSeconds = parseDurationToSeconds(activeSong?.duration);

    const tick = (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const deltaMs = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const el = containerRef.current;
      if (el) {
        // If container.scrollTop differs from what we last set, the user scrolled manually.
        // Absorb that offset into our tracked position so we continue from there.
        // (This also absorbs layout reflows — toggling inline diagrams or
        // zoom mid-run re-syncs both trackers to the new geometry.)
        if (Math.abs(el.scrollTop - lastSetRef.current) > 2) {
          posRef.current = el.scrollTop;
          // Same seeding rule as at start (see above) so re-anchoring
          // after a manual scroll is continuous with the anchor ramp.
          const a = el.clientHeight * READ_ANCHOR_FRACTION;
          readPosRef.current = el.scrollTop < a ? 2 * el.scrollTop : el.scrollTop + a;
          // Elapsed sung time no longer matches the page position —
          // re-derive it from the new reading position next frame.
          elapsedRef.current = null;
        }

        // {pause: N} markers — fire when the TOP edge of the indicator
        // chip reaches the top of the visible scroll container. We
        // measure with getBoundingClientRect so the comparison stays
        // accurate even when the inner song body has CSS `zoom` applied
        // (perform-mode zoom). Each marker fires only once per run.
        const markers = el.querySelectorAll<HTMLElement>('[data-pause]');
        const containerTop = el.getBoundingClientRect().top;
        for (const marker of markers) {
          if (consumedMarkersRef.current.has(marker)) continue;
          const relTop = marker.getBoundingClientRect().top - containerTop;
          if (relTop <= PAUSE_FIRE_OFFSET_PX) {
            const seconds = parseFloat(marker.dataset.pause ?? '0');
            if (seconds > 0) {
              pauseUntilRef.current = timestamp + seconds * 1000;
            }
            consumedMarkersRef.current.add(marker);
            // Only consume one marker per frame so back-to-back pauses
            // don't all collapse into a single pause window.
            break;
          }
        }

        // Skip scrolling while a pause is active.
        const isPaused = pauseUntilRef.current > timestamp;
        if (!isPaused) {
          // The section navigator can mount a `[data-bottom-spacer]` div
          // after the song content so trailing short sections can scroll
          // to the top of the viewport. Auto-scroll has to ignore that
          // spacer entirely — it MUST NOT scroll into or past the last
          // song line into the empty spacer area. Both PACING (duration
          // maps to song length, not song + spacer) and STOP DETECTION
          // (we stop at song end, not spacer end) are computed against
          // `totalScrollable`, which subtracts the spacer height.
          const spacer = el.querySelector<HTMLElement>('[data-bottom-spacer]');
          const spacerHeight = spacer ? spacer.offsetHeight : 0;
          const totalScrollable = Math.max(0, el.scrollHeight - el.clientHeight - spacerHeight);
          // Mode selects the pacing; 'duration' needs a valid duration,
          // otherwise it falls back to the speed slider so the toggle
          // still scrolls.
          const useDuration =
            autoScrollMode === 'duration' && !!durationSeconds && durationSeconds > 0;
          if (useDuration) {
            // ── Reading-anchor model over a content-line time map ───
            // The singer reads the CONTENT top to bottom over the
            // song's duration while the scroll keeps the sung line
            // parked at the anchor point (~35 % down the view), with:
            //   • ramped lead-in: from the top the ANCHOR grows from 0
            //     to its full value at twice the reading rate, so the
            //     page starts moving IMMEDIATELY at half speed while
            //     the sung line drifts down to the anchor point;
            //   • early finish: max scroll is reached once the last
            //     screenful is fully visible, with the remaining
            //     duration left for singing it — not at 0:00 left.
            //
            // Pacing comes from a piecewise time→position map built
            // from the rendered lines (utils/duration-profile.ts)
            // instead of a constant px/s, so that:
            //   • inline chord diagrams: a diagram-inflated line gets
            //     the same singing time as its plain rendering — its
            //     extra pixels scroll faster, not longer;
            //   • section titles / blanks / pause chips consume no
            //     singing time (crossed inside neighbouring slices);
            //   • {pause: N} holds are SUBTRACTED from the pacing
            //     budget — the stored duration includes them, and the
            //     scroller spends them stopped at the markers;
            //   • zoom / diagram toggles / resizes rebuild the map
            //     (geometry key below); elapsed sung time carries
            //     over, so the reading position stays on the same
            //     LINE in the new layout. Measurements use
            //     getBoundingClientRect so CSS zoom is reflected.
            const anchor = el.clientHeight * READ_ANCHOR_FRACTION;
            const geomKey = `${el.scrollHeight}|${el.clientHeight}|${spacerHeight}`;
            if (!profileRef.current || profileRef.current.geomKey !== geomKey) {
              const entries: ProfileEntry[] = [];
              const cTop = el.getBoundingClientRect().top;
              const base = el.scrollTop;
              const lineEls = Array.from(el.querySelectorAll<HTMLElement>('[data-scroll-weight]'));
              // The song body can carry CSS `zoom` (perform-mode zoom).
              // Chromium's legacy zoom (< 128; Electron 31 = 126)
              // reports getBoundingClientRect in UNZOOMED coordinates
              // while scrollTop/scrollHeight are in zoomed space —
              // multiply rect offsets by the accumulated zoom between
              // the line and the scroll container to land in scroll
              // coordinates. (zoom = 1 everywhere → no-op.)
              let zoom = 1;
              for (let n = lineEls[0]?.parentElement ?? null; n && n !== el; n = n.parentElement) {
                const z = parseFloat(getComputedStyle(n).zoom as unknown as string);
                if (z && z > 0 && z !== 1) zoom *= z;
              }
              if (zoom !== 1) {
                // Calibrate against the actual rect behaviour so this
                // stays correct if Electron moves to Chromium ≥ 128
                // (standardized zoom, where rects ARE scaled): compare
                // a line's visual rect height to its layout
                // offsetHeight. Legacy zoom → ratio ≈ 1 → keep the
                // multiplier; standard zoom → ratio ≈ zoom → no
                // correction needed.
                const probe = lineEls.find((le) => le.offsetHeight > 0);
                if (probe) {
                  const ratio = probe.getBoundingClientRect().height / probe.offsetHeight;
                  zoom = zoom / Math.max(ratio, 0.01);
                  if (Math.abs(zoom - 1) < 0.02) zoom = 1;
                }
              }
              for (const lineEl of lineEls) {
                const w = parseFloat(lineEl.dataset['scrollWeight'] ?? '0');
                if (!(w > 0)) continue;
                const r = lineEl.getBoundingClientRect();
                if (r.height <= 0 && r.width <= 0) continue; // not laid out
                entries.push({
                  y: (r.top - cTop) * zoom + base,
                  bottom: (r.bottom - cTop) * zoom + base,
                  w,
                });
              }
              let totalPause = 0;
              for (const m of el.querySelectorAll<HTMLElement>('[data-pause]')) {
                totalPause += Math.max(0, parseFloat(m.dataset['pause'] ?? '0') || 0);
              }
              const sung = sungDurationFor(durationSeconds!, totalPause);
              const knots = buildKnots(entries, sung);
              // The run must be able to REACH the stop condition
              // (scrollTop = totalScrollable). If unusually large
              // trailing padding leaves the last line's bottom short
              // of that, stretch the final slice to the scroll end so
              // the scroller can't stall just before finishing.
              if (knots.length > 0) {
                const lastKnot = knots[knots.length - 1]!;
                if (lastKnot.y < totalScrollable + anchor) lastKnot.y = totalScrollable + anchor;
              }
              profileRef.current = { knots, sungDuration: sung, geomKey };
            }
            const profile = profileRef.current;
            if (profile.knots.length > 0) {
              if (elapsedRef.current === null) {
                elapsedRef.current = knotsPosToTime(profile.knots, readPosRef.current);
              }
              elapsedRef.current = Math.min(elapsedRef.current + deltaMs / 1000, profile.sungDuration);
              readPosRef.current = Math.min(
                knotsTimeToPos(profile.knots, elapsedRef.current),
                totalScrollable + anchor,
              );
            } else {
              // No tagged content lines (e.g. an empty song body):
              // fall back to the constant-velocity reading model.
              const v = (totalScrollable + el.clientHeight) / durationSeconds!;
              readPosRef.current = Math.min(
                readPosRef.current + v * (deltaMs / 1000),
                totalScrollable + anchor,
              );
            }
            const anchorEff = Math.min(anchor, readPosRef.current / 2);
            posRef.current = Math.min(Math.max(readPosRef.current - anchorEff, 0), totalScrollable);
          } else {
            const pxPerSec = (autoScrollSpeed / 100) * 120; // slider 1–100 → 1.2–120 px/s
            // Advance the internal position, but CLAMP to `totalScrollable`
            // so we never scroll into the spacer even for a single frame.
            // The stop check below fires next, but clamping here means the
            // last visible frame lands exactly at the end of the song
            // content instead of jumping a few pixels into the empty
            // spacer zone before the check triggers.
            posRef.current = Math.min(posRef.current + pxPerSec * (deltaMs / 1000), totalScrollable);
          }

          el.scrollTop = posRef.current;
          // Read back the clamped value (browser stops at max scroll)
          lastSetRef.current = el.scrollTop;

          // When we reach the end of the song content, auto-stop. With a
          // spacer present, "end of content" = totalScrollable (already
          // adjusted above) rather than the container's full scroll range.
          // Also stop when totalScrollable is 0 (song fits in one
          // viewport) so we don't spin advancing an unclamped position
          // forever. If performance mode is active we route through
          // `perfStop` so the top-bar buttons flip too.
          if (totalScrollable === 0 || el.scrollTop >= totalScrollable - 1) {
            const { perfRunning } = usePlayerStore.getState();
            // Mark that this stop was caused by reaching the BOTTOM (not a
            // manual stop) so the UI can keep the toolbar hidden and leave
            // the page parked at the end instead of reflowing/jumping up.
            usePlayerStore.setState({ autoScrollHitBottom: true });
            if (perfRunning) perfStop();
            else toggleAutoScroll();
            return;
          }
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
        lastTimeRef.current = null;
      }
    };
  }, [autoScrollActive, autoScrollSpeed, autoScrollMode, activeSong?.duration, containerRef, toggleAutoScroll, perfStop]);
}
