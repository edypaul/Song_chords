import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ListTree } from 'lucide-react';
import type { ParsedSong } from '@song-chords/shared';
import { usePlayerStore } from '@song-chords/shared';
import { useT } from '../../i18n';
import { useSectionNavStore } from '../../store/section-nav-store';

interface Props {
  song: ParsedSong;
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Re-measure the active section when this changes (zoom, content swap, etc.). */
  recomputeKey?: unknown;
}

interface SectionItem {
  /** Stable id derived from the section's index in song.lines so duplicate
   *  labels (e.g. two verses) don't collide. */
  id: string;
  label: string;
}

/**
 * Right-side floating panel listing every {section} heading in the song.
 * Click a row to scroll its heading to the top of the viewport. Arrow Up /
 * Down (no modifier) step through sections by scrolling. The currently
 * visible section is highlighted live based on the scroll container's
 * position. Open/closed state is persisted in `settings.sectionPanelOpen`.
 */
export default function SectionNavigator({
  song,
  scrollRef,
  recomputeKey,
}: Props): React.ReactElement | null {
  const t = useT();
  // Open/close is hover-driven and shared through a tiny session
  // store (`useSectionNavStore`). Other components — most notably
  // `BottomSectionSpacer` — subscribe to the same flag so they
  // can mount/unmount in lockstep with the panel (the spacer
  // needs to appear while the nav is open and vanish the moment
  // the nav closes, so short trailing sections can be scrolled
  // to the top of the viewport without leaving permanent dead
  // space at the end of the song).
  const open = useSectionNavStore((s) => s.open);
  const setOpenState = useSectionNavStore((s) => s.setOpen);
  const setKeepSpacer = useSectionNavStore((s) => s.setKeepSpacer);
  // Hide the whole nav (icon + popover) while auto-scroll is
  // running — same rationale as the toolbar and sidebar: the user
  // wants a clean, uncluttered read of the scrolling lyrics.
  // Subscribes to the player store directly instead of taking a
  // prop, so callers don't have to thread the flag.
  const autoScrollActive = usePlayerStore((s) => s.autoScrollActive);
  // If the panel happens to be hover-open the moment auto-scroll
  // starts, close it in the store so the "open" flag doesn't stay
  // orphan while the component itself is unrendered. Prevents a
  // brief flash of an already-open panel on the next hover after
  // auto-scroll ends.
  useEffect(() => {
    if (autoScrollActive) setOpenState(false);
  }, [autoScrollActive, setOpenState]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Debounce close-on-mouse-leave so the ~10px gap between the
  // trigger button and the popover doesn't briefly close the panel
  // when the cursor transits between them.
  const closeTimerRef = useRef<number | null>(null);
  const scheduleClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpenState(false);
    }, 120);
  };
  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  // Build the section list from the parsed song. Each item gets a stable id
  // built from "index|label" so duplicate labels are independently
  // selectable.
  const sections = useMemo<SectionItem[]>(() => {
    const items: SectionItem[] = [];
    song.lines.forEach((line, idx) => {
      if (!line.isSection) return;
      const tok = line.tokens[0];
      if (!tok || tok.type !== 'section') return;
      if (!tok.label) return;
      items.push({ id: `${idx}|${tok.label}`, label: tok.label });
    });
    return items;
  }, [song.lines]);


  // Track the currently visible section by reading the position of every
  // [data-section-heading] element relative to the scroll container's top.
  // The "active" section is the last one whose top edge is at or above the
  // container's top. When the container is scrolled to the bottom, the last
  // section is forced active so short final sections still light up.
  // Throttled with requestAnimationFrame so rapid scroll events don't
  // re-render the panel per frame.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const computeActive = () => {
      rafId = null;
      const headings = container.querySelectorAll<HTMLElement>('[data-section-heading]');
      if (headings.length === 0) {
        setActiveId(null);
        return;
      }
      // The section navigator mounts a `[data-bottom-spacer]` div after
      // the song content while the panel is open, so trailing short
      // sections can scroll to the top. That spacer inflates
      // `scrollHeight`, so subtract it before deciding "at bottom" — we
      // want at-bottom to mean "end of the song", not "end of the
      // spacer".
      const spacer = container.querySelector<HTMLElement>('[data-bottom-spacer]');
      const spacerHeight = spacer ? spacer.offsetHeight : 0;
      const totalScrollable = Math.max(0, container.scrollHeight - container.clientHeight - spacerHeight);
      const atBottom = totalScrollable > 0 && container.scrollTop >= totalScrollable - 2;
      const containerTop = container.getBoundingClientRect().top;

      const TOLERANCE = 4;
      let activeIdx = -1;
      headings.forEach((h, i) => {
        const relTop = h.getBoundingClientRect().top - containerTop;
        if (relTop <= TOLERANCE) activeIdx = i;
      });

      // At the content end, the final section is always the relevant
      // one. Auto-scroll stops at `totalScrollable` (the end of the
      // song, NOT the end of the bottom spacer), so the last section's
      // heading may still sit below the container top — meaning the
      // `relTop <= TOLERANCE` test above never selects it. Without
      // this override the last section never lights up when the song
      // is auto-scrolled to the end with the panel open. Forcing the
      // last index whenever we're at the bottom fixes that, and is
      // correct because reaching the content end necessarily means
      // the final section is the one on screen.
      if (atBottom) activeIdx = sections.length - 1;
      if (activeIdx < 0) activeIdx = 0;
      const item = sections[activeIdx];
      setActiveId(item ? item.id : null);
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(computeActive);
    };

    computeActive();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [scrollRef, sections, recomputeKey]);

  const scrollToSection = (ordinal: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const headings = container.querySelectorAll<HTMLElement>('[data-section-heading]');
    const target = headings[ordinal];
    if (!target) return;
    // Use the browser's native scrollIntoView so coordinate-system
    // concerns (CSS `zoom` in perform mode + the manual zoom layer) are
    // handled by the engine. `block: 'start'` aligns the heading to the
    // top of the scroll container; the bottom spacer (mounted while the
    // panel is open) gives even the last short section enough room to
    // actually reach that position.
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Arrow-key nav while the panel is open: ArrowDown / ArrowUp move to the
  // next / previous section by scrolling its heading to the top. Plain
  // arrows only — Shift+Arrow remains reserved for transpose. Wraps at the
  // ends. Inputs / textareas / contentEditables are not hijacked.
  useEffect(() => {
    if (!open) return;
    if (sections.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      // Resolve the currently-active section from `activeId` so arrow keys
      // step relative to whichever section is visible right now (not a
      // stale reference). If nothing is active yet, start at index 0.
      const last = sections.length - 1;
      const currentIdx = activeId
        ? Math.max(0, sections.findIndex((s) => s.id === activeId))
        : 0;
      const next = e.key === 'ArrowDown'
        ? (currentIdx >= last ? 0 : currentIdx + 1)
        : (currentIdx <= 0 ? last : currentIdx - 1);
      scrollToSection(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // scrollToSection is stable enough (only reads refs); eslint-disable
    // would be appropriate here but the dep list captures `sections` and
    // `activeId` which is what we actually want for correctness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sections, activeId]);

  // Nothing to navigate to — render nothing rather than an empty panel.
  if (sections.length === 0) return null;
  // Hidden during auto-scroll (see subscription above). Rendering
  // nothing is enough — the panel's open state will reopen on the
  // user's next hover after auto-scroll ends.
  if (autoScrollActive) return null;

  // Trigger + panel share one hover-root so the pointer can travel
  // between them without triggering a close. `onMouseEnter` cancels
  // any pending close and marks open; `onMouseLeave` schedules the
  // debounced close. Every section click closes the panel.
  //
  // Special case for the LAST section: raise the shared `keepSpacer`
  // flag before closing so `BottomSectionSpacer` stays mounted
  // permanently. Otherwise its 700 ms tear-down would kick in, the
  // scrollHeight would shrink under the smooth-scroll animation,
  // and the trailing heading would end up back in the middle of
  // the viewport instead of at the top.
  const handleSectionClick = (ordinal: number) => {
    const isLastSection = ordinal === sections.length - 1;
    setKeepSpacer(isLastSection);
    scrollToSection(ordinal);
    cancelClose();
    setOpenState(false);
  };

  return (
    <>
      {/* Hover-root: fixed to the right edge, sized just around the
          icon. The panel is positioned ABSOLUTELY relative to this
          root so the root's height stays constant (= icon size).
          That keeps the icon's viewport position stable whether
          the panel is open or closed, and centered exactly at
          viewport middle via `-translate-y-1/2`. */}
      <div
        className="fixed right-3"
        style={{
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 55,
        }}
        // Clear keep-spacer whenever the nav re-opens: a prior
        // "last-section" click may have pinned the spacer, but
        // once the user hovers again they're about to pick a
        // fresh section — and if it's NOT the last one, we want
        // the spacer to tear down after that click.
        onMouseEnter={() => { cancelClose(); setKeepSpacer(false); setOpenState(true); }}
        onMouseLeave={scheduleClose}
      >
        {/* Trigger icon — anchored in the root; its viewport position
            never shifts because the root sizes to the icon only. */}
        <button
          onFocus={() => { cancelClose(); setOpenState(true); }}
          onBlur={scheduleClose}
          className="p-2.5 rounded-full shadow-lg transition-transform hover:scale-105"
          style={{
            background: 'var(--accent)',
            color: 'white',
            // Kill the browser default focus ring AND any inherited
            // border. Without this, some Chromium builds paint a
            // 2px accent-color outline on the button's right/bottom
            // edges when the pointer enters — visible as a flash
            // between the hover-scale animation frames.
            outline: 'none',
            border: 'none',
          }}
          title={t('sectionNav.buttonTitle', { count: sections.length })}
          aria-label={t('sectionNav.openAria')}
          aria-expanded={open}
        >
          <ListTree size={16} />
        </button>

        {/* Panel — absolutely positioned to the left of the icon,
            vertically centered on it. Sitting inside the same
            hover-root means the pointer can travel from icon to
            panel without leaving the hover region. Completely
            transparent surface per user request. */}
        <nav
          className="absolute flex flex-col"
          style={{
            right: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            marginRight: 12,
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            width: 220,
            maxHeight: '70vh',
            // `overflow: visible` is REQUIRED for the slide-in
            // animation: each row starts translated 100px to
            // the right of its final position, i.e. OUTSIDE
            // the panel bounds. With `overflow: hidden`, rows
            // would be clipped during their entire journey and
            // would only appear at the very last pixels of the
            // slide — reading as "fade in place" instead of
            // "fly in from the right".
            overflow: 'visible',
            visibility: open ? 'visible' : 'hidden',
            pointerEvents: open ? 'auto' : 'none',
          }}
          aria-label={t('sectionNav.navAria')}
        >
          <div className="px-3 py-2 shrink-0">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
            >
              {t('sectionNav.heading')}
            </span>
          </div>

          {/* Same overflow: visible rule as the panel — rows must
              be able to render outside this scroll container
              during the slide-in journey. Realistically songs
              have ≤ ~15 sections which fit in 70vh, so losing
              scroll here is fine. */}
          <div className="flex-1 py-1" style={{ overflow: 'visible' }}>
            {sections.map((s, i) => (
              <SectionItemRow
                key={`${s.id}-${open ? 'open' : 'closed'}`}
                item={s}
                ordinal={i}
                active={s.id === activeId}
                open={open}
                onClick={handleSectionClick}
              />
            ))}
          </div>
        </nav>
      </div>

      {/* Per-row top-to-bottom cascade. Each row starts slightly
          above its final slot (translated -8px on Y) and
          invisible, then drops into position while fading in
          over ~220 ms. Stagger is applied per ordinal so rows
          land one after another, top down — the classic
          menu-cascade effect. String concat (not template
          literal) because Vite's React-Babel plugin refuses
          backticks inside JSX children — see memory:
          no-backticks-in-template-literals. */}
      <style>{
        '@keyframes sectionNavRowAppear {' +
        '  from {' +
        '    opacity: 0;' +
        '    transform: translateY(-8px);' +
        '  }' +
        '  to {' +
        '    opacity: 1;' +
        '    transform: translateY(0);' +
        '  }' +
        '}'
      }</style>
    </>
  );
}

function SectionItemRow({
  item,
  ordinal,
  active,
  open,
  onClick,
}: {
  item: SectionItem;
  ordinal: number;
  active: boolean;
  /** Panel's open state — used to (re)play the per-row appear
   *  animation each time the menu opens. The row's key includes
   *  `open` at the call site so this component re-mounts on
   *  every open/close cycle, which restarts the CSS animation. */
  open: boolean;
  onClick: (ordinal: number) => void;
}): React.ReactElement {
  const t = useT();
  const rowRef = useRef<HTMLButtonElement>(null);

  // When this row becomes active, scroll it into view inside the panel so
  // the user's current section is always visible without manually scrolling
  // the panel itself.
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  // Top-to-bottom cascade: each row drops in slightly from
  // above and fades in on its own delayed slot. Stagger is
  // 30 ms per row so the cascade reads as a smooth wave from
  // the top of the menu down — ~15 sections finish revealing
  // in ~600 ms. The `both` fill mode holds the "from" state
  // before the delay fires so rows waiting their turn stay
  // hidden instead of flashing at their final position.
  const STAGGER_MS = 30;
  const staggerMs = ordinal * STAGGER_MS;
  const animationStyle: React.CSSProperties = open
    ? {
        animation: 'sectionNavRowAppear 160ms cubic-bezier(0.22, 1, 0.36, 1) both',
        animationDelay: `${staggerMs}ms`,
      }
    : { opacity: 0 };

  // Hover state — track locally so inline styles can react.
  // Tailwind's `hover:*` utilities can't compose with the inline
  // styles the active + animation state already sets, so we
  // manage it with a small piece of React state.
  const [hovered, setHovered] = useState(false);

  // Style resolution order: active > hovered > default. Active
  // wins because a highlighted current-section should stay
  // highlighted while the user hovers a different row (the
  // hover only styles the row the pointer is on, not the
  // active one).
  const rowBackground = active
    ? 'var(--surface-elevated)'
    : hovered
      ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
      : 'transparent';
  const rowColor = active
    ? 'var(--accent)'
    : hovered
      ? 'var(--text-primary)'
      : 'var(--text-secondary)';
  const rowBorderColor = active
    ? 'var(--accent)'
    : hovered
      ? 'color-mix(in srgb, var(--accent) 60%, transparent)'
      : 'transparent';

  return (
    <button
      ref={rowRef}
      onClick={() => onClick(ordinal)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2"
      style={{
        background: rowBackground,
        color: rowColor,
        fontWeight: active || hovered ? 600 : 400,
        borderLeft: `3px solid ${rowBorderColor}`,
        cursor: 'pointer',
        ...animationStyle,
      }}
      title={t('sectionNav.scrollTo', { label: item.label })}
    >
      <span className="truncate">{item.label}</span>
    </button>
  );
}
