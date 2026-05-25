import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote, X } from 'lucide-react';

interface Props {
  title: string;
  /** The song's notes, if any. Empty / whitespace-only is treated as
   *  "no notes" and renders the button disabled. */
  notes?: string;
  /** Visual size — `'sm'` for table rows, `'md'` for toolbars. Matches
   *  PlayLinkButton so the two icons line up in a row. */
  size?: 'sm' | 'md';
}

/**
 * Reusable "song notes" button for song-list rows. Mirrors
 * {@link PlayLinkButton}: rendered disabled-but-present when the song
 * has no notes so the columns stay aligned across rows. When the song
 * DOES have notes, clicking pops up a small read-only panel showing
 * them — letting the user peek at a song's notes without opening it.
 *
 * The popover is rendered through a portal so it escapes the table's
 * `overflow` clipping, and is positioned next to the button, flipped /
 * clamped to stay fully on-screen. It dismisses on outside-click or
 * Escape.
 */
export default function NotesLinkButton({ title, notes, size = 'sm' }: Props): React.ReactElement {
  const text = notes?.trim() ?? '';
  const has = text.length > 0;
  const iconSize = size === 'md' ? 18 : 15;
  const padding = size === 'md' ? 'p-2' : 'p-1';

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const POP_WIDTH = 300;
  const MAX_HEIGHT = 260;
  const GAP = 8;
  const MARGIN = 12;

  // Position the popover relative to the button once it opens (and on
  // resize while open). Prefer placing it to the RIGHT of the button;
  // flip to the left if it would overflow the viewport. Vertically it
  // hangs down from the button top, clamped to stay on-screen.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      let left = b.right + GAP;
      if (left + POP_WIDTH + MARGIN > window.innerWidth) {
        // Not enough room on the right — place to the left.
        left = b.left - GAP - POP_WIDTH;
      }
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - POP_WIDTH - MARGIN));
      let top = b.top;
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - MAX_HEIGHT - MARGIN));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Dismiss on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!has) return;
    setOpen((v) => !v);
  };

  const tooltip = has ? `Notes for "${title}"` : 'No notes for this song';

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        disabled={!has}
        className={`${padding} rounded-lg transition-colors`}
        style={{
          color: has ? 'var(--accent)' : 'var(--text-muted)',
          opacity: has ? 1 : 0.35,
          cursor: has ? 'pointer' : 'not-allowed',
          background: 'transparent',
        }}
        title={tooltip}
        aria-label={tooltip}
      >
        <StickyNote size={iconSize} strokeWidth={1.75} />
      </button>

      {open && has && pos && createPortal(
        <div
          ref={popRef}
          className="fixed rounded-xl shadow-2xl border flex flex-col"
          onClick={(e) => e.stopPropagation()}
          style={{
            left: pos.left,
            top: pos.top,
            width: POP_WIDTH,
            maxHeight: MAX_HEIGHT,
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border)',
            zIndex: 300,
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <StickyNote size={14} style={{ color: 'var(--accent)' }} />
              <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }} title={title}>
                {title}
              </h3>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              title="Close"
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div
            className="p-3 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
            style={{ color: 'var(--text-primary)' }}
          >
            {text}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
