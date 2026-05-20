import { useMemo } from 'react';
import { useSettingsStore, usePlayerStore, type InstrumentType } from '@song-chords/shared';

/**
 * The combined chord-variation map the renderer should use for the
 * CURRENTLY-loaded song, with the agreed precedence:
 *
 *   per-song override  >  global default for this instrument  >  0
 *
 * Returned as a plain `Record<chordName, voicingIndex>` so the existing
 * `chordVariations?.[name] ?? 0` lookups in renderers (ChordLine,
 * ChordDiagramBar, SongRenderer, SongExportModal, the ChordModal)
 * keep working unchanged — they just receive the already-merged map.
 *
 * Per-song overrides spread LAST so they shadow any global default for
 * the same chord; the rest of the song's chords get the global default
 * automatically. Untouched chords (no per-song, no global) fall to 0
 * via the `?? 0` at the call site.
 */
export function useEffectiveChordVariations(
  instrument: InstrumentType,
): Record<string, number> {
  const globalForInstrument = useSettingsStore(
    (s) => s.settings.defaultChordVariations?.[instrument],
  );
  const perSong = usePlayerStore((s) => s.activeSong?.preferences?.chordVariations);
  return useMemo(
    () => ({ ...(globalForInstrument ?? {}), ...(perSong ?? {}) }),
    [globalForInstrument, perSong],
  );
}
