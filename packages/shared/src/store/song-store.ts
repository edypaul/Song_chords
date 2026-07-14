import { create } from 'zustand';
import type { IDatabase } from '../db/db-interface';
import { SongRepository } from '../db/song-repository';
import { FavoriteRepository } from '../db/favorite-repository';
import type { Song, SongCreateInput, SongUpdateInput, SongPreferences } from '../types/song.types';
import type { FavoriteEntry } from '../types/favorite.types';
import { usePlayerStore } from './player-store';
import { useSetListStore } from './setlist-store';

export type SortField =
  | 'title'
  | 'artist'
  | 'genre'
  | 'key'
  | 'difficulty'
  | 'tempo'
  | 'duration'
  | 'year'
  | 'language'
  | 'updatedAt'
  | 'createdAt'
  | 'chordsCount';

function durationToSeconds(d: string | undefined): number {
  if (!d) return -1;
  const parts = d.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

interface SongStore {
  songs: Song[];
  filteredSongs: Song[];
  /** Favorite entries keyed by song id — stores per-favorite overrides
   * (transpose, capo, etc.) so favoriting acts like a setlist entry. */
  favoriteEntries: Record<string, FavoriteEntry>;
  searchQuery: string;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
  filterKey: string | null;
  filterTags: string[];
  isLoading: boolean;
  error: string | null;

  loadSongs: (db: IDatabase) => Promise<void>;
  addSong: (db: IDatabase, input: SongCreateInput) => Promise<Song>;
  updateSong: (db: IDatabase, id: string, patch: SongUpdateInput) => Promise<void>;
  deleteSong: (db: IDatabase, id: string) => Promise<void>;
  markSongViewed: (db: IDatabase, id: string) => Promise<void>;
  savePreferences: (db: IDatabase, id: string, prefs: SongPreferences) => Promise<void>;
  /** Persist a song's annotations JSON (or clear it with `null`). Also
   *  mirrors the change onto the in-memory song so consumers re-render
   *  immediately — same pattern as savePreferences. */
  saveAnnotations: (db: IDatabase, id: string, annotations: string | null) => Promise<void>;
  toggleFavorite: (db: IDatabase, id: string) => Promise<void>;
  updateFavoriteEntry: (
    db: IDatabase,
    songId: string,
    overrides: Partial<Pick<FavoriteEntry, 'transpose' | 'capo' | 'key' | 'tempo' | 'timeSig'>>,
  ) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSortField: (field: SortField) => void;
  toggleSortDirection: () => void;
  setFilterKey: (key: string | null) => void;
  setFilterTags: (tags: string[]) => void;
}

function applyFilters(
  songs: Song[],
  query: string,
  key: string | null,
  tags: string[],
  sortField: SortField,
  sortDir: 'asc' | 'desc',
): Song[] {
  let result = [...songs];

  if (query) {
    const q = query.toLowerCase();
    result = result.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist?.toLowerCase().includes(q) ?? false),
    );
  }

  if (key) {
    result = result.filter((s) => s.key === key);
  }

  if (tags.length > 0) {
    result = result.filter((s) => tags.every((t) => s.tags.includes(t)));
  }

  const dir = sortDir === 'asc' ? 1 : -1;
  result.sort((a, b) => {
    // Numeric fields
    if (sortField === 'updatedAt') return (a.updatedAt - b.updatedAt) * dir;
    if (sortField === 'createdAt') return (a.createdAt - b.createdAt) * dir;
    if (sortField === 'difficulty' || sortField === 'tempo' || sortField === 'year' || sortField === 'chordsCount') {
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
    // String fields (title, artist, key, language) — unset sorts last.
    const av = ((a[sortField] ?? '') as string).toString();
    const bv = ((b[sortField] ?? '') as string).toString();
    if (!av && bv) return 1;
    if (av && !bv) return -1;
    return av.localeCompare(bv) * dir;
  });

  return result;
}

export const useSongStore = create<SongStore>((set, get) => ({
  songs: [],
  filteredSongs: [],
  favoriteEntries: {},
  searchQuery: '',
  sortField: 'title',
  sortDirection: 'asc',
  filterKey: null,
  filterTags: [],
  isLoading: false,
  error: null,

  loadSongs: async (db) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new SongRepository(db);
      const favRepo = new FavoriteRepository(db);
      const [songs, favEntries] = await Promise.all([repo.getAll(), favRepo.getAll()]);
      const favoriteEntries: Record<string, FavoriteEntry> = {};
      for (const e of favEntries) favoriteEntries[e.songId] = e;

      // Backfill: any song marked favorite=true but missing an entry (e.g.
      // favorited before migration v9 added the entries table) gets a
      // snapshot row created now. Otherwise transpose/capo saves would fall
      // through to the "save to song" branch.
      for (const song of songs) {
        if (song.favorite && !favoriteEntries[song.id]) {
          const entry = await favRepo.add(song.id, {
            transpose: song.preferences?.transposeSteps ?? 0,
            capo: song.capo ?? 0,
            key: song.key,
            tempo: song.tempo,
            timeSig: song.timeSig,
          });
          favoriteEntries[song.id] = entry;
        }
      }

      const { searchQuery, filterKey, filterTags, sortField, sortDirection } = get();
      set({
        songs,
        favoriteEntries,
        filteredSongs: applyFilters(songs, searchQuery, filterKey, filterTags, sortField, sortDirection),
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  addSong: async (db, input) => {
    const repo = new SongRepository(db);
    const song = await repo.create(input);
    set((state) => {
      const songs = [...state.songs, song];
      return {
        songs,
        filteredSongs: applyFilters(songs, state.searchQuery, state.filterKey, state.filterTags, state.sortField, state.sortDirection),
      };
    });
    return song;
  },

  updateSong: async (db, id, patch) => {
    const repo = new SongRepository(db);
    const updated = await repo.update(id, patch);
    if (!updated) return;
    set((state) => {
      const songs = state.songs.map((s) => (s.id === id ? updated : s));
      return {
        songs,
        filteredSongs: applyFilters(songs, state.searchQuery, state.filterKey, state.filterTags, state.sortField, state.sortDirection),
      };
    });
  },

  savePreferences: async (db, id, prefs) => {
    const repo = new SongRepository(db);
    await repo.savePreferences(id, prefs);
    // Update in-memory song without re-filtering (preferences don't affect sort/filter)
    set((state) => ({
      songs: state.songs.map((s) => (s.id === id ? { ...s, preferences: prefs } : s)),
      filteredSongs: state.filteredSongs.map((s) => (s.id === id ? { ...s, preferences: prefs } : s)),
    }));
  },

  saveAnnotations: async (db, id, annotations) => {
    const repo = new SongRepository(db);
    await repo.saveAnnotations(id, annotations);
    const next = annotations ?? undefined;
    // Same pattern as savePreferences — patch the in-memory song(s)
    // so any mounted component reading `song.annotations` re-renders
    // right away. No re-filter (annotations don't affect sort/filter).
    set((state) => ({
      songs: state.songs.map((s) => (s.id === id ? { ...s, annotations: next } : s)),
      filteredSongs: state.filteredSongs.map((s) => (s.id === id ? { ...s, annotations: next } : s)),
    }));
    // Mirror onto the player store's activeSong too. Both SongViewPage
    // and PerformPage source their active-song for rendering from
    // `usePlayerStore.activeSong`, and the cast-triggers subscription
    // watches the player store's slice — without this, the receiver
    // wouldn't re-push on a save and pages might read stale JSON.
    const player = usePlayerStore.getState();
    if (player.activeSong && player.activeSong.id === id) {
      usePlayerStore.setState({
        activeSong: { ...player.activeSong, annotations: next },
      });
    }
    // Also patch any currently-open setlist's entries that reference
    // this song. SetListPlayerPage builds PerformItems from
    // `activeSetList.entries[i].song`, which is a snapshot taken when
    // the setlist was opened — without this update, saving annotations
    // in one page wouldn't propagate to a setlist perform view of the
    // same song until it was re-opened.
    const setlist = useSetListStore.getState();
    if (setlist.activeSetList) {
      const touched = setlist.activeSetList.entries.some(
        (e) => e.type === 'song' && e.song?.id === id,
      );
      if (touched) {
        useSetListStore.setState({
          activeSetList: {
            ...setlist.activeSetList,
            entries: setlist.activeSetList.entries.map((e) => {
              if (e.type !== 'song' || e.song?.id !== id) return e;
              return { ...e, song: { ...e.song, annotations: next } };
            }),
          },
        });
      }
    }
  },

  toggleFavorite: async (db, id) => {
    const current = get().songs.find((s) => s.id === id);
    if (!current) return;
    const next = !current.favorite;
    const repo = new SongRepository(db);
    const favRepo = new FavoriteRepository(db);
    await repo.setFavorite(id, next);
    if (next) {
      // Snapshot the song's current state into the favorite entry so later
      // edits to the song don't leak into the favorites context.
      const entry = await favRepo.add(id, {
        transpose: current.preferences?.transposeSteps ?? 0,
        capo: current.capo ?? 0,
        key: current.key,
        tempo: current.tempo,
        timeSig: current.timeSig,
      });
      set((state) => ({
        songs: state.songs.map((s) => (s.id === id ? { ...s, favorite: true } : s)),
        filteredSongs: state.filteredSongs.map((s) => (s.id === id ? { ...s, favorite: true } : s)),
        favoriteEntries: { ...state.favoriteEntries, [id]: entry },
      }));
    } else {
      await favRepo.remove(id);
      set((state) => {
        const nextEntries = { ...state.favoriteEntries };
        delete nextEntries[id];
        return {
          songs: state.songs.map((s) => (s.id === id ? { ...s, favorite: false } : s)),
          filteredSongs: state.filteredSongs.map((s) => (s.id === id ? { ...s, favorite: false } : s)),
          favoriteEntries: nextEntries,
        };
      });
    }
  },

  updateFavoriteEntry: async (db, songId, overrides) => {
    const favRepo = new FavoriteRepository(db);
    await favRepo.update(songId, overrides);
    set((state) => {
      const existing = state.favoriteEntries[songId];
      if (!existing) return {};
      return {
        favoriteEntries: {
          ...state.favoriteEntries,
          [songId]: { ...existing, ...overrides },
        },
      };
    });
  },

  deleteSong: async (db, id) => {
    const repo = new SongRepository(db);
    await repo.delete(id);
    set((state) => {
      const songs = state.songs.filter((s) => s.id !== id);
      return {
        songs,
        filteredSongs: applyFilters(songs, state.searchQuery, state.filterKey, state.filterTags, state.sortField, state.sortDirection),
      };
    });
  },

  markSongViewed: async (db, id) => {
    const repo = new SongRepository(db);
    await repo.markViewed(id);
    const now = Date.now();
    set((state) => {
      const songs = state.songs.map((s) => s.id === id ? { ...s, lastViewedAt: now } : s);
      return {
        songs,
        filteredSongs: applyFilters(songs, state.searchQuery, state.filterKey, state.filterTags, state.sortField, state.sortDirection),
      };
    });
  },

  setSearchQuery: (searchQuery) => {
    set((state) => ({
      searchQuery,
      filteredSongs: applyFilters(state.songs, searchQuery, state.filterKey, state.filterTags, state.sortField, state.sortDirection),
    }));
  },

  setSortField: (sortField) => {
    set((state) => ({
      sortField,
      filteredSongs: applyFilters(state.songs, state.searchQuery, state.filterKey, state.filterTags, sortField, state.sortDirection),
    }));
  },

  toggleSortDirection: () => {
    set((state) => {
      const sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      return {
        sortDirection,
        filteredSongs: applyFilters(state.songs, state.searchQuery, state.filterKey, state.filterTags, state.sortField, sortDirection),
      };
    });
  },

  setFilterKey: (filterKey) => {
    set((state) => ({
      filterKey,
      filteredSongs: applyFilters(state.songs, state.searchQuery, filterKey, state.filterTags, state.sortField, state.sortDirection),
    }));
  },

  setFilterTags: (filterTags) => {
    set((state) => ({
      filterTags,
      filteredSongs: applyFilters(state.songs, state.searchQuery, state.filterKey, filterTags, state.sortField, state.sortDirection),
    }));
  },
}));
