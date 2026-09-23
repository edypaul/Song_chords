import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StickyNote, X, Edit2 } from 'lucide-react';
import { useT } from '../../i18n';

interface Props {
  title: string;
  notes: string;
  onClose: () => void;
  onSave?: (next: string) => void | Promise<void>;
  /**
   * Stable identity for the "same panel" across close/reopen cycles.
   * When set, the FIRST successful mount measures the DOM and caches its
   * chosen position + size under this key; every later mount with the
   * same key reuses those cached values instead of re-measuring — so
   * closing the panel and reopening it from the toggle brings it back
   * exactly where it was, not somewhere else because the DOM shifted
   * (scroll position, hydration timing, etc.) in the interim.
   *
   * A different key (e.g. a different song id) invalidates the cache
   * and triggers a fresh measurement — that's what you want when the
   * gutter geometry may have changed for real.
   *
   * The cache is per-process (module-level), so it also survives if
   * the parent unmounts/remounts the panel for other reasons.
   */
  positionKey?: string;
}

/** Module-level cache of the first-measured position/size per `positionKey`.
 *  `userSized` records that the size came from a MANUAL resize — only
 *  then does a later mount keep it instead of auto-fitting to content.
 *  See the JSDoc on `Props.positionKey` for the rationale. */
const positionCache = new Map<string, {
  pos: { x: number; y: number };
  size: { w: number; h: number };
  userSized?: boolean;
}>();

/**
 * Floating, draggable & resizable panel that shows a song's notes. Used from
 * both the standalone song view and the perform pages.
 *
 * - Not modal (no backdrop). Sits above page content via zIndex.
 * - Drag the title bar with mouse, touch, or pen. Position is clamped to the
 *   viewport so the panel can't be dragged off-screen.
 * - Resizable via native CSS `resize: both` corner handle.
 * - When `onSave` is provided the header exposes an inline edit mode.
 */
export default function StickyNotePanel({ title, notes, onClose, onSave, positionKey }: Props): React.ReactElement {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  useEffect(() => { if (!editing) setDraft(notes); }, [notes, editing]);

  const DEFAULT_WIDTH = 340;
  const DEFAULT_HEIGHT = 260;
  const margin = 20;
  // If we have a cached position for this key (from an earlier mount
  // of the same panel that already measured the DOM), seed from it —
  // and skip the measurement effect entirely below. That's what makes
  // close-then-reopen restore the exact same spot.
  const cached = positionKey ? positionCache.get(positionKey) : undefined;
  // Initial position is measured from the live DOM after mount: the
  // note is horizontally centred in the gutter between the sidebar's
  // right edge and the first section heading's left edge. The static
  // value below is a pre-measurement fallback; the useLayoutEffect
  // overwrites it before paint.
  const [pos, setPos] = useState(() => cached?.pos ?? ({
    x: margin,
    y: 280,
  }));
  /** Set to true on first successful DOM measurement so the panel
   *  isn't visible at the fallback position for one frame. When the
   *  position comes from the cache it's already valid — start visible. */
  const [measured, setMeasured] = useState(!!cached);
  // True once the USER has resized the panel by hand (this mount, or
  // a cached earlier one). The content auto-fit below stands down
  // only then — programmatic sizes are always allowed to re-fit.
  const userResizedRef = useRef(!!cached?.userSized);
  // The last size WE set (commit / auto-fit), so the ResizeObserver
  // can tell a manual corner-drag apart from our own updates.
  const programmaticSizeRef = useRef<{ w: number; h: number } | null>(cached?.size ?? null);

  // Measure the page on mount and anchor the note in the gutter
  // between the sidebar and the song body. Two layout rules apply:
  //
  //   • If the gutter is WIDE enough to comfortably hold the default
  //     panel width with a margin on both sides (typical desktop +
  //     expanded sidebar), the panel's LEFT edge is placed a small
  //     fixed distance from the sidebar — close to the sidebar,
  //     with the song body well clear to the right. That matches
  //     the reference layout the user supplied.
  //
  //   • If the gutter is NARROWER than the default panel width
  //     (typical narrow window + collapsed sidebar), the panel
  //     shrinks to fit and centres in the gutter so it doesn't
  //     touch either edge.
  //
  // We retry briefly (up to ~10 frames) because the song content can
  // still be hydrating when the sticky-note mounts — the first
  // section heading may not exist in the DOM yet on frame 1.
  const [size, setSize] = useState(() => cached?.size ?? ({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }));
  useLayoutEffect(() => {
    // Cache hit → the constructor already seeded pos + size from the
    // stored measurement; skip re-measuring so a close/reopen doesn't
    // re-anchor the panel to a shifted DOM (e.g. scrolled content).
    if (cached) return;
    let cancelled = false;
    let attempts = 0;
    // Natural height of the note at a given panel width, so the panel
    // opens sized to its CONTENT — everything visible without
    // scrolling — clamped to sane bounds (scroll only past 70 % of
    // the viewport). Measured with an off-screen probe matching the
    // content area's typography (text-sm + leading-relaxed + p-3).
    const contentHeightFor = (w: number): number => {
      const probe = document.createElement('div');
      probe.style.cssText =
        `position:fixed;left:-9999px;top:0;width:${Math.max(60, w - 24)}px;` +
        'white-space:pre-wrap;font-size:14px;line-height:1.625;visibility:hidden;';
      probe.style.fontFamily = getComputedStyle(document.body).fontFamily;
      probe.textContent = notes || ' ';
      document.body.appendChild(probe);
      const textH = probe.scrollHeight;
      probe.remove();
      const HEADER_H = 37; // title bar (px-3 py-2) + bottom border
      const PAD_V = 24;    // content p-3, top + bottom
      const natural = textH + PAD_V + HEADER_H;
      return Math.max(140, Math.min(natural, Math.round(window.innerHeight * 0.7)));
    };
    const commit = (nextPos: { x: number; y: number }, nextSize: { w: number; h: number }) => {
      programmaticSizeRef.current = nextSize;
      setPos(nextPos);
      setSize(nextSize);
      setMeasured(true);
      if (positionKey) positionCache.set(positionKey, { pos: nextPos, size: nextSize, userSized: userResizedRef.current });
    };
    const measure = () => {
      if (cancelled) return;
      // Sidebar's right edge: the app's left <nav> is the first nav
      // element on the page. Falls back to 0 if not present (e.g.
      // fullscreen / perform mode which hides the sidebar).
      const navEl = document.querySelector('nav');
      const navRight = navEl ? navEl.getBoundingClientRect().right : 0;
      // First section heading visible anywhere in the document. The
      // SongRenderer marks every section label with this attribute.
      const sectionEl = document.querySelector<HTMLElement>('[data-section-heading]');
      const sectionLeft = sectionEl?.getBoundingClientRect().left;
      if (sectionLeft === undefined || sectionLeft <= navRight) {
        // Section content isn't laid out yet — retry next frame.
        if (++attempts < 10) {
          requestAnimationFrame(measure);
          return;
        }
        // No section heading in this document (song has no {c: …}
        // directives — just lyrics + chords). Without this fallback the
        // panel stayed `visibility: hidden` forever, so the user saw the
        // toggle icon flip color but the panel appeared to do nothing.
        // Pick a sensible default: anchor near the top-left of the main
        // content area (past the sidebar if present) and mark measured.
        const fallbackX = Math.max(margin, navRight + 20);
        const finalX = Math.min(window.innerWidth - DEFAULT_WIDTH - margin, fallbackX + 20);
        commit({ x: Math.max(margin, finalX), y: 120 }, { w: DEFAULT_WIDTH, h: contentHeightFor(DEFAULT_WIDTH) });
        return;
      }
      // Gutter geometry with a small inset on each side so the panel
      // never visually touches the sidebar or the song body.
      const gapFromSidebar = 20;
      const gapFromBody = 20;
      const gutterLeft = navRight + gapFromSidebar;
      const gutterRight = sectionLeft - gapFromBody;
      const gutterWidth = Math.max(0, gutterRight - gutterLeft);
      let w: number, x: number;
      if (gutterWidth >= DEFAULT_WIDTH) {
        // Wide gutter — anchor the panel's LEFT edge to the
        // sidebar-side of the gutter so it sits close to the nav,
        // matching the reference screenshot. Don't centre.
        w = DEFAULT_WIDTH;
        x = gutterLeft;
      } else {
        // Narrow gutter — shrink to fit and centre in it so it
        // doesn't overlap either edge.
        w = Math.max(220, gutterWidth);
        const gutterCentre = (gutterLeft + gutterRight) / 2;
        x = Math.max(margin, gutterCentre - w / 2);
      }
      // Vertical: align the note's TOP border with the top border
      // of the first section label so the two visually start at the
      // same horizontal line — that's the alignment the user wants.
      const sectionRect = sectionEl!.getBoundingClientRect();
      const y = Math.max(margin, sectionRect.top);
      // Final horizontal nudge: move the note 20 px to the right of
      // the computed gutter position, clamped so it can't be pushed
      // off-screen on narrow windows.
      const finalX = Math.min(window.innerWidth - w - margin, x + 20);
      commit({ x: finalX, y }, { w, h: contentHeightFor(w) });
    };
    measure();
    return () => { cancelled = true; };
  }, []);
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // BORDER-box size: the panel is sized border-box, so writing the
      // (2px-smaller) contentRect back into `size` used to re-trigger
      // this observer and shrink the panel ~2px per frame until it hit
      // its min height — every sticky note quietly collapsed.
      const bb = entry.borderBoxSize?.[0];
      const target = entry.target as HTMLElement;
      const w = Math.round(bb ? bb.inlineSize : target.offsetWidth);
      const h = Math.round(bb ? bb.blockSize : target.offsetHeight);
      // A size that differs from the one WE last set can only come
      // from the native corner-drag — remember that so the content
      // auto-fit stops overriding the user's choice.
      const p = programmaticSizeRef.current;
      if (p && (Math.abs(w - p.w) > 3 || Math.abs(h - p.h) > 3)) {
        userResizedRef.current = true;
      }
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the panel's height to the REAL rendered note content — the
  // pre-render probe estimate can drift with fonts/wrapping, so once
  // the content is actually laid out, grow (or shrink) so everything
  // is visible, clamped to 70 % of the viewport (scroll past that).
  // Cache-restored mounts skip this: a size the user set by hand (or
  // that was already fitted) must survive close → reopen untouched.
  useLayoutEffect(() => {
    if (!measured || userResizedRef.current || editing) return;
    const fit = () => {
      const panel = panelRef.current;
      const content = panel?.querySelector<HTMLElement>('[data-note-content]');
      if (!panel || !content) return;
      const chrome = panel.clientHeight - content.clientHeight; // header bar etc.
      const borders = panel.offsetHeight - panel.clientHeight;  // style height is border-box
      const target = Math.max(140, Math.min(content.scrollHeight + chrome + borders, Math.round(window.innerHeight * 0.7)));
      setSize((s) => {
        if (Math.abs(s.h - target) <= 2) return s;
        const next = { ...s, h: target };
        programmaticSizeRef.current = next;
        return next;
      });
    };
    fit();
    // Text metrics can settle a beat later (style hydration, fonts,
    // async song data) — fit again after layout has calmed down.
    const t1 = window.setTimeout(fit, 250);
    const t2 = window.setTimeout(fit, 700);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [measured, notes, editing]);

  // Persist whatever position/size the panel currently has into the cache,
  // so a drag or resize survives close → reopen just like the initial
  // measurement does. Only writes once measured (skips the fallback
  // pre-measurement pos of {margin, 280} that we never want to lock in).
  useEffect(() => {
    if (!positionKey || !measured) return;
    positionCache.set(positionKey, { pos, size, userSized: userResizedRef.current });
  }, [positionKey, measured, pos.x, pos.y, size.w, size.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-close]')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const nextX = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - d.dx));
    const nextY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy));
    setPos({ x: nextX, y: nextY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { (e.currentTarget as Element).releasePointerCapture(d.id); } catch { /* ignore */ }
  };

  return (
    <div
      ref={panelRef}
      className="fixed rounded-xl shadow-2xl border flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        // Hide the panel for the single frame between mount and the
        // gutter measurement so it doesn't visibly snap from the
        // fallback position to its real one.
        visibility: measured ? 'visible' : 'hidden',
        width: size.w,
        height: size.h,
        minWidth: 220,
        minHeight: 140,
        maxWidth: '90vw',
        maxHeight: '90vh',
        resize: 'both',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        zIndex: 200,
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b select-none"
        style={{ borderColor: 'var(--border)', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StickyNote size={14} style={{ color: 'var(--accent)' }} />
          <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }} title={title}>{t('notes.title')}</h3>
        </div>
        <div className="flex items-center gap-1">
          {onSave && !editing && (
            <button
              data-close
              onClick={() => { setDraft(notes); setEditing(true); }}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              title={t('notes.edit')}
            >
              <Edit2 size={13} style={{ color: 'var(--text-secondary)' }} />
            </button>
          )}
          {onSave && editing && (
            <>
              <button
                data-close
                onClick={async () => { await onSave(draft); setEditing(false); }}
                className="px-1.5 py-0.5 rounded text-[11px] font-medium hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--accent)' }}
                title={t('common.save')}
              >
                {t('common.save')}
              </button>
              <button
                data-close
                onClick={() => { setDraft(notes); setEditing(false); }}
                className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-muted)' }}
                title={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </>
          )}
          <button data-close onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title={t('common.close')}>
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 p-3 text-sm leading-relaxed outline-none resize-none"
          style={{ background: 'transparent', color: 'var(--text-primary)', border: 'none' }}
          placeholder={t('notes.placeholder')}
        />
      ) : (
        <div
          data-note-content
          className="flex-1 p-3 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: notes ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          {notes || t('notes.emptyHint')}
        </div>
      )}
    </div>
  );
}
