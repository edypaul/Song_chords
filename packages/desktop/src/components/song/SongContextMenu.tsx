import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Star, ListPlus, Info, Edit2, Trash2, Download } from 'lucide-react';
import type { Song } from '@song-chords/shared';
import { useSongStore } from '@song-chords/shared';
import ContextMenu from '../common/ContextMenu';
import ConfirmDialog from '../common/ConfirmDialog';
import SongInfoModal from './SongInfoModal';
import AddToPlaylistModal from './AddToPlaylistModal';
import SongExportModal from './SongExportModal';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';

interface Props {
  song: Song;
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * Menu + dialogs bundle for per-song row actions (favorite toggle, add to
 * playlist, info, edit, delete). The menu closes itself when an item is
 * chosen; the dialogs keep the menu logically "open" until they're dismissed
 * so callers only need to mount one component.
 */
export default function SongContextMenu({ song, x, y, onClose }: Props): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleFavorite = useSongStore((s) => s.toggleFavorite);
  const deleteSong = useSongStore((s) => s.deleteSong);
  const [modal, setModal] = useState<'info' | 'playlist' | 'export' | 'delete' | null>(null);

  // Items that only fire an action close the menu themselves. Items that
  // open a modal leave the component mounted (setModal(...) alone) so the
  // dialog can render.
  const items = [
    {
      icon: Star,
      label: song.favorite ? 'Remove from favorites' : 'Add to favorites',
      onClick: () => { void toggleFavorite(db, song.id); onClose(); },
    },
    {
      icon: ListPlus,
      label: 'Add to play list',
      onClick: () => setModal('playlist'),
    },
    {
      icon: Info,
      label: 'Song info',
      onClick: () => setModal('info'),
    },
    {
      icon: Download,
      label: 'Export…',
      onClick: () => setModal('export'),
    },
    {
      icon: Edit2,
      label: 'Edit',
      onClick: () => {
        // Pass the current page as the return target so Save/Back from the
        // edit page lands back on whichever list the user was browsing.
        const from = encodeURIComponent(location.pathname + location.search);
        navigate(`/song/${song.id}/edit?return=${from}`);
        onClose();
      },
    },
    { separator: true, label: '', onClick: () => {} },
    {
      icon: Trash2,
      label: 'Delete',
      danger: true,
      onClick: () => setModal('delete'),
    },
  ];

  // While a modal is open, hide the menu but keep this component mounted so
  // the dialog stays alive until the user dismisses it.
  return (
    <>
      {modal === null && <ContextMenu x={x} y={y} items={items} onClose={onClose} />}

      {modal === 'info' && (
        <SongInfoModal song={song} onClose={() => { setModal(null); onClose(); }} />
      )}

      {modal === 'playlist' && (
        <AddToPlaylistModal
          song={song}
          onClose={() => { setModal(null); onClose(); }}
        />
      )}

      {modal === 'export' && (
        <SongExportModal
          song={song}
          onClose={() => { setModal(null); onClose(); }}
        />
      )}

      {modal === 'delete' && (
        <ConfirmDialog
          title="Delete song?"
          message={<>This will permanently delete <strong>{toTitleCase(song.title)}</strong>. This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onCancel={() => { setModal(null); onClose(); }}
          onConfirm={async () => {
            await deleteSong(db, song.id);
            setModal(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
