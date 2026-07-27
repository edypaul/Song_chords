import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Music, User, Tag, Star, Hash, Globe2, Calendar, ListMusic, Play, Eye, Pencil, SlidersHorizontal, RotateCcw } from 'lucide-react';
import type { Song, DashboardCardKey } from '@song-chords/shared';
import { useSongStore, useSetListStore, useSettingsStore, SetListRepository, DASHBOARD_CARDS } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import { toTitleCase } from '../utils/text';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

/** Dictionary key for each card's label in the Customize popover. */
const CARD_LABEL_KEYS: Record<DashboardCardKey, TKey> = {
  stats: 'dashboard.cards.stats',
  favorites: 'dashboard.cards.favorites',
  setlists: 'dashboard.cards.setlists',
  recentlyViewed: 'dashboard.cards.recentlyViewed',
  recentlyEdited: 'dashboard.cards.recentlyEdited',
  difficulty: 'dashboard.cards.difficulty',
  topKeys: 'dashboard.cards.topKeys',
  topGenres: 'dashboard.cards.topGenres',
  topArtists: 'dashboard.cards.topArtists',
  languages: 'dashboard.cards.languages',
  decades: 'dashboard.cards.decades',
  topTags: 'dashboard.cards.topTags',
  recentlyAdded: 'dashboard.cards.recentlyAdded',
};

/** Dictionary keys for the five difficulty tiers (indexed 1..5 as the
 *  song's `difficulty` field is stored). Index 0 is a placeholder that
 *  keeps the array aligned with the numeric level. */
const DIFFICULTY_KEYS: TKey[] = [
  'dashboard.difficulty.unset',
  'dashboard.difficulty.basic',
  'dashboard.difficulty.easy',
  'dashboard.difficulty.intermediate',
  'dashboard.difficulty.advanced',
  'dashboard.difficulty.professional',
];

export default function DashboardPage(): React.ReactElement {
  const t = useT();
  const songs = useSongStore((s) => s.songs);
  const setlists = useSetListStore((s) => s.setlists);
  const dashboardCards = useSettingsStore((s) => s.settings.dashboardCards);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const navigate = useNavigate();
  // True when the card key is enabled. Defensive `?? true` so any
  // legacy settings blob that lacks a key still shows the card.
  const show = (k: DashboardCardKey): boolean => dashboardCards?.[k] ?? true;
  const visibleCount = DASHBOARD_CARDS.filter(show).length;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeBtnRef = useRef<HTMLButtonElement>(null);

  const toggleCard = (k: DashboardCardKey, on: boolean) => {
    const next = { ...(dashboardCards ?? {}), [k]: on };
    void updateSetting(db, 'dashboardCards', next as Record<DashboardCardKey, boolean>);
  };
  const resetCards = () => {
    const all = Object.fromEntries(DASHBOARD_CARDS.map((k) => [k, true])) as Record<DashboardCardKey, boolean>;
    void updateSetting(db, 'dashboardCards', all);
  };

  // Song counts per setlist — fetched separately because the store keeps
  // only setlist metadata, not entries (entries load on demand).
  const [setlistCounts, setSetlistCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const repo = new SetListRepository(db);
    void repo.getEntryCounts().then(setSetlistCounts);
  }, [setlists.length]);

  const stats = useMemo(() => computeStats(songs, t), [songs, t]);
  const favorites = useMemo(() => songs.filter((s) => s.favorite), [songs]);
  const recentFavorites = useMemo(
    () => [...favorites].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [favorites],
  );
  const recentSetlists = useMemo(
    () => [...setlists].sort((a, b) => b.updatedAt - a.updatedAt),
    [setlists],
  );
  const recentlyViewed = useMemo(
    () => songs
      .filter((s): s is Song & { lastViewedAt: number } => typeof s.lastViewedAt === 'number')
      .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
      .slice(0, 8),
    [songs],
  );
  const recentlyEdited = useMemo(
    () => [...songs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [songs],
  );
  const totalSetlistEntries = useMemo(
    () => Object.values(setlistCounts).reduce((sum, c) => sum + c, 0),
    [setlistCounts],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header
        className="px-6 py-4 border-b flex items-center gap-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('dashboard.title')}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('dashboard.subtitle')}
          </p>
        </div>
        <button
          ref={customizeBtnRef}
          onClick={() => setCustomizeOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)', background: customizeOpen ? 'var(--surface-elevated)' : 'transparent' }}
          aria-expanded={customizeOpen}
          aria-label={t('dashboard.customizeAria')}
          title={t('dashboard.customizeTitle')}
        >
          <SlidersHorizontal size={14} />
          {t('dashboard.customize')}
        </button>
        {customizeOpen && (
          <CustomizePopover
            anchorRef={customizeBtnRef}
            dashboardCards={dashboardCards}
            onToggle={toggleCard}
            onReset={resetCards}
            onClose={() => setCustomizeOpen(false)}
          />
        )}
      </header>

      {songs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('dashboard.emptyLibrary')}
        </div>
      ) : visibleCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-10 gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          <p>{t('dashboard.allHidden')}</p>
          <button
            onClick={resetCards}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <RotateCcw size={13} /> {t('dashboard.showAllCards')}
          </button>
        </div>
      ) : (
        <div className="p-6 grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {/* Top stat cards */}
          {show('stats') && (
          <div className="col-span-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard icon={<Music size={18} />}     label={t('dashboard.stats.totalSongs')} value={stats.total.toString()}          onClick={() => navigate('/library')} />
            <StatCard icon={<Star size={18} />}      label={t('dashboard.stats.favorites')}  value={favorites.length.toString()}     onClick={() => navigate('/favorites')} />
            <StatCard icon={<User size={18} />}      label={t('dashboard.stats.artists')}    value={stats.uniqueArtists.toString()}  onClick={() => navigate('/categories/artist')} />
            <StatCard icon={<Music size={18} />}     label={t('dashboard.stats.genres')}     value={stats.uniqueGenres.toString()}   onClick={() => navigate('/categories/genre')} />
            <StatCard icon={<Tag size={18} />}       label={t('dashboard.stats.tags')}       value={stats.uniqueTags.toString()}     onClick={() => navigate('/categories/tags')} />
            <StatCard icon={<ListMusic size={18} />} label={t('dashboard.stats.setLists')}   value={setlists.length.toString()}      onClick={() => navigate('/setlists')} />
          </div>
          )}

          {/* Favorites and set lists — prominent side-by-side cards */}
          {show('favorites') && (
          <Card
            title={t('dashboard.favorites.title')}
            icon={<Star size={16} />}
            action={favorites.length > 0 ? { label: t('dashboard.favorites.perform'), icon: <Play size={12} />, onClick: () => navigate('/favorites/perform') } : undefined}
          >
            {favorites.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('dashboard.favorites.empty')}
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
                          {s.artist ? toTitleCase(s.artist) : t('dashboard.unknownArtist')}
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
                      {t('dashboard.favorites.viewAll', { count: favorites.length })}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </Card>
          )}

          {show('setlists') && (
          <Card title={t('dashboard.setlists.title')} icon={<ListMusic size={16} />}>
            {setlists.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('dashboard.setlists.empty')}
              </p>
            ) : (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  {t(setlists.length === 1 ? 'dashboard.setlists.summaryOne' : 'dashboard.setlists.summaryMany', { count: setlists.length, total: totalSetlistEntries })}
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
                            {t(count === 1 ? 'dashboard.setlists.songsOne' : 'dashboard.setlists.songsMany', { count })}
                          </span>
                        </button>
                        {count > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/setlists/${sl.id}/player`); }}
                            className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
                            title={t('dashboard.setlists.perform')}
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
                        {t('dashboard.setlists.viewAll', { count: setlists.length })}
                      </button>
                    </li>
                  )}
                </ul>
              </>
            )}
          </Card>
          )}

          {show('recentlyViewed') && (
          <Card title={t('dashboard.recentlyViewed.title')} icon={<Eye size={16} />}>
            {recentlyViewed.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('dashboard.recentlyViewed.empty')}
              </p>
            ) : (
              <ul className="flex flex-col">
                {recentlyViewed.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => navigate(`/song/${s.id}`)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-left hover:bg-[var(--surface-elevated)] transition-colors"
                    >
                      <Eye size={12} style={{ color: 'var(--text-muted)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(s.title)}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {s.artist ? toTitleCase(s.artist) : t('dashboard.unknownArtist')} · {relativeTime(s.lastViewedAt, t)}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}

          {show('recentlyEdited') && (
          <Card title={t('dashboard.recentlyEdited.title')} icon={<Pencil size={16} />}>
            {recentlyEdited.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('dashboard.recentlyEdited.empty')}
              </p>
            ) : (
              <ul className="flex flex-col">
                {recentlyEdited.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => navigate(`/song/${s.id}`)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-left hover:bg-[var(--surface-elevated)] transition-colors"
                    >
                      <Pencil size={12} style={{ color: 'var(--text-muted)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(s.title)}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {s.artist ? toTitleCase(s.artist) : t('dashboard.unknownArtist')} · {relativeTime(s.updatedAt, t)}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}

          {show('difficulty') && (
          <BarCard
            title={t('dashboard.difficulty.title')}
            icon={<Star size={16} />}
            items={stats.difficulty}
            onItemClick={(v) => navigate(`/categories/difficulty/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/difficulty/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('topKeys') && (
          <BarCard
            title={t('dashboard.topKeys.title')}
            icon={<Hash size={16} />}
            items={stats.topKeys}
            onItemClick={(v) => navigate(`/categories/key/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/key/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('topGenres') && (
          <BarCard
            title={t('dashboard.topGenres.title')}
            icon={<Music size={16} />}
            items={stats.topGenres}
            onItemClick={(v) => navigate(`/categories/genre/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/genre/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('topArtists') && (
          <BarCard
            title={t('dashboard.topArtists.title')}
            icon={<User size={16} />}
            items={stats.topArtists}
            onItemClick={(v) => navigate(`/categories/artist/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/artist/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('languages') && (
          <BarCard
            title={t('dashboard.languages.title')}
            icon={<Globe2 size={16} />}
            items={stats.languages}
            onItemClick={(v) => navigate(`/categories/language/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/language/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('decades') && (
          <BarCard
            title={t('dashboard.decades.title')}
            icon={<Calendar size={16} />}
            items={stats.decades}
            onItemClick={(v) => navigate(`/categories/decade/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/decade/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('topTags') && (
          <BarCard
            title={t('dashboard.topTags.title')}
            icon={<Tag size={16} />}
            items={stats.topTags}
            onItemClick={(v) => navigate(`/categories/tags/${encodeURIComponent(v)}`)}
            onItemPerform={(v) => navigate(`/categories/tags/${encodeURIComponent(v)}/perform`)}
          />
          )}

          {show('recentlyAdded') && (
          <Card title={t('dashboard.recentlyAdded.title')} icon={<Calendar size={16} />}>
            {stats.recent.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dashboard.recentlyAdded.empty')}</p>
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
                        {s.artist ? toTitleCase(s.artist) : t('dashboard.unknownArtist')}
                        {s.key ? ` · ${s.key}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Customize popover ─────────────────────────────────────────────────────

/**
 * Popover anchored to the Dashboard header's "Customize" button. Lists every
 * card key with a checkbox; toggling persists immediately via updateSetting.
 * Closes on outside-click or Escape. Portaled into document.body so the
 * header's overflow / sticky styles don't clip it.
 */
function CustomizePopover({
  anchorRef, dashboardCards, onToggle, onReset, onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement>;
  dashboardCards: Record<DashboardCardKey, boolean>;
  onToggle: (k: DashboardCardKey, on: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}): React.ReactElement | null {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Anchor under the button, right-aligned. Re-place on resize/scroll while
  // the popover is open so it stays glued to the trigger.
  useEffect(() => {
    const place = () => {
      const btn = anchorRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;
  const enabledCount = DASHBOARD_CARDS.filter((k) => dashboardCards?.[k] ?? true).length;
  return createPortal(
    <div
      ref={ref}
      className="fixed rounded-lg shadow-2xl py-2"
      style={{
        top: pos.top,
        right: pos.right,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        width: 260,
        maxHeight: '70vh',
        overflowY: 'auto',
        zIndex: 1000,
      }}
      role="dialog"
      aria-label={t('dashboard.customizePopoverAria')}
    >
      <div className="px-3 pb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          {t('dashboard.customizeHeader')}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {enabledCount} / {DASHBOARD_CARDS.length}
        </span>
      </div>
      <div className="px-1">
        {DASHBOARD_CARDS.map((k) => {
          const on = dashboardCards?.[k] ?? true;
          return (
            <label
              key={k}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--surface-elevated)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onToggle(k, e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-xs flex-1 truncate">{t(CARD_LABEL_KEYS[k])}</span>
            </label>
          );
        })}
      </div>
      <div className="border-t mt-1 pt-1 px-1" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={onReset}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <RotateCcw size={12} />
          {t('dashboard.showAllCards')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ─── Stat computation ──────────────────────────────────────────────────────

type BarItem = { label: string; count: number; value?: string };

interface Stats {
  total: number;
  uniqueArtists: number;
  uniqueGenres: number;
  uniqueTags: number;
  difficulty: BarItem[];
  topKeys: BarItem[];
  topGenres: BarItem[];
  topArtists: BarItem[];
  languages: BarItem[];
  decades: BarItem[];
  topTags: BarItem[];
  recent: Song[];
}

function computeStats(songs: Song[], t: (key: TKey) => string): Stats {
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
  }

  const difficulty: BarItem[] = [];
  for (let i = 1; i <= 5; i++) {
    difficulty.push({ label: t(DIFFICULTY_KEYS[i]), count: difficultyCounts[i], value: String(i) });
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
    uniqueGenres: genres.size,
    uniqueTags: tags.size,
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

function relativeTime(ts: number, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 0) return t('dashboard.time.justNow');
  const s = Math.floor(diff / 1000);
  if (s < 60) return t('dashboard.time.justNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('dashboard.time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('dashboard.time.hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('dashboard.time.daysAgo', { count: d });
  return new Date(ts).toLocaleDateString();
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
  const t = useT();
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1;
  return (
    <Card title={title} icon={icon}>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dashboard.noDataYet')}</p>
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
                    title={t(it.count === 1 ? 'dashboard.performAllOne' : 'dashboard.performAllMany', { count: it.count })}
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
