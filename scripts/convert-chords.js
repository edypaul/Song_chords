#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'chords.json'), 'utf8'));

const keyMap = {
  'C':'C','Csharp':'C#','D':'D','Eb':'Eb','E':'E',
  'F':'F','Fsharp':'F#','G':'G','Ab':'Ab','A':'A','Bb':'Bb','B':'B',
};

// Map JSON suffixes → our app suffixes (only the 44 in dropdown)
const suffixMap = {
  'major':'', 'minor':'m', 'dim':'°', 'dim7':'°7',
  'sus2':'sus2', 'sus4':'sus4',
  '5':'5', '6':'6', '69':'6/9',
  '7':'7', '7b5':'7b5', '7sus4':'7sus4',
  'aug':'aug', 'aug7':'+7', 'aug9':'+9',
  '9':'9', '9b5':'9b5',
  '7b9':'7b9', '7#9':'7#9',
  '11':'11', '13':'13',
  'maj7':'maj7', 'maj9':'maj9', 'maj11':'maj7#11', 'maj13':'maj13',
  'm6':'m6', 'm69':'m6/9', 'm7':'m7', 'm7b5':'m7b5',
  'm9':'m9', 'm11':'m11',
  'mmaj7':'m(maj7)', 'mmaj9':'m9(maj7)',
  'add9':'add9', 'madd9':'m(add9)',
};

// Max 3 positions per chord
const MAX_POS = 3;

/**
 * Count how many fingers are needed to play a voicing.
 * Uses the source data's barres/capo info when available.
 * A barre covers all strings at that fret with 1 finger.
 * Each other fretted string needs its own finger.
 * Returns the number of fingers needed (max playable = 4).
 */
function countFingersNeeded(pos) {
  const frets = pos.frets;
  const fretted = [];
  for (let i = 0; i < frets.length; i++) {
    const f = frets[i];
    if (f !== 'x' && f !== -1 && Number(f) > 0) {
      fretted.push({ string: i, fret: Number(f) });
    }
  }
  if (fretted.length <= 4) return fretted.length;

  // If the source data declares barres, use them — but validate no muted/open gaps
  if (pos.barres && pos.barres.length > 0) {
    let savings = 0;
    for (const barreFret of pos.barres) {
      const atFret = fretted.filter(f => f.fret === barreFret);
      if (atFret.length >= 2) {
        const from = Math.min(...atFret.map(f => f.string));
        const to = Math.max(...atFret.map(f => f.string));
        // Barre only valid if no muted/open strings between endpoints
        let valid = true;
        for (let i = from; i <= to; i++) {
          if (frets[i] === 0 || frets[i] === -1 || frets[i] === 'x') { valid = false; break; }
        }
        if (valid) savings += atFret.length - 1;
      }
    }
    return fretted.length - savings;
  }

  // No declared barres — try to detect: find the lowest fret shared by 2+ consecutive strings
  const fretGroups = {};
  for (const { string, fret } of fretted) {
    if (!fretGroups[fret]) fretGroups[fret] = [];
    fretGroups[fret].push(string);
  }

  let bestSavings = 0;
  for (const [fret, strings] of Object.entries(fretGroups)) {
    if (strings.length < 2) continue;
    const from = Math.min(...strings);
    const to = Math.max(...strings);
    // Check no open/muted strings between endpoints
    let valid = true;
    for (let i = from; i <= to; i++) {
      const val = frets[i];
      if (val === 0 || val === -1 || val === 'x') { valid = false; break; }
    }
    if (valid) {
      const savings = strings.length - 1;
      if (savings > bestSavings) bestSavings = savings;
    }
  }

  return fretted.length - bestSavings;
}

/**
 * Check if a position is playable (≤ 4 fingers needed)
 */
function isPlayable(pos) {
  return countFingersNeeded(pos) <= 4;
}

const lines = [];
lines.push("import type { ChordDiagram } from '../types/chord.types';");
lines.push('');
lines.push('export const GUITAR_DIAGRAMS: Record<string, ChordDiagram[]> = {');

let totalSkipped = 0;

for (const [jsonKey, chordList] of Object.entries(data.chords)) {
  const rootNote = keyMap[jsonKey];
  if (!rootNote) continue;

  for (const chord of chordList) {
    const mapped = suffixMap[chord.suffix];
    if (mapped === undefined) continue;

    const chordName = rootNote + mapped;
    // Filter to playable positions, then take up to MAX_POS
    const allPositions = chord.positions || [];
    const playable = allPositions.filter(isPlayable);
    const skipped = allPositions.length - playable.length;
    totalSkipped += skipped;
    const positions = playable.slice(0, MAX_POS);
    if (positions.length === 0) continue;

    const diagrams = positions.map((pos) => {
      const baseFret = pos.baseFret || 1;
      const absFrets = pos.frets.map((f) => {
        if (f === -1) return "'x'";
        if (f === 0) return 0;
        return f + baseFret - 1;
      });

      let barreStr = '';
      if (pos.barres && pos.barres.length > 0 && pos.capo) {
        const barreFretRel = pos.barres[0];
        const barreFretAbs = barreFretRel + baseFret - 1;
        // Find strings at barre fret, check no open strings between
        const stringIndices = [];
        for (let i = 0; i < pos.frets.length; i++) {
          if (pos.frets[i] === barreFretRel) stringIndices.push(i);
        }
        if (stringIndices.length >= 2) {
          const fromIdx = Math.min(...stringIndices);
          const toIdx = Math.max(...stringIndices);
          // Check no open strings between endpoints
          let hasOpen = false;
          for (let i = fromIdx; i <= toIdx; i++) {
            if (pos.frets[i] === 0) { hasOpen = true; break; }
          }
          if (!hasOpen) {
            barreStr = `, barre:{fret:${barreFretAbs},fromString:${fromIdx + 1},toString:${toIdx + 1}}`;
          }
        }
      }

      let fingersStr = '';
      if (pos.fingers && pos.fingers.some((f) => f > 0)) {
        fingersStr = `, fingers:[${pos.fingers.join(',')}]`;
      }

      return `    { name:'${chordName}', instrument:'guitar', baseFret:${baseFret}, strings:6, frets:[${absFrets.join(',')}]${fingersStr}${barreStr} }`;
    });

    lines.push(`  '${chordName}': [`);
    lines.push(diagrams.join(',\n') + ',');
    lines.push('  ],');
  }
}

// Add missing chord types not in the JSON database with manual voicings
// These are the types from our dropdown that don't exist in tombatossals DB
const manualChords = {
  // mb6 (minor flat 6) - for all 12 keys, use A-shape movable
  'mb6': { shape: ['x',0,2,1,1,0], rootString: 2, rootFret: 0 },
  // m9b5 - A-shape
  'm9b5': { shape: ['x',0,1,0,1,2], rootString: 2, rootFret: 0 },
  // m9(maj7) - A-shape (4 fretted notes max)
  'm9(maj7)': { shape: ['x',0,1,0,0,2], rootString: 2, rootFret: 0 },
  // m13 - E-shape shell
  'm13': { shape: [0,2,0,0,2,0], rootString: 1, rootFret: 0 },
  // 9sus4 - E-shape
  '9sus4': { shape: [0,2,0,2,0,2], rootString: 1, rootFret: 0 },
  // 7b5(#9) - E-shape
  '7b5(#9)': { shape: [0,1,0,1,3,'x'], rootString: 1, rootFret: 0 },
  // 7#11 - A-shape
  '7#11': { shape: ['x',0,1,0,2,0], rootString: 2, rootFret: 0 },
  // 13sus4 - E-shape
  '13sus4': { shape: [0,2,0,2,2,0], rootString: 1, rootFret: 0 },
  // + (augmented) - 4-string voicing to stay playable
  '+': { shape: ['x',0,3,2,2,'x'], rootString: 2, rootFret: 0 },
  // +7b9
  '+7b9': { shape: [0,3,0,1,0,1], rootString: 1, rootFret: 0 },
  // +7#9
  '+7#9': { shape: [0,3,0,1,0,3], rootString: 1, rootFret: 0 },
};

const roots = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const noteIndex = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
const tuning = ['E','A','D','G','B','E'];

for (const [suffix, tmpl] of Object.entries(manualChords)) {
  for (const root of roots) {
    const chordName = root + suffix;
    // Check if already generated from JSON
    const existing = lines.some(l => l.includes(`'${chordName}':`));
    if (existing) continue;

    const openNote = noteIndex[tuning[tmpl.rootString - 1]];
    const rootNote = noteIndex[root];
    const shift = ((rootNote - openNote) % 12 + 12) % 12;

    const frets = tmpl.shape.map(f => {
      if (f === 'x') return "'x'";
      return f + shift;
    });

    // Check playability of shifted shape
    const fretValues = tmpl.shape.map(f => {
      if (f === 'x') return -1;
      return f + shift;
    });
    if (countFingersNeeded({ frets: fretValues }) > 4) {
      console.error(`WARNING: Manual chord ${chordName} needs >4 fingers, skipping`);
      continue;
    }

    // Detect barre
    const numFrets = frets.map(f => f === "'x'" ? -1 : Number(f));
    const played = numFrets.filter(f => f > 0);
    let barreStr = '';
    if (played.length >= 2) {
      const groups = {};
      numFrets.forEach((f, i) => {
        if (f > 0) {
          if (!groups[f]) groups[f] = [];
          groups[f].push(i);
        }
      });
      for (const [fret, indices] of Object.entries(groups)) {
        if (indices.length >= 2) {
          const from = Math.min(...indices);
          const to = Math.max(...indices);
          let hasOpen = false;
          for (let i = from; i <= to; i++) {
            if (numFrets[i] === 0) { hasOpen = true; break; }
          }
          // Check all between are >= fret
          let valid = true;
          let hasHigher = false;
          for (let i = from; i <= to; i++) {
            if (numFrets[i] === -1) continue;
            if (numFrets[i] === 0) { valid = false; break; }
            if (numFrets[i] < Number(fret)) { valid = false; break; }
            if (numFrets[i] > Number(fret)) hasHigher = true;
          }
          if (valid && hasHigher && !hasOpen) {
            barreStr = `, barre:{fret:${fret},fromString:${from+1},toString:${to+1}}`;
            break;
          }
        }
      }
    }

    const baseFret = played.length > 0 ? (Math.min(...played) <= 3 ? 1 : Math.min(...played)) : 1;

    lines.push(`  '${chordName}': [`);
    lines.push(`    { name:'${chordName}', instrument:'guitar', baseFret:${baseFret}, strings:6, frets:[${frets.join(',')}]${barreStr} },`);
    lines.push('  ],');
  }
}

lines.push('};');
console.log(lines.join('\n'));
console.error(`\nFiltered out ${totalSkipped} unplayable voicings from source data.`);
