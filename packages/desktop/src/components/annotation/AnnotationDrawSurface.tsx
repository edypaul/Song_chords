import React, { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationSet,
  BoxAnnotation,
  LineAnnotation,
  StrokeAnnotation,
  TextAnnotation,
} from '@song-chords/shared';
import { renderShape, resolveAnchorBox, useLineBoxes } from './AnnotationLayer';
import type { LineBox } from './AnnotationLayer';
import { useAnnotationEditStore } from './annotation-store';

interface Props {
  scrollRef: React.RefObject<HTMLElement>;
  recomputeKey: string;
  showCommitted?: boolean;
  /** The DRAFT set — the drawing surface's editable target. Named
   *  sets are read-only from here: strokes always write to the draft.
   *  When null, the first stroke creates a fresh draft via
   *  `replaceShapes` on the parent controller. */
  editingSet: AnnotationSet | undefined;
  /** Replace the active set's shape list. Creates a draft if there's
   *  no active set yet. */
  replaceShapes: (shapes: Annotation[]) => void;
  undo: () => void;
  redo: () => void;
}

const HIGHLIGHTER_WIDTH_MULTIPLIER = 4;

/**
 * Interactive drawing overlay. Mounted only while the annotation
 * toolbar is open. On pointer-down it locks the shape to the nearest
 * DOM line (see `useLineBoxes`), then stores subsequent coords in
 * that line's local frame. All state (multiple named sets, draft,
 * undo, save) is owned by `useAnnotationDoc` — this component is a
 * pointer-to-shape translator that writes back via `replaceShapes`.
 */
export default function AnnotationDrawSurface({
  scrollRef,
  recomputeKey,
  showCommitted = true,
  editingSet,
  replaceShapes,
  undo,
  redo,
}: Props): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement>(null);
  const { boxes, layerSize, currentZoom, measured } = useLineBoxes(scrollRef, svgRef, recomputeKey);
  const tool = useAnnotationEditStore((s) => s.tool);
  const color = useAnnotationEditStore((s) => s.color);
  const strokeWidth = useAnnotationEditStore((s) => s.strokeWidth);
  const fontSize = useAnnotationEditStore((s) => s.fontSize);

  const shapes: Annotation[] = editingSet?.shapes ?? [];

  const [draft, setDraft] = useState<Annotation | null>(null);
  /** Anchor line the current stroke is locked to. */
  const draftBox = useRef<LineBox | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [pendingText, setPendingText] = useState<null | {
    anchor: AnnotationAnchor;
    x: number;
    y: number;
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

  /** Convert viewport (client) coords into SVG user-space using the
   *  browser's own transform matrix. This sidesteps every bcr / CSS
   *  zoom / scale-factor discrepancy: `getScreenCTM()` gives the
   *  live user→screen matrix, inverting it produces screen→user in
   *  one shot. Works identically at any browser zoom + CSS zoom
   *  combination. */
  const svgUserFromClient = useCallback((clientX: number, clientY: number): { ux: number; uy: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const u = pt.matrixTransform(inv);
    return { ux: u.x, uy: u.y };
  }, []);

  const resolvePointer = useCallback((e: React.PointerEvent) => {
    // Get shape user coord directly from the SVG's own CTM. This
    // is the ground-truth transform the browser will use to paint
    // the shape — so if we store the shape at this exact user coord,
    // it will paint under the cursor at any zoom / DPR / CSS-zoom
    // combination.
    const u = svgUserFromClient(e.clientX, e.clientY);
    if (!u) return null;
    // The rendered `<g transform="translate(-leftOffset, 0)">`
    // wraps the shape group; undo it so the shape's stored coord
    // becomes what the wrapping <g translate(box.x, box.y)> expects.
    const contentX = u.ux + layerSize.leftOffset;
    const contentY = u.uy;
    const box = findAnchorLine(contentX, contentY);
    if (!box) return null;
    const localX = contentX - box.x;
    const localY = contentY - box.y;
    return { box, contentX, contentY, localX, localY };
  }, [svgUserFromClient, findAnchorLine, layerSize.leftOffset]);

  const commit = useCallback((next: Annotation) => {
    replaceShapes([...shapes, next]);
    setDraft(null);
    draftBox.current = null;
    dragStart.current = null;
  }, [shapes, replaceShapes]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tool === 'select') {
      const p = resolvePointer(e);
      if (!p) return;
      const hit = hitTest(shapes, boxes, p.contentX, p.contentY);
      if (hit) {
        replaceShapes(shapes.filter((s) => s.id !== hit.id));
      }
      return;
    }
    if (tool === 'text') {
      const p = resolvePointer(e);
      if (!p) return;
      setPendingText({
        anchor: { sectionIndex: p.box.sectionIndex, lineIndex: p.box.lineIndex },
        x: p.localX,
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
    const u = svgUserFromClient(e.clientX, e.clientY);
    if (!u) return;
    const contentX = u.ux + layerSize.leftOffset;
    const contentY = u.uy;
    const box = draftBox.current;
    const localX = contentX - box.x;
    const localY = contentY - box.y;
    if (draft.kind === 'pen' || draft.kind === 'highlighter') {
      setDraft({ ...draft, points: [...draft.points, [localX, localY]] });
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
    replaceShapes([...shapes, shape]);
    setPendingText(null);
    setTextValue('');
  }, [pendingText, textValue, color, strokeWidth, fontSize, shapes, replaceShapes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape' && pendingText) {
        e.preventDefault();
        setPendingText(null);
        setTextValue('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, pendingText]);

  const container = scrollRef.current;
  const effectiveW = layerSize.w || container?.clientWidth || 0;
  const effectiveH = layerSize.h || container?.clientHeight || 0;

  return (
    <>
      <svg
        ref={svgRef}
        data-annot-svg="true"
        width={effectiveW}
        height={effectiveH}
        style={{
          position: 'absolute',
          left: layerSize.leftOffset,
          top: 0,
          width: effectiveW,
          height: effectiveH,
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
