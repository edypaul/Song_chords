import type { IDatabase, Migration } from '@song-chords/shared';

export class ElectronIPCDatabase implements IDatabase {
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return window.electronAPI.db.query(sql, params) as Promise<T[]>;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await window.electronAPI.db.execute(sql, params);
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    return window.electronAPI.db.queryOne(sql, params) as Promise<T | null>;
  }

  async runMigrations(_migrations: Migration[]): Promise<void> {
    // Migrations are run in the main process at startup
  }

  async close(): Promise<void> {
    // Main process manages lifecycle
  }
}

export const db = new ElectronIPCDatabase();
