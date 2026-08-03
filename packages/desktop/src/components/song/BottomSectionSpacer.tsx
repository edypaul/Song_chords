import React, { useEffect, useState } from 'react';
import { useSectionNavStore } from '../../store/section-nav-store';

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
 * Mounts ONLY while the section navigator is open (via
 * `useSectionNavStore`). Since the navigator is hover-driven, the
 * spacer appears on hover and disappears the moment the user picks
 * a section (which closes the nav) — so the song doesn't have
 * permanent dead space at the bottom after navigating.
 *
 * The height is measured from the scroll container at mount and on
 * window resize, sized so a heading near the bottom can be lifted to
 * the top edge with the rest of the viewport empty below it.
 *
 * Carries `data-bottom-spacer` so `useAutoScroll` knows to stop at the
 * spacer's top edge rather than the container's true scroll-bottom.
 */
export default function BottomSectionSpacer({ scrollRef, recomputeKey }: Props): React.ReactElement | null {
  const open = useSectionNavStore((s) => s.open);
  // `keepSpacer` is a sticky pin raised by the navigator when the
  // user clicks the LAST section. It overrides the normal
  // tear-down so the spacer stays mounted forever after — the
  // trailing heading is lifted to the top of the viewport and
  // stays there (removing the spacer would shrink scrollHeight
  // and drop the heading back into the middle of the screen).
  // Cleared when the user reopens the nav or picks a different
  // section.
  const keepSpacer = useSectionNavStore((s) => s.keepSpacer);
  const [height, setHeight] = useState(0);
  // Grace-period flag: stays true for ~700 ms after the nav
  // closes, so a smooth-scroll triggered by the user's click on
  // a section can complete against the full scrollable range
  // (spacer still present) before we shrink the scrollHeight.
  // Without it, unmounting the spacer synchronously with the
  // close would clamp `scrollTop` and leave the target heading
  // partway down the viewport instead of at the top.
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (open || keepSpacer) {
      setSettling(false);
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
    }
    // Nav closed AND keep-spacer isn't pinned. Enter the settling
    // window: keep the spacer mounted until the smooth-scroll
    // animation completes, then tear it down so the song doesn't
    // have permanent dead space at the bottom.
    setSettling(true);
    const t = window.setTimeout(() => {
      setSettling(false);
      setHeight(0);
    }, 700);
    return () => window.clearTimeout(t);
  }, [open, keepSpacer, scrollRef, recomputeKey]);

  const shouldRender = (open || settling || keepSpacer) && height > 0;
  if (!shouldRender) return null;
  return <div data-bottom-spacer style={{ height, pointerEvents: 'none' }} aria-hidden="true" />;
}
