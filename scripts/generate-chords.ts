#!/usr/bin/env npx tsx
/**
 * Generate guitar chord diagrams using the chord engine.
 *
 * This script uses the formula-based voicing generator to produce
 * guitar-diagrams.ts — a static file with all 44 chord types × 12 keys.
 *
 * Usage: npx tsx scripts/generate-chords.ts
 */

import { CHORD_FORMULAS } from '../packages/shared/src/chord-engine/formulas';
import { generateGuitarVoicings } from '../packages/shared/src/chord-engine/voicing-generator';
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Upper bound on variations per chord. Product goal: as MANY common /
// practical guitar voicings as possible (open + the standard moveable
// barre shapes + positional alternates across frets 1–12), never
// dropping characteristic notes. The selector still returns fewer when
// a chord genuinely has fewer good shapes — this is just the ceiling.
const VOICINGS_PER_CHORD = 10;

const outFile = path.join(__dirname, '..', 'packages', 'shared', 'src', 'chord-diagrams', 'guitar-diagrams.ts');

const lines: string[] = [];
lines.push("import type { ChordDiagram } from '../types/chord.types';");
lines.push('');
lines.push('export const GUITAR_DIAGRAMS: Record<string, ChordDiagram[]> = {');

let totalChords = 0;
let totalVoicings = 0;
let emptyChords: string[] = [];

for (const root of ROOTS) {
  for (const formula of CHORD_FORMULAS) {
    const chordName = root + formula.suffix;
    const voicings = generateGuitarVoicings(chordName, VOICINGS_PER_CHORD);

    totalChords++;
    totalVoicings += voicings.length;

    if (voicings.length === 0) {
      emptyChords.push(chordName);
      continue;
    }

    lines.push(`  '${chordName}': [`);
    for (const v of voicings) {
      const fretsStr = v.frets.map((f) => (f === 'x' ? "'x'" : f)).join(',');
      let extras = '';
      if (v.barre) {
        extras += `, barre:{fret:${v.barre.fret},fromString:${v.barre.fromString},toString:${v.barre.toString}}`;
      }
      lines.push(`    { name:'${chordName}', instrument:'guitar', baseFret:${v.baseFret}, strings:6, frets:[${fretsStr}]${extras} },`);
    }
    lines.push('  ],');
  }
}

lines.push('};');

fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');

console.log(`Generated ${totalVoicings} voicings for ${totalChords} chords (${VOICINGS_PER_CHORD} per chord)`);
console.log(`Output: ${outFile}`);
if (emptyChords.length > 0) {
  console.error(`WARNING: No voicings generated for: ${emptyChords.join(', ')}`);
}
