import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ChevronRight, ArrowLeft, Play, Star } from 'lucide-react';
import type { Song, SongListColumn } from '@song-chords/shared';
import { useSongStore, useSettingsStore } from '@song-chords/shared';
import { toTitleCase } from '../utils/text';
import SongContextMenu from '../components/song/SongContextMenu';
import SongSelectionBar from '../components/song/SongSelectionBar';
import PlayLinkButton from '../components/song/PlayLinkButton';

type CategoryKey = 'artist' | 'genre' | 'key' | 'difficulty' | 'tags' | 'year' | 'decade' | 'language';

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'artist',     label: 'Artist' },
  { key: 'genre',      label: 'Genre' },
  { key: 'key',        label: 'Key' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'language',   label: 'Language' },
  { key: 'year',       label: 'Year' },
  { key: 'decade',     label: 'Decade' },
  { key: 'tags',       label: 'Tags' },
];

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

export default function CategoriesPage(): React.ReactElement {
  const { category, value } = useParams<{ category?: CategoryKey; value?: string }>();
  const songs = useSongStore((s) => s.songs);

  if (!category) return <Navigate to="/categories/artist" replace />;
  if (!value) return <CategoryValueList category={category} songs={songs} />;
  return <SongsForValue category={category} value={decodeURIComponent(value)} songs={songs} />;
}

// ─── Tab bar (shared header across all category levels) ───────────────────

function CategoryTabs({ active }: { active?: CategoryKey }): React.ReactElement {
  const navigate = useNavigate();
  return (
    <header className="px-6 py-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <h1 className="text-xl font-bold mr-3" style={{ color: 'var(--text-primary)' }}>Categories</h1>
      {CATEGORIES.map(({ key, label }) => {
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
            {label}
          </button>
        );
      })}
    </header>
  );
}


// ─── Level 2: list distinct values for a category ──────────────────────────

function CategoryValueList({ category, songs }: { category: CategoryKey; songs: Song[] }): React.ReactElement {
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
          <EmptyHint message="No values in this category yet." />
        ) : (
          <ul>
            {values.map(([v, count]) => (
              <li key={v}>
                <button
                  onClick={() => navigate(`/categories/${category}/${encodeURIComponent(v)}`)}
                  className="w-full flex items-center gap-3 px-6 py-3 border-b text-left hover:bg-[var(--surface-elevated)] transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <span className="flex-1">{formatValue(category, v)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{count} song{count === 1 ? '' : 's'}</span>
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

type SortableField = 'title' | 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'duration' | 'year' | 'language' | 'chordsCount' | 'createdAt';

function durationToSeconds(d: string | undefined): number {
  if (!d) return -1;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

function SongsForValue({ category, value, songs }: { category: CategoryKey; value: string; songs: Song[] }): React.ReactElement {
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
  const allChecked = sorted.length > 0 && selected.size === sorted.length;

  // Hide the column whose data already matches the current category — e.g.
  // when browsing "By Key → G", every row shares the same Key value.
  const hidden: SortableField | null =
    category === 'artist' ? 'artist' :
    category === 'genre' ? 'genre' :
    category === 'key' ? 'key' :
    category === 'difficulty' ? 'difficulty' :
    category === 'year' ? 'year' :
    category === 'language' ? 'language' : null;
  const columns = useSettingsStore((s) => s.settings.songListColumns);
  // Column is visible only when both the active-category rule allows it
  // AND the user hasn't hidden it in Settings.
  const show = (f: SortableField) => {
    if (f === hidden) return false;
    if (f === 'title') return true;
    return columns?.[f as SongListColumn] ?? true;
  };

  return (
    <div className="flex flex-col h-full">
      <CategoryTabs active={category} />
      <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => navigate(`/categories/${category}`)}
          className="p-1 rounded hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatValue(category, value)}</span>
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
          title="Perform these songs"
        >
          <Play size={13} /> Perform
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyHint message="No songs match." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all songs" />
                </th>
                <SortTh field="title"      label="Title"      align="left"  extra="px-6" active={sortField} dir={sortDir} onClick={handleSort} />
                <th className="w-10 px-2 py-2" aria-label="Play audio source" />
                {show('artist')     && <SortTh field="artist"     label="Artist"     align="left"  active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('genre')      && <SortTh field="genre"      label="Genre"      align="left"  width="w-28" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('key')        && <SortTh field="key"        label="Key"        align="left"  width="w-16" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('difficulty') && <SortTh field="difficulty" label="Difficulty" align="left"  width="w-32" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('tempo')      && <SortTh field="tempo"      label="Tempo"      align="right" width="w-24" extra="whitespace-nowrap" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('duration')   && <SortTh field="duration"   label="Duration"   align="right" width="w-20" extra="whitespace-nowrap" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('year')       && <SortTh field="year"       label="Year"       align="left"  width="w-20" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('language')   && <SortTh field="language"   label="Language"   align="left"  width="w-28" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('chordsCount')&& <SortTh field="chordsCount" label="Chords"     align="right" width="w-20" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('createdAt')  && <SortTh field="createdAt"   label="Added"      align="left"  width="w-28" active={sortField} dir={sortDir} onClick={handleSort} />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((song) => (
                <tr
                  key={song.id}
                  onClick={() => navigate(`/song/${song.id}`)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (selected.size > 0) return;
                    setMenu({ song, x: e.clientX, y: e.clientY });
                  }}
                  className="cursor-pointer border-b hover:bg-[var(--surface-elevated)] transition-colors"
                  style={{ borderColor: 'var(--border)', background: (selected.has(song.id) || menu?.song.id === song.id) ? 'var(--surface-elevated)' : undefined }}
                >
                  <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(song.id)} onChange={() => toggleRow(song.id)} aria-label={`Select ${song.title}`} />
                  </td>
                  <td className="px-6 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    <span className="inline-flex items-center gap-2">
                      {song.favorite && <Star size={12} style={{ color: 'var(--accent)' }} fill="currentColor" />}
                      {toTitleCase(song.title)}
                    </span>
                  </td>
                  <td className="w-10 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <PlayLinkButton title={song.title} link={song.link} audioFile={song.audioFile} />
                  </td>
                  {show('artist')     && <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{song.artist ? toTitleCase(song.artist) : '—'}</td>}
                  {show('genre')      && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.genre ? toTitleCase(song.genre) : '—'}</td>}
                  {show('key')        && <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--chord-color)' }}>{song.key ?? '—'}</td>}
                  {show('difficulty') && <td className="px-4 py-3"><DifficultyCell value={song.difficulty} /></td>}
                  {show('tempo')      && <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.tempo ? `${song.tempo} BPM` : '—'}</td>}
                  {show('duration')   && <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.duration ?? '—'}</td>}
                  {show('year')       && <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{song.year ?? '—'}</td>}
                  {show('language')   && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.language ? toTitleCase(song.language) : '—'}</td>}
                  {show('chordsCount')&& <td className="px-4 py-3 text-xs font-mono text-right" style={{ color: 'var(--text-muted)' }}>{song.chordsCount ?? 0}</td>}
                  {show('createdAt')  && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(song.createdAt).toLocaleDateString()}</td>}
                </tr>
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

function formatValue(category: CategoryKey, value: string): string {
  if (category === 'difficulty') {
    const n = parseInt(value);
    return DIFFICULTY_LABELS[n] ?? value;
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
