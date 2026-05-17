import { join, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { app } from 'electron';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import type { IDatabase, Migration } from '@song-chords/shared';

class SqlJsAdapter implements IDatabase {
  private db: Database;
  private dbPath: string;

  constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  private persist(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    this.persist();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return results;
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    let result: T | null = null;
    if (stmt.step()) {
      result = stmt.getAsObject() as unknown as T;
    }
    stmt.free();
    return result;
  }

  async runMigrations(migrations: Migration[]): Promise<void> {
    // Create version table
    this.db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);

    const stmt = this.db.prepare('SELECT version FROM schema_version LIMIT 1');
    let currentVersion = 0;
    if (stmt.step()) {
      currentVersion = (stmt.getAsObject() as { version: number }).version ?? 0;
    }
    stmt.free();

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        try {
          // exec handles multi-statement DDL (no params)
          this.db.exec(migration.up);
        } catch (err) {
          // Self-heal known idempotent failures. A buggy earlier
          // build shipped the `position` column in BOTH the v1 DDL
          // and migration v14, so on databases it created the v14
          // `ALTER TABLE ... ADD COLUMN position` throws "duplicate
          // column name: position". The schema is already in the
          // desired shape in that case, so swallow ONLY that error
          // and let the migration be recorded as applied. Any other
          // migration error still aborts startup (data-loss safety).
          const msg = err instanceof Error ? err.message : String(err);
          if (!/duplicate column name/i.test(msg)) {
            throw err;
          }
        }
        if (currentVersion === 0) {
          this.db.run('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
        } else {
          this.db.run('UPDATE schema_version SET version = ?', [migration.version]);
        }
        currentVersion = migration.version;
      }
    }

    this.persist();
  }

  async close(): Promise<void> {
    this.persist();
    this.db.close();
  }
}

let dbInstance: IDatabase | null = null;

export async function setupDatabase(): Promise<IDatabase> {
  if (dbInstance) return dbInstance;

  const userDataPath = app.getPath('userData');
  const dbPath = join(userDataPath, 'song-chords.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  // Resolve the WASM file relative to sql.js's own dist folder,
  // using Node's module resolution so it works regardless of __dirname location.
  const sqlJsDistDir = dirname(require.resolve('sql.js/dist/sql-wasm.js'));
  const SQL = await initSqlJs({ locateFile: (file: string) => join(sqlJsDistDir, file) });

  let rawDb: Database;
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  // Enable WAL-equivalent pragmas
  rawDb.run('PRAGMA foreign_keys = ON;');

  dbInstance = new SqlJsAdapter(rawDb, dbPath);
  return dbInstance;
}
