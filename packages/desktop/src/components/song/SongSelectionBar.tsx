import React, { useRef, useState } from 'react';
import { Star, ListMusic, Trash2, X, Download, Columns3 } from 'lucide-react';
import { useSongStore, useSetListStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import ConfirmDialog from '../common/ConfirmDialog';
import SetListPickerModal from './SetListPickerModal';
import SongExportModal from './SongExportModal';
import SongListColumnsPopover from './SongListColumnsPopover';
import { useT } from '../../i18n';

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
  const t = useT();
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
        className="app-toolbar flex items-center gap-2 px-3 py-1"
        style={{
          background: 'transparent',
          opacity: disabledOpacity,
        }}
      >
        <button
          onClick={onClear}
          disabled={isEmpty}
          className="p-1.5 rounded hover:bg-[var(--surface)] disabled:hover:bg-transparent disabled:cursor-not-allowed"
          title={t('songSelection.clear')}
          aria-label={t('songSelection.clear')}
        >
          <X size={14} style={{ color: 'var(--text-muted)' }} />
        </button>
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
          {t('songSelection.selected', { count: selected.length })}
        </span>

        <div className="ml-1 flex items-center gap-1">
          <button
            onClick={() => void handleFavoriteToggle()}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? t('songSelection.favorite.disabled') : (allFavorite ? t('songSelection.favorite.remove') : t('songSelection.favorite.add'))}
            aria-label={allFavorite ? t('songSelection.favorite.remove') : t('songSelection.favorite.add')}
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
            title={isEmpty ? t('songSelection.addToSetList.disabled') : t('songSelection.addToSetList')}
            aria-label={t('songSelection.addToSetList')}
          >
            <ListMusic size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <button
            onClick={() => setShowExport(true)}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? t('songSelection.export.disabled') : t('songSelection.export')}
            aria-label={t('songSelection.export')}
          >
            <Download size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <button
            onClick={() => setShowDelete(true)}
            disabled={isEmpty}
            className={iconBtn}
            title={isEmpty ? t('songSelection.delete.disabled') : t('songSelection.delete')}
            aria-label={t('songSelection.delete')}
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
        title={t('songSelection.columns.toggle')}
        aria-label={t('songSelection.columns.aria')}
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
          bookTitle={t('songSelection.exportHeading', { count: selected.length })}
          onClose={() => setShowExport(false)}
        />
      )}

      {showPicker && (
        <SetListPickerModal
          initialSelected={[]}
          hint={selected.length === 1
            ? t('songSelection.pickerHintOne', { count: selected.length })
            : t('songSelection.pickerHintMany', { count: selected.length })}
          onClose={() => setShowPicker(false)}
          onConfirm={(ids) => void handleAddToSetLists(ids)}
        />
      )}

      {showDelete && (
        <ConfirmDialog
          title={selected.length === 1
            ? t('songSelection.deleteTitleOne', { count: selected.length })
            : t('songSelection.deleteTitleMany', { count: selected.length })}
          message={
            selected.length === 1
              ? <>{t('songSelection.deleteMessageOne', { title: selected[0]!.title })}</>
              : <>{t('songSelection.deleteMessageMany')}</>
          }
          confirmLabel={t('common.delete')}
          danger
          onCancel={() => setShowDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  );
}
