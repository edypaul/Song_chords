import type { ChordDiagram } from '../types/chord.types';

/**
 * Piano chord library. Unlike guitar/ukulele where every voicing is a
 * hand-tuned table, piano voicings are generated algorithmically from
 * interval recipes — there are 12 roots × ~14 qualities and they're all
 * regular shapes, so a recipe map pays off.
 *
 * The diagram model: `pianoNotes` is a list of semitones offsets from the
 * lowest rendered C (0..23 covers two octaves). The first entry is the
 * chord root — the renderer accents it so inversions read at a glance.
 *
 * Storage / lookup: `PIANO_DIAGRAMS` exposes the same `Record<chordName,
 * ChordDiagram[]>` shape that the guitar/ukulele libraries use, populated
 * lazily by `ensurePiano(name)`. Looking up an unknown name builds the
 * diagram on demand from the recipes and memoizes it.
 */

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

/** Map a root spelling (e.g. "Bb", "F#") to its canonical sharp form so
 *  index lookup in `ROOTS` works. Falls back to the input unchanged. */
function canonicalRoot(root: string): string {
  return FLAT_TO_SHARP[root] ?? root;
}

function rootIndex(root: string): number {
  const idx = ROOTS.indexOf(canonicalRoot(root) as (typeof ROOTS)[number]);
  return idx < 0 ? 0 : idx;
}

/**
 * Quality recipes — semitone offsets from the chord root for each chord
 * quality. Order is structural (root, third/fifth/etc.) but the visual
 * sort happens later. Bass (`/X`) is added separately by the builder.
 */
const QUALITIES: Record<string, number[]> = {
  // Triads
  '':       [0, 4, 7],         // major
  'm':      [0, 3, 7],         // minor
  'dim':    [0, 3, 6],
  'aug':    [0, 4, 8],
  'sus2':   [0, 2, 7],
  'sus4':   [0, 5, 7],
  '5':      [0, 7],             // power chord
  // Sevenths
  '7':      [0, 4, 7, 10],
  'maj7':   [0, 4, 7, 11],
  'm7':     [0, 3, 7, 10],
  'mMaj7':  [0, 3, 7, 11],
  'dim7':   [0, 3, 6, 9],
  'm7b5':   [0, 3, 6, 10],     // half-diminished
  '7sus4':  [0, 5, 7, 10],
  // Sixths
  '6':      [0, 4, 7, 9],
  'm6':     [0, 3, 7, 9],
  '6/9':    [0, 4, 7, 9, 14],
  // Extended (compressed into single-octave-friendly voicings where
  // possible; the renderer wraps to the second octave when needed)
  '9':      [0, 4, 7, 10, 14],
  'maj9':   [0, 4, 7, 11, 14],
  'm9':     [0, 3, 7, 10, 14],
  'add9':   [0, 4, 7, 14],
  'madd9':  [0, 3, 7, 14],
  '11':     [0, 4, 7, 10, 14, 17],
  'm11':    [0, 3, 7, 10, 14, 17],
  '13':     [0, 4, 7, 10, 14, 21],
};

/** Try to split a chord name into root + quality + optional bass. Returns
 *  null when the input doesn't look like a known chord shape. */
function splitChord(chord: string): { root: string; quality: string; bass?: string } | null {
  const slash = chord.indexOf('/');
  let main = chord;
  let bass: string | undefined;
  if (slash > 0) {
    main = chord.slice(0, slash);
    bass = chord.slice(slash + 1);
  }
  const m = main.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = m[1]!;
  const quality = (m[2] ?? '').trim();
  if (!(quality in QUALITIES)) return null;
  return { root, quality, bass };
}

/** Build the `pianoNotes` semitone array for a chord. The lowest displayed
 *  C is `0`; the chord root sits at `rootIndex(root)` in the lower octave.
 *  Bass (when below the root) drops an octave so it renders left of the
 *  chord — the visual cue users want for slash chords. */
function buildPianoNotes(root: string, quality: string, bass?: string): number[] {
  const recipe = QUALITIES[quality];
  if (!recipe) return [];
  const baseRoot = rootIndex(root);
  const notes = recipe.map((iv) => baseRoot + iv);

  // Some qualities push past the 24-semitone window. Wrap intervals that
  // exceed 23 down by an octave so the diagram stays in range. This is a
  // pragmatic compromise — extended chords aren't strictly playable as
  // shown, but the visual conveys "these notes are in the chord".
  const wrapped = notes.map((n) => (n > 23 ? n - 12 : n));

  if (bass) {
    const bassIdx = rootIndex(bass);
    // Place the bass note in the lower octave. If that bass note happens
    // to be the same pitch class as the root, putting it before the root
    // would be redundant — skip it.
    const bassPitch = bassIdx;
    if (bassPitch !== baseRoot && !wrapped.includes(bassPitch)) {
      wrapped.unshift(bassPitch);
    }
  }
  // Sort ascending for visual clarity. The root keeps its identity via
  // `pianoNotes[0]` after sort? No — sort breaks the "first = root"
  // invariant. We track the root separately by always making it the first
  // entry: sort everything except the root, then prepend.
  const rootNote = baseRoot;
  const others = wrapped.filter((n) => n !== rootNote).sort((a, b) => a - b);
  return [rootNote, ...others];
}

/**
 * In-memory cache of generated piano diagrams. Built on first lookup per
 * chord name and reused thereafter.
 */
const PIANO_CACHE: Record<string, ChordDiagram[]> = {};

/** Generate (and cache) the piano diagram for a chord name. Returns an
 *  empty array if the name doesn't parse to a known quality. */
function ensurePiano(name: string): ChordDiagram[] {
  if (PIANO_CACHE[name]) return PIANO_CACHE[name]!;
  const parts = splitChord(name);
  if (!parts) {
    PIANO_CACHE[name] = [];
    return [];
  }
  const notes = buildPianoNotes(parts.root, parts.quality, parts.bass);
  if (notes.length === 0) {
    PIANO_CACHE[name] = [];
    return [];
  }
  const diagram: ChordDiagram = {
    name,
    instrument: 'piano',
    baseFret: 1,
    strings: 0,
    frets: [],
    pianoNotes: notes,
  };
  PIANO_CACHE[name] = [diagram];
  return [diagram];
}

/**
 * `Record<string, ChordDiagram[]>` proxy that builds entries lazily on
 * access. Indexing into it (e.g. `PIANO_DIAGRAMS['Cmaj7']`) triggers
 * `ensurePiano`. Iteration yields the names already built — the lookup
 * helpers below cover discovery for chord-library listing.
 */
export const PIANO_DIAGRAMS = new Proxy({} as Record<string, ChordDiagram[]>, {
  get(_target, prop: string) {
    if (typeof prop !== 'string') return undefined;
    return ensurePiano(prop);
  },
  has(_target, prop: string) {
    if (typeof prop !== 'string') return false;
    return ensurePiano(prop).length > 0;
  },
});

/**
 * Enumerate every piano chord name we can generate. Used by
 * `getAllChordNames('piano')` to populate the chord library page. The
 * cross product is 12 roots × ~25 qualities ≈ 300 entries — small enough
 * to materialize once.
 */
export function getAllPianoChordNames(): string[] {
  const names: string[] = [];
  for (const root of ROOTS) {
    for (const quality of Object.keys(QUALITIES)) {
      names.push(`${root}${quality}`);
    }
  }
  return names;
}
