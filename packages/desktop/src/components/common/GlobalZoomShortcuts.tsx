import { useRef } from 'react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

/**
 * App-wide zoom via CSS `zoom` on the document root. Fires only when the
 * active page hasn't already handled the shortcut — per-page hooks
 * (SongViewPage, PerformPage) call stopImmediatePropagation so the local
 * zoom wins there. On every other page, these bindings scale the whole UI.
 *
 * No state is persisted: the zoom resets to 1× on app restart, which matches
 * how browser zoom behaves for ephemeral sessions.
 */
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const STEP = 0.1;

export default function GlobalZoomShortcuts(): null {
  const zoomRef = useRef(1);

  const apply = (z: number) => {
    zoomRef.current = z;
    // `zoom` is a non-standard CSS property but works in Chromium. It scales
    // layout + rendering, unlike `transform: scale()` which only affects paint
    // and leaves scrollbars + hit-testing confused.
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
  };

  useKeyboardShortcuts({
    zoomIn:    () => apply(Math.min(zoomRef.current + STEP, MAX_ZOOM)),
    zoomOut:   () => apply(Math.max(zoomRef.current - STEP, MIN_ZOOM)),
    zoomReset: () => apply(1),
  });

  return null;
}
