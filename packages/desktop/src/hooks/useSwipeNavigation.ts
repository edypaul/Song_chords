import { useRef, useCallback } from 'react';

interface Options {
  onNext: () => void;
  onPrev: () => void;
  /** Minimum horizontal distance (px) to count as a swipe. */
  threshold?: number;
  /** Horizontal travel must exceed vertical travel by at least this ratio. */
  horizontalRatio?: number;
  /** Max duration (ms) between pointerdown and pointerup. */
  maxDuration?: number;
}

/**
 * Detects horizontal swipe / drag gestures using Pointer Events so the same
 * handlers work for mouse, touch, and pen. Left → onNext, right → onPrev.
 *
 * The returned `style.touchAction: 'pan-y'` is REQUIRED on touchscreens:
 * the default `touch-action: auto` lets the browser claim horizontal
 * gestures for panning/back-navigation, so `pointerup` never fires on the
 * element. Setting pan-y tells the browser to keep only vertical panning
 * and hand horizontal gestures to our handlers.
 */
export function useSwipeNavigation({
  onNext, onPrev,
  threshold = 80,
  horizontalRatio = 1.5,
  maxDuration = 800,
}: Options) {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Capture the pointer so we still receive pointerup even if the finger
    // leaves the element's bounds during the swipe.
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dt = Date.now() - s.t;
    if (dt > maxDuration) return;
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dx) < Math.abs(dy) * horizontalRatio) return;
    if (dx < 0) onNext(); else onPrev();
  }, [onNext, onPrev, threshold, horizontalRatio, maxDuration]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    start.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    style: { touchAction: 'pan-y' } as React.CSSProperties,
  };
}
