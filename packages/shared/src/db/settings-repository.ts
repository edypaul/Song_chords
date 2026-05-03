import type { IDatabase } from './db-interface';
import type { AppSettings } from '../types/settings.types';
import { DEFAULT_SETTINGS } from '../constants/default-settings';

export class SettingsRepository {
  constructor(private db: IDatabase) {}

  async load(): Promise<AppSettings> {
    const rows = await this.db.query<{ key: string; value: string }>('SELECT key, value FROM settings');
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value) as unknown;
        if (row.key === 'songViewStyle' && typeof parsed === 'object' && parsed !== null) {
          // Deep-merge with defaults so old flat structures get filled in
          const def = DEFAULT_SETTINGS.songViewStyle;
          const raw = parsed as Record<string, unknown>;
          settings.songViewStyle = {
            preset: (raw.preset as string) ?? def.preset,
            fontFamily: (raw.fontFamily as string) ?? def.fontFamily,
            titleUppercase: (raw.titleUppercase as boolean) ?? def.titleUppercase,
            sectionUppercase: (raw.sectionUppercase as boolean) ?? def.sectionUppercase,
            lyrics:  { ...def.lyrics,  ...(raw.lyrics as object ?? {}) },
            chords:  { ...def.chords,  ...(raw.chords as object ?? {}) },
            title:   { ...def.title,   ...(raw.title as object ?? {}) },
            details: { ...def.details, ...(raw.details as object ?? {}) },
            section: { ...def.section, ...(raw.section as object ?? {}) },
            chorusBorderColor: (raw.chorusBorderColor as string) ?? def.chorusBorderColor,
          };
        } else if (row.key === 'shortcuts' && typeof parsed === 'object' && parsed !== null) {
          // Merge with defaults so new actions added in later versions are
          // populated automatically instead of being missing/undefined.
          settings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...(parsed as object) };
        } else {
          (settings as unknown as Record<string, unknown>)[row.key] = parsed;
        }
      } catch {
        // skip invalid
      }
    }
    return settings;
  }

  async set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.db.execute(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, serialized],
    );
  }

  async save(settings: Partial<AppSettings>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
    }
  }
}
