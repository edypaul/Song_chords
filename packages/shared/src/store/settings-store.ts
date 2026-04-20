import { create } from 'zustand';
import type { IDatabase } from '../db/db-interface';
import { SettingsRepository } from '../db/settings-repository';
import type { AppSettings } from '../types/settings.types';
import { DEFAULT_SETTINGS } from '../constants/default-settings';

interface SettingsStore {
  settings: AppSettings;
  isLoaded: boolean;
  loadSettings: (db: IDatabase) => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(db: IDatabase, key: K, value: AppSettings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoaded: false,

  loadSettings: async (db) => {
    const repo = new SettingsRepository(db);
    const settings = await repo.load();
    set({ settings, isLoaded: true });
  },

  updateSetting: async (db, key, value) => {
    const repo = new SettingsRepository(db);
    await repo.set(key, value);
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
  },
}));
