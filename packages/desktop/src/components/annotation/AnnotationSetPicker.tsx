import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Check, Star, EyeOff, Edit2, Trash2 } from 'lucide-react';
import {
  ANNOTATION_OFF,
  listSetsForViewMode,
  parseSongAnnotations,
  pickActiveSet,
} from '@song-chords/shared';
import type { AnnotationViewMode } from '@song-chords/shared';
import { useAnnotationEditStore } from './annotation-store';
import { useAnnotationDoc } from './useAnnotationDoc';

interface Props {
  songId: string;
  annotationsJson: string | undefined;
  viewMode: AnnotationViewMode;
}

/**
 * Top-toolbar dropdown for switching between saved annotation sets on
 * the current song. Owns the full set-management UI:
 *   • Off — hide all annotations
 *   • Named-set rows with rename / delete / set-as-default on hover
 *
 * When there are zero sets for the current view configuration (and
 * no draft), the button is disabled — nothing to pick from.
 *
 * Uses its own `useAnnotationDoc` instance so rename / delete /
 * set-default go through the same debounced save path as the
 * drawing surface. Two instances on the same song sync via the
 * `annotationsJson` prop: whichever writes first, the other sees
 * the update on the next render and updates its local `doc` state.
 */
export default function AnnotationSetPicker({ songId, annotationsJson, viewMode }: Props): React.ReactElement {
  const selectedSetIds = useAnnotationEditStore((s) => s.selectedSetIds);
  const setSelectedSetId = useAnnotationEditStore((s) => s.setSelectedSetId);
  const selectedSetId = selectedSetIds[songId] ?? null;

  const controller = useAnnotationDoc(songId, annotationsJson, viewMode);
  const { rename, remove, setDefault } = controller;

  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Viewport-relative position for the dropdown. Rendered in a
  // portal so it isn't clipped by the toolbar container's
  // `overflow: hidden` (the toolbar uses that for its collapse
  // animation). Recomputed on open + on window resize.
  //
  // Anchoring: prefer left-aligned with the button (dropdown extends
  // to the right). Falls back to right-aligned when there isn't
  // enough room to the right — e.g. the button sits on a wrapped
  // toolbar row far to the left AND right-aligning would still fit;
  // OR the button is near the right edge and left-aligning would
  // overflow. This gives sensible placement whether the button is
  // in the primary or wrapped toolbar row.
  const DROPDOWN_WIDTH = 240;
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
      // If left-aligned dropdown would spill past viewport-right,
      // shift left so its right edge sits `margin` from the viewport.
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

  // Read via parse (not controller.doc) so the picker reflects the
  // latest annotationsJson from props even if the controller's own
  // memoization is a tick behind. The controller's own writes flow
  // back through this same annotationsJson on the next render.
  const doc = useMemo(() => parseSongAnnotations(annotationsJson), [annotationsJson]);
  const setsInMode = useMemo(() => listSetsForViewMode(doc, viewMode), [doc, viewMode]);
  const active = useMemo(() => pickActiveSet(doc, viewMode, selectedSetId), [doc, viewMode, selectedSetId]);
  const isOff = selectedSetId === ANNOTATION_OFF;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // Dropdown lives in a portal (outside `containerRef`), so we
      // check both the button container AND the dropdown root before
      // treating this as an outside click.
      if (containerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
      setRenamingId(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const nothingToPick = setsInMode.length === 0;
  const iconColor = isOff
    ? 'var(--danger)'
    : active
      ? 'var(--accent)'
      : nothingToPick
        ? 'var(--text-muted)'
        : 'var(--text-secondary)';

  const dropdown = open && !nothingToPick && pos ? createPortal(
    // Portal-mounted, viewport-fixed. The toolbar's own container
    // uses `overflow: hidden` for its collapse animation, which
    // would clip this dropdown if it were nested inline. Portalling
    // to <body> + `position: fixed` sidesteps that entirely.
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
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {/* Off — hides all annotations for this song. */}
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
        <span className="truncate flex-1">Off</span>
      </button>
      {setsInMode.map((s) => {
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
                  <span className="truncate">
                    {s.id === 'draft' ? 'Unsaved draft' : (s.name || '(unnamed)')}
                  </span>
                </button>
                {s.id !== 'draft' && (
                  <>
                    {/* Star / rename / delete are always visible on
                        every row — no hover-gated affordances. The
                        star is filled when this set is the default. */}
                    <button
                      onClick={() => setDefault(s.id)}
                      className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                      title={s.isDefault ? 'Default for this view configuration' : 'Set as default'}
                      disabled={s.isDefault}
                    >
                      <Star
                        size={11}
                        style={{ color: s.isDefault ? 'var(--accent)' : 'var(--text-muted)' }}
                        fill={s.isDefault ? 'var(--accent)' : 'none'}
                      />
                    </button>
                    <button
                      onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}
                      className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                      title="Rename"
                    >
                      <Edit2 size={11} style={{ color: 'var(--text-muted)' }} />
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                      title="Delete this set"
                    >
                      <Trash2 size={11} style={{ color: 'var(--danger)' }} />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => { if (!nothingToPick) setOpen((v) => !v); }}
        disabled={nothingToPick}
        className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
        style={{
          opacity: nothingToPick ? 0.4 : 1,
          cursor: nothingToPick ? 'not-allowed' : 'pointer',
        }}
        title="Annotations list"
        aria-label="Annotations list"
        aria-pressed={open}
        aria-disabled={nothingToPick}
      >
        <Layers size={16} style={{ color: iconColor }} />
      </button>
      {dropdown}
    </div>
  );
}
