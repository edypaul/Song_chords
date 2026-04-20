import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@song-chords/shared';

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
  const { autoScrollActive, autoScrollSpeed, activeSong } = usePlayerStore();
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  // Fractional scroll position we're tracking internally (avoids rounding losing sub-pixel progress)
  const posRef = useRef<number>(0);
  // The scrollTop we last programmatically set — used to detect manual scroll
  const lastSetRef = useRef<number>(0);

  useEffect(() => {
    if (!autoScrollActive) {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
        lastTimeRef.current = null;
      }
      return;
    }

    // Sync internal position to wherever the page is right now when starting
    const container = containerRef.current;
    if (container) {
      posRef.current = container.scrollTop;
      lastSetRef.current = container.scrollTop;
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

        // Duration-based speed: cover the full scrollable height in exactly durationSeconds.
        // Fallback to the speed slider when no duration is set.
        const totalScrollable = el.scrollHeight - el.clientHeight;
        const pxPerSec =
          durationSeconds && durationSeconds > 0
            ? totalScrollable / durationSeconds
            : (autoScrollSpeed / 100) * 120; // slider 1–100 → 1.2–120 px/s

        posRef.current += pxPerSec * (deltaMs / 1000);

        el.scrollTop = posRef.current;
        // Read back the clamped value (browser stops at max scroll)
        lastSetRef.current = el.scrollTop;
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
  }, [autoScrollActive, autoScrollSpeed, activeSong?.duration, containerRef]);
}
