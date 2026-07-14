/**
 * Freehand + shape annotations drawn on top of a rendered song.
 *
 * Persisted as JSON in `songs.annotations`. Anchoring rule: every
 * shape is stored relative to a specific RENDERED LINE inside a
 * section (heading, chord line, lyric line, blank spacer, comment,
 * or a virtual "whole song" line when the song has no sections).
 *
 * A shape's coordinates live in the anchor line's OWN local frame:
 *   • `offsetX` — px offset from the line's left edge
 *   • `offsetY` — px offset from the line's top edge
 * Both are stored in whatever coord space the browser reports for
 * bcr inside the CSS-zoomed subtree (typically LAYOUT px). We never
 * compare stored offsets against a bcr measured at a different zoom
 * level: draw and render always look up the anchor line's bcr fresh
 * and use it directly, so zoom drift is impossible by construction.
 *
 * Margin drawing works naturally: the pointer picks the NEAREST line
 * and stores the horizontal / vertical offset — the offset can be
 * negative (left margin) or greater than line.width (right margin) or
 * outside line.height (above/below), and the render path places the
 * shape at exactly the stored offset with no clamping.
 */
export interface SongAnnotations {
  /** Bumped from 1 → 2 when the anchor model switched from
   *  section-normalised coords to per-line offsets. Loaders MUST
   *  migrate v1 rows to v2 on read (see `parseSongAnnotations`). */
  version: 2;
  shapes: Annotation[];
}

export type AnnotationKind =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text';

/** Anchor a shape to a specific rendered line inside a section.
 *
 *  `sectionIndex` is the 0-based position of the section heading in
 *  the parsed song (INTRO=0, VERSE=1, …), or -1 for a song with no
 *  sections (single virtual whole-song frame).
 *
 *  `lineIndex` is the 0-based position of the target line WITHIN the
 *  section (heading = 0, first line after heading = 1, …). Lines
 *  that are marked `data-annot-line` in the DOM are the anchor
 *  candidates.
 *
 *  `sectionLabel` is kept as a fallback so an edit that inserts a new
 *  section can be detected on load (label match wins). */
export interface AnnotationAnchor {
  sectionIndex: number;
  lineIndex: number;
  sectionLabel?: string;
}

interface AnnotationBase {
  id: string;
  kind: AnnotationKind;
  color: string;
  /** Stroke width in the ANCHOR-LINE frame (layout px). Visual weight
   *  scales naturally with zoom because the render path scales the
   *  whole SVG in the CSS-zoomed subtree. */
  strokeWidth: number;
  anchor: AnnotationAnchor;
}

/** Freehand / highlighter stroke. `points` are `[offsetX, offsetY]`
 *  pairs in the anchor line's local frame. Zoom-drift-proof by
 *  construction. */
export interface StrokeAnnotation extends AnnotationBase {
  kind: 'pen' | 'highlighter';
  points: Array<[number, number]>;
}

/** Straight line and arrow. Endpoint coords are in the anchor line's
 *  local frame. `arrow` is `line` + arrowhead at (x2, y2). */
export interface LineAnnotation extends AnnotationBase {
  kind: 'line' | 'arrow';
  x1: number; y1: number;
  x2: number; y2: number;
}

/** Rectangle / ellipse outline. `(x, y)` is the top-left corner in
 *  the anchor line's local frame; `(w, h)` are extents in the same
 *  frame. */
export interface BoxAnnotation extends AnnotationBase {
  kind: 'rect' | 'ellipse';
  x: number; y: number;
  w: number; h: number;
}

/** Free-floating text label. `(x, y)` is the top-left corner of the
 *  first line in the anchor line's local frame. */
export interface TextAnnotation extends AnnotationBase {
  kind: 'text';
  x: number; y: number;
  content: string;
  fontSize: number;
}

export type Annotation =
  | StrokeAnnotation
  | LineAnnotation
  | BoxAnnotation
  | TextAnnotation;

/** v1 anchor — the pre-refactor model. Kept as a type alias so the
 *  migration path is clearly documented. `refWidth` was an earlier
 *  attempt at zoom-drift correction; it can be safely ignored during
 *  migration because we're switching to a DOM-anchored model. */
interface AnnotationAnchorV1 {
  sectionIndex: number;
  sectionLabel?: string;
  refWidth?: number;
}
interface AnnotationV1Base {
  id: string;
  kind: AnnotationKind;
  color: string;
  strokeWidth: number;
  anchor: AnnotationAnchorV1;
}
interface StrokeV1 extends AnnotationV1Base { kind: 'pen' | 'highlighter'; points: Array<[number, number]>; }
interface LineV1 extends AnnotationV1Base { kind: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; }
interface BoxV1 extends AnnotationV1Base { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number; }
interface TextV1 extends AnnotationV1Base { kind: 'text'; x: number; y: number; content: string; fontSize: number; }
type AnnotationV1 = StrokeV1 | LineV1 | BoxV1 | TextV1;

/** Best-effort migration from v1 (section-normalised) to v2 (line-
 *  anchored). We can't perfectly place shapes without knowing which
 *  line each stored y coordinate landed on originally — the DOM
 *  isn't available during a pure data migration. So we do the
 *  simplest safe thing: anchor every v1 shape to `lineIndex: 0`
 *  (the section heading) and preserve the shape's own offsets
 *  as-is. The result is APPROXIMATE placement: shapes land in the
 *  right section, near their original y, and any x that was stored
 *  as a normalised fraction becomes an absolute offset (we multiply
 *  by an ASSUMED section width of 600px — the render path never
 *  reads this, but the shape geometry is preserved for the user
 *  to nudge if needed).
 *
 *  This is not perfect. It's a "your old marks won't be lost, but
 *  they might be a few pixels off after the migration" pact.
 *  Existing shapes drawn before this refactor were already drifting
 *  at zoom, so a small one-time re-position is acceptable. */
const V1_ASSUMED_SECTION_WIDTH = 600;

function migrateShapeV1toV2(shape: AnnotationV1): Annotation {
  const baseAnchor: AnnotationAnchor = {
    sectionIndex: shape.anchor.sectionIndex,
    lineIndex: 0,
    sectionLabel: shape.anchor.sectionLabel,
  };
  const W = V1_ASSUMED_SECTION_WIDTH;
  if (shape.kind === 'pen' || shape.kind === 'highlighter') {
    return {
      id: shape.id,
      kind: shape.kind,
      color: shape.color,
      strokeWidth: shape.strokeWidth,
      anchor: baseAnchor,
      points: shape.points.map(([nx, y]): [number, number] => [nx * W, y]),
    };
  }
  if (shape.kind === 'line' || shape.kind === 'arrow') {
    return {
      id: shape.id,
      kind: shape.kind,
      color: shape.color,
      strokeWidth: shape.strokeWidth,
      anchor: baseAnchor,
      x1: shape.x1 * W, y1: shape.y1,
      x2: shape.x2 * W, y2: shape.y2,
    };
  }
  if (shape.kind === 'rect' || shape.kind === 'ellipse') {
    return {
      id: shape.id,
      kind: shape.kind,
      color: shape.color,
      strokeWidth: shape.strokeWidth,
      anchor: baseAnchor,
      x: shape.x * W, y: shape.y,
      w: shape.w * W, h: shape.h,
    };
  }
  // text — TS narrowing gets confused across the union, so assert.
  const t = shape as TextV1;
  return {
    id: t.id,
    kind: 'text',
    color: t.color,
    strokeWidth: t.strokeWidth,
    anchor: baseAnchor,
    x: t.x * W, y: t.y,
    content: t.content,
    fontSize: t.fontSize,
  };
}

/** Safe parse — never throws. Returns `undefined` when the column is
 *  empty, malformed, or has a version we don't understand yet.
 *
 *  Handles legacy v1 documents by migrating each shape to v2 on the
 *  fly. The returned document is always v2, so the render path can
 *  assume the new shape everywhere. */
export function parseSongAnnotations(raw: string | null | undefined): SongAnnotations | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (!Array.isArray(parsed.shapes)) return undefined;
    if (parsed.version === 2) return parsed as SongAnnotations;
    if (parsed.version === 1) {
      const migrated = (parsed.shapes as AnnotationV1[]).map(migrateShapeV1toV2);
      return { version: 2, shapes: migrated };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Serialise for DB write. Always emits the current version, so future
 *  migrations only need to convert older rows on read. */
export function stringifySongAnnotations(a: SongAnnotations): string {
  return JSON.stringify({ version: 2, shapes: a.shapes });
}
