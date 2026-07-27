import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ChevronRight, ArrowLeft, Play } from 'lucide-react';
import type { Song, SongListColumn } from '@song-chords/shared';
import { useSongStore } from '@song-chords/shared';
import { toTitleCase } from '../utils/text';
import SongContextMenu from '../components/song/SongContextMenu';
import SongSelectionBar from '../components/song/SongSelectionBar';
import SongListTable, { type SortableField } from '../components/song/SongListTable';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

type CategoryKey = 'artist' | 'genre' | 'key' | 'difficulty' | 'tags' | 'year' | 'decade' | 'language';

const CATEGORIES: { key: CategoryKey; labelKey: TKey }[] = [
  { key: 'artist',     labelKey: 'categories.tabs.artist' },
  { key: 'genre',      labelKey: 'categories.tabs.genre' },
  { key: 'key',        labelKey: 'categories.tabs.key' },
  { key: 'difficulty', labelKey: 'categories.tabs.difficulty' },
  { key: 'language',   labelKey: 'categories.tabs.language' },
  { key: 'year',       labelKey: 'categories.tabs.year' },
  { key: 'decade',     labelKey: 'categories.tabs.decade' },
  { key: 'tags',       labelKey: 'categories.tabs.tags' },
];

export default function CategoriesPage(): React.ReactElement {
  const { category, value } = useParams<{ category?: CategoryKey; value?: string }>();
  const songs = useSongStore((s) => s.songs);

  if (!category) return <Navigate to="/categories/artist" replace />;
  if (!value) return <CategoryValueList category={category} songs={songs} />;
  return <SongsForValue category={category} value={decodeURIComponent(value)} songs={songs} />;
}

// ─── Tab bar (shared header across all category levels) ───────────────────

function CategoryTabs({ active }: { active?: CategoryKey }): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  return (
    <header className="px-6 py-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <h1 className="text-xl font-bold mr-3" style={{ color: 'var(--text-primary)' }}>{t('categories.title')}</h1>
      {CATEGORIES.map(({ key, labelKey }) => {
        const on = active === key;
        return (
          <button
            key={key}
            onClick={() => navigate(`/categories/${key}`)}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              background: on ? 'var(--accent)' : 'var(--surface-elevated)',
              color: on ? 'white' : 'var(--text-secondary)',
            }}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </header>
  );
}


// ─── Level 2: list distinct values for a category ──────────────────────────

function CategoryValueList({ category, songs }: { category: CategoryKey; songs: Song[] }): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const values = useMemo(() => {
    const counts = new Map<string, number>();
    for (const song of songs) {
      const vals = extractValues(category, song);
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => compareValues(category, a[0], b[0]));
  }, [category, songs]);

  return (
    <div className="flex flex-col h-full">
      <CategoryTabs active={category} />
      <div className="flex-1 overflow-y-auto">
        {values.length === 0 ? (
          <EmptyHint message={t('categories.emptyValues')} />
        ) : (
          <ul>
            {values.map(([v, count]) => (
              <li key={v}>
                <button
                  onClick={() => navigate(`/categories/${category}/${encodeURIComponent(v)}`)}
                  className="w-full flex items-center gap-3 px-6 py-3 border-b text-left hover:bg-[var(--surface-elevated)] transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <span className="flex-1">{formatValue(category, v, t)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{count === 1 ? t('categories.songCountOne', { count }) : t('categories.songCountMany', { count })}</span>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Level 3: songs matching the selected value ────────────────────────────

function durationToSeconds(d: string | undefined): number {
  if (!d) return -1;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

function SongsForValue({ category, value, songs }: { category: CategoryKey; value: string; songs: Song[] }): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [sortField, setSortField] = React.useState<SortableField>('title');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const filtered = songs.filter((s) => extractValues(category, s).includes(value));
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
  }, [songs, category, value, sortField, sortDir]);

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

  // Hide the column whose data already matches the current category — e.g.
  // when browsing "By Key → G", every row shares the same Key value. This
  // is passed to SongListTable's `forceHidden` prop so it wins over the
  // user's per-column visibility setting for the duration of this view.
  const forceHiddenColumn: SongListColumn | null =
    category === 'artist' ? 'artist' :
    category === 'genre' ? 'genre' :
    category === 'key' ? 'key' :
    category === 'difficulty' ? 'difficulty' :
    category === 'year' ? 'year' :
    category === 'language' ? 'language' : null;
  const forceHidden = useMemo(
    () => new Set<SongListColumn>(forceHiddenColumn ? [forceHiddenColumn] : []),
    [forceHiddenColumn],
  );

  return (
    <div className="flex flex-col h-full">
      <CategoryTabs active={category} />
      <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => navigate(`/categories/${category}`)}
          className="p-1 rounded hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title={t('common.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatValue(category, value, t)}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({sorted.length})</span>
        <SongSelectionBar selected={selectedSongs} onClear={() => setSelected(new Set())} />
        <button
          onClick={() => navigate(`/categories/${category}/${encodeURIComponent(value)}/perform?sort=${sortField}&dir=${sortDir}`)}
          disabled={sorted.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{
            background: sorted.length === 0 ? 'var(--surface-elevated)' : 'var(--accent)',
            color: sorted.length === 0 ? 'var(--text-muted)' : 'white',
            cursor: sorted.length === 0 ? 'not-allowed' : 'pointer',
          }}
          title={t('categories.performTooltip')}
        >
          <Play size={13} /> {t('categories.perform')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyHint message={t('categories.emptyNoMatch')} />
        ) : (
          <SongListTable
            songs={sorted}
            selectedIds={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onRowClick={(song) => navigate(`/song/${song.id}`)}
            onContextMenu={(song, e) => {
              e.preventDefault();
              if (selected.size > 0) return;
              setMenu({ song, x: e.clientX, y: e.clientY });
            }}
            forceHidden={forceHidden}
            showFavoriteStar
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractValues(category: CategoryKey, song: Song): string[] {
  switch (category) {
    case 'artist':     return song.artist ? [song.artist] : [];
    case 'genre':      return song.genre ? [song.genre] : [];
    case 'key':        return song.key ? [song.key] : [];
    case 'difficulty': return song.difficulty && song.difficulty > 0 ? [String(song.difficulty)] : [];
    case 'tags':       return song.tags ?? [];
    case 'year':       return song.year ? [String(song.year)] : [];
    case 'decade':     return song.year ? [`${Math.floor(song.year / 10) * 10}s`] : [];
    case 'language':   return song.language ? [song.language] : [];
  }
}

const DIFFICULTY_TKEYS: TKey[] = [
  'dashboard.difficulty.unset',
  'dashboard.difficulty.basic',
  'dashboard.difficulty.easy',
  'dashboard.difficulty.intermediate',
  'dashboard.difficulty.advanced',
  'dashboard.difficulty.professional',
];

function formatValue(category: CategoryKey, value: string, t: (key: TKey) => string): string {
  if (category === 'difficulty') {
    const n = parseInt(value);
    const key = DIFFICULTY_TKEYS[n];
    return key ? t(key) : value;
  }
  if (category === 'tags' || category === 'artist' || category === 'language') return toTitleCase(value);
  return value;
}

function compareValues(category: CategoryKey, a: string, b: string): number {
  if (category === 'difficulty') return parseInt(a) - parseInt(b);
  if (category === 'year' || category === 'decade') return parseInt(b) - parseInt(a); // newest → oldest
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function EmptyHint({ message }: { message: string }): React.ReactElement {
  return <div className="p-8 text-sm" style={{ color: 'var(--text-muted)' }}>{message}</div>;
}

