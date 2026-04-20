/**
 * Chord formulas based on the Picture Chord Encyclopedia.
 * Each formula is an array of semitone intervals from the root.
 *
 * Interval reference (semitones from root):
 *   1(root)=0, b2=1, 2/9=2, b3=3, 3=4, 4/11=5, b5/#11=6, 5=7,
 *   #5/b6=8, 6/13=9, bb7=9, b7=10, 7=11
 *
 * Tiered tone system:
 *   tier1 — Required: must be present or voicing is rejected
 *   tier2 — Strongly preferred: missing = score penalty
 *   tier3 — Optional: missing = no problem
 *   avoid — Must NOT be present (e.g. 3rd in sus chords)
 */

export interface ChordFormula {
  suffix: string;
  /** All intervals in the chord (semitones from root) */
  intervals: number[];
  /** Tier 1: must be present — indices into intervals[] */
  tier1: number[];
  /** Tier 2: strongly preferred — indices into intervals[] */
  tier2: number[];
  /** Tier 3: optional — indices into intervals[] */
  tier3: number[];
  /** Pitch classes (semitones from root) that must NOT appear */
  avoid?: number[];
}

// Semitone constants
const ROOT = 0;
const M2 = 2;   // also 9th
const m3 = 3;
const M3 = 4;
const P4 = 5;   // also 11th
const b5 = 6;   // also #11
const P5 = 7;
const s5 = 8;   // #5 / b6
const M6 = 9;   // also 13th, also bb7
const m7 = 10;  // dominant 7th
const M7 = 11;
const b9 = 1;
const s9 = 3;   // same as m3

/**
 * All 44 chord types from the Picture Chord Encyclopedia.
 *
 * Tier assignment logic:
 *   - The tones that DEFINE the chord quality go in tier1 (guide tones)
 *   - The root and structural tones go in tier2
 *   - The 5th and color tones go in tier3
 *   - Sus chords avoid the 3rd
 */
export const CHORD_FORMULAS: ChordFormula[] = [
  // ────── Major family ──────
  //  major: 1 3 5  — 3rd defines major quality
  { suffix: '',        intervals: [ROOT, M3, P5],
    tier1: [0, 1],  tier2: [],     tier3: [2] },
  //  5 (power chord): 1 5  — both essential
  { suffix: '5',       intervals: [ROOT, P5],
    tier1: [0, 1],  tier2: [],     tier3: [] },
  //  sus4: 1 4 5  — 4th defines the sus, avoid 3rd
  { suffix: 'sus4',    intervals: [ROOT, P4, P5],
    tier1: [0, 1],  tier2: [],     tier3: [2],  avoid: [M3] },
  //  sus2: 1 2 5  — 2nd defines the sus, avoid 3rd
  { suffix: 'sus2',    intervals: [ROOT, M2, P5],
    tier1: [0, 1],  tier2: [],     tier3: [2],  avoid: [M3] },
  //  add9: 1 3 5 9  — triad + added 9th
  { suffix: 'add9',    intervals: [ROOT, M3, P5, M2],
    tier1: [0, 1, 3], tier2: [],   tier3: [2] },
  //  6: 1 3 5 6  — 3rd + 6th define quality
  { suffix: '6',       intervals: [ROOT, M3, P5, M6],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  6/9: 1 3 5 6 9
  { suffix: '6/9',     intervals: [ROOT, M3, P5, M6, M2],
    tier1: [1, 3, 4], tier2: [0],  tier3: [2] },
  //  maj7: 1 3 5 7  — 3rd + maj7 are guide tones
  { suffix: 'maj7',    intervals: [ROOT, M3, P5, M7],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  maj9: 1 3 5 7 9
  { suffix: 'maj9',    intervals: [ROOT, M3, P5, M7, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2] },
  //  maj7#11: 1 3 5 7 #11
  { suffix: 'maj7#11', intervals: [ROOT, M3, P5, M7, b5],
    tier1: [1, 3, 4], tier2: [0],  tier3: [2] },
  //  maj13: 1 3 5 7 9 13
  { suffix: 'maj13',   intervals: [ROOT, M3, P5, M7, M2, M6],
    tier1: [1, 3, 5], tier2: [0],  tier3: [2, 4] },

  // ────── Minor family ──────
  //  m: 1 b3 5  — b3 defines minor
  { suffix: 'm',       intervals: [ROOT, m3, P5],
    tier1: [0, 1],   tier2: [],    tier3: [2] },
  //  m(add9): 1 b3 5 9
  { suffix: 'm(add9)', intervals: [ROOT, m3, P5, M2],
    tier1: [0, 1, 3], tier2: [],   tier3: [2] },
  //  m6: 1 b3 5 6
  { suffix: 'm6',      intervals: [ROOT, m3, P5, M6],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  mb6: 1 b3 5 b6
  { suffix: 'mb6',     intervals: [ROOT, m3, P5, s5],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  m6/9: 1 b3 5 6 9
  { suffix: 'm6/9',    intervals: [ROOT, m3, P5, M6, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2] },
  //  m7: 1 b3 5 b7  — b3 + b7 are guide tones
  { suffix: 'm7',      intervals: [ROOT, m3, P5, m7],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  m7b5: 1 b3 b5 b7  — all 4 define the quality
  { suffix: 'm7b5',    intervals: [ROOT, m3, b5, m7],
    tier1: [1, 2, 3], tier2: [0],  tier3: [] },
  //  m(maj7): 1 b3 5 7  — b3 + maj7 are guide tones
  { suffix: 'm(maj7)', intervals: [ROOT, m3, P5, M7],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  m9: 1 b3 5 b7 9
  { suffix: 'm9',      intervals: [ROOT, m3, P5, m7, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2] },
  //  m9b5: 1 b3 b5 b7 9
  { suffix: 'm9b5',    intervals: [ROOT, m3, b5, m7, M2],
    tier1: [1, 2, 3], tier2: [0],  tier3: [4] },
  //  m9(maj7): 1 b3 5 7 9
  { suffix: 'm9(maj7)',intervals: [ROOT, m3, P5, M7, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2] },
  //  m11: 1 b3 5 b7 9 11
  { suffix: 'm11',     intervals: [ROOT, m3, P5, m7, M2, P4],
    tier1: [1, 3, 5], tier2: [0],  tier3: [2, 4] },
  //  m13: 1 b3 5 b7 9 11 13
  { suffix: 'm13',     intervals: [ROOT, m3, P5, m7, M2, P4, M6],
    tier1: [1, 3, 6], tier2: [0],  tier3: [2, 4, 5] },

  // ────── Dominant family (b7) ──────
  //  7: 1 3 5 b7  — 3rd + b7 are THE guide tones
  { suffix: '7',       intervals: [ROOT, M3, P5, m7],
    tier1: [1, 3],   tier2: [0],   tier3: [2] },
  //  7sus4: 1 4 5 b7  — 4th + b7 define it, avoid 3rd
  { suffix: '7sus4',   intervals: [ROOT, P4, P5, m7],
    tier1: [1, 3],   tier2: [0],   tier3: [2],  avoid: [M3] },
  //  7b5: 1 3 b5 b7  — all 4 important
  { suffix: '7b5',     intervals: [ROOT, M3, b5, m7],
    tier1: [1, 2, 3], tier2: [0],  tier3: [] },
  //  9: 1 3 5 b7 9
  { suffix: '9',       intervals: [ROOT, M3, P5, m7, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2] },
  //  9sus4: 1 4 5 b7 9
  { suffix: '9sus4',   intervals: [ROOT, P4, P5, m7, M2],
    tier1: [1, 3],   tier2: [0, 4], tier3: [2],  avoid: [M3] },
  //  9b5: 1 3 b5 b7 9
  { suffix: '9b5',     intervals: [ROOT, M3, b5, m7, M2],
    tier1: [1, 2, 3], tier2: [0],  tier3: [4] },
  //  7b9: 1 3 5 b7 b9
  { suffix: '7b9',     intervals: [ROOT, M3, P5, m7, b9],
    tier1: [1, 3, 4], tier2: [0],  tier3: [2] },
  //  7#9: 1 3 5 b7 #9
  { suffix: '7#9',     intervals: [ROOT, M3, P5, m7, s9],
    tier1: [1, 3, 4], tier2: [0],  tier3: [2] },
  //  7b5(#9): 1 3 b5 b7 #9
  { suffix: '7b5(#9)', intervals: [ROOT, M3, b5, m7, s9],
    tier1: [1, 2, 3, 4], tier2: [0], tier3: [] },
  //  11: 1 3 5 b7 9 11  — b7 + 11th define it
  { suffix: '11',      intervals: [ROOT, M3, P5, m7, M2, P4],
    tier1: [3, 5],   tier2: [0],   tier3: [1, 2, 4] },
  //  7#11: 1 3 5 b7 #11
  { suffix: '7#11',    intervals: [ROOT, M3, P5, m7, b5],
    tier1: [1, 3, 4], tier2: [0],  tier3: [2] },
  //  13: 1 3 5 b7 9 13
  { suffix: '13',      intervals: [ROOT, M3, P5, m7, M2, M6],
    tier1: [1, 3, 5], tier2: [0],  tier3: [2, 4] },
  //  13sus4: 1 4 5 b7 9 13
  { suffix: '13sus4',  intervals: [ROOT, P4, P5, m7, M2, M6],
    tier1: [1, 3, 5], tier2: [0],  tier3: [2, 4],  avoid: [M3] },

  // ────── Augmented family (#5) ──────
  //  +: 1 3 #5  — 3rd + #5 both define augmented
  { suffix: '+',       intervals: [ROOT, M3, s5],
    tier1: [0, 1, 2], tier2: [],   tier3: [] },
  //  +7: 1 3 #5 b7
  { suffix: '+7',      intervals: [ROOT, M3, s5, m7],
    tier1: [1, 2, 3], tier2: [0],  tier3: [] },
  //  +9: 1 3 #5 b7 9
  { suffix: '+9',      intervals: [ROOT, M3, s5, m7, M2],
    tier1: [1, 2, 3], tier2: [0],  tier3: [4] },
  //  +7b9: 1 3 #5 b7 b9
  { suffix: '+7b9',    intervals: [ROOT, M3, s5, m7, b9],
    tier1: [1, 2, 3, 4], tier2: [0], tier3: [] },
  //  +7#9: 1 3 #5 b7 #9
  { suffix: '+7#9',    intervals: [ROOT, M3, s5, m7, s9],
    tier1: [1, 2, 3, 4], tier2: [0], tier3: [] },

  // ────── Diminished family ──────
  //  °: 1 b3 b5  — all three define diminished
  { suffix: '°',       intervals: [ROOT, m3, b5],
    tier1: [0, 1, 2], tier2: [],   tier3: [] },
  //  °7: 1 b3 b5 bb7  — all four define dim7
  { suffix: '°7',      intervals: [ROOT, m3, b5, M6],
    tier1: [0, 1, 2, 3], tier2: [], tier3: [] },
];

/** Lookup formula by suffix */
export function getFormula(suffix: string): ChordFormula | undefined {
  return CHORD_FORMULAS.find((f) => f.suffix === suffix);
}

/** Get the set of semitone pitch classes for a chord */
export function getChordPitchClasses(rootSemitone: number, formula: ChordFormula): Set<number> {
  return new Set(formula.intervals.map((i) => (rootSemitone + i) % 12));
}

/** Note name to semitone value */
export function noteToSemitone(note: string): number {
  const map: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
    'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  return map[note] ?? 0;
}

/** Parse a chord name into root note and suffix */
export function parseChordName(name: string): { root: string; suffix: string } | null {
  const m = name.match(/^([A-G][#b]?)(.*)/);
  if (!m) return null;
  return { root: m[1]!, suffix: m[2]! };
}
