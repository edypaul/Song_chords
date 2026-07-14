import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  parseSongAnnotations,
  stringifySongAnnotations,
  useSongStore,
} from '@song-chords/shared';
import type {
  Annotation,
  AnnotationAnchor,
  BoxAnnotation,
  LineAnnotation,
  SongAnnotations,
  StrokeAnnotation,
  TextAnnotation,
} from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import { renderShape, resolveAnchorBox, useLineBoxes } from './AnnotationLayer';
import type { LineBox } from './AnnotationLayer';
import { useAnnotationEditStore } from './annotation-store';

interface Props {
  songId: string;
  annotationsJson: string | undefined;
  scrollRef: React.RefObject<HTMLElement>;
  recomputeKey: string;
  showCommitted?: boolean;
}

interface HistoryEntry {
  shapes: Annotation[];
}

const HIGHLIGHTER_WIDTH_MULTIPLIER = 4;
const DEBOUNCE_SAVE_MS = 250;

/**
 * Interactive drawing overlay. Mounted only while the annotation
 * toolbar is open. On pointer-down it looks up which rendered line the
 * pointer is over (or nearest — for margin drawing), locks the shape
 * to that line's anchor, and stores subsequent coords in that line's
 * local frame. Render and draw share `useLineBoxes` so they see the
 * exact same box positions at the same instant — no zoom drift.
 */
export default function AnnotationDrawSurface({
  songId,
  annotationsJson,
  scrollRef,
  recomputeKey,
  showCommitted = true,
}: Props): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement>(null);
  const { boxes, layerSize, currentZoom, measured } = useLineBoxes(scrollRef, svgRef, recomputeKey);
  const tool = useAnnotationEditStore((s) => s.tool);
  const color = useAnnotationEditStore((s) => s.color);
  const strokeWidth = useAnnotationEditStore((s) => s.strokeWidth);
  const fontSize = useAnnotationEditStore((s) => s.fontSize);
  const saveAnnotations = useSongStore((s) => s.saveAnnotations);

  const initialShapes = useMemo(
    () => parseSongAnnotations(annotationsJson)?.shapes ?? [],
    [annotationsJson],
  );
  const [shapes, setShapes] = useState<Annotation[]>(initialShapes);
  const lastSavedJson = useRef<string | undefined>(annotationsJson);
  useEffect(() => {
    if (annotationsJson !== lastSavedJson.current) {
      setShapes(parseSongAnnotations(annotationsJson)?.shapes ?? []);
      lastSavedJson.current = annotationsJson;
    }
  }, [annotationsJson]);

  const [history, setHistory] = useState<HistoryEntry[]>(() => [{ shapes: initialShapes }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const pushHistory = useCallback((next: Annotation[]) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIdx + 1);
      return [...truncated, { shapes: next }];
    });
    setHistoryIdx((i) => i + 1);
  }, [historyIdx]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Annotation[] | null>(null);
  const scheduleSave = useCallback((next: Annotation[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = next;
    saveTimer.current = setTimeout(() => {
      const doc: SongAnnotations = { version: 2, shapes: next };
      const json = next.length === 0 ? null : stringifySongAnnotations(doc);
      lastSavedJson.current = json ?? undefined;
      void saveAnnotations(db, songId, json);
      pendingSaveRef.current = null;
      saveTimer.current = null;
    }, DEBOUNCE_SAVE_MS);
  }, [songId, saveAnnotations]);
  useEffect(() => () => {
    if (saveTimer.current && pendingSaveRef.current) {
      clearTimeout(saveTimer.current);
      const shapesToSave = pendingSaveRef.current;
      const doc: SongAnnotations = { version: 2, shapes: shapesToSave };
      const json = shapesToSave.length === 0 ? null : stringifySongAnnotations(doc);
      lastSavedJson.current = json ?? undefined;
      void saveAnnotations(db, songId, json);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState<Annotation | null>(null);
  /** The anchor line the current stroke is locked to. Stays fixed for
   *  the whole stroke so the shape doesn't jump lines mid-drag. */
  const draftBox = useRef<LineBox | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [pendingText, setPendingText] = useState<null | {
    anchor: AnnotationAnchor;
    /** Local-frame offsetX in the anchor line. */
    x: number;
    /** Local-frame offsetY in the anchor line. */
    y: number;
    /** Screen pixel position for the floating input. */
    screenX: number;
    screenY: number;
  }>(null);
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!pendingText) return;
    const t = requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
    return () => cancelAnimationFrame(t);
  }, [pendingText]);

  /** Pick the anchor line for a pointer position.
   *
   *  Preference order:
   *   1. If a line CONTAINS the pointer (x within box.x..box.x+width
   *      and y within box.y..box.y+height), use it.
   *   2. Otherwise, pick the line with the smallest euclidean distance
   *      to the pointer (nearest edge). This is what enables margin
   *      drawing: the pointer is outside every line's box, but we pick
   *      the closest one and store the offset as negative-x /
   *      greater-than-width — the render path preserves that offset
   *      verbatim.
   *
   *  Falls back to a virtual whole-container box if no lines exist
   *  (song has literally zero rendered lines yet — should be very
   *  rare after mount). */
  const findAnchorLine = useCallback((contentX: number, contentY: number): LineBox | null => {
    if (boxes.size === 0) {
      const container = scrollRef.current;
      if (!container) return null;
      return {
        sectionIndex: -1,
        lineIndex: 0,
        x: 0,
        y: 0,
        width: Math.max(container.clientWidth, container.scrollWidth),
        height: Math.max(container.clientHeight, container.scrollHeight),
      };
    }
    let contained: LineBox | null = null;
    let nearest: LineBox | null = null;
    let nearestDist = Infinity;
    for (const b of boxes.values()) {
      const inX = contentX >= b.x && contentX <= b.x + b.width;
      const inY = contentY >= b.y && contentY <= b.y + b.height;
      if (inX && inY) {
        contained = b;
        break;
      }
      // Distance from pointer to the box's nearest edge.
      const dx = contentX < b.x ? b.x - contentX : contentX > b.x + b.width ? contentX - (b.x + b.width) : 0;
      const dy = contentY < b.y ? b.y - contentY : contentY > b.y + b.height ? contentY - (b.y + b.height) : 0;
      const d = Math.hypot(dx, dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = b;
      }
    }
    return contained ?? nearest;
  }, [boxes, scrollRef]);

  /** Convert a pointer event into `(contentX, contentY, anchorBox,
   *  localX, localY)`. Coords are all in the WRAPPER's frame.
   *
   *  Key insight vs. the previous implementation: we no longer divide
   *  by CSS zoom. The wrapper's bcr and the line bcrs are all measured
   *  inside the same CSS-zoomed subtree, so both come back in the same
   *  frame (in practice: layout px). Subtraction is frame-consistent.
   *  The pointer clientX/Y is in visual px, so we DO need to convert
   *  it — but the wrapper's bcr top-left is the visual point where
   *  the layout origin sits, so `(clientX - wrapper.left) / zoom` is
   *  the correct conversion to a layout-frame delta. */
  const resolvePointer = useCallback((e: React.PointerEvent) => {
    const container = scrollRef.current;
    if (!container) return null;
    const wrapper = container.firstElementChild as HTMLElement | null;
    if (!wrapper) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const zoom = currentZoom > 0 ? currentZoom : 1;
    const contentX = (e.clientX - wrapperRect.left) / zoom;
    const contentY = (e.clientY - wrapperRect.top) / zoom;
    const box = findAnchorLine(contentX, contentY);
    if (!box) return null;
    const localX = contentX - box.x;
    const localY = contentY - box.y;
    return { box, contentX, contentY, localX, localY };
  }, [scrollRef, findAnchorLine, currentZoom]);

  const commit = useCallback((next: Annotation) => {
    setShapes((prev) => {
      const merged = [...prev, next];
      pushHistory(merged);
      scheduleSave(merged);
      return merged;
    });
    setDraft(null);
    draftBox.current = null;
    dragStart.current = null;
  }, [pushHistory, scheduleSave]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tool === 'select') {
      const p = resolvePointer(e);
      if (!p) return;
      const hit = hitTest(shapes, boxes, p.contentX, p.contentY);
      if (hit) {
        const next = shapes.filter((s) => s.id !== hit.id);
        setShapes(next);
        pushHistory(next);
        scheduleSave(next);
      }
      return;
    }
    if (tool === 'text') {
      const p = resolvePointer(e);
      if (!p) return;
      setPendingText({
        anchor: { sectionIndex: p.box.sectionIndex, lineIndex: p.box.lineIndex },
        x: p.localX,
        // Vertically centre the eventual text on the click point (matches
        // the floating input's own vertical centering).
        y: p.localY - fontSize / 2,
        screenX: e.clientX,
        screenY: e.clientY,
      });
      setTextValue('');
      return;
    }
    const p = resolvePointer(e);
    if (!p) return;
    draftBox.current = p.box;
    dragStart.current = { x: p.localX, y: p.localY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const baseAnchor: AnnotationAnchor = {
      sectionIndex: p.box.sectionIndex,
      lineIndex: p.box.lineIndex,
    };
    const effectiveWidth = tool === 'highlighter' ? strokeWidth * HIGHLIGHTER_WIDTH_MULTIPLIER : strokeWidth;
    if (tool === 'pen' || tool === 'highlighter') {
      const s: StrokeAnnotation = {
        id: uuidv4(),
        kind: tool,
        color,
        strokeWidth: effectiveWidth,
        anchor: baseAnchor,
        points: [[p.localX, p.localY]],
      };
      setDraft(s);
    } else if (tool === 'line' || tool === 'arrow') {
      const s: LineAnnotation = {
        id: uuidv4(),
        kind: tool,
        color,
        strokeWidth,
        anchor: baseAnchor,
        x1: p.localX, y1: p.localY,
        x2: p.localX, y2: p.localY,
      };
      setDraft(s);
    } else if (tool === 'rect' || tool === 'ellipse') {
      const s: BoxAnnotation = {
        id: uuidv4(),
        kind: tool,
        color,
        strokeWidth,
        anchor: baseAnchor,
        x: p.localX, y: p.localY,
        w: 0, h: 0,
      };
      setDraft(s);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draft || !draftBox.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const wrapper = container.firstElementChild as HTMLElement | null;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const zoom = currentZoom > 0 ? currentZoom : 1;
    const contentX = (e.clientX - wrapperRect.left) / zoom;
    const contentY = (e.clientY - wrapperRect.top) / zoom;
    // Keep the shape locked to its ORIGINAL anchor line — subsequent
    // points are stored as offsets from that line's box, even if the
    // pointer drifted into another line's box. Matches the "this arrow
    // lives on line X" mental model, and prevents mid-drag anchor
    // jumps.
    const box = draftBox.current;
    const localX = contentX - box.x;
    const localY = contentY - box.y;
    if (draft.kind === 'pen' || draft.kind === 'highlighter') {
      setDraft({
        ...draft,
        points: [...draft.points, [localX, localY]],
      });
    } else if (draft.kind === 'line' || draft.kind === 'arrow') {
      setDraft({ ...draft, x2: localX, y2: localY });
    } else if (draft.kind === 'rect' || draft.kind === 'ellipse') {
      const start = dragStart.current;
      if (!start) return;
      setDraft({
        ...draft,
        x: start.x, y: start.y,
        w: localX - start.x,
        h: localY - start.y,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Filter zero-size shapes.
    if (draft.kind === 'line' || draft.kind === 'arrow') {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 4) {
        setDraft(null);
        draftBox.current = null;
        dragStart.current = null;
        return;
      }
    } else if (draft.kind === 'rect' || draft.kind === 'ellipse') {
      if (Math.abs(draft.w) < 4 && Math.abs(draft.h) < 4) {
        setDraft(null);
        draftBox.current = null;
        dragStart.current = null;
        return;
      }
    }
    commit(draft);
  };

  const commitPendingText = useCallback(() => {
    if (!pendingText) return;
    const trimmed = textValue.trim();
    if (!trimmed) {
      setPendingText(null);
      setTextValue('');
      return;
    }
    const shape: TextAnnotation = {
      id: uuidv4(),
      kind: 'text',
      color,
      strokeWidth,
      anchor: pendingText.anchor,
      x: pendingText.x,
      y: pendingText.y,
      content: trimmed,
      fontSize,
    };
    setShapes((prev) => {
      const merged = [...prev, shape];
      pushHistory(merged);
      scheduleSave(merged);
      return merged;
    });
    setPendingText(null);
    setTextValue('');
  }, [pendingText, textValue, color, strokeWidth, fontSize, pushHistory, scheduleSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          setHistoryIdx((i) => {
            const next = Math.min(i + 1, history.length - 1);
            if (next !== i) {
              const entry = history[next];
              setShapes(entry.shapes);
              scheduleSave(entry.shapes);
            }
            return next;
          });
        } else {
          setHistoryIdx((i) => {
            const next = Math.max(i - 1, 0);
            if (next !== i) {
              const entry = history[next];
              setShapes(entry.shapes);
              scheduleSave(entry.shapes);
            }
            return next;
          });
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setHistoryIdx((i) => {
          const next = Math.min(i + 1, history.length - 1);
          if (next !== i) {
            const entry = history[next];
            setShapes(entry.shapes);
            scheduleSave(entry.shapes);
          }
          return next;
        });
      } else if (e.key === 'Escape' && pendingText) {
        e.preventDefault();
        setPendingText(null);
        setTextValue('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, scheduleSave, pendingText]);

  const container = scrollRef.current;
  const effectiveW = layerSize.w || container?.clientWidth || 0;
  const effectiveH = layerSize.h || container?.clientHeight || 0;

  return (
    <>
      <svg
        ref={svgRef}
        width={effectiveW}
        height={effectiveH}
        style={{
          position: 'absolute',
          left: layerSize.leftOffset,
          top: 0,
          width: effectiveW,
          height: effectiveH,
          // Overflow visible so shape overflow past the SVG box (e.g.
          // an ellipse dragged past the right edge) still paints.
          overflow: 'visible',
          pointerEvents: 'auto',
          cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
          zIndex: 40,
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Coord-frame shift — see AnnotationLayer for the full
            rationale. Shape/box coords live in the wrapper's frame;
            the SVG sits `leftOffset` layout-px left of the wrapper's
            origin, so we translate the shape group right by
            `-leftOffset` to compensate. */}
        <g transform={`translate(${-layerSize.leftOffset}, 0)`}>
          <g style={{ visibility: (measured && showCommitted) ? 'visible' : 'hidden' }}>
            {shapes.map((shape) => {
              const box = resolveAnchorBox(boxes, shape.anchor.sectionIndex, shape.anchor.lineIndex);
              if (!box) return null;
              return (
                <g key={shape.id} transform={`translate(${box.x}, ${box.y})`}>
                  {renderShape(shape)}
                </g>
              );
            })}
          </g>
          {draft && draftBox.current && (
            <g transform={`translate(${draftBox.current.x}, ${draftBox.current.y})`}>
              {renderShape(draft)}
            </g>
          )}
        </g>
      </svg>
      {pendingText && (
        <input
          ref={textInputRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => { if (textValue.trim()) commitPendingText(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitPendingText();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setPendingText(null);
              setTextValue('');
            }
          }}
          placeholder="Type…"
          style={{
            position: 'fixed',
            left: pendingText.screenX,
            top: pendingText.screenY - (fontSize * (currentZoom || 1)) / 2 - 1,
            zIndex: 41,
            background: 'transparent',
            color,
            border: '1px dashed var(--border)',
            padding: '0 4px',
            lineHeight: '1',
            fontSize: fontSize * (currentZoom || 1),
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            outline: 'none',
            minWidth: 120,
          }}
        />
      )}
    </>
  );
}

/** Cheap hit-test for the "select" tool. Coordinates are in the
 *  wrapper's frame. For each shape, translate its local-frame coords
 *  by its anchor box's (x, y) and check proximity. */
function hitTest(shapes: Annotation[], boxes: Map<string, LineBox>, contentX: number, contentY: number): Annotation | null {
  const TOLERANCE = 12;
  let best: { shape: Annotation; dist: number } | null = null;
  const consider = (shape: Annotation, dist: number) => {
    if (dist > TOLERANCE) return;
    if (!best || dist < best.dist) best = { shape, dist };
  };
  for (const shape of shapes) {
    const box = resolveAnchorBox(boxes, shape.anchor.sectionIndex, shape.anchor.lineIndex);
    if (!box) continue;
    const abs = (lx: number, ly: number) => ({ cx: box.x + lx, cy: box.y + ly });
    if (shape.kind === 'pen' || shape.kind === 'highlighter') {
      for (const [lx, ly] of shape.points) {
        const { cx, cy } = abs(lx, ly);
        consider(shape, Math.hypot(cx - contentX, cy - contentY));
      }
    } else if (shape.kind === 'line' || shape.kind === 'arrow') {
      const a = abs(shape.x1, shape.y1);
      const b = abs(shape.x2, shape.y2);
      consider(shape, distToSegment(contentX, contentY, a.cx, a.cy, b.cx, b.cy));
    } else if (shape.kind === 'rect' || shape.kind === 'ellipse') {
      const a = abs(shape.x, shape.y);
      const bx = box.x + shape.x + shape.w;
      const by = box.y + shape.y + shape.h;
      const minX = Math.min(a.cx, bx);
      const maxX = Math.max(a.cx, bx);
      const minY = Math.min(a.cy, by);
      const maxY = Math.max(a.cy, by);
      const inside = contentX >= minX && contentX <= maxX && contentY >= minY && contentY <= maxY;
      if (inside) {
        const d = Math.min(contentX - minX, maxX - contentX, contentY - minY, maxY - contentY);
        consider(shape, d);
      } else {
        const dx = contentX < minX ? minX - contentX : contentX > maxX ? contentX - maxX : 0;
        const dy = contentY < minY ? minY - contentY : contentY > maxY ? contentY - maxY : 0;
        consider(shape, Math.hypot(dx, dy));
      }
    } else if (shape.kind === 'text') {
      const a = abs(shape.x, shape.y);
      const fontSize = shape.fontSize;
      const w = shape.content.length * fontSize * 0.6;
      const inside = contentX >= a.cx && contentX <= a.cx + w
        && contentY >= a.cy && contentY <= a.cy + fontSize;
      consider(shape, inside ? 0 : Number.POSITIVE_INFINITY);
    }
  }
  return best ? (best as { shape: Annotation; dist: number }).shape : null;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
