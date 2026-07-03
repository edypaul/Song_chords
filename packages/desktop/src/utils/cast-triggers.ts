import { usePlayerStore, useSettingsStore, type AppSettings } from '@song-chords/shared';
import { shallow } from 'zustand/shallow';

/**
 * Selective cast re-push triggers.
 *
 * `buildCastHtml` bakes a snapshot of the current song + a specific subset
 * of settings into the receiver HTML. Only writes to THOSE fields should
 * cause the receiver to reload — everything else the receiver either
 * ignores or handles locally with its own JS (auto-scroll play/pause + speed
 * slider, view-mode pill toggle, chord-bar collapse, fullscreen, zoom, …).
 *
 * IMPORTANT: we compare the PAYLOAD-AFFECTING FIELDS OF the song, not the
 * activeSong object reference. The song store rebuilds the song object on
 * many unrelated events (toggleFavorite, savePreferences for viewMode /
 * autoScrollMode, etc.); the SongViewPage effect then re-loads that fresh
 * reference into the player store's `activeSong`. If we shallow-compared
 * `{ activeSong }` we'd re-push every time the reference flipped — even
 * though NONE of the fields baked into the HTML changed. Projecting to a
 * flat "cast-relevant fingerprint" makes those reference churns no-ops.
 */

/** Payload-affecting projection of the active song + player store. */
export interface PlayerCastSlice {
  /** Song identity — different id ⇒ different song ⇒ re-push. */
  id: string | null;
  /** The song body the receiver renders. */
  content: string | null;
  /** Fields getRenderableSong reads for transpose / key handling. */
  key: string | null;
  capo: number | null;
  transposeSteps: number | null;
  /** Metadata that appears on the receiver (title / artist header, etc.). */
  title: string | null;
  artist: string | null;
  /** Whether the receiver still has a song to render at all. */
  hasSong: boolean;
  /** Song duration (MM:SS or null) — baked into the receiver toolbar so
   *  Duration mode can compute px/s. If it changes on the desktop the
   *  receiver needs a re-push so Duration mode reflects the new length
   *  and the mode chooser enables/disables Duration correctly. */
  duration: string | null;
  /** The initial mode the receiver seeds. Desktop's mode chooser writes
   *  to the active song's preferences.autoScrollMode; re-pushing when
   *  it flips keeps the cast toolbar in step with the desktop. */
  autoScrollMode: 'duration' | 'speed' | null;
}

/** Settings fields the cast payload actually depends on. */
export interface SettingsCastSlice {
  songViewStyle: AppSettings['songViewStyle'];
  defaultInstrument: AppSettings['defaultInstrument'];
  customChords: AppSettings['customChords'];
  /** Theme drives the CSS variables the payload reads via `cssVar()` for
   *  `--bg`, `--text-primary`, etc. — so a theme flip does need a re-push. */
  theme: AppSettings['theme'];
}

export function pickPlayerCastSlice(state: ReturnType<typeof usePlayerStore.getState>): PlayerCastSlice {
  const song = state.activeSong;
  return {
    id: song?.id ?? null,
    content: song?.content ?? null,
    key: song?.key ?? null,
    capo: song?.capo ?? null,
    transposeSteps: song?.preferences?.transposeSteps ?? 0,
    title: song?.title ?? null,
    artist: song?.artist ?? null,
    hasSong: !!song,
    duration: song?.duration ?? null,
    autoScrollMode: song?.preferences?.autoScrollMode ?? null,
  };
}

export function pickSettingsCastSlice(state: ReturnType<typeof useSettingsStore.getState>): SettingsCastSlice {
  const s = state.settings;
  return {
    songViewStyle: s.songViewStyle,
    defaultInstrument: s.defaultInstrument,
    customChords: s.customChords,
    theme: s.theme,
  };
}

/**
 * Subscribe to only the cast-relevant slice of a Zustand store. Fires the
 * listener when any field in the slice changes (shallow comparison), never
 * on unrelated field mutations. Returns the unsubscribe function.
 *
 * The shared player + settings stores use the base `create()` (no
 * `subscribeWithSelector` middleware), so we implement the selector diff
 * manually: subscribe to the whole store, project each state to the
 * cast-relevant slice, and only invoke `onChange` when the projection
 * shallow-differs from the previous one.
 */
export function subscribeCastRelevant<T, U extends object>(
  storeApi: {
    subscribe: (listener: (state: T, prevState: T) => void) => () => void;
    getState: () => T;
  },
  selector: (s: T) => U,
  onChange: () => void,
): () => void {
  let prev = selector(storeApi.getState());
  return storeApi.subscribe((state) => {
    const next = selector(state);
    if (!shallow(prev, next)) {
      prev = next;
      onChange();
    }
  });
}
