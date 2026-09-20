import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@song-chords/shared';
import { MIN_SUNG_FRACTION } from '../utils/duration-profile';

function parseDurationToSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const parts = duration.split(':');
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0]!, 10);
  const secs = parseInt(parts[1]!, 10);
  if (isNaN(mins) || isNaN(secs) || secs >= 60) return null;
  return mins * 60 + secs;
}

interface PauseMeasure {
  /** {pause: N} markers with their freeze position (see below), sorted. */
  pauseMarks: { el: HTMLElement; y: number; seconds: number }[];
  totalPause: number;
}

/**
 * Measure the {pause: N} markers of a scroll container in SCROLL-SPACE
 * coordinates. Shared by both scroll modes so pauses behave
 * identically on every page.
 *
 * Zoom: the song body can carry CSS `zoom` (perform-mode zoom).
 * Chromium's legacy zoom (< 128; Electron 31 = 126) reports
 * getBoundingClientRect in UNZOOMED coordinates while
 * scrollTop/scrollHeight are in zoomed space — multiply rect offsets
 * by the accumulated zoom between the marker and the container, with
 * an offsetHeight calibration so a future Chromium (≥ 128,
 * standardized zoom, rects ARE scaled) doesn't get double-corrected.
 *
 * Freeze positions: each marker's `y` is the SCROLL POSITION where the
 * page freezes — the directive's OWN position, so the hold happens
 * exactly where the {pause} is placed (chip at the top of the view),
 * the first pause included.
 */
function measurePauses(el: HTMLElement): PauseMeasure {
  const cTop = el.getBoundingClientRect().top;
  const base = el.scrollTop;
  const markEls = Array.from(el.querySelectorAll<HTMLElement>('[data-pause]'))
    .filter((m) => {
      const r = m.getBoundingClientRect();
      return r.height > 0 || r.width > 0; // skip hidden copies
    });
  let zoom = 1;
  for (let n = markEls[0]?.parentElement ?? null; n && n !== el; n = n.parentElement) {
    const z = parseFloat(getComputedStyle(n).zoom as unknown as string);
    if (z && z > 0 && z !== 1) zoom *= z;
  }
  if (zoom !== 1) {
    const probe = markEls.find((m) => m.offsetHeight > 0);
    if (probe) {
      const ratio = probe.getBoundingClientRect().height / probe.offsetHeight;
      zoom = zoom / Math.max(ratio, 0.01);
      if (Math.abs(zoom - 1) < 0.02) zoom = 1;
    }
  }
  let totalPause = 0;
  const pauseMarks: PauseMeasure['pauseMarks'] = [];
  for (const m of markEls) {
    const seconds = Math.max(0, parseFloat(m.dataset['pause'] ?? '0') || 0);
    totalPause += seconds;
    pauseMarks.push({ el: m, y: (m.getBoundingClientRect().top - cTop) * zoom + base, seconds });
  }
  pauseMarks.sort((a, b) => a.y - b.y);
  return { pauseMarks, totalPause };
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
  // The scrollTop we last programmatically set — used to detect manual scroll
  const lastSetRef = useRef<number>(0);
  // Timestamp (performance.now()) until which scrolling is paused because
  // we crossed a {pause: N} marker. 0 = no pause active.
  const pauseUntilRef = useRef<number>(0);
  // Markers we've already triggered this run so a single pause directive
  // doesn't keep firing every frame.
  const consumedMarkersRef = useRef<Set<Element>>(new Set());
  // {pause: N} freeze positions + total hold seconds (see
  // measurePauses) — shared by BOTH scroll modes, rebuilt on geometry
  // change (zoom, inline-diagram toggle, resize).
  const pauseMarksRef = useRef<{ key: string; marks: PauseMeasure['pauseMarks']; totalPause: number } | null>(null);
  // Whether this run already consumed the marks the start position was
  // past (done once, on the first marks build of the run).
  const marksSeededRef = useRef<boolean>(false);

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
      pauseMarksRef.current = null;
      marksSeededRef.current = false;
      return;
    }

    // Sync internal position to wherever the page is right now when starting
    const container = containerRef.current;
    if (container) {
      posRef.current = container.scrollTop;
      lastSetRef.current = container.scrollTop;
      // Markers the start position is already past are consumed on
      // the first marks build of the run (in the tick below) —
      // nothing to pre-consume here.
      pauseMarksRef.current = null;
      marksSeededRef.current = false;
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
          // A jump FORWARD skips the freeze positions in between —
          // consume them so they don't all fire in a chain at the
          // landing point. (Backward jumps: already-fired marks stay
          // consumed — each pause holds once per run.)
          if (pauseMarksRef.current) {
            for (const pm of pauseMarksRef.current.marks) {
              if (pm.y < el.scrollTop - 1) consumedMarkersRef.current.add(pm.el);
            }
          }
        }

        // Mode selects the pacing; 'duration' needs a valid duration,
        // otherwise it falls back to the speed slider so the toggle
        // still scrolls.
        const useDuration =
          autoScrollMode === 'duration' && !!durationSeconds && durationSeconds > 0;

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

        // {pause: N} — ONE rule for BOTH modes and every page: the
        // page freezes EXACTLY WHERE THE DIRECTIVE IS PLACED, i.e.
        // when scrollTop reaches the chip's own position (chip at the
        // top of the view during the hold) — the first pause of the
        // song included. A pause too deep for the scroll range to
        // reach (inside the last screenful) fires at the end of the
        // scrollable range.
        {
          const marksKey = `${el.scrollHeight}|${el.clientHeight}`;
          if (!pauseMarksRef.current || pauseMarksRef.current.key !== marksKey) {
            const { pauseMarks, totalPause } = measurePauses(el);
            pauseMarksRef.current = { key: marksKey, marks: pauseMarks, totalPause };
            if (!marksSeededRef.current) {
              marksSeededRef.current = true;
              // Freeze positions the run STARTS below were passed
              // before this run began — don't fire them retroactively.
              for (const pm of pauseMarksRef.current.marks) {
                if (Math.min(pm.y, totalScrollable) < el.scrollTop - 1) {
                  consumedMarkersRef.current.add(pm.el);
                }
              }
            }
          }
          for (const pm of pauseMarksRef.current.marks) {
            if (consumedMarkersRef.current.has(pm.el)) continue;
            if (el.scrollTop >= Math.min(pm.y, totalScrollable) - 1) {
              consumedMarkersRef.current.add(pm.el);
              if (pm.seconds > 0) pauseUntilRef.current = timestamp + pm.seconds * 1000;
              // Only one marker per frame so back-to-back pauses hold
              // sequentially instead of collapsing into one window.
              break;
            }
          }
        }

        // Skip scrolling while a pause is active.
        const isPaused = pauseUntilRef.current > timestamp;
        if (!isPaused) {
          if (useDuration) {
            // ── Constant-rate duration model ────────────────────────
            // ONE uniform speed for the whole song (user-specified:
            // "smooth, same rate throughout"): the page — title and
            // details block included — covers the full reading span
            // (totalScrollable + clientHeight) in the song's duration
            // MINUS its {pause: N} holds, which the scroller spends
            // frozen at the markers instead. Because the span includes
            // the final screenful, the bottom is reached EARLY, with
            // that screenful's share of time left for singing it —
            // not at 0:00.
            //
            // Everything is measured live each frame, so zoom
            // changes, inline-diagram toggles and window resizes
            // re-pace immediately with no seams.
            const totalPause = pauseMarksRef.current?.totalPause ?? 0;
            const scrollTime = Math.max(
              durationSeconds! - totalPause,
              durationSeconds! * MIN_SUNG_FRACTION,
            );
            const v = (totalScrollable + el.clientHeight) / scrollTime;
            posRef.current = Math.min(posRef.current + v * (deltaMs / 1000), totalScrollable);
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
