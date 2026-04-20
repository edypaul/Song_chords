import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, User, Clock, Tag, Star, Hash, Globe2, Calendar, ListMusic, Play } from 'lucide-react';
import type { Song } from '@song-chords/shared';
import { useSongStore, useSetListStore, SetListRepository } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import { toTitleCase } from '../utils/text';

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

export default function DashboardPage(): React.ReactElement {
  const songs = useSongStore((s) => s.songs);
  const setlists = useSetListStore((s) => s.setlists);
  const navigate = useNavigate();

  // Song counts per setlist — fetched separately because the store keeps
  // only setlist metadata, not entries (entries load on demand).
  const [setlistCounts, setSetlistCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const repo = new SetListRepository(db);
    void repo.getEntryCounts().then(setSetlistCounts);
  }, [setlists.length]);

  const stats = useMemo(() => computeStats(songs), [songs]);
  const favorites = useMemo(() => songs.filter((s) => s.favorite), [songs]);
  const recentFavorites = useMemo(
    () => [...favorites].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [favorites],
  );
  const recentSetlists = useMemo(
    () => [...setlists].sort((a, b) => b.updatedAt - a.updatedAt),
    [setlists],
  );
  const totalSetlistEntries = useMemo(
    () => Object.values(setlistCounts).reduce((sum, c) => sum + c, 0),
    [setlistCounts],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          An at-a-glance look at your song library.
        </p>
      </header>

      {songs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10 text-sm" style={{ color: 'var(--text-muted)' }}>
          Add some songs to see statistics.
        </div>
      ) : (
        <div className="p-6 grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {/* Top stat cards */}
          <div className="col-span-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard icon={<Music size={18} />}     label="Total Songs"     value={stats.total.toString()}               onClick={() => navigate('/library')} />
            <StatCard icon={<Star size={18} />}      label="Favorites"       value={favorites.length.toString()}          onClick={() => navigate('/favorites')} />
            <StatCard icon={<ListMusic size={18} />} label="Set Lists"       value={setlists.length.toString()}           onClick={() => navigate('/setlists')} />
            <StatCard icon={<User size={18} />}      label="Unique Artists"  value={stats.uniqueArtists.toString()} />
            <StatCard icon={<Clock size={18} />}     label="Avg Tempo"       value={stats.avgTempo ? `${stats.avgTempo} BPM` : '—'} />
            <StatCard icon={<Tag size={18} />}       label="Unique Tags"     value={stats.uniqueTags.toString()} />
          </div>

          {/* Favorites and set lists — prominent side-by-side cards */}
          <Card
            title="Favorite Songs"
            icon={<Star size={16} />}
            action={favorites.length > 0 ? { label: 'Perform', icon: <Play size={12} />, onClick: () => navigate('/favorites/perform') } : undefined}
          >
            {favorites.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No favorites yet. Right-click a song and choose &ldquo;Add to favorites&rdquo;.
              </p>
            ) : (
              <ul className="flex flex-col">
                {recentFavorites.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => navigate(`/song/${s.id}?favorite=1`)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-left hover:bg-[var(--surface-elevated)] transition-colors"
                    >
                      <Star size={12} style={{ color: 'var(--accent)' }} fill="currentColor" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(s.title)}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {s.artist ? toTitleCase(s.artist) : 'Unknown artist'}
                          {s.key ? ` · ${s.key}` : ''}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
                {favorites.length > recentFavorites.length && (
                  <li>
                    <button
                      onClick={() => navigate('/favorites')}
                      className="w-full text-xs py-1.5 mt-1 hover:underline"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      View all {favorites.length} favorites →
                    </button>
                  </li>
                )}
              </ul>
            )}
          </Card>

          <Card title="Your Set Lists" icon={<ListMusic size={16} />}>
            {setlists.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No set lists yet. Create one from the Set Lists page.
              </p>
            ) : (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  {setlists.length} set list{setlists.length === 1 ? '' : 's'} · {totalSetlistEntries} total song{totalSetlistEntries === 1 ? '' : 's'}
                </p>
                <ul className="flex flex-col">
                  {recentSetlists.slice(0, 8).map((sl) => {
                    const count = setlistCounts[sl.id] ?? 0;
                    return (
                      <li key={sl.id} className="flex items-center gap-1 group">
                        <button
                          onClick={() => navigate(`/setlists/${sl.id}`)}
                          className="flex-1 flex items-center gap-2 py-1.5 px-2 rounded text-left hover:bg-[var(--surface-elevated)] transition-colors"
                        >
                          <ListMusic size={12} style={{ color: 'var(--text-muted)' }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(sl.name)}</div>
                            {sl.date && (
                              <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                                {new Date(sl.date).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                            {count} song{count === 1 ? '' : 's'}
                          </span>
                        </button>
                        {count > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/setlists/${sl.id}/player`); }}
                            className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
                            title="Perform this set list"
                          >
                            <Play size={12} style={{ color: 'var(--accent)' }} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {setlists.length > 8 && (
                    <li>
                      <button
                        onClick={() => navigate('/setlists')}
                        className="w-full text-xs py-1.5 mt-1 hover:underline"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        View all {setlists.length} set lists →
                      </button>
                    </li>
                  )}
                </ul>
              </>
            )}
          </Card>

          <BarCard
            title="Difficulty"
            icon={<Star size={16} />}
            items={stats.difficulty}
            onItemClick={(v) => navigate(`/categories/difficulty/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/difficulty/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Top Keys"
            icon={<Hash size={16} />}
            items={stats.topKeys}
            onItemClick={(v) => navigate(`/categories/key/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/key/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Top Genres"
            icon={<Music size={16} />}
            items={stats.topGenres}
            onItemClick={(v) => navigate(`/categories/genre/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/genre/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Top Artists"
            icon={<User size={16} />}
            items={stats.topArtists}
            onItemClick={(v) => navigate(`/categories/artist/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/artist/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Languages"
            icon={<Globe2 size={16} />}
            items={stats.languages}
            onItemClick={(v) => navigate(`/categories/language/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/language/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Songs by Decade"
            icon={<Calendar size={16} />}
            items={stats.decades}
            onItemClick={(v) => navigate(`/categories/decade/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/decade/${encodeURIComponent(v)}/perform`)}
          />

          <BarCard
            title="Popular Tags"
            icon={<Tag size={16} />}
            items={stats.topTags}
            onItemClick={(v) => navigate(`/categories/tags/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/tags/${encodeURIComponent(v)}/perform`)}
          />

          <Card title="Recently Added" icon={<Calendar size={16} />}>
            {stats.recent.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No recent songs.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {stats.recent.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => navigate(`/song/${s.id}`)}
                      className="w-full text-left py-2 hover:bg-[var(--surface-elevated)] rounded px-2"
                    >
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{toTitleCase(s.title)}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {s.artist ? toTitleCase(s.artist) : 'Unknown artist'}
                        {s.key ? ` · ${s.key}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Stat computation ──────────────────────────────────────────────────────

type BarItem = { label: string; count: number; value?: string };

interface Stats {
  total: number;
  uniqueArtists: number;
  uniqueTags: number;
  avgTempo: number | null;
  difficulty: BarItem[];
  topKeys: BarItem[];
  topGenres: BarItem[];
  topArtists: BarItem[];
  languages: BarItem[];
  decades: BarItem[];
  topTags: BarItem[];
  recent: Song[];
}

function computeStats(songs: Song[]): Stats {
  const tallyInto = (m: Map<string, number>, key: string | undefined | null) => {
    if (!key) return;
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  const toSorted = (m: Map<string, number>, limit?: number): BarItem[] => {
    const arr = [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    return limit ? arr.slice(0, limit) : arr;
  };

  const artists = new Map<string, number>();
  const genres = new Map<string, number>();
  const keys = new Map<string, number>();
  const languages = new Map<string, number>();
  const tags = new Map<string, number>();
  const decades = new Map<string, number>();
  const difficultyCounts = new Array<number>(6).fill(0);
  let tempoSum = 0;
  let tempoCount = 0;

  for (const s of songs) {
    tallyInto(artists, s.artist);
    tallyInto(genres, s.genre);
    tallyInto(keys, s.key);
    tallyInto(languages, s.language);
    for (const t of s.tags ?? []) tallyInto(tags, t);
    if (s.year) {
      const d = `${Math.floor(s.year / 10) * 10}s`;
      tallyInto(decades, d);
    }
    if (s.difficulty && s.difficulty >= 1 && s.difficulty <= 5) difficultyCounts[s.difficulty]++;
    if (s.tempo) { tempoSum += s.tempo; tempoCount++; }
  }

  const difficulty: BarItem[] = [];
  for (let i = 1; i <= 5; i++) {
    difficulty.push({ label: DIFFICULTY_LABELS[i], count: difficultyCounts[i], value: String(i) });
  }

  const recent = [...songs]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  // Decades sorted chronologically (newest first).
  const decadesSorted = [...decades.entries()]
    .sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
    .map(([label, count]) => ({ label, count }));

  return {
    total: songs.length,
    uniqueArtists: artists.size,
    uniqueTags: tags.size,
    avgTempo: tempoCount > 0 ? Math.round(tempoSum / tempoCount) : null,
    difficulty,
    topKeys: toSorted(keys, 8),
    topGenres: toSorted(genres, 8),
    topArtists: toSorted(artists, 8),
    languages: toSorted(languages),
    decades: decadesSorted,
    topTags: toSorted(tags, 10),
    recent,
  };
}

// ─── Reusable cards ────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
}): React.ReactElement {
  const content = (
    <>
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </>
  );
  const className = 'p-4 rounded-lg border flex flex-col gap-1 text-left';
  const style: React.CSSProperties = { background: 'var(--bg-secondary)', borderColor: 'var(--border)' };
  return onClick ? (
    <button onClick={onClick} className={`${className} hover:border-[var(--accent)] transition-colors`} style={style}>
      {content}
    </button>
  ) : (
    <div className={className} style={style}>{content}</div>
  );
}

function Card({
  title, icon, action, children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: { label: string; icon?: React.ReactNode; onClick: () => void };
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="p-4 rounded-lg border"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {icon}
        <span className="flex-1">{title}</span>
        {action && (
          <button
            onClick={action.onClick}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {action.icon}
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function BarCard({
  title, icon, items, onItemClick, onItemPerform,
}: {
  title: string;
  icon: React.ReactNode;
  items: BarItem[];
  onItemClick?: (value: string) => void;
  onItemPerform?: (value: string) => void;
}): React.ReactElement {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1;
  return (
    <Card title={title} icon={icon}>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No data yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const pct = Math.round((it.count / max) * 100);
            const value = it.value ?? it.label;
            const row = (
              <div className="flex items-center gap-2">
                <span className="text-xs w-28 truncate" style={{ color: 'var(--text-secondary)' }}>
                  {toTitleCase(it.label)}
                </span>
                <div className="flex-1 relative h-4 rounded overflow-hidden" style={{ background: 'var(--surface-elevated)' }}>
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${pct}%`, background: 'var(--accent)' }}
                  />
                </div>
                <span className="text-xs font-mono w-8 text-right" style={{ color: 'var(--text-muted)' }}>{it.count}</span>
              </div>
            );
            return (
              <li key={it.label} className="flex items-center gap-1 group">
                {onItemClick ? (
                  <button
                    onClick={() => onItemClick(value)}
                    className="flex-1 text-left hover:opacity-90"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex-1">{row}</div>
                )}
                {onItemPerform && it.count > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onItemPerform(value); }}
                    className="p-1 rounded hover:bg-[var(--surface-elevated)]"
                    title={`Perform all ${it.count} song${it.count === 1 ? '' : 's'}`}
                  >
                    <Play size={12} style={{ color: 'var(--accent)' }} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
