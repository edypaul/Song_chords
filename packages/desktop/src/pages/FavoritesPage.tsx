import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Play } from 'lucide-react';
import { useSongStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import SongContextMenu from '../components/song/SongContextMenu';
import SongSelectionBar from '../components/song/SongSelectionBar';
import SongListTable, { type SortableField } from '../components/song/SongListTable';
import { useT } from '../i18n';

function durationToSeconds(d: string | undefined): number {
  if (!d) return -1;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

export default function FavoritesPage(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const [sortField, setSortField] = useState<SortableField>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const filtered = songs.filter((s) => s.favorite);
    const dir = sortDir === 'asc' ? 1 : -1;
    const numeric = sortField === 'difficulty' || sortField === 'tempo' || sortField === 'year' || sortField === 'chordsCount' || sortField === 'createdAt';
    return [...filtered].sort((a, b) => {
      if (numeric) {
        const av = (a[sortField] ?? 0) as number;
        const bv = (b[sortField] ?? 0) as number;
        return (av - bv) * dir;
      }
      if (sortField === 'duration') {
        const av = durationToSeconds(a.duration);
        const bv = durationToSeconds(b.duration);
        if (av < 0 && bv >= 0) return 1;
        if (av >= 0 && bv < 0) return -1;
        return (av - bv) * dir;
      }
      const av = ((a[sortField] ?? '') as string).toString();
      const bv = ((b[sortField] ?? '') as string).toString();
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av.localeCompare(bv) * dir;
    });
  }, [songs, sortField, sortDir]);

  const handleSort = (f: SortableField) => {
    if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => prev.size === sorted.length ? new Set() : new Set(sorted.map((s) => s.id)));
  };
  const selectedSongs = useMemo(() => sorted.filter((s) => selected.has(s.id)), [sorted, selected]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <Star size={18} style={{ color: 'var(--accent)' }} fill="currentColor" />
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('favoritesPage.title')}</h1>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {sorted.length === 1 ? t('favoritesPage.songCountOne', { count: sorted.length }) : t('favoritesPage.songCountMany', { count: sorted.length })}
        </span>
        <SongSelectionBar selected={selectedSongs} onClear={() => setSelected(new Set())} />
        <button
          onClick={() => navigate(`/favorites/perform?sort=${sortField}&dir=${sortDir}`)}
          disabled={sorted.length === 0}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: sorted.length === 0 ? 'var(--surface-elevated)' : 'var(--accent)',
            color: sorted.length === 0 ? 'var(--text-muted)' : 'white',
            cursor: sorted.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <Play size={16} /> {t('favoritesPage.perform')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-20" style={{ color: 'var(--text-muted)' }}>
            <Star size={36} style={{ opacity: 0.4 }} />
            <p className="text-sm">{t('favoritesPage.emptyTitle')}</p>
            <p className="text-xs">{t('favoritesPage.emptyHint')}</p>
          </div>
        ) : (
          <SongListTable
            songs={sorted}
            selectedIds={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onRowClick={(song) => navigate(`/song/${song.id}?favorite=1`)}
            onContextMenu={(song, e) => {
              e.preventDefault();
              if (selected.size > 0) return;
              setMenu({ song, x: e.clientX, y: e.clientY });
            }}
            sortField={sortField}
            sortDirection={sortDir}
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

