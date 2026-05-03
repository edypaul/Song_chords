import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@song-chords/shared';

/** Fire offset for {pause: N} markers, measured from the viewport's top
 * edge. Zero = the marker fires the instant its bottom border meets the
 * top of the visible area (i.e., the chip has just scrolled out of view). */
const PAUSE_FIRE_OFFSET_PX = 0;

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
  const { autoScrollActive, autoScrollSpeed, activeSong, toggleAutoScroll, perfStop } = usePlayerStore();
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  // Fractional scroll position we're tracking internally (avoids rounding losing sub-pixel progress)
  const posRef = useRef<number>(0);
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
        if (Math.abs(el.scrollTop - lastSetRef.current) > 2) {
          posRef.current = el.scrollTop;
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
          // to the top. Auto-scroll has to ignore that spacer for both
          // pacing (so song duration still maps to song length) and stop
          // detection (so we stop at the end of the song, not at the end
          // of the spacer).
          const spacer = el.querySelector<HTMLElement>('[data-bottom-spacer]');
          const spacerHeight = spacer ? spacer.offsetHeight : 0;
          // Duration-based speed: cover the full scrollable height in exactly durationSeconds.
          // Fallback to the speed slider when no duration is set.
          const totalScrollable = Math.max(0, el.scrollHeight - el.clientHeight - spacerHeight);
          const pxPerSec =
            durationSeconds && durationSeconds > 0
              ? totalScrollable / durationSeconds
              : (autoScrollSpeed / 100) * 120; // slider 1–100 → 1.2–120 px/s

          posRef.current += pxPerSec * (deltaMs / 1000);

          el.scrollTop = posRef.current;
          // Read back the clamped value (browser stops at max scroll)
          lastSetRef.current = el.scrollTop;

          // When we reach the end of the song content, auto-stop. With a
          // spacer present, "end of content" = totalScrollable (already
          // adjusted above) rather than the container's full scroll range.
          // If performance mode is active we route through `perfStop` so
          // the top-bar buttons flip too.
          if (totalScrollable > 0 && el.scrollTop >= totalScrollable - 1) {
            const { perfRunning } = usePlayerStore.getState();
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
  }, [autoScrollActive, autoScrollSpeed, activeSong?.duration, containerRef, toggleAutoScroll, perfStop]);
}
