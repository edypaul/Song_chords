import React, { useEffect, useRef, useState } from 'react';
import { StickyNote, X, Edit2 } from 'lucide-react';

interface Props {
  title: string;
  notes: string;
  onClose: () => void;
  onSave?: (next: string) => void | Promise<void>;
}

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
export default function StickyNotePanel({ title, notes, onClose, onSave }: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  useEffect(() => { if (!editing) setDraft(notes); }, [notes, editing]);

  const DEFAULT_WIDTH = 340;
  const DEFAULT_HEIGHT = 260;
  const margin = 20;
  const [pos, setPos] = useState(() => ({
    x: Math.max(margin, (typeof window !== 'undefined' ? window.innerWidth : 1200) - DEFAULT_WIDTH - margin),
    y: 80,
  }));
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
          <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }} title={title}>Song Notes</h3>
        </div>
        <div className="flex items-center gap-1">
          {onSave && !editing && (
            <button
              data-close
              onClick={() => { setDraft(notes); setEditing(true); }}
              className="p-1 rounded hover:bg-[var(--surface-elevated)]"
              title="Edit note"
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
                title="Save"
              >
                Save
              </button>
              <button
                data-close
                onClick={() => { setDraft(notes); setEditing(false); }}
                className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-muted)' }}
                title="Cancel"
              >
                Cancel
              </button>
            </>
          )}
          <button data-close onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title="Close">
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
          placeholder="Write your notes here…"
        />
      ) : (
        <div
          className="flex-1 p-3 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: notes ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          {notes || 'No notes yet — click the pencil to add some.'}
        </div>
      )}
    </div>
  );
}
