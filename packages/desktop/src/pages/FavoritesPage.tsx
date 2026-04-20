import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Play } from 'lucide-react';
import { useSongStore, useSettingsStore } from '@song-chords/shared';
import type { Song, SongListColumn } from '@song-chords/shared';
import { toTitleCase } from '../utils/text';
import SongContextMenu from '../components/song/SongContextMenu';

type SortableField = 'title' | 'artist' | 'genre' | 'key' | 'difficulty' | 'tempo' | 'year' | 'language';

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

export default function FavoritesPage(): React.ReactElement {
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const columns = useSettingsStore((s) => s.settings.songListColumns);
  const show = (c: SongListColumn) => columns?.[c] ?? true;
  const [sortField, setSortField] = useState<SortableField>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);

  const sorted = useMemo(() => {
    const filtered = songs.filter((s) => s.favorite);
    const dir = sortDir === 'asc' ? 1 : -1;
    const numeric = sortField === 'difficulty' || sortField === 'tempo' || sortField === 'year';
    return [...filtered].sort((a, b) => {
      if (numeric) {
        const av = (a[sortField] ?? 0) as number;
        const bv = (b[sortField] ?? 0) as number;
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <Star size={18} style={{ color: 'var(--accent)' }} fill="currentColor" />
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Favorites</h1>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {sorted.length} song{sorted.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => navigate('/favorites/perform')}
          disabled={sorted.length === 0}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold"
          style={{
            background: sorted.length === 0 ? 'var(--surface-elevated)' : 'var(--accent)',
            color: sorted.length === 0 ? 'var(--text-muted)' : 'white',
            cursor: sorted.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <Play size={14} /> Perform
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-20" style={{ color: 'var(--text-muted)' }}>
            <Star size={36} style={{ opacity: 0.4 }} />
            <p className="text-sm">No favorite songs yet.</p>
            <p className="text-xs">Right-click a song and choose &ldquo;Add to favorites&rdquo;.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <SortTh field="title"      label="Title"      align="left"  extra="px-6" active={sortField} dir={sortDir} onClick={handleSort} />
                {show('artist')     && <SortTh field="artist"     label="Artist"     align="left"  active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('genre')      && <SortTh field="genre"      label="Genre"      align="left"  width="w-28" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('key')        && <SortTh field="key"        label="Key"        align="left"  width="w-16" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('difficulty') && <SortTh field="difficulty" label="Difficulty" align="left"  width="w-32" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('tempo')      && <SortTh field="tempo"      label="Tempo"      align="right" width="w-24" extra="whitespace-nowrap" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('year')       && <SortTh field="year"       label="Year"       align="left"  width="w-20" active={sortField} dir={sortDir} onClick={handleSort} />}
                {show('language')   && <SortTh field="language"   label="Language"   align="left"  width="w-28" active={sortField} dir={sortDir} onClick={handleSort} />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((song) => (
                <tr
                  key={song.id}
                  onClick={() => navigate(`/song/${song.id}?favorite=1`)}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ song, x: e.clientX, y: e.clientY }); }}
                  className="cursor-pointer border-b hover:bg-[var(--surface-elevated)] transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="px-6 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</td>
                  {show('artist')     && <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{song.artist ? toTitleCase(song.artist) : '—'}</td>}
                  {show('genre')      && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.genre ? toTitleCase(song.genre) : '—'}</td>}
                  {show('key')        && <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--chord-color)' }}>{song.key ?? '—'}</td>}
                  {show('difficulty') && <td className="px-4 py-3"><DifficultyCell value={song.difficulty} /></td>}
                  {show('tempo')      && <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.tempo ? `${song.tempo} BPM` : '—'}</td>}
                  {show('year')       && <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{song.year ?? '—'}</td>}
                  {show('language')   && <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.language ? toTitleCase(song.language) : '—'}</td>}
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
    <span className="inline-flex items-center gap-1 text-xs font-mono" title={DIFFICULTY_LABELS[level] ?? ''} style={{ color: 'var(--accent)' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ opacity: n <= level ? 1 : 0.25 }}>{n <= level ? '★' : '☆'}</span>
      ))}
    </span>
  );
}
