import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Highlighter, Check, EyeOff, Edit3, Trash2, Plus } from 'lucide-react';
import {
  ANNOTATION_OFF,
  finalizeUntaggedPresets,
  listSetsForViewMode,
  parseSongAnnotations,
  pickActiveSet,
} from '@song-chords/shared';
import type { AnnotationViewMode } from '@song-chords/shared';
import { useAnnotationEditStore } from './annotation-store';
import { useAnnotationDoc } from './useAnnotationDoc';
import { useT } from '../../i18n';

interface Props {
  songId: string;
  annotationsJson: string | undefined;
  viewMode: AnnotationViewMode;
  /** Currently-active style preset key. Together with `viewMode`
   *  decides which saved sets are listed in the dropdown. */
  preset: string;
}

/**
 * Merged annotations icon in the top toolbar.
 *
 * Behavior depends on how many annotation sets the current song has
 * for the CURRENT view configuration:
 *   • Zero sets → clicking the icon opens the drawing panel directly
 *     with a fresh empty draft (as if the user clicked "New
 *     annotation" from within the panel).
 *   • One or more → clicking the icon opens a dropdown listing the
 *     sets. Each row shows a select checkmark plus Edit / star /
 *     delete actions. A "New annotation" button at the bottom
 *     launches the drawing panel with a fresh empty draft.
 *
 * The panel-launch path always goes through `setPendingDraftIntent`
 * so `useAnnotationDoc` (inside the freshly-mounted editing root)
 * knows what to do on its first render.
 */
export default function AnnotationMenu({ songId, annotationsJson, viewMode, preset }: Props): React.ReactElement {
  const t = useT();
  const selectedSetIds = useAnnotationEditStore((s) => s.selectedSetIds);
  const setSelectedSetId = useAnnotationEditStore((s) => s.setSelectedSetId);
  const selectedSetId = selectedSetIds[songId] ?? null;
  const annotationEditing = useAnnotationEditStore((s) => s.editing);
  const setAnnotationEditing = useAnnotationEditStore((s) => s.setEditing);
  const setPendingDraftIntent = useAnnotationEditStore((s) => s.setPendingDraftIntent);
  const reopenMenuAfterClose = useAnnotationEditStore((s) => s.reopenMenuAfterClose);
  const setReopenMenuAfterClose = useAnnotationEditStore((s) => s.setReopenMenuAfterClose);

  // Own controller for set-level ops (rename / remove / set-default).
  // Shares the debounced-save path with any concurrently-mounted
  // editing root via the annotationsJson prop; both instances
  // hydrate from the same store.
  const controller = useAnnotationDoc(songId, annotationsJson, viewMode, preset);
  const { rename, remove } = controller;

  const doc = useMemo(() => {
    const raw = parseSongAnnotations(annotationsJson);
    return raw ? finalizeUntaggedPresets(raw, preset) : raw;
  }, [annotationsJson, preset]);
  const setsInMode = useMemo(() => listSetsForViewMode(doc, viewMode, preset), [doc, viewMode, preset]);
  const active = useMemo(() => pickActiveSet(doc, viewMode, preset, selectedSetId), [doc, viewMode, preset, selectedSetId]);
  const isOff = selectedSetId === ANNOTATION_OFF;
  // Draft-only rows aren't user-actionable from the top menu — the
  // drawing panel owns the draft. Filter it out so the list here
  // only shows named saved sets.
  const namedSets = useMemo(() => setsInMode.filter((s) => s.id !== 'draft'), [setsInMode]);
  const noSavedSets = namedSets.length === 0;

  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Watch for the "Cancel" hand-off from the drawing panel. When it
  // fires, reopen the dropdown so the user lands back on the list
  // they came from — but only if there are saved sets to show. If
  // no sets remain (they just cancelled a New annotation on a song
  // that had none), leave the menu closed and just clear the flag.
  useEffect(() => {
    if (!reopenMenuAfterClose || annotationEditing) return;
    if (!noSavedSets) setOpen(true);
    setReopenMenuAfterClose(false);
  }, [reopenMenuAfterClose, annotationEditing, noSavedSets, setReopenMenuAfterClose]);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const DROPDOWN_WIDTH = 260;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const preferredLeft = r.left;
      const rightEdgeIfLeftAligned = preferredLeft + DROPDOWN_WIDTH;
      const viewportW = window.innerWidth;
      const margin = 8;
      const clampedLeft = rightEdgeIfLeftAligned > viewportW - margin
        ? Math.max(margin, viewportW - margin - DROPDOWN_WIDTH)
        : preferredLeft;
      setPos({ top: r.bottom + 4, left: clampedLeft });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
      setRenamingId(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const openPanelForNew = useCallback(() => {
    setPendingDraftIntent({ kind: 'new' });
    setAnnotationEditing(true);
    setOpen(false);
  }, [setPendingDraftIntent, setAnnotationEditing]);

  const openPanelForEdit = useCallback((setId: string) => {
    setPendingDraftIntent({ kind: 'edit', setId });
    setAnnotationEditing(true);
    setOpen(false);
  }, [setPendingDraftIntent, setAnnotationEditing]);

  const onClickIcon = () => {
    if (annotationEditing) {
      // Toggle-close: matches the previous "annotate this song"
      // button's second-click-closes behavior.
      setAnnotationEditing(false);
      return;
    }
    if (noSavedSets) {
      // No sets to pick from → skip the dropdown and go straight to
      // the drawing panel with an empty new draft.
      openPanelForNew();
      return;
    }
    setOpen((v) => !v);
  };

  // Icon color follows the same convention as every other toolbar
  // icon: accent when the feature is "active" (editing panel is
  // open OR a set is currently rendering), muted secondary text
  // otherwise. The old code painted the icon red (`--danger`) when
  // annotations were toggled Off, which stuck out visually because
  // no other toolbar button uses red — and, since songs now open
  // with annotations Off by default, the red state ended up being
  // the icon's normal appearance.
  const iconColor = annotationEditing || active
    ? 'var(--accent)'
    : 'var(--text-secondary)';

  const dropdown = open && !annotationEditing && pos ? createPortal(
    <div
      ref={dropdownRef}
      className="rounded-md shadow-xl"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: DROPDOWN_WIDTH,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        zIndex: 10010,
        maxHeight: 400,
        overflowY: 'auto',
      }}
    >
      {/* Off row — hides all annotations. */}
      <button
        onClick={() => { setSelectedSetId(songId, ANNOTATION_OFF); setOpen(false); }}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs"
        style={{
          color: isOff ? 'var(--text-primary)' : 'var(--text-secondary)',
          background: isOff ? 'var(--surface)' : 'transparent',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {isOff
          ? <Check size={11} style={{ color: 'var(--danger)' }} />
          : <EyeOff size={11} style={{ color: 'var(--text-muted)' }} />}
        <span className="truncate flex-1">{t('annotationMenu.off')}</span>
      </button>

      {/* Set rows */}
      {namedSets.map((s) => {
        const isActive = !isOff && active?.id === s.id;
        const isRenaming = renamingId === s.id;
        return (
          <div
            key={s.id}
            className="flex items-center gap-1 px-2 py-1.5"
            style={{
              background: isActive ? 'var(--surface)' : 'transparent',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) rename(s.id, renameValue);
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameValue.trim()) rename(s.id, renameValue);
                    setRenamingId(null);
                  } else if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                className="flex-1 text-xs px-1 rounded"
                style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            ) : (
              <>
                <button
                  onClick={() => {
                    setSelectedSetId(songId, s.id);
                    setOpen(false);
                  }}
                  className="flex-1 flex items-center gap-1 text-left text-xs truncate"
                  style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {isActive
                    ? <Check size={11} style={{ color: 'var(--accent)' }} />
                    : <span style={{ width: 11 }} />}
                  <span className="truncate">{s.name || t('annotationMenu.unnamed')}</span>
                </button>
                <button
                  onClick={() => openPanelForEdit(s.id)}
                  className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                  title={t('annotationMenu.editSetTitle')}
                >
                  <Edit3 size={11} style={{ color: 'var(--text-muted)' }} />
                </button>
                <button
                  onClick={() => remove(s.id)}
                  className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                  title={t('annotationMenu.deleteSet')}
                >
                  <Trash2 size={11} style={{ color: 'var(--danger)' }} />
                </button>
              </>
            )}
          </div>
        );
      })}

      {/* New annotation — always at the bottom, keeps the "Off + list
          + New" ordering the eye reads top-to-bottom. */}
      <button
        onClick={openPanelForNew}
        className="w-full flex items-center gap-1.5 px-2 py-2 text-left text-xs font-medium"
        style={{
          background: 'var(--accent)',
          color: 'white',
        }}
        title={t('annotationMenu.newAnnotationTitle')}
      >
        <Plus size={13} />
        <span className="truncate">{t('annotationMenu.newAnnotation')}</span>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={onClickIcon}
        className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
        title={
          annotationEditing
            ? t('annotationMenu.closeTools')
            : noSavedSets
              ? t('annotationMenu.annotateSong')
              : t('annotationMenu.annotations')
        }
        aria-label={t('annotationMenu.annotationsAria')}
        aria-pressed={annotationEditing || open}
      >
        <Highlighter size={16} style={{ color: iconColor }} />
      </button>
      {dropdown}
    </div>
  );
}
