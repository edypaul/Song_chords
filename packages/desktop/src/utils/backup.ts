import type {
  Song, SetList, SetListEntry, FavoriteEntry, ChordDiagram, CustomPreset, IDatabase,
} from '@song-chords/shared';
import { SongRepository, SetListRepository, FavoriteRepository } from '@song-chords/shared';

// ─── Generic file helpers ──────────────────────────────────────────────────

/** Download arbitrary JSON as a file via a blob + anchor click. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Prompts the user to pick a JSON file and returns its parsed contents. */
export function pickJsonFile<T>(): Promise<T | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result as string) as T);
        } catch (e) {
          console.error('Invalid JSON backup file', e);
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

export function timestampSlug(): string {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// ─── Songs library backup ──────────────────────────────────────────────────

export interface LibraryBackup {
  version: 1;
  exportedAt: number;
  songs: Song[];
  setlists: SetList[];
  setlistEntries: SetListEntry[];
  favoriteEntries: FavoriteEntry[];
}

export async function exportLibrary(db: IDatabase): Promise<LibraryBackup> {
  const songRepo = new SongRepository(db);
  const slRepo = new SetListRepository(db);
  const favRepo = new FavoriteRepository(db);

  const [songs, setlists, favoriteEntries] = await Promise.all([
    songRepo.getAll(),
    slRepo.getAll(),
    favRepo.getAll(),
  ]);

  const entryLists = await Promise.all(setlists.map((sl) => slRepo.getEntries(sl.id)));
  const setlistEntries = entryLists.flat();

  return {
    version: 1,
    exportedAt: Date.now(),
    songs,
    setlists,
    setlistEntries,
    favoriteEntries,
  };
}

/**
 * Replaces the library with the contents of the backup. Wipes songs + setlists
 * (cascading to setlist_entries and favorite_entries), then re-inserts every
 * row preserving original IDs so cross-references stay intact.
 */
export async function importLibrary(db: IDatabase, backup: LibraryBackup): Promise<void> {
  // Delete children first, then parents. Explicit order avoids relying on
  // FK cascade (sql.js's PRAGMA foreign_keys behaviour is inconsistent and
  // stale rows would collide with the backup's IDs on insert).
  await db.execute('DELETE FROM favorite_entries', []);
  await db.execute('DELETE FROM setlist_entries', []);
  await db.execute('DELETE FROM setlists', []);
  await db.execute('DELETE FROM songs', []);

  for (const s of backup.songs ?? []) {
    await db.execute(
      `INSERT INTO songs (id, title, artist, album, key, tempo, time_sig, capo, genre, year, language, duration,
        notes, content, content_format, tags, difficulty, favorite, preferences, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id, s.title, s.artist ?? null, s.album ?? null, s.key ?? null,
        s.tempo ?? null, s.timeSig ?? null, s.capo,
        s.genre ?? null, s.year ?? null, s.language ?? null,
        s.duration ?? null, s.notes ?? null,
        s.content, 'chordpro', JSON.stringify(s.tags ?? []),
        s.difficulty ?? null,
        s.favorite ? 1 : 0,
        JSON.stringify(s.preferences ?? {}),
        s.createdAt, s.updatedAt, s.sortOrder,
      ],
    );
  }

  for (const sl of backup.setlists ?? []) {
    await db.execute(
      'INSERT INTO setlists (id, name, description, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [sl.id, sl.name, sl.description ?? null, sl.date ?? null, sl.createdAt, sl.updatedAt],
    );
  }

  for (const e of backup.setlistEntries ?? []) {
    await db.execute(
      `INSERT INTO setlist_entries (id, setlist_id, song_id, position, transpose, capo, key, tempo, time_sig, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id, e.setlistId, e.songId, e.position,
        e.transpose, e.capo,
        e.key ?? null, e.tempo ?? null, e.timeSig ?? null,
        e.notes ?? null,
      ],
    );
  }

  for (const f of backup.favoriteEntries ?? []) {
    await db.execute(
      `INSERT INTO favorite_entries (song_id, transpose, capo, key, tempo, time_sig, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        f.songId, f.transpose, f.capo,
        f.key ?? null, f.tempo ?? null, f.timeSig ?? null,
        f.addedAt,
      ],
    );
  }
}

// ─── Custom chords / presets backup ────────────────────────────────────────

export interface CustomChordsBackup {
  version: 1;
  exportedAt: number;
  customChords: Record<string, ChordDiagram[]>;
}

export interface CustomPresetsBackup {
  version: 1;
  exportedAt: number;
  customPresets: Record<string, CustomPreset>;
}

export function buildChordsBackup(customChords: Record<string, ChordDiagram[]>): CustomChordsBackup {
  return { version: 1, exportedAt: Date.now(), customChords };
}

export function buildPresetsBackup(customPresets: Record<string, CustomPreset>): CustomPresetsBackup {
  return { version: 1, exportedAt: Date.now(), customPresets };
}
