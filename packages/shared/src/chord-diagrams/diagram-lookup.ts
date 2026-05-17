import type { ChordDiagram, InstrumentType } from '../types/chord.types';
import { GUITAR_DIAGRAMS } from './guitar-diagrams';
import { UKULELE_DIAGRAMS } from './ukulele-diagrams';
import { GUITAR_SLASH_DIAGRAMS, UKULELE_SLASH_DIAGRAMS } from './slash-diagrams';
import { PIANO_DIAGRAMS, getAllPianoChordNames } from './piano-diagrams';

type DiagramMap = Record<string, ChordDiagram[]>;

/** Look up a chord by name in the relevant built-in library. Piano is
 *  generated lazily, so its `[name]` access always returns an array
 *  (possibly empty for unrecognized names). */
function getBuiltin(chordName: string, instrument: InstrumentType): ChordDiagram[] {
  if (instrument === 'guitar') {
    return GUITAR_DIAGRAMS[chordName] ?? GUITAR_SLASH_DIAGRAMS[chordName] ?? [];
  }
  if (instrument === 'ukulele') {
    return UKULELE_DIAGRAMS[chordName] ?? UKULELE_SLASH_DIAGRAMS[chordName] ?? [];
  }
  // Piano: Proxy-backed lazy generator — already resolves slash
  // chords at runtime (splitChord + bass note), so no slash table.
  return PIANO_DIAGRAMS[chordName] ?? [];
}

/** Filter a custom-chord map to entries matching the active instrument
 *  (custom chords are stored across all instruments in one map). */
function customForInstrument(custom: DiagramMap | undefined, instrument: InstrumentType): DiagramMap {
  if (!custom) return {};
  const out: DiagramMap = {};
  for (const [name, diagrams] of Object.entries(custom)) {
    const matched = diagrams.filter((d) => d.instrument === instrument);
    if (matched.length) out[name] = matched;
  }
  return out;
}

function lookup(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram[] {
  const builtin = getBuiltin(chordName, instrument);
  const custMap = customForInstrument(custom, instrument);
  const userVariants = custMap[chordName] ?? [];
  return [...builtin, ...userVariants];
}

/** Exact match — returns first variation. */
export function getDiagramExact(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  return lookup(chordName, instrument, custom)[0] ?? null;
}

/** Exact match — returns ALL variations (built-in + custom). */
export function getDiagramVariations(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram[] {
  return lookup(chordName, instrument, custom);
}

/** Returns a specific variation by index. */
export function getDiagramByIndex(chordName: string, instrument: InstrumentType, index: number, custom?: DiagramMap): ChordDiagram | null {
  const all = getDiagramVariations(chordName, instrument, custom);
  if (all.length === 0) return null;
  return all[Math.min(index, all.length - 1)] ?? all[0]!;
}

/** Get all chord names available (built-in + custom). For piano this
 *  enumerates the algorithmic library. */
export function getAllChordNames(instrument: InstrumentType, custom?: DiagramMap): string[] {
  let names: string[];
  if (instrument === 'guitar') {
    names = [...Object.keys(GUITAR_DIAGRAMS), ...Object.keys(GUITAR_SLASH_DIAGRAMS)];
  } else if (instrument === 'ukulele') {
    names = [...Object.keys(UKULELE_DIAGRAMS), ...Object.keys(UKULELE_SLASH_DIAGRAMS)];
  } else {
    names = getAllPianoChordNames();
  }

  // Add custom chord names that don't already exist in the built-in list.
  const custMap = customForInstrument(custom, instrument);
  for (const name of Object.keys(custMap)) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Check if a chord name has any custom (user-added) variations for any
 *  instrument. The customChords map mixes instruments together. */
export function hasCustomVariations(chordName: string, custom?: DiagramMap): boolean {
  return !!custom?.[chordName]?.length;
}

/** Get built-in diagram map directly. Piano returns a snapshot of the
 *  generated library — sufficient for callers that only iterate names.
 *  Use the lookup helpers above when querying by name. */
export function getBuiltinDiagrams(instrument: InstrumentType): DiagramMap {
  if (instrument === 'guitar') return { ...GUITAR_DIAGRAMS, ...GUITAR_SLASH_DIAGRAMS };
  if (instrument === 'ukulele') return { ...UKULELE_DIAGRAMS, ...UKULELE_SLASH_DIAGRAMS };
  // Piano: materialize the full set so callers that iterate (e.g. chord
  // library) get every name. The library is small (~300 entries) so the
  // up-front cost is fine.
  const out: DiagramMap = {};
  for (const name of getAllPianoChordNames()) {
    const list = PIANO_DIAGRAMS[name];
    if (list && list.length) out[name] = list;
  }
  return out;
}

/** Fuzzy lookup with fallbacks. */
export function getDiagram(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  const exact = lookup(chordName, instrument, custom);
  if (exact.length) return exact[0]!;

  // Strip slash bass note: "G/B" -> "G"
  const slashIdx = chordName.lastIndexOf('/');
  if (slashIdx > 0) {
    const withoutBass = chordName.slice(0, slashIdx);
    const matched = lookup(withoutBass, instrument, custom);
    if (matched.length) return matched[0]!;
  }

  // Simplify: try root+m or root
  const root = chordName.match(/^[A-G][#b]?/)?.[0];
  if (root) {
    const quality = chordName.slice(root.length);
    const simplifications = [chordName, root + (quality.startsWith('m') ? 'm' : ''), root];
    for (const candidate of simplifications) {
      const matched = lookup(candidate, instrument, custom);
      if (matched.length) return matched[0]!;
    }
  }

  return null;
}
