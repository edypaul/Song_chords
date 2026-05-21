/**
 * Built-in instrument presets and their common tunings. Each tuning
 * is an ordered list of note names (scientific pitch: "E2", "A2",
 * "D3", …) so we can derive target frequencies for any A4 reference.
 *
 * The strings are ordered LOW → HIGH (the way a player thinks of
 * them), which is independent of how an instrument's strings sit
 * physically. The UI labels each string by name.
 */

export type TunerInstrument =
  | 'chromatic'
  | 'guitar'
  | 'bass'
  | 'ukulele'
  | 'violin'
  | 'banjo'
  | 'mandolin'
  | 'voice';

export interface TuningPreset {
  /** Stable id for selection / persistence. */
  id: string;
  /** User-facing name (e.g. "Standard", "Drop D", "DADGAD"). */
  name: string;
  /** Ordered low → high. Empty for chromatic mode. */
  notes: ReadonlyArray<string>;
}

export interface InstrumentPreset {
  id: TunerInstrument;
  label: string;
  /** Tunings shipped with the app. Custom user tunings extend this
   *  list at runtime via the custom-tunings store. */
  tunings: ReadonlyArray<TuningPreset>;
  /** Which built-in tuning to start with. */
  defaultTuningId: string;
}

/** Universal chromatic mode — no strings, the tuner snaps to the
 *  nearest chromatic pitch. */
const CHROMATIC: InstrumentPreset = {
  id: 'chromatic',
  label: 'Chromatic',
  tunings: [{ id: 'chromatic', name: 'Chromatic (any note)', notes: [] }],
  defaultTuningId: 'chromatic',
};

/** Guitar tunings. */
const GUITAR: InstrumentPreset = {
  id: 'guitar',
  label: 'Guitar',
  defaultTuningId: 'standard',
  tunings: [
    { id: 'standard',  name: 'Standard (EADGBE)',     notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    { id: 'drop-d',    name: 'Drop D',                notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    { id: 'dadgad',    name: 'DADGAD',                notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
    { id: 'open-d',    name: 'Open D',                notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
    { id: 'open-g',    name: 'Open G',                notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
    { id: 'open-e',    name: 'Open E',                notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
    { id: 'half-down', name: 'Half-step down (Eb)',   notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
    { id: 'full-down', name: 'Whole-step down (D)',   notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
    { id: 'drop-c',    name: 'Drop C',                notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  ],
};

/** Bass tunings — 4 and 5 string. */
const BASS: InstrumentPreset = {
  id: 'bass',
  label: 'Bass',
  defaultTuningId: 'standard-4',
  tunings: [
    { id: 'standard-4', name: 'Standard 4-string',     notes: ['E1', 'A1', 'D2', 'G2'] },
    { id: 'drop-d-4',   name: 'Drop D (4-string)',     notes: ['D1', 'A1', 'D2', 'G2'] },
    { id: 'standard-5', name: 'Standard 5-string',     notes: ['B0', 'E1', 'A1', 'D2', 'G2'] },
    { id: 'standard-6', name: 'Standard 6-string',     notes: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'] },
  ],
};

/** Ukulele tunings. */
const UKULELE: InstrumentPreset = {
  id: 'ukulele',
  label: 'Ukulele',
  defaultTuningId: 'gcea-high',
  tunings: [
    // Re-entrant high-G — soprano/concert/tenor default. Listed in
    // playing order (the high G actually sounds above the C and E,
    // but the player reads it as the 4th string).
    { id: 'gcea-high', name: 'Standard (gCEA, high-G)', notes: ['G4', 'C4', 'E4', 'A4'] },
    { id: 'gcea-low',  name: 'Linear (GCEA, low-G)',    notes: ['G3', 'C4', 'E4', 'A4'] },
    { id: 'dgbe',      name: 'D-tuning (ADF#B)',        notes: ['A4', 'D4', 'F#4', 'B4'] },
    { id: 'baritone',  name: 'Baritone (DGBE)',         notes: ['D3', 'G3', 'B3', 'E4'] },
  ],
};

/** Violin family (violin / viola / cello tunings use the same shape;
 *  defaulting to violin proper). */
const VIOLIN: InstrumentPreset = {
  id: 'violin',
  label: 'Violin',
  defaultTuningId: 'standard',
  tunings: [
    { id: 'standard', name: 'Standard (GDAE)', notes: ['G3', 'D4', 'A4', 'E5'] },
    { id: 'viola',    name: 'Viola (CGDA)',    notes: ['C3', 'G3', 'D4', 'A4'] },
    { id: 'cello',    name: 'Cello (CGDA)',    notes: ['C2', 'G2', 'D3', 'A3'] },
  ],
};

/** Banjo — 5-string open G is the most common; tenor and plectrum
 *  variants included. */
const BANJO: InstrumentPreset = {
  id: 'banjo',
  label: 'Banjo',
  defaultTuningId: 'open-g',
  tunings: [
    // 5-string open G: the high G drone is the 5th string, fretted
    // from the 5th fret on the neck. Listed in playing order.
    { id: 'open-g',     name: '5-string Open G (gDGBD)', notes: ['G4', 'D3', 'G3', 'B3', 'D4'] },
    { id: 'double-c',   name: 'Double-C (gCGCD)',        notes: ['G4', 'C3', 'G3', 'C4', 'D4'] },
    { id: 'sawmill',    name: 'Sawmill (gDGCD)',         notes: ['G4', 'D3', 'G3', 'C4', 'D4'] },
    { id: 'tenor',      name: 'Tenor (CGDA)',            notes: ['C3', 'G3', 'D4', 'A4'] },
    { id: 'plectrum',   name: 'Plectrum (CGBD)',         notes: ['C3', 'G3', 'B3', 'D4'] },
  ],
};

/** Mandolin family. */
const MANDOLIN: InstrumentPreset = {
  id: 'mandolin',
  label: 'Mandolin',
  defaultTuningId: 'standard',
  tunings: [
    { id: 'standard', name: 'Standard (GDAE)',         notes: ['G3', 'D4', 'A4', 'E5'] },
    { id: 'mandola',  name: 'Mandola (CGDA)',           notes: ['C3', 'G3', 'D4', 'A4'] },
    { id: 'octave',   name: 'Octave mandolin (GDAE)',   notes: ['G2', 'D3', 'A3', 'E4'] },
  ],
};

/** Voice / chromatic — same behaviour as chromatic but labelled for
 *  singers. */
const VOICE: InstrumentPreset = {
  id: 'voice',
  label: 'Voice',
  defaultTuningId: 'voice',
  tunings: [{ id: 'voice', name: 'Voice (chromatic)', notes: [] }],
};

export const INSTRUMENT_PRESETS: ReadonlyArray<InstrumentPreset> = [
  CHROMATIC, GUITAR, BASS, UKULELE, VIOLIN, BANJO, MANDOLIN, VOICE,
];

export function getInstrument(id: TunerInstrument): InstrumentPreset {
  return INSTRUMENT_PRESETS.find((i) => i.id === id) ?? CHROMATIC;
}
