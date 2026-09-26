/**
 * Voicings that must NEVER be dropped from the baked guitar table,
 * whatever the current selection/pruning rules produce.
 *
 * Why: users pin voicings by INDEX ("Remember for this song" /
 * "Set as default for all songs"). When the 2026-09 pruning pass
 * (CAGED-first, ceiling 5) removed a shape a song had pinned, that
 * pin would silently point at a different shape. The entries here are
 * exactly those pinned shapes — all previously emitted by the same
 * generator, so they are known-valid; they are APPENDED at the end of
 * their chord's list so the canonical CAGED ordering stays intact.
 *
 * Add to this list only when a real pinned shape would otherwise
 * disappear. generate-chords.ts skips any entry the selector already
 * emitted, so duplicates can't occur.
 */
export interface KeepVoicing {
  baseFret: number;
  frets: Array<number | 'x'>;
  barre?: { fret: number; fromString: number; toString: number };
}

export const GUITAR_KEEP_VOICINGS: Record<string, KeepVoicing[]> = {
  // Pinned in "Sombras"
  'C#°': [{ baseFret: 1, frets: ['x', 4, 2, 0, 'x', 3] }],
  // Pinned in "ÁNGEL"
  'Eadd9': [{ baseFret: 1, frets: [0, 2, 4, 1, 0, 0] }],
  // Pinned in "BENDITA TU LUZ"
  'Em9': [{ baseFret: 1, frets: [0, 2, 4, 0, 3, 0] }],
  // Pinned in "DILE"
  'F#add9': [{ baseFret: 1, frets: ['x', 'x', 4, 3, 2, 4] }],
};
