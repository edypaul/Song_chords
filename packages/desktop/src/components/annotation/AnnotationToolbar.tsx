import React, { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  useAnnotationEditStore,
  type AnnotationTool,
} from './annotation-store';

interface Props {
  /** Called when the user clicks the toolbar's close button, or when
   *  they hit Escape while the toolbar is focused. Parent flips the
   *  `showAnnotationToolbar` state (which also unmounts the drawing
   *  surface, flushing any pending save). */
  onClose: () => void;
  /** Called when the user hits "clear all". Confirmation is up to the
   *  parent — the toolbar just fires. */
  onClearAll: () => void;
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
 * Floating, draggable annotation toolbar. Mounted while `editing` is
 * on; unmounting fires `onClose` from the parent.
 *
 * Layout mirrors StickyNotePanel: a drag handle at the top, pointer
 * capture during drag, clamped to the viewport.
 */
export default function AnnotationToolbar({ onClose, onClearAll }: Props): React.ReactElement {
  const tool = useAnnotationEditStore((s) => s.tool);
  const color = useAnnotationEditStore((s) => s.color);
  const strokeWidth = useAnnotationEditStore((s) => s.strokeWidth);
  const fontSize = useAnnotationEditStore((s) => s.fontSize);
  const setTool = useAnnotationEditStore((s) => s.setTool);
  const setColor = useAnnotationEditStore((s) => s.setColor);
  const setStrokeWidth = useAnnotationEditStore((s) => s.setStrokeWidth);
  const setFontSize = useAnnotationEditStore((s) => s.setFontSize);

  // Position — start anchored below-right of the toolbar (out of the
  // way of the song title). Drag persists in memory only; a next
  // session recentres.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, window.innerWidth - 320),
    y: 120,
  }));
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clamp = () => {
      setPos((p) => ({
        x: Math.max(0, Math.min(window.innerWidth - 60, p.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, p.y)),
      }));
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
    const nx = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - d.dx));
    const ny = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - d.dy));
    setPos({ x: nx, y: ny });
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
      className="fixed rounded-xl shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: 260,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        // Above the drawing surface's z: 40 and any sticky note (200);
        // below modals (1000+).
        zIndex: 300,
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
                  // Outline the active swatch so the user's choice is
                  // obvious. White gets a border always so it's visible
                  // on light backgrounds.
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

      {/* Text font size — only shown when the text tool is picked so
          the toolbar stays compact for the common case. */}
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

      {/* Actions */}
      <div data-no-drag className="p-2">
        <button
          onClick={onClearAll}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{
            background: 'var(--surface)',
            color: 'var(--danger)',
            border: '1px solid var(--border)',
          }}
          title="Erase every annotation on this song"
        >
          <Trash2 size={13} />
          Clear all
        </button>
        <div className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
          Ctrl+Z undo · Ctrl+Shift+Z redo
        </div>
      </div>
    </div>
  );
}
