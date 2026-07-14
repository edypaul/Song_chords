import { create } from 'zustand';
import type { AnnotationKind } from '@song-chords/shared';

/** In-session drawing state for the annotation feature. NOT persisted —
 *  the picked tool / color / stroke width live only as long as the
 *  editing session. Only the shapes themselves are persisted (to the
 *  song's `annotations` column, via the song store).
 *
 *  Undo/redo lives HERE (not in the DB) as JSON snapshots of the
 *  annotations document. That way ⌘Z / ⌘Y is instant, and only the
 *  final state is written to disk on stroke-end. */

export const ANNOTATION_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#000000', // black
  '#ffffff', // white
] as const;

/** Tool the user is currently drawing with. `select` is a no-tool state
 *  used while dragging annotations around or clicking them to delete —
 *  reserved for future use, mounted now so the toolbar can render its
 *  affordance. */
export type AnnotationTool =
  | 'select'
  | Exclude<AnnotationKind, never>;

interface AnnotationEditState {
  /** True whenever the annotation toolbar is open. When false the layer
   *  is purely read-only — no pointer capture, no drawing. */
  editing: boolean;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  /** Text-annotation font size, kept separate from strokeWidth because
   *  they change together far less often than either changes alone. */
  fontSize: number;

  setEditing: (v: boolean) => void;
  setTool: (t: AnnotationTool) => void;
  setColor: (c: string) => void;
  setStrokeWidth: (w: number) => void;
  setFontSize: (n: number) => void;
}

export const useAnnotationEditStore = create<AnnotationEditState>((set) => ({
  editing: false,
  tool: 'pen',
  color: ANNOTATION_COLORS[0],
  strokeWidth: 3,
  fontSize: 18,

  setEditing: (editing) => set({ editing }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setFontSize: (fontSize) => set({ fontSize }),
}));
