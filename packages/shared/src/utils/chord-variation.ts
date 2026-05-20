import type { InstrumentType } from '../types/chord.types';

/**
 * Resolve which voicing INDEX to render for a given chord, applying
 * the agreed precedence:
 *
 *   1. The song's own per-chord override (`song.preferences
 *      .chordVariations[chord]`) — set via the modal's "Remember for
 *      this song" button. Highest priority; only affects this song.
 *   2. The global default for the current instrument
 *      (`settings.defaultChordVariations[instrument][chord]`) — set
 *      via the Chord Library's "Set as default for all songs" button.
 *      Used when the song hasn't pinned that chord itself.
 *   3. `0` — the engine-chosen primary voicing.
 *
 * Centralised so the renderer, the diagram bar, the export, and the
 * chord modal all agree on which voicing to use — the previous
 * `chordVariations?.[name] ?? 0` lookups missed the global default
 * and were also inconsistent if any caller forgot the per-song layer.
 */
export function resolveChordVariation(
  chord: string,
  instrument: InstrumentType,
  songOverrides: Readonly<Record<string, number>> | undefined,
  globalDefaults:
    | Readonly<Partial<Record<InstrumentType, Readonly<Record<string, number>>>>>
    | undefined,
): number {
  const perSong = songOverrides?.[chord];
  if (typeof perSong === 'number') return perSong;
  const perInstrument = globalDefaults?.[instrument]?.[chord];
  if (typeof perInstrument === 'number') return perInstrument;
  return 0;
}
