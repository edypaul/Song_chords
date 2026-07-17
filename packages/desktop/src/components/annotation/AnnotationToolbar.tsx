import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eraser,
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
  Plus,
  Edit3,
} from 'lucide-react';
import type { AnnotationSet, AnnotationViewMode } from '@song-chords/shared';
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
  { id: 'select',      label: 'Erase',            Icon: Eraser },
  { id: 'pen',         label: 'Pen',              Icon: Pencil },
  { id: 'highlighter', label: 'Highlighter',      Icon: Highlighter },
  { id: 'line',        label: 'Line',             Icon: Minus },
  { id: 'arrow',       label: 'Arrow',            Icon: ArrowRight },
  { id: 'rect',        label: 'Rectangle',        Icon: Square },
  { id: 'ellipse',     label: 'Ellipse',          Icon: Circle },
  { id: 'text',        label: 'Text',             Icon: Type },
];

/**
 * Floating, draggable annotation drawing toolbar.
 *
 * Three UI states, based on whether a draft is being edited and where
 * it came from:
 *   1. NO DRAFT — the panel just opened; whichever set is picked in
 *      the top-toolbar dropdown is being displayed but not edited.
 *      Toolbar shows the tools palette + a "New annotation" button
 *      and (if a set is selected) an "Edit" button. Drawing tools
 *      are inert.
 *   2. DRAFT FROM SCRATCH — user clicked "New annotation". Draft is
 *      empty. Toolbar shows tools + name input + Save (creates a new
 *      set) + Cancel (discards the draft).
 *   3. DRAFT LOADED FROM AN EXISTING SET — user clicked "Edit …".
 *      Draft holds a copy of the set's shapes. Toolbar shows tools +
 *      "Editing {name}" + Save (overwrites the source set) + Save as
 *      (creates a new set beside it) + Cancel (discards edits).
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

  const {
    draft, doc, activeSet, draftSourceSetId,
    saveDraftAs, saveDraftOverwriting, startNewDraft, loadSetIntoDraft,
    discardDraft, replaceShapes,
  } = controller;

  const isEditing = !!draft;
  const editingFromSet = isEditing && draftSourceSetId
    ? doc.sets.find((s) => s.id === draftSourceSetId) ?? null
    : null;
  // Only offer Edit for a set that matches the current view mode
  // and is actually selected — matches the picker's own contract.
  const currentSetToEdit: AnnotationSet | null = !isEditing && activeSet && activeSet.id !== 'draft'
    ? activeSet
    : null;
  const hasShapesInDraft = !!draft && draft.shapes.length > 0;

  // Auto-numbered default name for "save as new". Recomputes on
  // save so the next name auto-advances.
  const defaultName = useMemo(() => {
    const existing = doc.sets.filter((s) => viewModeEquals(s.viewMode, viewMode));
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

  const [saveAsName, setSaveAsName] = useState(defaultName);
  const [nameDirty, setNameDirty] = useState(false);
  useEffect(() => {
    if (!nameDirty) setSaveAsName(defaultName);
  }, [defaultName, nameDirty]);

  // Position — start anchored below-right of the top toolbar, with a
  // margin so the panel doesn't butt against the viewport edge.
  const PANEL_WIDTH = 260;
  const MARGIN = 20;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN),
    y: 120,
  }));
  const dragRef = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const doSaveAsNew = () => {
    const name = saveAsName.trim();
    if (!name || !hasShapesInDraft) return;
    saveDraftAs(name, viewMode);
    setNameDirty(false);
  };
  const doSaveOverwrite = () => {
    if (!editingFromSet || !hasShapesInDraft) return;
    saveDraftOverwriting();
  };
  const doCancel = () => {
    discardDraft();
    setNameDirty(false);
  };
  const doNewAnnotation = () => {
    startNewDraft();
    setNameDirty(false);
  };
  const doEditCurrent = () => {
    if (!currentSetToEdit) return;
    loadSetIntoDraft(currentSetToEdit.id);
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed rounded-xl shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
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

      {/* Status line: view mode + (when editing) which set we're on. */}
      <div data-no-drag className="px-2 py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {viewModeLabel(viewMode)}
        </div>
        {editingFromSet && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Editing: <span style={{ color: 'var(--text-primary)' }}>{editingFromSet.name}</span>
          </div>
        )}
      </div>

      {/* Tools grid. Dimmed & non-interactive when there's no draft to
          write into — matches the "click New annotation first" flow. */}
      <div
        data-no-drag
        className="grid grid-cols-4 gap-1 p-2 border-b"
        style={{
          borderColor: 'var(--border)',
          opacity: isEditing ? 1 : 0.4,
          pointerEvents: isEditing ? 'auto' : 'none',
        }}
        title={isEditing ? undefined : 'Click "New annotation" (or "Edit") to start drawing'}
      >
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
      <div
        data-no-drag
        className="p-2 border-b"
        style={{
          borderColor: 'var(--border)',
          opacity: isEditing ? 1 : 0.4,
          pointerEvents: isEditing ? 'auto' : 'none',
        }}
      >
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
      <div
        data-no-drag
        className="p-2 border-b"
        style={{
          borderColor: 'var(--border)',
          opacity: isEditing ? 1 : 0.4,
          pointerEvents: isEditing ? 'auto' : 'none',
        }}
      >
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

      {isEditing && tool === 'text' && (
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

      {/* Bottom: state-dependent actions. */}
      <div data-no-drag className="p-2 space-y-1.5">
        {!isEditing && (
          <>
            {currentSetToEdit && (
              <button
                onClick={doEditCurrent}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
                title={`Edit "${currentSetToEdit.name}" — draw more strokes then Save`}
              >
                <Edit3 size={13} />
                Edit &ldquo;{currentSetToEdit.name}&rdquo;
              </button>
            )}
            <button
              onClick={doNewAnnotation}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
              }}
              title="Start a new blank annotation"
            >
              <Plus size={13} />
              New annotation
            </button>
          </>
        )}

        {isEditing && !editingFromSet && (
          <>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Save as</div>
            <input
              value={saveAsName}
              onChange={(e) => { setSaveAsName(e.target.value); setNameDirty(true); }}
              placeholder="Name…"
              className="w-full text-xs px-1.5 py-1 rounded"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doSaveAsNew(); }}
            />
            <button
              onClick={doSaveAsNew}
              disabled={!hasShapesInDraft || !saveAsName.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium"
              style={{
                background: (hasShapesInDraft && saveAsName.trim()) ? 'var(--accent)' : 'var(--surface)',
                color: (hasShapesInDraft && saveAsName.trim()) ? 'white' : 'var(--text-muted)',
                border: '1px solid var(--border)',
                cursor: (hasShapesInDraft && saveAsName.trim()) ? 'pointer' : 'not-allowed',
                opacity: (hasShapesInDraft && saveAsName.trim()) ? 1 : 0.6,
              }}
              title={
                !hasShapesInDraft
                  ? 'Draw something first'
                  : !saveAsName.trim()
                    ? 'Give it a name'
                    : 'Save as a new annotation set'
              }
            >
              <Save size={13} />
              Save
            </button>
          </>
        )}

        {isEditing && editingFromSet && (
          <>
            <button
              onClick={doSaveOverwrite}
              disabled={!hasShapesInDraft}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium"
              style={{
                background: hasShapesInDraft ? 'var(--accent)' : 'var(--surface)',
                color: hasShapesInDraft ? 'white' : 'var(--text-muted)',
                border: '1px solid var(--border)',
                cursor: hasShapesInDraft ? 'pointer' : 'not-allowed',
              }}
              title={`Overwrite “${editingFromSet.name}” with the current drawing`}
            >
              <Save size={13} />
              Save
            </button>
            <div className="flex gap-1">
              <input
                value={saveAsName}
                onChange={(e) => { setSaveAsName(e.target.value); setNameDirty(true); }}
                placeholder="Save as new name…"
                className="flex-1 text-xs px-1.5 py-1 rounded"
                style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') doSaveAsNew(); }}
              />
              <button
                onClick={doSaveAsNew}
                disabled={!hasShapesInDraft || !saveAsName.trim()}
                className="px-2 py-1 rounded text-xs font-medium"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  cursor: (hasShapesInDraft && saveAsName.trim()) ? 'pointer' : 'not-allowed',
                  opacity: (hasShapesInDraft && saveAsName.trim()) ? 1 : 0.5,
                }}
                title="Save as a new set instead of overwriting"
              >
                Save as…
              </button>
            </div>
          </>
        )}

        {isEditing && (
          <>
            <button
              onClick={() => replaceShapes([])}
              disabled={!hasShapesInDraft}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: 'var(--surface)',
                color: 'var(--danger)',
                border: '1px solid var(--border)',
                opacity: hasShapesInDraft ? 1 : 0.4,
                cursor: hasShapesInDraft ? 'pointer' : 'not-allowed',
              }}
              title="Erase everything in the current drawing"
            >
              <Trash2 size={13} />
              Clear
            </button>
            <button
              onClick={doCancel}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs"
              style={{
                background: 'var(--surface)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              title="Discard the current drawing"
            >
              <X size={13} />
              Cancel
            </button>
          </>
        )}

        <div className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
          Ctrl+Z undo · Ctrl+Shift+Z redo
        </div>
      </div>
    </div>,
    document.body,
  );
}
