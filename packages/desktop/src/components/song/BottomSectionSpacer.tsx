import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '@song-chords/shared';

interface Props {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Force a re-measure when this changes (e.g. zoom level, view mode). */
  recomputeKey?: unknown;
}

/**
 * A tall empty block placed after the song content so that even the last,
 * shortest section can be scrolled all the way to the top of the viewport
 * by the section navigator.
 *
 * Only rendered when the section panel is open. The height is measured
 * from the scroll container at mount and on window resize, sized so a
 * heading near the bottom can be lifted to the top edge with the rest of
 * the viewport empty below it.
 *
 * Carries `data-bottom-spacer` so `useAutoScroll` knows to stop at the
 * spacer's top edge rather than the container's true scroll-bottom.
 */
export default function BottomSectionSpacer({ scrollRef, recomputeKey }: Props): React.ReactElement | null {
  const open = useSettingsStore((s) => s.settings.sectionPanelOpen ?? false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!open) {
      setHeight(0);
      return;
    }
    const measure = () => {
      const el = scrollRef.current;
      if (!el) return;
      // Subtract a small slack so a heading at the very top still has a
      // sliver of next-section content (or padding) visible above it,
      // making the placement feel intentional rather than crammed.
      const next = Math.max(0, el.clientHeight - 60);
      setHeight(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, scrollRef, recomputeKey]);

  if (!open || height === 0) return null;
  return <div data-bottom-spacer style={{ height, pointerEvents: 'none' }} aria-hidden="true" />;
}
