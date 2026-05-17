import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ListTree, X } from 'lucide-react';
import type { ParsedSong } from '@song-chords/shared';
import { useSettingsStore } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';

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
  const open = useSettingsStore((s) => s.settings.sectionPanelOpen ?? false);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const setOpen = (next: boolean) => {
    void updateSetting(db, 'sectionPanelOpen', next);
  };

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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed top-1/2 right-3 -translate-y-1/2 p-2.5 rounded-full shadow-lg transition-all hover:scale-105"
        style={{
          background: 'var(--accent)',
          color: 'white',
          zIndex: 55,
        }}
        title={`Section navigator (${sections.length} sections)`}
        aria-label="Open section navigator"
      >
        <ListTree size={16} />
      </button>
    );
  }

  return (
    <div
      className="fixed top-1/2 right-3 -translate-y-1/2 rounded-xl shadow-xl flex flex-col"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        width: 220,
        maxHeight: '70vh',
        zIndex: 55,
      }}
      role="navigation"
      aria-label="Section navigator"
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
        >
          Sections
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-1 rounded hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close section navigator"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sections.map((s, i) => (
          <SectionItemRow
            key={s.id}
            item={s}
            ordinal={i}
            active={s.id === activeId}
            onClick={scrollToSection}
          />
        ))}
      </div>
    </div>
  );
}

function SectionItemRow({
  item,
  ordinal,
  active,
  onClick,
}: {
  item: SectionItem;
  ordinal: number;
  active: boolean;
  onClick: (ordinal: number) => void;
}): React.ReactElement {
  const rowRef = useRef<HTMLButtonElement>(null);

  // When this row becomes active, scroll it into view inside the panel so
  // the user's current section is always visible without manually scrolling
  // the panel itself.
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    <button
      ref={rowRef}
      onClick={() => onClick(ordinal)}
      className="w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2"
      style={{
        background: active ? 'var(--surface-elevated)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
      }}
      title={`Scroll to "${item.label}"`}
    >
      <span className="truncate">{item.label}</span>
    </button>
  );
}
