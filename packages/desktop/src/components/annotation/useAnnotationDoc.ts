import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  listSetsForViewMode,
  parseSongAnnotations,
  pickActiveSet,
  stringifySongAnnotations,
  useSongStore,
  viewModeEquals,
} from '@song-chords/shared';
import type {
  Annotation,
  AnnotationSet,
  AnnotationViewMode,
  SongAnnotations,
} from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import { useAnnotationEditStore } from './annotation-store';

const DEBOUNCE_SAVE_MS = 250;

interface DocHistoryEntry {
  doc: SongAnnotations;
}

/**
 * Central controller for the annotations feature: owns the document,
 * the debounced save, undo/redo, and every set-level and shape-level
 * mutation.
 *
 * Consumers:
 *   • AnnotationDrawSurface — reads `activeSet.shapes` to render its
 *     interactive layer, calls `addShape` / `removeShape` /
 *     `replaceShapes` as the user draws.
 *   • AnnotationToolbar — reads `sets` / `activeSet` for the picker,
 *     calls `saveAs` / `overwriteActive` / `rename` / `remove` /
 *     `setDefault`.
 *
 * All writes go through `commitDoc`, which pushes a history snapshot
 * and schedules a debounced save. Undo / redo just pop / push through
 * that same snapshot stack.
 */
export function useAnnotationDoc(songId: string, annotationsJson: string | undefined, viewMode: AnnotationViewMode) {
  const saveAnnotations = useSongStore((s) => s.saveAnnotations);
  const selectedSetIds = useAnnotationEditStore((s) => s.selectedSetIds);
  const setSelectedSetId = useAnnotationEditStore((s) => s.setSelectedSetId);
  const setActiveDraft = useAnnotationEditStore((s) => s.setActiveDraft);
  const selectedSetId = selectedSetIds[songId] ?? null;

  // Live document. Sourced from the song's JSON on mount / when the
  // JSON changes for a reason other than our own writes.
  const initialDoc = useMemo<SongAnnotations>(
    () => parseSongAnnotations(annotationsJson) ?? { version: 3, sets: [] },
    [annotationsJson],
  );
  const [doc, setDoc] = useState<SongAnnotations>(initialDoc);
  const lastSavedJson = useRef<string | undefined>(annotationsJson);
  useEffect(() => {
    if (annotationsJson !== lastSavedJson.current) {
      setDoc(parseSongAnnotations(annotationsJson) ?? { version: 3, sets: [] });
      lastSavedJson.current = annotationsJson;
    }
  }, [annotationsJson]);

  // Broadcast whether there's an active draft so the read-only
  // AnnotationLayer knows whether to hide (draft renders live) or
  // stay visible (panel is open but user hasn't clicked New/Edit
  // yet — the picked set should keep showing).
  useEffect(() => {
    setActiveDraft(!!doc.draft);
    return () => setActiveDraft(false);
  }, [doc.draft, setActiveDraft]);

  const [history, setHistory] = useState<DocHistoryEntry[]>(() => [{ doc: initialDoc }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const pushHistory = useCallback((next: SongAnnotations) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIdx + 1);
      return [...truncated, { doc: next }];
    });
    setHistoryIdx((i) => i + 1);
  }, [historyIdx]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<SongAnnotations | null>(null);
  const scheduleSave = useCallback((next: SongAnnotations) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = next;
    saveTimer.current = setTimeout(() => {
      const empty = next.sets.length === 0 && (!next.draft || next.draft.shapes.length === 0);
      const json = empty ? null : stringifySongAnnotations(next);
      lastSavedJson.current = json ?? undefined;
      void saveAnnotations(db, songId, json);
      pendingSaveRef.current = null;
      saveTimer.current = null;
    }, DEBOUNCE_SAVE_MS);
  }, [songId, saveAnnotations]);
  useEffect(() => () => {
    // Flush any pending save on unmount. Guard on pendingSaveRef so a
    // clean unmount (nothing queued) doesn't overwrite the DB with
    // stale in-memory state.
    if (saveTimer.current && pendingSaveRef.current) {
      clearTimeout(saveTimer.current);
      const toSave = pendingSaveRef.current;
      const empty = toSave.sets.length === 0 && (!toSave.draft || toSave.draft.shapes.length === 0);
      const json = empty ? null : stringifySongAnnotations(toSave);
      lastSavedJson.current = json ?? undefined;
      void saveAnnotations(db, songId, json);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Central write path: update state, push history, schedule save. */
  const commitDoc = useCallback((next: SongAnnotations) => {
    setDoc(next);
    pushHistory(next);
    scheduleSave(next);
  }, [pushHistory, scheduleSave]);

  // ─── Set-level operations ─────────────────────────────────────

  /** Currently active set — draft OR a named set matching the current
   *  view mode, honouring the user's explicit selection. Reading and
   *  writing shapes both go through this. */
  const activeSet = useMemo(
    () => pickActiveSet(doc, viewMode, selectedSetId),
    [doc, viewMode, selectedSetId],
  );

  /** Sets visible in the picker dropdown for the CURRENT view mode.
   *  Draft appears first when present. */
  const setsForPicker = useMemo(
    () => listSetsForViewMode(doc, viewMode),
    [doc, viewMode],
  );

  /** Replace the DRAFT's shapes. All drawing goes to the draft; a
   *  Save button in the toolbar promotes it to a new named set
   *  (`saveDraftAs`) or overwrites the set the draft was loaded
   *  from (`saveDraftOverwriting`). Named sets themselves are
   *  read-only from the draw surface — modifications go through
   *  the draft so the user has an explicit Save gate before
   *  changes are persisted. */
  const replaceShapes = useCallback((shapes: Annotation[]) => {
    if (doc.draft) {
      commitDoc({ ...doc, draft: { ...doc.draft, shapes } });
      return;
    }
    const draft: AnnotationSet = {
      id: 'draft',
      name: '',
      viewMode,
      isDefault: false,
      shapes,
    };
    commitDoc({ ...doc, draft });
  }, [doc, viewMode, commitDoc]);

  /** Which saved set the current draft was loaded FROM (via
   *  `loadSetIntoDraft`). Session-only — cleared when the draft is
   *  discarded or promoted. When set, the toolbar shows a plain
   *  "Save" that overwrites this set; when null, "Save" prompts for
   *  a name and creates a new set. */
  const [draftSourceSetId, setDraftSourceSetId] = useState<string | null>(null);

  /** Start a fresh empty draft — the "New annotation" flow. Clears
   *  any prior draft so the user gets a blank canvas. Doesn't touch
   *  saved sets. */
  const startNewDraft = useCallback(() => {
    const draft: AnnotationSet = {
      id: 'draft',
      name: '',
      viewMode,
      isDefault: false,
      shapes: [],
    };
    commitDoc({ ...doc, draft });
    setDraftSourceSetId(null);
  }, [doc, viewMode, commitDoc]);

  /** Load an existing set's shapes into the draft for editing. The
   *  set itself is unchanged until the user clicks Save (which
   *  routes through `saveDraftOverwriting`). Records the source set
   *  id so Save knows what to overwrite. */
  const loadSetIntoDraft = useCallback((setId: string) => {
    const src = doc.sets.find((s) => s.id === setId);
    if (!src) return;
    const draft: AnnotationSet = {
      id: 'draft',
      name: src.name,
      viewMode,
      isDefault: false,
      shapes: [...src.shapes],
    };
    commitDoc({ ...doc, draft });
    setDraftSourceSetId(setId);
  }, [doc, viewMode, commitDoc]);

  /** Discard the draft without saving. If the toolbar is showing an
   *  editing session, this is the Cancel action. */
  const discardDraft = useCallback(() => {
    if (!doc.draft) return;
    commitDoc({ ...doc, draft: undefined });
    setDraftSourceSetId(null);
  }, [doc, commitDoc]);

  /** Overwrite an existing named set with the current draft's shapes.
   *  Used when the draft was loaded from a set via `loadSetIntoDraft`
   *  and the user hits Save (not Save-as). */
  const saveDraftOverwriting = useCallback(() => {
    const draft = doc.draft;
    if (!draft || !draftSourceSetId) return;
    const nextSets = doc.sets.map((s) => (s.id === draftSourceSetId ? { ...s, shapes: draft.shapes } : s));
    commitDoc({ version: 3, sets: nextSets, draft: undefined });
    setDraftSourceSetId(null);
  }, [doc, draftSourceSetId, commitDoc]);

  /** Promote the current draft to a named set. Draft is cleared.
   *  Chosen view mode overrides the draft's placeholder. If it's the
   *  first set for that viewMode, it becomes default. */
  const saveDraftAs = useCallback((name: string, setViewMode: AnnotationViewMode) => {
    const draft = doc.draft;
    if (!draft || !name.trim()) return;
    const existingForMode = doc.sets.filter((s) => viewModeEquals(s.viewMode, setViewMode));
    const isDefault = existingForMode.length === 0;
    const newSet: AnnotationSet = {
      id: uuidv4(),
      name: name.trim(),
      viewMode: setViewMode,
      isDefault,
      shapes: draft.shapes,
    };
    const nextDoc: SongAnnotations = {
      version: 3,
      sets: [...doc.sets, newSet],
      draft: undefined,
    };
    commitDoc(nextDoc);
    // Auto-select the new set (only makes a difference if it matches
    // the current view mode — otherwise the layer picks by default
    // rules on view mode change).
    setSelectedSetId(songId, newSet.id);
    setDraftSourceSetId(null);
  }, [doc, commitDoc, setSelectedSetId, songId]);

  /** Overwrite the currently-active NAMED set with fresh shapes. No-op
   *  when the active target is the draft. */
  const overwriteActive = useCallback((shapes: Annotation[]) => {
    if (!activeSet || activeSet.id === 'draft') return;
    commitDoc({
      ...doc,
      sets: doc.sets.map((s) => (s.id === activeSet.id ? { ...s, shapes } : s)),
    });
  }, [activeSet, doc, commitDoc]);

  /** Rename a set by id. Ignored for the draft. */
  const rename = useCallback((setId: string, newName: string) => {
    if (setId === 'draft' || !newName.trim()) return;
    commitDoc({
      ...doc,
      sets: doc.sets.map((s) => (s.id === setId ? { ...s, name: newName.trim() } : s)),
    });
  }, [doc, commitDoc]);

  /** Delete a set by id. If it was the default for its view mode,
   *  the first remaining set (if any) becomes default. */
  const remove = useCallback((setId: string) => {
    if (setId === 'draft') {
      commitDoc({ ...doc, draft: undefined });
      if (selectedSetId === 'draft') setSelectedSetId(songId, null);
      return;
    }
    const target = doc.sets.find((s) => s.id === setId);
    if (!target) return;
    const remaining = doc.sets.filter((s) => s.id !== setId);
    if (target.isDefault) {
      const nextDefaultIdx = remaining.findIndex((s) => viewModeEquals(s.viewMode, target.viewMode));
      if (nextDefaultIdx >= 0) {
        remaining[nextDefaultIdx] = { ...remaining[nextDefaultIdx], isDefault: true };
      }
    }
    commitDoc({ ...doc, sets: remaining });
    if (selectedSetId === setId) setSelectedSetId(songId, null);
  }, [doc, selectedSetId, songId, commitDoc, setSelectedSetId]);

  /** Mark `setId` as the default for its view mode; unset any other
   *  default in that mode. */
  const setDefault = useCallback((setId: string) => {
    const target = doc.sets.find((s) => s.id === setId);
    if (!target) return;
    commitDoc({
      ...doc,
      sets: doc.sets.map((s) =>
        viewModeEquals(s.viewMode, target.viewMode)
          ? { ...s, isDefault: s.id === setId }
          : s,
      ),
    });
  }, [doc, commitDoc]);

  /** Change the view mode a named set is tied to. Preserves default
   *  status only if there's no existing default in the new mode. */
  const changeSetViewMode = useCallback((setId: string, newViewMode: AnnotationViewMode) => {
    const target = doc.sets.find((s) => s.id === setId);
    if (!target || viewModeEquals(target.viewMode, newViewMode)) return;
    const hasDefaultInNewMode = doc.sets.some(
      (s) => s.id !== setId && viewModeEquals(s.viewMode, newViewMode) && s.isDefault,
    );
    const wasDefaultInOldMode = target.isDefault;
    let sets = doc.sets.map((s) =>
      s.id === setId
        ? { ...s, viewMode: newViewMode, isDefault: !hasDefaultInNewMode }
        : s,
    );
    if (wasDefaultInOldMode) {
      const promotedIdx = sets.findIndex((s) => s.id !== setId && viewModeEquals(s.viewMode, target.viewMode));
      if (promotedIdx >= 0) sets[promotedIdx] = { ...sets[promotedIdx], isDefault: true };
    }
    commitDoc({ ...doc, sets });
  }, [doc, commitDoc]);

  const selectSet = useCallback((setId: string | null) => {
    setSelectedSetId(songId, setId);
  }, [setSelectedSetId, songId]);

  // ─── Undo / redo ──────────────────────────────────────────────

  const undo = useCallback(() => {
    setHistoryIdx((i) => {
      const next = Math.max(i - 1, 0);
      if (next !== i) {
        const entry = history[next];
        setDoc(entry.doc);
        scheduleSave(entry.doc);
      }
      return next;
    });
  }, [history, scheduleSave]);

  const redo = useCallback(() => {
    setHistoryIdx((i) => {
      const next = Math.min(i + 1, history.length - 1);
      if (next !== i) {
        const entry = history[next];
        setDoc(entry.doc);
        scheduleSave(entry.doc);
      }
      return next;
    });
  }, [history, scheduleSave]);

  return {
    doc,
    activeSet,
    /** The draft directly — used by the drawing surface as its own
     *  editable target (it never edits named sets). */
    draft: doc.draft,
    /** Which saved set the current draft was loaded from, if any.
     *  Toolbar reads this to decide whether Save overwrites vs
     *  creates-a-new-set. */
    draftSourceSetId,
    setsForPicker,
    selectedSetId,
    selectSet,
    replaceShapes,
    startNewDraft,
    loadSetIntoDraft,
    discardDraft,
    saveDraftOverwriting,
    saveDraftAs,
    overwriteActive,
    rename,
    remove,
    setDefault,
    changeSetViewMode,
    undo,
    redo,
  };
}
