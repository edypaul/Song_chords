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
 *
 * IMPORTANT — pointer capture is LAZY: we only `setPointerCapture` once a
 * gesture has actually moved far enough horizontally to be a swipe. The
 * earlier version captured eagerly on `pointerdown`, which redirected every
 * following pointer event (and the synthesized `click`) to the scroll
 * container — so a plain tap on a chord never reached the chord's own
 * `onClick`, and tapping a chord in the perform view did nothing. Capturing
 * only after the swipe threshold is crossed lets taps fall through as normal
 * clicks while still keeping pointerup for genuine swipes.
 */
export function useSwipeNavigation({
  onNext, onPrev,
  threshold = 80,
  horizontalRatio = 1.5,
  maxDuration = 800,
}: Options) {
  const start = useRef<{ x: number; y: number; t: number; id: number; captured: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Do NOT capture here — capturing eagerly swallows taps (the click
    // gets retargeted to this element). We capture lazily in
    // onPointerMove once the movement is clearly a horizontal swipe.
    start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, captured: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId || s.captured) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // Once the gesture has clearly committed to a horizontal swipe,
    // capture the pointer so we still receive pointerup even if the
    // finger leaves the element's bounds.
    if (Math.abs(dx) >= threshold && Math.abs(dx) >= Math.abs(dy) * horizontalRatio) {
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      s.captured = true;
    }
  }, [threshold, horizontalRatio]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (s?.captured) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
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
    const s = start.current;
    start.current = null;
    if (s?.captured) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    style: { touchAction: 'pan-y' } as React.CSSProperties,
  };
}
