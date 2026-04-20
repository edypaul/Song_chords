export interface Migration {
  version: number;
  up: string;
}

export interface IDatabase {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  runMigrations(migrations: Migration[]): Promise<void>;
  close(): Promise<void>;
}
