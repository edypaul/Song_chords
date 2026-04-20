import { create } from 'zustand';
import type { IDatabase } from '../db/db-interface';
import { SetListRepository } from '../db/setlist-repository';
import { SongRepository } from '../db/song-repository';
import type { SetList, SetListCreateInput, SetListEntry, SetListWithSongs } from '../types/setlist.types';

interface SetListStore {
  setlists: SetList[];
  activeSetList: SetListWithSongs | null;
  activeEntryIndex: number;
  isLoading: boolean;

  loadSetLists: (db: IDatabase) => Promise<void>;
  createSetList: (db: IDatabase, input: SetListCreateInput) => Promise<SetList>;
  updateSetList: (db: IDatabase, id: string, patch: Partial<Pick<SetList, 'name' | 'description' | 'date'>>) => Promise<void>;
  deleteSetList: (db: IDatabase, id: string) => Promise<void>;
  openSetList: (db: IDatabase, id: string) => Promise<void>;
  closeSetList: () => void;
  addSongToSetList: (db: IDatabase, setlistId: string, songId: string) => Promise<void>;
  removeSongFromSetList: (db: IDatabase, entryId: string) => Promise<void>;
  reorderSetList: (db: IDatabase, setlistId: string, orderedEntryIds: string[]) => Promise<void>;
  updateEntry: (
    db: IDatabase,
    entryId: string,
    overrides: Partial<Pick<SetListEntry, 'transpose' | 'capo' | 'key' | 'tempo' | 'timeSig' | 'notes'>>,
  ) => Promise<void>;
  nextSong: () => void;
  prevSong: () => void;
  goToSong: (index: number) => void;
}

export const useSetListStore = create<SetListStore>((set, get) => ({
  setlists: [],
  activeSetList: null,
  activeEntryIndex: 0,
  isLoading: false,

  loadSetLists: async (db) => {
    set({ isLoading: true });
    const repo = new SetListRepository(db);
    const setlists = await repo.getAll();
    set({ setlists, isLoading: false });
  },

  createSetList: async (db, input) => {
    const repo = new SetListRepository(db);
    const setlist = await repo.create(input);
    set((s) => ({ setlists: [setlist, ...s.setlists] }));
    return setlist;
  },

  updateSetList: async (db, id, patch) => {
    const repo = new SetListRepository(db);
    await repo.update(id, patch);
    set((s) => ({
      setlists: s.setlists.map((sl) => sl.id === id ? { ...sl, ...patch, updatedAt: Date.now() } : sl),
      activeSetList: s.activeSetList?.id === id ? { ...s.activeSetList, ...patch, updatedAt: Date.now() } : s.activeSetList,
    }));
  },

  deleteSetList: async (db, id) => {
    const repo = new SetListRepository(db);
    await repo.delete(id);
    set((s) => ({ setlists: s.setlists.filter((sl) => sl.id !== id) }));
  },

  openSetList: async (db, id) => {
    set({ isLoading: true });
    const slRepo = new SetListRepository(db);
    const songRepo = new SongRepository(db);
    const setlist = await slRepo.getById(id);
    if (!setlist) { set({ isLoading: false }); return; }

    const entries = await slRepo.getEntries(id);
    const entriesWithSongs = await Promise.all(
      entries.map(async (entry) => {
        const song = await songRepo.getById(entry.songId);
        return song ? { ...entry, song } : null;
      }),
    );

    const activeSetList: SetListWithSongs = {
      ...setlist,
      entries: entriesWithSongs.filter(Boolean) as SetListWithSongs['entries'],
    };

    set({ activeSetList, activeEntryIndex: 0, isLoading: false });
  },

  closeSetList: () => set({ activeSetList: null, activeEntryIndex: 0 }),

  addSongToSetList: async (db, setlistId, songId) => {
    // Snapshot the song's current state so the entry stays independent of
    // future edits to the original song.
    const songRepo = new SongRepository(db);
    const song = await songRepo.getById(songId);
    const snapshot = song ? {
      transpose: song.preferences?.transposeSteps ?? 0,
      capo: song.capo ?? 0,
      key: song.key,
      tempo: song.tempo,
      timeSig: song.timeSig,
    } : undefined;
    const repo = new SetListRepository(db);
    await repo.addEntry(setlistId, songId, snapshot);
    // Only refresh the active setlist if it's the one we just modified —
    // otherwise actions from a context menu would silently switch what the
    // user is viewing.
    const { activeSetList } = get();
    if (activeSetList && activeSetList.id === setlistId) {
      await get().openSetList(db, setlistId);
    }
  },

  removeSongFromSetList: async (db, entryId) => {
    const { activeSetList } = get();
    const repo = new SetListRepository(db);
    await repo.removeEntry(entryId);
    if (activeSetList) {
      set({
        activeSetList: {
          ...activeSetList,
          entries: activeSetList.entries.filter((e) => e.id !== entryId),
        },
      });
    }
  },

  reorderSetList: async (db, setlistId, orderedEntryIds) => {
    const repo = new SetListRepository(db);
    await repo.reorderEntries(setlistId, orderedEntryIds);
    await get().openSetList(db, setlistId);
  },

  updateEntry: async (db, entryId, overrides) => {
    const repo = new SetListRepository(db);
    await repo.updateEntrySettings(entryId, overrides);
    const { activeSetList } = get();
    if (!activeSetList) return;
    set({
      activeSetList: {
        ...activeSetList,
        entries: activeSetList.entries.map((e) =>
          e.id === entryId ? { ...e, ...overrides } : e,
        ),
      },
    });
  },

  nextSong: () => {
    const { activeSetList, activeEntryIndex } = get();
    if (!activeSetList) return;
    const max = activeSetList.entries.length - 1;
    if (activeEntryIndex < max) {
      set({ activeEntryIndex: activeEntryIndex + 1 });
    }
  },

  prevSong: () => {
    const { activeEntryIndex } = get();
    if (activeEntryIndex > 0) {
      set({ activeEntryIndex: activeEntryIndex - 1 });
    }
  },

  goToSong: (index) => {
    const { activeSetList } = get();
    if (!activeSetList) return;
    const clamped = Math.max(0, Math.min(index, activeSetList.entries.length - 1));
    set({ activeEntryIndex: clamped });
  },
}));
