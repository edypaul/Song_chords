import React, { useRef, useState } from 'react';
import { Star, ListMusic, Trash2, X, Download, Columns3 } from 'lucide-react';
import { useSongStore, useSetListStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import ConfirmDialog from '../common/ConfirmDialog';
import SetListPickerModal from './SetListPickerModal';
import SongExportModal from './SongExportModal';
import SongListColumnsPopover from './SongListColumnsPopover';

interface Props {
  /** Songs currently selected. */
  selected: Song[];
  /** Called after any bulk action completes (success or cancel of confirm). */
  onClear: () => void;
}

/**
 * Compact, inline bulk-action controls for selected songs — designed to slot
 * directly into a page header next to the search bar. Renders nothing when no
 * songs are selected. Buttons are icon-only to keep the header narrow; the
 * count and a clear (×) button sit on the left of the cluster.
 */
export default function SongSelectionBar({ selected, onClear }: Props): React.ReactElement | null {
  const toggleFavorite = useSongStore((s) => s.toggleFavorite);
  const deleteSong = useSongStore((s) => s.deleteSong);
  const addSongToSetList = useSetListStore((s) => s.addSongToSetList);
  const [showPicker, setShowPicker] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const columnsBtnRef = useRef<HTMLButtonElement>(null);

  const isEmpty = selected.length === 0;
  const allFavorite = !isEmpty && selected.every((s) => s.favorite);

  const handleFavoriteToggle = async () => {
    for (const song of selected) {
      if (allFavorite) {
        await toggleFavorite(db, song.id);
      } else if (!song.favorite) {
        await toggleFavorite(db, song.id);
      }
    }
    onClear();
  };

  const handleAddToSetLists = async (setlistIds: string[]) => {
    for (const slId of setlistIds) {
      for (const song of selected) {
        await addSongToSetList(db, slId, song.id);
      }
    }
    setShowPicker(false);
    onClear();
  };

  const handleDelete = async () => {
    for (const song of selected) {
      await deleteSong(db, song.id);
    }
    setShowDelete(false);
    onClear();
  };

  const iconBtn = "p-2 rounded-lg transition-colors hover:bg-[var(--surface-elevated)] disabled:hover:bg-transparent disabled:cursor-not-allowed";
  // Disabled state: dim the whole pill so it reads as a preview of what's
  // available once the user starts selecting rows.
  const disabledOpacity = isEmpty ? 0.5 : 1;

  return (
    <>
      <div className="flex items-center">
      <div
        className="flex items-center gap-2 px-3 py-1"
        style={{
          background: 'transparent',
          opacity: disabledOpacity,
        }}
      >
        <button
          onClick={onClear}
          disabled={isEmpty}
          className="p-1.5 rounded hover:bg-[var(--surface)] disabled:hover:bg-transparent disabled:cursor-not-allowed"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={14} style={{ color: 'var(--text-muted)' }} />
        </button>
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
          {selected.length} selected
        </span>

        <div className="ml-1 flex items-center gap-1">
          <button
            onClick={() => void handleFavoriteToggle()}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? 'Select songs to favorite' : (allFavorite ? 'Remove from favorites' : 'Add to favorites')}
            aria-label={allFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={16}
              style={{ color: allFavorite ? 'var(--accent)' : 'var(--text-secondary)' }}
              fill={allFavorite ? 'currentColor' : 'none'}
            />
          </button>

          <button
            onClick={() => setShowPicker(true)}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? 'Select songs to add to a set list' : 'Add to set list'}
            aria-label="Add to set list"
          >
            <ListMusic size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <button
            onClick={() => setShowExport(true)}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? 'Select songs to export' : 'Export selected songs'}
            aria-label="Export selected songs"
          >
            <Download size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <button
            onClick={() => setShowDelete(true)}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? 'Select songs to delete' : 'Delete selected songs'}
            aria-label="Delete selected songs"
          >
            <Trash2 size={16} style={{ color: 'var(--danger)' }} />
          </button>
        </div>
      </div>

      {/* Columns editor — configures the table, not the selection, so it's
          always enabled and lives outside the dimmed selection cluster. */}
      <button
        ref={columnsBtnRef}
        onClick={() => setShowColumns((v) => !v)}
        className={iconBtn}
        title="Show / hide and reorder columns"
        aria-label="Columns"
        aria-expanded={showColumns}
        style={{ background: showColumns ? 'var(--surface-elevated)' : undefined }}
      >
        <Columns3 size={16} style={{ color: 'var(--text-secondary)' }} />
      </button>
      </div>

      {showColumns && (
        <SongListColumnsPopover
          anchorRef={columnsBtnRef}
          onClose={() => setShowColumns(false)}
        />
      )}

      {showExport && (
        <SongExportModal
          songs={selected}
          bookTitle={`${selected.length} selected songs`}
          onClose={() => setShowExport(false)}
        />
      )}

      {showPicker && (
        <SetListPickerModal
          initialSelected={[]}
          hint={`Will add ${selected.length} song${selected.length === 1 ? '' : 's'} to the chosen set list${selected.length === 1 ? '' : 's'}.`}
          onClose={() => setShowPicker(false)}
          onConfirm={(ids) => void handleAddToSetLists(ids)}
        />
      )}

      {showDelete && (
        <ConfirmDialog
          title={`Delete ${selected.length} song${selected.length === 1 ? '' : 's'}?`}
          message={
            <>
              This permanently removes {selected.length === 1 ? <><strong>{selected[0]!.title}</strong></> : <>these songs</>} from the library. Set list and favorite references will be cleaned up automatically.
            </>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setShowDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  );
}
