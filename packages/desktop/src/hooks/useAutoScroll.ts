import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@song-chords/shared';

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
      return;
    }

    // Sync internal position to wherever the page is right now when starting
    const container = containerRef.current;
    if (container) {
      posRef.current = container.scrollTop;
      lastSetRef.current = container.scrollTop;
      // Duration mode: seed the reading position. Starting from the
      // very top means the singer starts at the FIRST line (content
      // y = 0), which produces the natural lead-in — no scrolling
      // until the sung line walks down to the anchor point. Resuming
      // mid-song assumes the sung line is at the anchor.
      readPosRef.current = container.scrollTop > 2
        ? container.scrollTop + container.clientHeight * READ_ANCHOR_FRACTION
        : 0;
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
          readPosRef.current = el.scrollTop + el.clientHeight * READ_ANCHOR_FRACTION;
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
            // ── Reading-anchor model ────────────────────────────────
            // The naive mapping (top → max scroll over the duration)
            // reads wrong at both ends: the first screenful is already
            // visible yet scrolling starts instantly, and the LAST
            // screenful only finishes arriving at the very last second
            // — the singer waits on the closing lines, which is
            // especially bad with inline chord diagrams where a
            // screenful holds only a few lines.
            //
            // Model instead: the singer reads the CONTENT — a span of
            // `totalScrollable + clientHeight` pixels — top to bottom
            // over the song's duration, and the scroll keeps the sung
            // line parked at the anchor point (~35 % down the view).
            //   • rate v = (totalScrollable + clientHeight) / duration
            //     (measured live each frame, so toggling inline
            //     diagrams mid-run re-paces immediately);
            //   • lead-in: from the top, nothing scrolls until the
            //     sung line has walked down to the anchor;
            //   • early finish: max scroll is reached once the last
            //     screenful is fully visible, with the remaining
            //     duration left for singing it — not at 0:00 left.
            const anchor = el.clientHeight * READ_ANCHOR_FRACTION;
            const v = (totalScrollable + el.clientHeight) / durationSeconds!;
            readPosRef.current = Math.min(
              readPosRef.current + v * (deltaMs / 1000),
              totalScrollable + anchor,
            );
            posRef.current = Math.min(Math.max(readPosRef.current - anchor, 0), totalScrollable);
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
