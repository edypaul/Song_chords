import React, { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSongStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import PerformPage, { type PerformItem } from '../components/song/PerformPage';
import { toTitleCase } from '../utils/text';
import { parseSortFromSearch, sortSongs } from '../utils/song-sort';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

type CategoryKey = 'artist' | 'genre' | 'key' | 'difficulty' | 'tags' | 'year' | 'decade' | 'language';

const CATEGORY_LABEL_KEYS: Record<CategoryKey, TKey> = {
  artist:     'categories.tabs.artist',
  genre:      'categories.tabs.genre',
  key:        'categories.tabs.key',
  difficulty: 'categories.tabs.difficulty',
  tags:       'categories.tabs.tags',
  year:       'categories.tabs.year',
  decade:     'categories.tabs.decade',
  language:   'categories.tabs.language',
};

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

export default function CategoryPlayerPage(): React.ReactElement {
  const t = useT();
  const { category, value } = useParams<{ category: CategoryKey; value: string }>();
  const songs = useSongStore((s) => s.songs);
  const [searchParams] = useSearchParams();
  const { field, dir } = parseSortFromSearch(searchParams);

  const decoded = value ? decodeURIComponent(value) : '';
  // Filter, then apply the same sort the user chose on the list page.
  const matches = useMemo(() => {
    if (!category) return [];
    const filtered = songs.filter((s) => extractValues(category, s).includes(decoded));
    return sortSongs(filtered, field, dir);
  }, [category, decoded, songs, field, dir]);

  const items = useMemo<PerformItem[]>(
    () => matches.map((s) => ({ id: s.id, type: 'song', song: s })),
    [matches],
  );

  const categoryLabel = category ? t(CATEGORY_LABEL_KEYS[category]) : '';
  const title = decoded
    ? t('categoryPlayer.titleWithValue', { category: categoryLabel, value: toTitleCase(decoded) })
    : categoryLabel;

  // Return to the category list rather than history-back so a
  // Perform → Edit → Perform round-trip doesn't leave the close X
  // pointing at the Edit page.
  const exitTo = category ? `/categories/${category}` : '/categories';

  return <PerformPage title={title} items={items} exitTo={exitTo} />;
}
