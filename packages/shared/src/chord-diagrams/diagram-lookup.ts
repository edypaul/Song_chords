import type { ChordDiagram, InstrumentType } from '../types/chord.types';
import { GUITAR_DIAGRAMS } from './guitar-diagrams';
import { UKULELE_DIAGRAMS } from './ukulele-diagrams';

type DiagramMap = Record<string, ChordDiagram[]>;

function getMap(instrument: InstrumentType, custom?: DiagramMap): DiagramMap {
  const builtin = instrument === 'guitar' ? GUITAR_DIAGRAMS : UKULELE_DIAGRAMS;
  if (!custom || Object.keys(custom).length === 0) return builtin;
  const merged: DiagramMap = { ...builtin };
  for (const [key, diagrams] of Object.entries(custom)) {
    merged[key] = [...(merged[key] ?? []), ...diagrams];
  }
  return merged;
}

/** Exact match — returns first variation. */
export function getDiagramExact(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  const map = getMap(instrument, custom);
  return map[chordName]?.[0] ?? null;
}

/** Exact match — returns ALL variations (built-in + custom). */
export function getDiagramVariations(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram[] {
  const map = getMap(instrument, custom);
  return map[chordName] ?? [];
}

/** Returns a specific variation by index. */
export function getDiagramByIndex(chordName: string, instrument: InstrumentType, index: number, custom?: DiagramMap): ChordDiagram | null {
  const all = getDiagramVariations(chordName, instrument, custom);
  if (all.length === 0) return null;
  return all[Math.min(index, all.length - 1)] ?? all[0]!;
}

/** Get all chord names available (built-in + custom). */
export function getAllChordNames(instrument: InstrumentType, custom?: DiagramMap): string[] {
  const map = getMap(instrument, custom);
  return Object.keys(map);
}

/** Check if a chord name has any custom (user-added) variations. */
export function hasCustomVariations(chordName: string, custom?: DiagramMap): boolean {
  return !!custom?.[chordName]?.length;
}

/** Get built-in diagram map directly. */
export function getBuiltinDiagrams(instrument: InstrumentType): DiagramMap {
  return instrument === 'guitar' ? GUITAR_DIAGRAMS : UKULELE_DIAGRAMS;
}

/** Fuzzy lookup with fallbacks. */
export function getDiagram(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  const map = getMap(instrument, custom);

  if (map[chordName]) return map[chordName]![0]!;

  // Strip slash bass note: "G/B" -> "G"
  const slashIdx = chordName.lastIndexOf('/');
  if (slashIdx > 0) {
    const withoutBass = chordName.slice(0, slashIdx);
    if (map[withoutBass]) return map[withoutBass]![0]!;
  }

  // Simplify: try root+m or root
  const root = chordName.match(/^[A-G][#b]?/)?.[0];
  if (root) {
    const quality = chordName.slice(root.length);
    const simplifications = [chordName, root + (quality.startsWith('m') ? 'm' : ''), root];
    for (const candidate of simplifications) {
      if (map[candidate]) return map[candidate]![0]!;
    }
  }

  return null;
}
