import type { Migration } from './db-interface';

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
  favorite       INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS setlist_entries (
  id          TEXT PRIMARY KEY,
  setlist_id  TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  transpose   INTEGER NOT NULL DEFAULT 0,
  capo        INTEGER NOT NULL DEFAULT 0,
  key         TEXT,
  tempo       INTEGER,
  time_sig    TEXT,
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
];
