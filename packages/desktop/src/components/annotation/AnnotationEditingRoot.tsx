import React from 'react';
import type { AnnotationViewMode } from '@song-chords/shared';
import AnnotationDrawSurface from './AnnotationDrawSurface';
import AnnotationToolbar from './AnnotationToolbar';
import { useAnnotationDoc } from './useAnnotationDoc';

interface Props {
  songId: string;
  annotationsJson: string | undefined;
  scrollRef: React.RefObject<HTMLElement>;
  recomputeKey: string;
  showCommitted: boolean;
  viewMode: AnnotationViewMode;
  onCloseToolbar: () => void;
}

/**
 * Wraps the drawing surface + toolbar in a single owner of the
 * annotation document controller (`useAnnotationDoc`). Draw and
 * toolbar therefore share ONE state instance, one debounced save,
 * one undo stack — instead of two independent hook instances that
 * would fight over the same DB column.
 *
 * The parent (SongViewPage / PerformPage) mounts this root only when
 * `editing` is on. On unmount the doc controller flushes any
 * pending save.
 */
export default function AnnotationEditingRoot({
  songId,
  annotationsJson,
  scrollRef,
  recomputeKey,
  showCommitted,
  viewMode,
  onCloseToolbar,
}: Props): React.ReactElement {
  const controller = useAnnotationDoc(songId, annotationsJson, viewMode);

  return (
    <>
      <AnnotationDrawSurface
        scrollRef={scrollRef}
        recomputeKey={recomputeKey}
        showCommitted={showCommitted}
        editingSet={controller.draft}
        replaceShapes={controller.replaceShapes}
        undo={controller.undo}
        redo={controller.redo}
      />
      <AnnotationToolbar
        songId={songId}
        viewMode={viewMode}
        controller={controller}
        onClose={onCloseToolbar}
      />
    </>
  );
}
