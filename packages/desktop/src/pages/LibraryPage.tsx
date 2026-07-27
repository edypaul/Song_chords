import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { useSongStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import SongContextMenu from '../components/song/SongContextMenu';
import SongSelectionBar from '../components/song/SongSelectionBar';
import SongListTable, { type SortableField } from '../components/song/SongListTable';
import { useT } from '../i18n';

export default function LibraryPage(): React.ReactElement {
  const navigate = useNavigate();
  const t = useT();
  const {
    filteredSongs, searchQuery, setSearchQuery,
    sortField, sortDirection, setSortField, toggleSortDirection,
    isLoading,
  } = useSongStore();
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleSort = (field: SortableField) => {
    if (sortField === field) toggleSortDirection();
    else setSortField(field as Parameters<typeof setSortField>[0]);
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => prev.size === filteredSongs.length ? new Set() : new Set(filteredSongs.map((s) => s.id)));
  };
  const selectedSongs = useMemo(
    () => filteredSongs.filter((s) => selected.has(s.id)),
    [filteredSongs, selected],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-bold mr-2" style={{ color: 'var(--text-primary)' }}>{t('library.title')}</h1>

        {/* Search */}
        <div className="flex-1 relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder={t('library.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          {searchQuery && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery('')} title={t('library.searchClearAria')} aria-label={t('library.searchClearAria')}>
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        <SongSelectionBar selected={selectedSongs} onClear={() => setSelected(new Set())} />
        <button
          onClick={() => navigate('/song/new')}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Plus size={16} />
          {t('library.newSong')}
        </button>
      </div>

      {/* Song list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <EmptyState message={t('library.emptyState.loading')} />
        ) : filteredSongs.length === 0 ? (
          <EmptyState
            message={searchQuery ? t('library.emptyState.noMatches') : t('library.emptyState.noSongs')}
            action={!searchQuery ? { label: t('library.emptyState.addFirst'), onClick: () => navigate('/song/new') } : undefined}
          />
        ) : (
          <SongListTable
            songs={filteredSongs}
            selectedIds={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onRowClick={(song) => navigate(`/song/${song.id}`)}
            onContextMenu={(song, e) => {
              e.preventDefault();
              // Selection mode: suppress the per-song context menu so
              // the bulk-action pill is the only affordance.
              if (selected.size > 0) return;
              setMenu({ song, x: e.clientX, y: e.clientY });
            }}
            showFavoriteStar
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        )}
      </div>

      {menu && (
        <SongContextMenu
          song={menu.song}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ message, action }: { message: string; action?: { label: string; onClick: () => void } }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20" style={{ color: 'var(--text-muted)' }}>
      <p>{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
