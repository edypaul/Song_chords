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
import { generateGuitarVoicings, drainCanonicalWarnings } from '../packages/shared/src/chord-engine/voicing-generator';
import { GUITAR_KEEP_VOICINGS } from './keep-voicings';
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Product rule (user, 2026-09): guitar = ONLY the most used / useful
// shapes, CAGED first. Ceiling 5 (the five CAGED forms); the curated
// canonical shapes fill the list and generator extras only top up to
// MIN_FILL when a quality has fewer than 3 curated shapes in that key
// — so every chord keeps at least 2–3 variations without the old
// positional-alternate padding.
const VOICINGS_PER_CHORD = 5;
const MIN_FILL = 3;

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
    const voicings = generateGuitarVoicings(chordName, VOICINGS_PER_CHORD, MIN_FILL);

    // Append user-pinned shapes the selector no longer emits (see
    // keep-voicings.ts) — at the END so canonical ordering holds.
    for (const keep of GUITAR_KEEP_VOICINGS[chordName] ?? []) {
      const sigOf = (frets: Array<number | 'x'>) => frets.join(',');
      if (voicings.some((v) => sigOf(v.frets as Array<number | 'x'>) === sigOf(keep.frets))) continue;
      voicings.push({
        name: chordName, instrument: 'guitar', strings: 6,
        baseFret: keep.baseFret, frets: keep.frets,
        ...(keep.barre ? { barre: keep.barre } : {}),
      } as (typeof voicings)[number]);
    }

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
// Curated shapes (canonical-shapes.ts) that failed the engine's own
// validation. A template legitimately not fitting one key is fine;
// the same template failing in EVERY key means a typo in the table.
const canonicalWarnings = drainCanonicalWarnings();
if (canonicalWarnings.length > 0) {
  console.warn(`\n${canonicalWarnings.length} canonical shape(s) rejected:`);
  for (const w of canonicalWarnings) console.warn('  - ' + w);
}
