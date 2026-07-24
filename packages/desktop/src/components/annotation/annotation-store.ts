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

  /** Per-song "active set" selection. Not persisted across app
   *  restarts — a session preference, so restarting resets to the
   *  default set for the current view mode.
   *
   *  Keyed by songId → set id (or 'draft'). `null` means "no explicit
   *  choice, use the default-for-view-mode rule".
   *
   *  Cleared explicitly when a song's set is renamed / deleted so a
   *  stale id doesn't get used after a mutation. */
  selectedSetIds: Record<string, string | null>;

  /** True when the drawing surface is actively editing a draft (New
   *  annotation or Edit-existing flow). Used by AnnotationLayer to
   *  decide whether to hide itself (draft's live rendering takes
   *  over) or stay visible (panel is open but user hasn't started
   *  editing yet — the picked set should keep showing). */
  activeDraft: boolean;

  /** One-shot instruction handed to the next-mounted
   *  `AnnotationEditingRoot`. When the merged Annotations menu
   *  launches the drawing panel with a specific action
   *  ("Edit this set", "New annotation"), it stashes the intent
   *  here; `useAnnotationDoc` consumes it on its first render and
   *  clears it. Prevents ambiguity like "user hits Edit, panel
   *  opens showing an old unrelated draft". */
  pendingDraftIntent:
    | { kind: 'new' }
    | { kind: 'edit'; setId: string }
    | null;

  /** One-shot: when true, the merged Annotations menu opens its
   *  dropdown as soon as it renders and clears the flag. Set by
   *  the drawing panel's Cancel button so the user is returned to
   *  the list they came from. */
  reopenMenuAfterClose: boolean;

  setEditing: (v: boolean) => void;
  setTool: (t: AnnotationTool) => void;
  setColor: (c: string) => void;
  setStrokeWidth: (w: number) => void;
  setFontSize: (n: number) => void;
  /** Explicit set choice for a song. Pass `null` to clear (fall back
   *  to view-mode default). */
  setSelectedSetId: (songId: string, setId: string | null) => void;
  setActiveDraft: (v: boolean) => void;
  setPendingDraftIntent: (intent: AnnotationEditState['pendingDraftIntent']) => void;
  setReopenMenuAfterClose: (v: boolean) => void;
}

export const useAnnotationEditStore = create<AnnotationEditState>((set) => ({
  editing: false,
  tool: 'pen',
  color: ANNOTATION_COLORS[0],
  strokeWidth: 3,
  fontSize: 18,
  selectedSetIds: {},
  activeDraft: false,
  pendingDraftIntent: null,
  reopenMenuAfterClose: false,

  setEditing: (editing) => set({ editing }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setFontSize: (fontSize) => set({ fontSize }),
  setSelectedSetId: (songId, setId) => set((state) => ({
    selectedSetIds: { ...state.selectedSetIds, [songId]: setId },
  })),
  setActiveDraft: (activeDraft) => set({ activeDraft }),
  setPendingDraftIntent: (pendingDraftIntent) => set({ pendingDraftIntent }),
  setReopenMenuAfterClose: (reopenMenuAfterClose) => set({ reopenMenuAfterClose }),
}));
