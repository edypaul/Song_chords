import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, X, Star } from 'lucide-react';
import { useSongStore, useSettingsStore } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { Song, SongListColumn } from '@song-chords/shared';
import { toTitleCase } from '../utils/text';
import SongContextMenu from '../components/song/SongContextMenu';

export default function LibraryPage(): React.ReactElement {
  const navigate = useNavigate();
  const {
    filteredSongs, searchQuery, setSearchQuery,
    sortField, sortDirection, setSortField, toggleSortDirection,
    isLoading,
  } = useSongStore();
  const columns = useSettingsStore((s) => s.settings.songListColumns);
  const show = (c: SongListColumn) => columns?.[c] ?? true;
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);

  const handleSort = (field: Parameters<typeof setSortField>[0]) => {
    if (sortField === field) toggleSortDirection();
    else setSortField(field);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-bold mr-2" style={{ color: 'var(--text-primary)' }}>Songs</h1>

        {/* Search */}
        <div className="flex-1 relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search songs, artists..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          {searchQuery && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery('')}>
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        <button
          onClick={() => navigate('/song/new')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Plus size={16} />
          New Song
        </button>
      </div>


      {/* Song list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <EmptyState message="Loading..." />
        ) : filteredSongs.length === 0 ? (
          <EmptyState
            message={searchQuery ? 'No songs match your search' : 'No songs yet'}
            action={!searchQuery ? { label: 'Add your first song', onClick: () => navigate('/song/new') } : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <SortTh field="title"      label="Title"      align="left"  extra="px-6" active={sortField} dir={sortDirection} onClick={handleSort} />
                {show('artist')     && <SortTh field="artist"     label="Artist"     align="left"  active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('genre')      && <SortTh field="genre"      label="Genre"      align="left"  width="w-28" active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('key')        && <SortTh field="key"        label="Key"        align="left"  width="w-16" active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('difficulty') && <SortTh field="difficulty" label="Difficulty" align="left"  width="w-32" active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('tempo')      && <SortTh field="tempo"      label="Tempo"      align="right" width="w-24" extra="whitespace-nowrap" active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('year')       && <SortTh field="year"       label="Year"       align="left"  width="w-20" active={sortField} dir={sortDirection} onClick={handleSort} />}
                {show('language')   && <SortTh field="language"   label="Language"   align="left"  width="w-28" active={sortField} dir={sortDirection} onClick={handleSort} />}
              </tr>
            </thead>
            <tbody>
              {filteredSongs.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  show={show}
                  onClick={() => navigate(`/song/${song.id}`)}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ song, x: e.clientX, y: e.clientY }); }}
                />
              ))}
            </tbody>
          </table>
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

function SongRow({
  song, show, onClick, onContextMenu,
}: {
  song: Song;
  show: (c: SongListColumn) => boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}): React.ReactElement {
  return (
    <tr
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="cursor-pointer border-b transition-colors hover:bg-[var(--surface-elevated)]"
      style={{ borderColor: 'var(--border)' }}
    >
      <td className="px-6 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
        <span className="inline-flex items-center gap-2">
          {song.favorite && <Star size={12} style={{ color: 'var(--accent)' }} fill="currentColor" />}
          {toTitleCase(song.title)}
        </span>
      </td>
      {show('artist')     && <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{song.artist ? toTitleCase(song.artist) : '—'}</td>}
      {show('genre')      && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.genre ? toTitleCase(song.genre) : '—'}</td>}
      {show('key')        && <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--chord-color)' }}>{song.key ?? '—'}</td>}
      {show('difficulty') && <td className="px-4 py-3"><DifficultyCell value={song.difficulty} /></td>}
      {show('tempo')      && <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.tempo ? `${song.tempo} BPM` : '—'}</td>}
      {show('year')       && <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{song.year ?? '—'}</td>}
      {show('language')   && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.language ? toTitleCase(song.language) : '—'}</td>}
    </tr>
  );
}

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

type SortableField = 'title' | 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'year' | 'language';

function SortTh({
  field, label, align, width, extra, active, dir, onClick,
}: {
  field: SortableField;
  label: string;
  align: 'left' | 'right';
  width?: string;
  extra?: string;
  active: string;
  dir: 'asc' | 'desc';
  onClick: (field: SortableField) => void;
}): React.ReactElement {
  const isActive = active === field;
  const arrow = isActive ? (dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th
      onClick={() => onClick(field)}
      className={`px-4 py-2 font-medium cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'} ${width ?? ''} ${extra ?? ''}`}
      style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
    >
      <span>{label}</span>
      {arrow && <span className="ml-1 text-[10px]" style={{ color: 'var(--accent)' }}>{arrow}</span>}
    </th>
  );
}

function DifficultyCell({ value }: { value?: number }): React.ReactElement {
  const level = value ?? 0;
  if (level <= 0) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono"
      title={DIFFICULTY_LABELS[level] ?? ''}
      style={{ color: 'var(--accent)' }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ opacity: n <= level ? 1 : 0.25 }}>
          {n <= level ? '★' : '☆'}
        </span>
      ))}
    </span>
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
