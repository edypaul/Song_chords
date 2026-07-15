import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2,
  Pencil,
  Highlighter,
  Minus,
  ArrowRight,
  Square,
  Circle,
  Type,
  Trash2,
  X,
  Save,
} from 'lucide-react';
import type { AnnotationViewMode } from '@song-chords/shared';
import { viewModeEquals, viewModeLabel } from '@song-chords/shared';
import {
  ANNOTATION_COLORS,
  useAnnotationEditStore,
  type AnnotationTool,
} from './annotation-store';
import type { useAnnotationDoc } from './useAnnotationDoc';

interface Props {
  onClose: () => void;
  songId: string;
  viewMode: AnnotationViewMode;
  controller: ReturnType<typeof useAnnotationDoc>;
}

const TOOLS: Array<{ id: AnnotationTool; label: string; Icon: typeof Pencil }> = [
  { id: 'select',      label: 'Select / erase',   Icon: MousePointer2 },
  { id: 'pen',         label: 'Pen',              Icon: Pencil },
  { id: 'highlighter', label: 'Highlighter',      Icon: Highlighter },
  { id: 'line',        label: 'Line',             Icon: Minus },
  { id: 'arrow',       label: 'Arrow',            Icon: ArrowRight },
  { id: 'rect',        label: 'Rectangle',        Icon: Square },
  { id: 'ellipse',     label: 'Ellipse',          Icon: Circle },
  { id: 'text',        label: 'Text',             Icon: Type },
];

/**
 * Floating, draggable annotation drawing toolbar. Purely a drawing
 * palette — tools, colors, stroke, font size, and a Save-as at the
 * bottom that promotes the current draft into a named set.
 *
 * Set management (switch active set, rename, delete, set-as-default,
 * turn off) lives in the top-toolbar `AnnotationSetPicker` — the
 * two UIs are intentionally split so the drawing surface stays
 * focused on drawing.
 */
export default function AnnotationToolbar({ onClose, viewMode, controller }: Props): React.ReactElement {
  const tool = useAnnotationEditStore((s) => s.tool);
  const color = useAnnotationEditStore((s) => s.color);
  const strokeWidth = useAnnotationEditStore((s) => s.strokeWidth);
  const fontSize = useAnnotationEditStore((s) => s.fontSize);
  const setTool = useAnnotationEditStore((s) => s.setTool);
  const setColor = useAnnotationEditStore((s) => s.setColor);
  const setStrokeWidth = useAnnotationEditStore((s) => s.setStrokeWidth);
  const setFontSize = useAnnotationEditStore((s) => s.setFontSize);

  const { draft, doc, saveDraftAs, replaceShapes } = controller;
  const hasDraftShapes = !!draft && draft.shapes.length > 0;

  // Auto-numbered default name based on how many named sets already
  // exist for the CURRENT view configuration. Every save gets an
  // incrementing number, "Annotation #1", "#2", etc — per triple.
  // Recomputed whenever the doc or view mode changes so the field
  // shows the next number the user is about to save into.
  const defaultName = useMemo(() => {
    const existing = doc.sets.filter((s) => viewModeEquals(s.viewMode, viewMode));
    // Extract numbers from names matching "Annotation #N"; N is the
    // max + 1. Custom-named sets don't participate in the count, so
    // the auto-number stays intuitive ("if I never rename, I get
    // #1, #2, #3…").
    let maxN = 0;
    for (const s of existing) {
      const m = /^Annotation #(\d+)$/.exec(s.name);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }
    return `Annotation #${maxN + 1}`;
  }, [doc.sets, viewMode]);

  // Name the user is currently typing. Starts as the auto-numbered
  // default and refreshes when the default changes (typical case:
  // after a save, defaultName ticks up; the field reflects it).
  const [saveAsName, setSaveAsName] = useState(defaultName);
  const [nameDirty, setNameDirty] = useState(false);
  useEffect(() => {
    // Sync to the new default whenever the user hasn't typed
    // anything custom. Once they touch the field, we stop
    // overwriting their input.
    if (!nameDirty) setSaveAsName(defaultName);
  }, [defaultName, nameDirty]);

  // Position — start anchored below-right of the top toolbar, with a
  // margin so the panel doesn't butt against the viewport edge.
  //
  // Constants: panel width = 260 (matches the `width: 260` on the
  // root div), right margin = 20. Left-clamp at 20 so a very narrow
  // window still leaves the panel visible.
  const PANEL_WIDTH = 260;
  const MARGIN = 20;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN),
    y: 120,
  }));
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Clamp to viewport on resize using the panel's actual measured
    // dimensions (fallback to constants). Keeps the whole panel
    // visible, not just a 60-px stub of it.
    const clamp = () => {
      setPos((p) => {
        const w = panelRef.current?.offsetWidth ?? PANEL_WIDTH;
        const h = panelRef.current?.offsetHeight ?? 60;
        return {
          x: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, p.x)),
          y: Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, p.y)),
        };
      });
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const w = panelRef.current?.offsetWidth ?? PANEL_WIDTH;
    const h = panelRef.current?.offsetHeight ?? 60;
    const nx = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, e.clientX - d.dx));
    const ny = Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, e.clientY - d.dy));
    setPos({ x: nx, y: ny });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { (e.currentTarget as Element).releasePointerCapture(d.id); } catch { /* ignore */ }
  };

  const doSaveAs = () => {
    const name = saveAsName.trim();
    if (!name || !hasDraftShapes) return;
    saveDraftAs(name, viewMode);
    // Reset the field so the next save auto-picks the next number.
    // Clearing `nameDirty` re-arms the auto-sync effect above; the
    // draft is now gone, so `defaultName` will already reflect the
    // incremented number by this render.
    setNameDirty(false);
  };

  // Portal to <body>. The parent (AnnotationEditingRoot) mounts
  // inside PerformPage's zoomed wrapper (CSS `zoom: perfZoom`),
  // which scales EVERY descendant — including `position: fixed`
  // ones — visually. Portalling escapes that ancestor so the
  // toolbar renders at its true CSS size and its `left`/`top`
  // coords aren't post-multiplied by the perf-mode zoom.
  return createPortal(
    <div
      ref={panelRef}
      className="fixed rounded-xl shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: 260,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        // Above audio/YouTube panels (9999) so the drawing toolbar
        // remains visible even when a media panel is open.
        zIndex: 10000,
        overflow: 'hidden',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b select-none"
        style={{ borderColor: 'var(--border)', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Annotate</span>
        <button
          data-no-drag
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--surface-elevated)]"
          title="Close (annotations stay saved)"
          aria-label="Close"
        >
          <X size={14} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Tools */}
      <div data-no-drag className="grid grid-cols-4 gap-1 p-2 border-b" style={{ borderColor: 'var(--border)' }}>
        {TOOLS.map(({ id, label, Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              onClick={() => setTool(id)}
              className="flex items-center justify-center p-2 rounded-md transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'var(--surface)',
                color: active ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              title={label}
              aria-label={label}
              aria-pressed={active}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>

      {/* Colors */}
      <div data-no-drag className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {ANNOTATION_COLORS.map((c) => {
            const active = c === color;
            return (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="rounded-full transition-transform"
                style={{
                  width: 20,
                  height: 20,
                  background: c,
                  border: active
                    ? `2px solid var(--accent)`
                    : `1px solid ${c === '#ffffff' ? 'var(--border)' : 'transparent'}`,
                  transform: active ? 'scale(1.15)' : 'scale(1)',
                }}
                title={c}
                aria-label={`Color ${c}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
      </div>

      {/* Stroke width */}
      <div data-no-drag className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stroke</span>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{strokeWidth}px</span>
        </div>
        <input
          type="range"
          min={1}
          max={16}
          step={1}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {tool === 'text' && (
        <div data-no-drag className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Font size</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{fontSize}px</span>
          </div>
          <input
            type="range"
            min={10}
            max={48}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {/* Bottom: name input + Save button + Clear-draft. Always
          visible so the flow is:
            1. Draw
            2. See auto-numbered name in the input
            3. Optionally rename
            4. Hit Save
            5. Draft becomes a named set, input auto-advances to the
               next number, canvas is ready for the next set. */}
      <div data-no-drag className="p-2 space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Save as
        </div>
        <input
          value={saveAsName}
          onChange={(e) => { setSaveAsName(e.target.value); setNameDirty(true); }}
          placeholder="Name…"
          className="w-full text-xs px-1.5 py-1 rounded"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          onKeyDown={(e) => { if (e.key === 'Enter') doSaveAs(); }}
        />
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Will show in: <span style={{ color: 'var(--text-secondary)' }}>{viewModeLabel(viewMode)}</span>
        </div>
        <button
          onClick={doSaveAs}
          disabled={!hasDraftShapes || !saveAsName.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium"
          style={{
            background: (hasDraftShapes && saveAsName.trim()) ? 'var(--accent)' : 'var(--surface)',
            color: (hasDraftShapes && saveAsName.trim()) ? 'white' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            cursor: (hasDraftShapes && saveAsName.trim()) ? 'pointer' : 'not-allowed',
            opacity: (hasDraftShapes && saveAsName.trim()) ? 1 : 0.6,
          }}
          title={
            !hasDraftShapes
              ? 'Draw something first'
              : !saveAsName.trim()
                ? 'Give it a name'
                : 'Save the current drawing as a named annotation'
          }
        >
          <Save size={13} />
          Save
        </button>
        <button
          onClick={() => replaceShapes([])}
          disabled={!hasDraftShapes}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{
            background: 'var(--surface)',
            color: 'var(--danger)',
            border: '1px solid var(--border)',
            opacity: hasDraftShapes ? 1 : 0.4,
            cursor: hasDraftShapes ? 'pointer' : 'not-allowed',
          }}
          title="Erase everything in the current drawing"
        >
          <Trash2 size={13} />
          Clear
        </button>
        <div className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
          Ctrl+Z undo · Ctrl+Shift+Z redo
        </div>
      </div>
    </div>,
    document.body,
  );
}
