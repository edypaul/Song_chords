import type { Migration } from './db-interface';

// IMPORTANT: these DDLs are the v1 schema — they must match the table shape
// at the moment migration v1 runs, NOT the latest shape. Later migrations
// (v2…v10) ALTER / rebuild these tables to reach current form. If you add a
// column here to reflect a later migration, fresh installs will fail with
// "duplicate column" when that later ALTER runs.
export const SONGS_DDL = `
CREATE TABLE IF NOT EXISTS songs (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  artist         TEXT,
  album          TEXT,
  key            TEXT,
  tempo          INTEGER,
  time_sig       TEXT,
  capo           INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  content        TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'chordpro',
  tags           TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_songs_title  ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_key    ON songs(key);
`;

export const SETLISTS_DDL = `
CREATE TABLE IF NOT EXISTS setlists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  date        INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- NOTE: the position column (Set Lists drag-to-reorder) is added by
-- migration v14, NOT here. This DDL must stay frozen as the ORIGINAL
-- v1 schema. Adding new columns here makes fresh installs create the
-- column twice (via this DDL in migration v1, then again via the v14
-- ALTER), crashing with duplicate column name.

CREATE TABLE IF NOT EXISTS setlist_entries (
  id          TEXT PRIMARY KEY,
  setlist_id  TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  transpose   INTEGER NOT NULL DEFAULT 0,
  capo        INTEGER NOT NULL DEFAULT 0,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_setlist_entries_setlist ON setlist_entries(setlist_id);
CREATE INDEX IF NOT EXISTS idx_setlist_entries_song    ON setlist_entries(song_id);
`;

export const SETTINGS_DDL = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const FAVORITES_DDL = `
CREATE TABLE IF NOT EXISTS favorite_entries (
  song_id    TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  transpose  INTEGER NOT NULL DEFAULT 0,
  capo       INTEGER NOT NULL DEFAULT 0,
  key        TEXT,
  tempo      INTEGER,
  time_sig   TEXT,
  added_at   INTEGER NOT NULL
);
`;

export const SCHEMA_VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
`;

export const migrations: Migration[] = [
  {
    version: 1,
    up: `${SCHEMA_VERSION_DDL}${SONGS_DDL}${SETLISTS_DDL}${SETTINGS_DDL}`,
  },
  {
    version: 2,
    up: `
ALTER TABLE songs ADD COLUMN genre TEXT;
ALTER TABLE songs ADD COLUMN duration TEXT;
`,
  },
  {
    version: 3,
    up: `ALTER TABLE songs ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';`,
  },
  {
    version: 4,
    up: `ALTER TABLE songs ADD COLUMN difficulty INTEGER;`,
  },
  {
    version: 5,
    up: `ALTER TABLE songs ADD COLUMN year INTEGER;`,
  },
  {
    version: 6,
    up: `ALTER TABLE songs ADD COLUMN language TEXT;`,
  },
  {
    version: 7,
    up: `
ALTER TABLE setlist_entries ADD COLUMN key TEXT;
ALTER TABLE setlist_entries ADD COLUMN tempo INTEGER;
ALTER TABLE setlist_entries ADD COLUMN time_sig TEXT;
`,
  },
  {
    version: 8,
    up: `ALTER TABLE songs ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 9,
    up: FAVORITES_DDL,
  },
  {
    // Allow setlist entries to be either songs or free-form text notes.
    // SQLite can't loosen NOT NULL on song_id via ALTER, so we rebuild the
    // table and carry every existing row over as a 'song' entry.
    version: 10,
    up: `
CREATE TABLE setlist_entries_new (
  id          TEXT PRIMARY KEY,
  setlist_id  TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  song_id     TEXT REFERENCES songs(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'song',
  note_title  TEXT,
  note_body   TEXT,
  position    INTEGER NOT NULL,
  transpose   INTEGER NOT NULL DEFAULT 0,
  capo        INTEGER NOT NULL DEFAULT 0,
  key         TEXT,
  tempo       INTEGER,
  time_sig    TEXT,
  notes       TEXT
);
INSERT INTO setlist_entries_new (id, setlist_id, song_id, type, position, transpose, capo, key, tempo, time_sig, notes)
  SELECT id, setlist_id, song_id, 'song', position, transpose, capo, key, tempo, time_sig, notes FROM setlist_entries;
DROP TABLE setlist_entries;
ALTER TABLE setlist_entries_new RENAME TO setlist_entries;
CREATE INDEX IF NOT EXISTS idx_setlist_entries_setlist ON setlist_entries(setlist_id);
CREATE INDEX IF NOT EXISTS idx_setlist_entries_song    ON setlist_entries(song_id);
`,
  },
  {
    version: 11,
    up: `ALTER TABLE songs ADD COLUMN last_viewed_at INTEGER;`,
  },
  {
    version: 12,
    up: `ALTER TABLE songs ADD COLUMN link TEXT;`,
  },
  {
    version: 13,
    up: `ALTER TABLE songs ADD COLUMN audio_file TEXT;`,
  },
  {
    // User-controllable ordering for the Set Lists page.
    //
    // v14 is JUST the column add — kept isolated because a buggy
    // earlier build also put `position` in the v1 SETLISTS_DDL, so
    // on databases that build created this ALTER throws "duplicate
    // column name". The SqlJs adapter's runMigrations swallows ONLY
    // that specific error, so v14 records as applied either way and
    // the column exists afterwards regardless of which build made
    // the DB.
    version: 14,
    up: `ALTER TABLE setlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // v15 seeds initial ordering and the index. Both statements are
    // idempotent and safe on ANY database (whether `position` came
    // from v14 or pre-existed from the buggy v1 DDL): the UPDATE just
    // (re)assigns a sensible default order (updated_at DESC → smaller
    // position = nearer the top), and CREATE INDEX IF NOT EXISTS is
    // inherently a no-op when it already exists.
    version: 15,
    up: `
UPDATE setlists SET position = (
  SELECT COUNT(*) FROM setlists s2 WHERE s2.updated_at > setlists.updated_at OR (s2.updated_at = setlists.updated_at AND s2.id > setlists.id)
);
CREATE INDEX IF NOT EXISTS idx_setlists_position ON setlists(position);
`,
  },
];
