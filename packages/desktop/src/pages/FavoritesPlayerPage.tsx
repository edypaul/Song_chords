import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useSongStore } from '@song-chords/shared';
import PerformPage, { type PerformItem } from '../components/song/PerformPage';
import { db } from '../ipc/ipc-client';
import { parseSortFromSearch, sortSongs } from '../utils/song-sort';
import { useT } from '../i18n';

export default function FavoritesPlayerPage(): React.ReactElement {
  const t = useT();
  const songs = useSongStore((s) => s.songs);
  const favoriteEntries = useSongStore((s) => s.favoriteEntries);
  const updateFavoriteEntry = useSongStore((s) => s.updateFavoriteEntry);
  const [searchParams] = useSearchParams();
  const { field, dir } = parseSortFromSearch(searchParams);

  // Match the list-page ordering after user sorting; fall back to title-asc.
  const favorites = useMemo(
    () => sortSongs(songs.filter((s) => s.favorite), field, dir),
    [songs, field, dir],
  );

  const items = useMemo<PerformItem[]>(
    () => favorites.map((s) => {
      const entry = favoriteEntries[s.id];
      return {
        id: s.id,
        type: 'song',
        song: s,
        overrides: entry
          ? { transpose: entry.transpose, capo: entry.capo, key: entry.key, tempo: entry.tempo, timeSig: entry.timeSig }
          : undefined,
      };
    }),
    [favorites, favoriteEntries],
  );

  return (
    <PerformPage
      title={t('favoritesPlayer.title')}
      icon={<Star size={14} style={{ color: 'var(--accent)' }} fill="currentColor" />}
      items={items}
      exitTo="/favorites"
      onOverridesChange={(songId, { transpose, capo }) => {
        void updateFavoriteEntry(db, songId, { transpose, capo });
      }}
      emptyState={<>
        <Star size={36} style={{ opacity: 0.4 }} />
        <p>{t('favoritesPlayer.empty')}</p>
      </>}
    />
  );
}
