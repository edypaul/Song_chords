/**
 * Chord Engine — Public API
 *
 * Generates guitar chord voicings algorithmically using formulas
 * from the Picture Chord Encyclopedia. Voicings are cached after
 * first generation for instant subsequent lookups.
 */

export { CHORD_FORMULAS, getFormula, noteToSemitone, parseChordName } from './formulas';
export type { ChordFormula } from './formulas';
export { generateGuitarVoicings } from './voicing-generator';

import type { ChordDiagram } from '../types/chord.types';
import { generateGuitarVoicings } from './voicing-generator';
import { CHORD_FORMULAS, noteToSemitone } from './formulas';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** In-memory cache of generated voicings */
const cache = new Map<string, ChordDiagram[]>();

/**
 * Get guitar chord diagrams (cached).
 * Returns up to `count` voicings for the given chord name.
 */
export function getGuitarDiagrams(chordName: string, count: number = 5): ChordDiagram[] {
  const key = `${chordName}:${count}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const diagrams = generateGuitarVoicings(chordName, count);
  cache.set(key, diagrams);
  return diagrams;
}

/**
 * Pre-generate and cache all guitar chord diagrams.
 * Call this at app startup if you want instant lookups.
 * Returns the total number of voicings generated.
 */
export function preGenerateAllGuitarDiagrams(count: number = 5): number {
  let total = 0;
  for (const root of ROOTS) {
    for (const formula of CHORD_FORMULAS) {
      const name = root + formula.suffix;
      const diagrams = getGuitarDiagrams(name, count);
      total += diagrams.length;
    }
  }
  return total;
}

/**
 * Build a complete diagram map (compatible with the old static GUITAR_DIAGRAMS).
 * Returns Record<chordName, ChordDiagram[]>.
 */
export function buildGuitarDiagramMap(count: number = 5): Record<string, ChordDiagram[]> {
  const map: Record<string, ChordDiagram[]> = {};
  for (const root of ROOTS) {
    for (const formula of CHORD_FORMULAS) {
      const name = root + formula.suffix;
      const diagrams = getGuitarDiagrams(name, count);
      if (diagrams.length > 0) {
        map[name] = diagrams;
      }
    }
  }
  return map;
}

/** Clear the voicing cache */
export function clearCache(): void {
  cache.clear();
}
