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
 *
 * v3 shape: multiple NAMED annotation SETS per song, each tagged
 * with the view mode it applies to. Loaders migrate v1 and v2 rows
 * into a single unnamed draft set (see `parseSongAnnotations`).
 */
/** The three top-toolbar toggle-button states captured at annotation
 *  save time. A set is visible only when the CURRENT toggle state
 *  matches the saved state on all three flags simultaneously.
 *
 *  Each flag is independent — turning ANY of them on or off changes
 *  which sets are visible. `lyricsOnly=true, chordBar=false,
 *  inlineDiagrams=true` picks a different set of annotations than
 *  `lyricsOnly=true, chordBar=false, inlineDiagrams=false`, even
 *  though "lyrics-only" is on in both. */
export interface AnnotationViewMode {
  lyricsOnly: boolean;
  chordBar: boolean;
  inlineDiagrams: boolean;
}

/** True when two view modes are the same on all three flags. Used
 *  as the render-time and picker-time match rule. */
export function viewModeEquals(a: AnnotationViewMode, b: AnnotationViewMode): boolean {
  return (
    a.lyricsOnly === b.lyricsOnly &&
    a.chordBar === b.chordBar &&
    a.inlineDiagrams === b.inlineDiagrams
  );
}

/** Snapshot the three toggle states as an AnnotationViewMode. */
export function annotationModeFromToggles(opts: {
  lyricsOnly: boolean;
  chordBarVisible: boolean;
  inlineDiagrams: boolean;
}): AnnotationViewMode {
  return {
    lyricsOnly: opts.lyricsOnly,
    chordBar: opts.chordBarVisible,
    inlineDiagrams: opts.inlineDiagrams,
  };
}

/** Human-readable label for a view mode — used by the UI (picker
 *  header + save-as confirmation). Describes exactly which toggles
 *  are on, so the user can tell why one set is shown vs another. */
export function viewModeLabel(vm: AnnotationViewMode): string {
  const parts: string[] = [];
  if (vm.lyricsOnly) parts.push('Lyrics only');
  if (vm.chordBar) parts.push('Chord bar');
  if (vm.inlineDiagrams) parts.push('Inline diagrams');
  if (parts.length === 0) return 'Default view';
  return parts.join(' + ');
}

/** Base view mode — none of the three toggles on. Used as the
 *  placeholder for the draft (which shows in all modes anyway). */
export const DEFAULT_VIEW_MODE: AnnotationViewMode = {
  lyricsOnly: false,
  chordBar: false,
  inlineDiagrams: false,
};

/** One named collection of shapes tied to a view mode + style preset. */
export interface AnnotationSet {
  id: string;
  name: string;
  /** Only visible / editable when the song is being viewed in this
   *  mode. Enforced by `pickActiveSet` — the render/draw code never
   *  has to check view mode directly. */
  viewMode: AnnotationViewMode;
  /** Style preset key (`SongViewStyle.preset`) the set was drawn
   *  against. Shapes are anchored to line positions that depend on
   *  the preset's font family + font sizes, so a set drawn under
   *  "classic" doesn't look right under "midnight" (different font
   *  metrics → different line heights). Only visible when the
   *  current preset matches. Migrated to the current preset on
   *  first load for sets saved before this field existed. */
  preset: string;
  /** At most one set per (song, viewMode, preset) can be default.
   *  When true AND no explicit selection is active, this set is
   *  used for that (viewMode, preset) pair. */
  isDefault: boolean;
  shapes: Annotation[];
}

/** The whole annotation document for one song. */
export interface SongAnnotations {
  /** Bumped from 1 → 2 when the anchor model switched to per-line
   *  offsets, and from 2 → 3 when annotations became a list of named
   *  view-mode-tagged sets. Loaders migrate older versions on read. */
  version: 3;
  /** Named saved sets. Empty on a fresh song. */
  sets: AnnotationSet[];
  /** Unnamed draft the drawing surface writes into when no saved set
   *  is currently loaded for editing. `Save as…` promotes this to a
   *  named `AnnotationSet`, then clears the draft. Not tagged with a
   *  view mode — it's whatever the user is currently drawing on. */
  draft?: AnnotationSet;
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

// ─────────────────────────────────────────────────────────────────
// v1 → v2 migration types (line-anchoring refactor). Kept because
// stored rows in the DB may still be v1.
// ─────────────────────────────────────────────────────────────────

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

/** Wrap a bare list of v2 shapes in a v3 document. The user's
 *  existing annotations become an UNNAMED DRAFT — no view-mode tag,
 *  no name — so the read layer still shows them and the user can
 *  `Save as…` them into a named set at their leisure. */
function wrapShapesAsDraft(shapes: Annotation[]): SongAnnotations {
  if (shapes.length === 0) return { version: 3, sets: [] };
  const draft: AnnotationSet = {
    id: 'draft',
    name: '',
    // Placeholder view mode + preset. The draft renders in every
    // view mode / preset (see `pickActiveSet`) until the user saves
    // it, at which point it takes the currently-active toggle-button
    // state and the currently-active style preset.
    viewMode: DEFAULT_VIEW_MODE,
    preset: '',
    isDefault: false,
    shapes,
  };
  return { version: 3, sets: [], draft };
}

/** Migrate a v3 doc whose `viewMode` field is still the old string
 *  enum ('default' / 'lyrics-only' / 'chord-bar' / 'inline-diagrams')
 *  to the current object form, and fill in a missing `preset` field
 *  with an empty-string placeholder so `finalizeUntaggedPresets` can
 *  later stamp it with the current preset key at load time. */
function migrateV3Set(set: unknown): AnnotationSet {
  const s = set as AnnotationSet & { viewMode: AnnotationViewMode | string; preset?: string };
  let vm: AnnotationViewMode;
  if (typeof s.viewMode === 'string') {
    switch (s.viewMode) {
      case 'lyrics-only':     vm = { lyricsOnly: true,  chordBar: false, inlineDiagrams: false }; break;
      case 'chord-bar':       vm = { lyricsOnly: false, chordBar: true,  inlineDiagrams: false }; break;
      case 'inline-diagrams': vm = { lyricsOnly: false, chordBar: false, inlineDiagrams: true  }; break;
      // 'default', 'chords', 'chords-only' (never really used), anything unknown
      default:                vm = DEFAULT_VIEW_MODE;
    }
  } else {
    // Already the new shape; defensive shape check so a malformed
    // row doesn't crash the picker.
    const raw = s.viewMode as Partial<AnnotationViewMode> | null | undefined;
    vm = {
      lyricsOnly: !!raw?.lyricsOnly,
      chordBar: !!raw?.chordBar,
      inlineDiagrams: !!raw?.inlineDiagrams,
    };
  }
  return {
    ...s,
    viewMode: vm,
    preset: typeof s.preset === 'string' ? s.preset : '',
  };
}

/** Stamp the current preset key onto any set whose `preset` field is
 *  the empty-string placeholder (i.e. saved before the preset field
 *  existed). Called by loaders that know the current preset — the
 *  raw parser doesn't, so it leaves the placeholder in place.
 *
 *  Returns the same doc when no set needs stamping so React memos
 *  can rely on referential equality. */
export function finalizeUntaggedPresets(
  doc: SongAnnotations,
  currentPreset: string,
): SongAnnotations {
  const untagged = doc.sets.some((s) => s.preset === '');
  if (!untagged) return doc;
  return {
    ...doc,
    sets: doc.sets.map((s) => (s.preset === '' ? { ...s, preset: currentPreset } : s)),
  };
}

/** Safe parse — never throws. Returns `undefined` when the column is
 *  empty, malformed, or has a version we don't understand yet.
 *
 *  Migrates v1 → v2 (per-shape anchor rewrite) and v2 → v3 (wrap
 *  shapes into an unnamed draft). Returned doc is always v3, so the
 *  render/draw code assumes the new shape everywhere. */
export function parseSongAnnotations(raw: string | null | undefined): SongAnnotations | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (parsed.version === 3) {
      if (!Array.isArray(parsed.sets)) return undefined;
      // Migrate each set's viewMode from the earlier string enum to
      // the current triple-boolean object shape. Idempotent for docs
      // already in the new shape.
      return {
        version: 3,
        sets: parsed.sets.map(migrateV3Set),
        draft: parsed.draft ? migrateV3Set(parsed.draft) : undefined,
      };
    }
    if (parsed.version === 2) {
      if (!Array.isArray(parsed.shapes)) return undefined;
      return wrapShapesAsDraft(parsed.shapes as Annotation[]);
    }
    if (parsed.version === 1) {
      if (!Array.isArray(parsed.shapes)) return undefined;
      const migrated = (parsed.shapes as AnnotationV1[]).map(migrateShapeV1toV2);
      return wrapShapesAsDraft(migrated);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Serialise for DB write. Always emits the current version, so future
 *  migrations only need to convert older rows on read. */
export function stringifySongAnnotations(a: SongAnnotations): string {
  return JSON.stringify({ version: 3, sets: a.sets, draft: a.draft });
}

/** Pick which set to RENDER (or DRAW into) for a given view mode,
 *  honouring an optional explicit selection.
 *
 *  Selection priority:
 *    1. If the user has explicitly picked a set for this song via the
 *       set-picker UI and that set still exists and matches the view
 *       mode → return it.
 *    2. Draft, if present. Draft shows in EVERY view mode because
 *       it's untagged working memory the user hasn't yet committed.
 *    3. The default set for this view mode, if any.
 *    4. The first set matching this view mode, if any.
 *    5. undefined — nothing to render for this view mode.
 *
 *  Returned as a MUTABLE reference to the caller's document — mutation
 *  helpers (add / remove shape) operate on this exact set. */
/** Special sentinel for `explicitId` meaning "the user explicitly
 *  turned annotations off for this song". `pickActiveSet` returns
 *  undefined in this case, so the read layer renders nothing.
 *  Distinct from `null` (no explicit choice, fall back to default). */
export const ANNOTATION_OFF = 'off';

export function pickActiveSet(
  doc: SongAnnotations | undefined,
  viewMode: AnnotationViewMode,
  preset: string,
  explicitId?: string | null,
): AnnotationSet | undefined {
  if (!doc) return undefined;
  // User explicitly chose "Off" — render nothing, regardless of what
  // sets exist for this view mode. Draft included: the toggle is a
  // hard mute.
  if (explicitId === ANNOTATION_OFF) return undefined;
  // STRICT (viewMode, preset) match. Annotations are drawn against
  // a specific view configuration AND a specific style preset;
  // switching either dimension must show a DIFFERENT set (or
  // nothing) — the shapes are anchored to line positions that
  // depend on font metrics from the preset, so a set drawn under
  // one preset would look wrong under another. If you're missing
  // annotations on a fresh install, it's because they were saved
  // under a different preset than the one currently active:
  // switch back to that preset (or draw new ones here).
  const matches = (s: AnnotationSet): boolean =>
    viewModeEquals(s.viewMode, viewMode) && s.preset === preset;
  if (explicitId) {
    const picked = doc.sets.find((s) => s.id === explicitId);
    if (picked && matches(picked)) return picked;
    if (explicitId === 'draft' && doc.draft) return doc.draft;
  }
  if (doc.draft) return doc.draft;
  const defaultForMode = doc.sets.find((s) => matches(s) && s.isDefault);
  if (defaultForMode) return defaultForMode;
  return doc.sets.find(matches);
}

/** List every set for a specific view mode + preset (used by the
 *  set-picker dropdown). Draft is included and appears first when
 *  present. */
export function listSetsForViewMode(
  doc: SongAnnotations | undefined,
  viewMode: AnnotationViewMode,
  preset: string,
): AnnotationSet[] {
  if (!doc) return [];
  const inMode = doc.sets.filter(
    (s) => viewModeEquals(s.viewMode, viewMode) && s.preset === preset,
  );
  return doc.draft ? [doc.draft, ...inMode] : inMode;
}
