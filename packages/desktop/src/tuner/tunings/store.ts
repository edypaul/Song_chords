import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TunerInstrument, TuningPreset } from './presets';

/**
 * Persistent storage for:
 *   - the user's custom tunings (per-instrument lists),
 *   - the active reference A4 frequency (calibration),
 *   - the last-used instrument + tuning + operating mode + device,
 *
 * so reopening the tuner lands the musician back where they left off.
 *
 * Storage is `localStorage` via Zustand's `persist` middleware — the
 * tuner is desktop-only renderer state and doesn't need to flow
 * through the SQLite backup pipeline (the user can re-create custom
 * tunings if they nuke localStorage; this isn't song data).
 */

export type TunerMode = 'auto' | 'instrument' | 'single-string' | 'custom';

export interface CustomTuning extends TuningPreset {
  /** Which instrument this custom tuning belongs to. */
  instrument: TunerInstrument;
  /** Unix ms — used for ordering "most-recent" in pickers. */
  createdAt: number;
  /** True when the user has explicitly favourited this tuning. */
  favorite?: boolean;
}

interface TunerStoreState {
  /** Reference frequency for A4. Defaults to 440 (concert pitch). */
  a4Hz: number;
  /** Last-used instrument. */
  instrument: TunerInstrument;
  /** Last-used tuning id (matches either a built-in preset or a custom). */
  tuningId: string;
  /** Operating mode. */
  mode: TunerMode;
  /** Single-string target note (used in single-string mode). */
  singleString: string;
  /** Last-used mic device id. */
  deviceId?: string;
  /** Prefer flat note spellings on the readout. */
  preferFlats: boolean;
  /**
   * Input sensitivity preset. Controls the silence-RMS gate inside
   * the PitchSmoother: LOW = ignores quieter input (less false-
   * positive humming), HIGH = picks up softer notes (acoustic /
   * fingerstyle). Maps to a concrete dB-ish threshold at the page.
   */
  sensitivity: 'low' | 'medium' | 'high';
  /**
   * Reference-tone sound. `instrument` = a synthesised plucked /
   * bowed string matching the selected instrument (the default);
   * `pure` = the plain sine reference tone.
   */
  toneStyle: 'instrument' | 'pure';
  /** Custom tunings keyed by id. */
  customTunings: Record<string, CustomTuning>;

  setA4Hz: (hz: number) => void;
  setInstrument: (i: TunerInstrument) => void;
  setTuningId: (id: string) => void;
  setMode: (m: TunerMode) => void;
  setSingleString: (note: string) => void;
  setDeviceId: (id: string | undefined) => void;
  setPreferFlats: (v: boolean) => void;
  setSensitivity: (s: 'low' | 'medium' | 'high') => void;
  setToneStyle: (s: 'instrument' | 'pure') => void;

  addCustomTuning: (t: Omit<CustomTuning, 'id' | 'createdAt'> & { id?: string }) => string;
  updateCustomTuning: (id: string, patch: Partial<Omit<CustomTuning, 'id' | 'createdAt'>>) => void;
  removeCustomTuning: (id: string) => void;
  toggleFavoriteTuning: (id: string) => void;
}

function makeId(): string {
  return 'ct_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const useTunerStore = create<TunerStoreState>()(
  persist(
    (set, get) => ({
      a4Hz: 440,
      instrument: 'guitar',
      tuningId: 'standard',
      mode: 'instrument',
      singleString: 'A4',
      deviceId: undefined,
      preferFlats: false,
      sensitivity: 'medium',
      toneStyle: 'instrument',
      customTunings: {},

      setA4Hz: (hz) => set({ a4Hz: clampA4(hz) }),
      setInstrument: (instrument) => set({ instrument }),
      setTuningId: (tuningId) => set({ tuningId }),
      setMode: (mode) => set({ mode }),
      setSingleString: (singleString) => set({ singleString }),
      setDeviceId: (deviceId) => set({ deviceId }),
      setPreferFlats: (preferFlats) => set({ preferFlats }),
      setSensitivity: (sensitivity) => set({ sensitivity }),
      setToneStyle: (toneStyle) => set({ toneStyle }),

      addCustomTuning: (t) => {
        const id = t.id ?? makeId();
        const tuning: CustomTuning = {
          id,
          name: t.name,
          notes: [...t.notes],
          instrument: t.instrument,
          createdAt: Date.now(),
          favorite: t.favorite ?? false,
        };
        set((s) => ({ customTunings: { ...s.customTunings, [id]: tuning } }));
        return id;
      },

      updateCustomTuning: (id, patch) => {
        const existing = get().customTunings[id];
        if (!existing) return;
        set((s) => ({
          customTunings: {
            ...s.customTunings,
            [id]: { ...existing, ...patch, notes: patch.notes ? [...patch.notes] : existing.notes },
          },
        }));
      },

      removeCustomTuning: (id) => {
        set((s) => {
          if (!s.customTunings[id]) return s;
          const next = { ...s.customTunings };
          delete next[id];
          // If the removed tuning was active, fall back to the
          // built-in standard for the active instrument; the page
          // resolves "unknown tuningId" gracefully but cleaning up
          // here avoids a transient "tuning not found" state.
          const tuningId = s.tuningId === id ? 'standard' : s.tuningId;
          return { customTunings: next, tuningId };
        });
      },

      toggleFavoriteTuning: (id) => {
        const existing = get().customTunings[id];
        if (!existing) return;
        set((s) => ({
          customTunings: {
            ...s.customTunings,
            [id]: { ...existing, favorite: !existing.favorite },
          },
        }));
      },
    }),
    {
      name: 'song-chords:tuner',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/** Pin A4 to a sane musical range so a typo (e.g. 4400) can't break
 *  the whole tuner. 300–500 Hz comfortably covers every historical
 *  / regional reference (baroque ~415, modern 440, sharp orchestras
 *  up to 445). */
export function clampA4(hz: number): number {
  if (!Number.isFinite(hz)) return 440;
  return Math.max(300, Math.min(500, hz));
}

/** Standard reference-frequency presets shown in the calibration UI. */
export const A4_PRESETS = [432, 440, 441, 442, 443, 444, 445] as const;
