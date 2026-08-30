/** The instruments the app ships chord libraries for. */
export type BuiltinInstrumentType = 'guitar' | 'ukulele' | 'piano';

/** Id of a user-defined instrument. The `custom:` prefix keeps custom
 *  ids trivially distinguishable from the built-ins everywhere an
 *  instrument is switched on, and lets `isCustomInstrument()` narrow. */
export type CustomInstrumentId = `custom:${string}`;

/**
 * Any instrument a chord diagram can belong to. Custom instruments
 * are fretted (a string count + optional tuning); their chord
 * libraries are entirely user-made and live in `settings.customChords`
 * like any other custom voicing, tagged with the instrument id.
 */
export type InstrumentType = BuiltinInstrumentType | CustomInstrumentId;

/** A user-defined fretted instrument (charango, 7-string guitar,
 *  bouzouki, …). Stored in `settings.customInstruments` keyed by id. */
export interface CustomInstrument {
  id: CustomInstrumentId;
  /** Display name, e.g. "Charango". */
  name: string;
  /** Number of strings / courses drawn on the diagram (2–12). */
  strings: number;
  /** Optional open-string notes, LOW → HIGH, one per string (e.g.
   *  ["E2","A2","D3","G3","B3","E4"]). Shown as labels under the
   *  chord editor's fretboard; purely informational. */
  tuning?: string[];
  /** Unix ms, for stable ordering in pickers. */
  createdAt: number;
}

/**
 * A chord shape. The same struct represents both fretted-instrument
 * shapes (guitar / ukulele) and piano voicings — only the relevant
 * fields are populated:
 *
 *  - **Guitar / Ukulele**: `baseFret`, `strings`, `frets`, optional
 *    `fingers`, optional `barre`.
 *  - **Piano**: `pianoNotes` — semitone offsets from a base note (C of
 *    the lowest displayed octave). The renderer draws a 2-octave
 *    keyboard and highlights every key whose offset is in the array.
 *    Lowest offset is treated as the chord's root (and gets the accent
 *    color so inversions read at a glance).
 *
 * Other instrument-specific fields are unused / ignored when
 * `instrument` doesn't match.
 */
export interface ChordDiagram {
  name: string;
  instrument: InstrumentType;
  /** Fretted-instrument: first displayed fret (1 = at the nut). Piano: unused. */
  baseFret: number;
  /** Fretted-instrument: number of strings (guitar=6, ukulele=4). Piano: 0. */
  strings: number;
  /** Fretted-instrument: per-string fret values (`'x'` muted, `0` open,
   *  `number` fretted, `null` hidden). Empty for piano. */
  frets: Array<number | 'x' | 0 | null>;
  /** Optional finger assignments for fretted instruments. */
  fingers?: number[];
  /** Optional barre marker for fretted instruments. */
  barre?: { fret: number; fromString: number; toString: number };
  /** Piano-only: semitone offsets from C of the lowest rendered octave.
   *  The renderer shows two octaves (24 semitones, 0..23). The first entry
   *  is the chord root and is drawn with the accent color. */
  pianoNotes?: number[];
}
