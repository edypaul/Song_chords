import type { ChordDiagram } from '../types/chord.types';
import { CHORD_FORMULAS, getFormula, noteToSemitone } from '../chord-engine/formulas';

/**
 * Piano chord library. Piano voicings are generated algorithmically.
 *
 * SOURCE OF TRUTH: the same `CHORD_FORMULAS` table that drives the
 * guitar / ukulele voicing generator. Previously this file kept its
 * OWN `QUALITIES` recipe map (~25 entries, different suffix spellings
 * like `dim`/`aug`/`mMaj7`), so piano covered far fewer chords than
 * guitar/ukulele and silently returned nothing for the rest. Sourcing
 * from `CHORD_FORMULAS` means piano now has all 44 chord types in all
 * 12 keys automatically and stays in sync whenever a formula changes.
 *
 * The diagram model: `pianoNotes` is a list of semitone offsets from
 * the lowest rendered C (0..23 covers two octaves). The first entry is
 * the chord root — the renderer accents it so inversions read at a
 * glance.
 *
 * Storage / lookup: `PIANO_DIAGRAMS` exposes the same `Record<
 * chordName, ChordDiagram[]>` shape that the guitar/ukulele libraries
 * use, populated lazily by `ensurePiano(name)` and memoized.
 */

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Root spelling → pitch class (0=C..11=B). Reuses the guitar engine's
 *  `noteToSemitone` so flats / sharps resolve identically everywhere. */
function rootIndex(root: string): number {
  return ((noteToSemitone(root) % 12) + 12) % 12;
}

/**
 * Spread a chord's pitch intervals over two octaves so it reads like a
 * real keyboard voicing rather than a tight cluster. `CHORD_FORMULAS`
 * intervals are all within one octave (0..11); we lift the upper
 * structure (the 7th and any extensions) into the second octave so
 * adjacent tones don't collide visually and extensions sit where a
 * pianist would actually play them (root + 3rd + 5th low, 7th/9th/
 * 11th/13th up top).
 *
 * Strategy: keep root/3rd/5th in the lower octave; push the 7th and
 * everything above it up by an octave. Tones are then octave-folded
 * into the 0..23 display window by `buildPianoNotes`.
 */
function spreadIntervals(intervals: number[]): number[] {
  // Index 0 is always the root (per CHORD_FORMULAS contract). The
  // "lower triad" is the first three intervals (root, 3rd, 5th-ish);
  // anything after that is upper structure and gets +12 so it renders
  // in the second octave.
  return intervals.map((iv, i) => (i >= 3 ? iv + 12 : iv));
}

/** A slash is only a bass-note separator when what follows is an
 *  actual note name (e.g. "G/B"). Several chord QUALITY suffixes
 *  themselves contain a slash — "6/9", "m6/9" — so we must NOT split
 *  those on the slash. */
function looksLikeNote(s: string): boolean {
  return /^[A-G][#b]?$/.test(s.trim());
}

/** Try to split a chord name into root + suffix + optional bass.
 *  Validates the suffix against the canonical CHORD_FORMULAS table so
 *  every chord type the guitar/ukulele engine knows is also a valid
 *  piano chord. Returns null for unknown shapes. */
function splitChord(chord: string): { root: string; suffix: string; bass?: string } | null {
  // Only treat a trailing "/X" as a slash-bass when X is a note name.
  // This keeps quality suffixes that embed a slash (6/9, m6/9) intact
  // — previously "C6/9" was wrongly parsed as root C, suffix "6",
  // bass "9", dropping the 9th and injecting a bogus C bass note.
  const slash = chord.lastIndexOf('/');
  let main = chord;
  let bass: string | undefined;
  if (slash > 0 && looksLikeNote(chord.slice(slash + 1))) {
    main = chord.slice(0, slash);
    bass = chord.slice(slash + 1);
  }
  const m = main.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = m[1]!;
  const suffix = (m[2] ?? '').trim();
  if (!getFormula(suffix)) return null;
  return { root, suffix, bass };
}

/** Build the `pianoNotes` semitone array for a chord. The lowest displayed
 *  C is `0`; the chord root sits at `rootIndex(root)` in the lower octave.
 *  Bass (when below the root) drops an octave so it renders left of the
 *  chord — the visual cue users want for slash chords. */
function buildPianoNotes(root: string, suffix: string, bass?: string): number[] {
  const formula = getFormula(suffix);
  if (!formula) return [];
  // Spread the upper structure into the second octave (see
  // spreadIntervals) so the keyboard diagram looks like a played
  // voicing rather than a one-octave cluster.
  const recipe = spreadIntervals(formula.intervals);
  const baseRoot = rootIndex(root);

  // Lay every recipe interval into the displayed two-octave window
  // (semitones 0..23) measured from the lowest rendered C.
  //
  // The old code only shifted notes that exceeded 23 down by a single
  // octave (`n > 23 ? n - 12 : n`). That had two failure modes for
  // extended chords:
  //   1. A high root (e.g. B13) plus a 13th interval could land a note
  //      above 35 — one −12 shift still left it out of range.
  //   2. A wrapped extension could collide with a note already in the
  //      chord; the later `filter(n !== rootNote)` only removed the
  //      literal root, so a non-root collision silently DROPPED a chord
  //      tone — the diagram showed fewer notes than the chord has.
  //
  // Fix: fold each note into 0..23 by full octaves, then dedupe by the
  // exact displayed semitone. Extended tones are kept distinct because
  // their pitch classes differ from the root/3rd/5th; only true
  // unison/octave duplicates collapse, which is the correct visual.
  const seen = new Set<number>();
  const placed: number[] = [];
  for (const iv of recipe) {
    let n = baseRoot + iv;
    // Fold into [0, 23]. Using while-loops keeps it correct for any
    // interval size without assuming a single-octave overflow.
    while (n > 23) n -= 12;
    while (n < 0) n += 12;
    if (!seen.has(n)) {
      seen.add(n);
      placed.push(n);
    }
  }

  if (bass) {
    let bassNote = rootIndex(bass);
    while (bassNote > 23) bassNote -= 12;
    while (bassNote < 0) bassNote += 12;
    // Skip when the bass pitch is already shown (e.g. C/C) — adding it
    // again would just duplicate a key.
    if (!seen.has(bassNote)) {
      seen.add(bassNote);
      placed.push(bassNote);
    }
  }

  // `pianoNotes[0]` must remain the chord root so the renderer can
  // accent it. The recipe's first interval is always 0 (the root), so
  // `baseRoot` is guaranteed to be in `placed`; pull it to the front
  // and sort the rest ascending for a clean left-to-right keyboard read.
  const rootNote = baseRoot;
  const others = placed.filter((n) => n !== rootNote).sort((a, b) => a - b);
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
  const notes = buildPianoNotes(parts.root, parts.suffix, parts.bass);
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
 * `getAllChordNames('piano')` to populate the chord library page.
 * Now the full cross product of 12 roots × all 44 CHORD_FORMULAS
 * suffixes (≈ 528 entries) — matching the guitar/ukulele coverage.
 */
export function getAllPianoChordNames(): string[] {
  const names: string[] = [];
  for (const root of ROOTS) {
    for (const formula of CHORD_FORMULAS) {
      names.push(`${root}${formula.suffix}`);
    }
  }
  return names;
}
