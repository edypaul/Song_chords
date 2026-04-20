/**
 * Guitar voicing generator — v2
 *
 * Generates playable chord voicings using:
 *   - Tiered tone validation (required / preferred / optional / avoid)
 *   - Realistic barre detection with 7 physical rules
 *   - Effective finger count (not raw fretted-note count)
 *   - Hand geometry constraints (stretch, collisions, layering)
 *   - Scoring that rewards playability over theoretical completeness
 */

import type { ChordDiagram } from '../types/chord.types';
import type { ChordFormula } from './formulas';
import { noteToSemitone, getFormula, parseChordName } from './formulas';

// ─── Constants ───────────────────────────────────────────────────────────────

const GUITAR_TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E in semitones
const NUM_STRINGS = 6;
const MAX_FRET = 15;
const MAX_STRETCH = 4;   // max fret span among fretted notes
const MAX_FINGERS = 4;   // maximum effective finger count

// ─── Types ───────────────────────────────────────────────────────────────────

interface BarreInfo {
  fret: number;
  from: number; // string index (0-based)
  to: number;   // string index (0-based)
  span: number; // number of strings covered
  savings: number; // fingers saved
}

interface FingerAnalysis {
  effectiveFingers: number;
  barre: BarreInfo | null;
  /** Whether the barre is a full 5-6 string barre */
  isFullBarre: boolean;
}

interface RawVoicing {
  frets: Array<number | 'x'>;
  score: number;
  lowestFret: number;
  hasOpenStrings: boolean;
}

// ─── Fretboard helpers ───────────────────────────────────────────────────────

function pitchAt(stringIdx: number, fret: number): number {
  return (GUITAR_TUNING[stringIdx]! + fret) % 12;
}

// ─── PART 4: Realistic barre detection (7 rules) ────────────────────────────

/**
 * Detect the best valid barre for a voicing.
 * Applies all 7 realism rules from the spec.
 */
function detectBarre(frets: number[]): BarreInfo | null {
  const fretted: { s: number; f: number }[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! > 0) fretted.push({ s: i, f: frets[i]! });
  }
  // No barre needed if ≤ 4 fretted notes
  if (fretted.length <= MAX_FINGERS) return null;

  // RULE 8: barres cannot coexist with open strings — physically impossible
  // (you can't lay a finger flat while leaving a string open)
  const hasOpenStrings = frets.some((f) => f === 0);
  if (hasOpenStrings) return null;

  // Group fretted strings by fret number
  const groups: Record<number, number[]> = {};
  for (const { s, f } of fretted) {
    if (!groups[f]) groups[f] = [];
    groups[f]!.push(s);
  }

  let bestBarre: BarreInfo | null = null;

  for (const [fretStr, strings] of Object.entries(groups)) {
    const fr = Number(fretStr);
    // RULE 1: barred strings must share the same fret
    if (strings!.length < 2) continue;

    const from = Math.min(...strings!);
    const to = Math.max(...strings!);
    const span = to - from + 1;

    // RULE 2: barred strings must be adjacent/continuous range
    // Check no muted or open strings between endpoints
    let continuous = true;
    for (let i = from; i <= to; i++) {
      if (frets[i]! <= 0) { continuous = false; break; }
    }
    if (!continuous) continue;

    // RULE 3: barre must not be blocked by lower-fret fingers inside the range
    // All strings in the barre range must have fret >= barreFret
    let blocked = false;
    for (let i = from; i <= to; i++) {
      if (frets[i]! > 0 && frets[i]! < fr) { blocked = true; break; }
    }
    if (blocked) continue;

    // RULE 4: barre must reduce total finger effort meaningfully
    // Count how many actual fretted strings at this fret fall within the range
    let coveredAtFret = 0;
    for (let i = from; i <= to; i++) {
      if (frets[i]! === fr) coveredAtFret++;
    }
    const savings = coveredAtFret - 1; // 1 finger replaces coveredAtFret fingers
    if (savings < 1) continue; // must save at least 1 finger

    // RULE 7: verify the barre finger can physically do one coherent action
    // The barre fret should be the lowest fret in the voicing (or close to it)
    // so the index finger can lay flat while other fingers reach higher
    const minFretted = Math.min(...fretted.map((x) => x.f));
    if (fr > minFretted) continue; // barre should be at the lowest fret

    // RULE 5 & 6: prefer smaller barres; full barres need justification
    // We pick the barre that gives the best savings
    // Between equal savings, prefer smaller span (mini-barre)
    if (!bestBarre || savings > bestBarre.savings ||
        (savings === bestBarre.savings && span < bestBarre.span)) {
      bestBarre = { fret: fr, from, to, span, savings };
    }
  }

  return bestBarre;
}

// ─── PART 3: Effective finger count ──────────────────────────────────────────

/**
 * Analyze the effective finger count for a voicing.
 * This counts independent finger placements after barre logic.
 */
function analyzeFingers(frets: number[]): FingerAnalysis {
  const fretted: { s: number; f: number }[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! > 0) fretted.push({ s: i, f: frets[i]! });
  }

  if (fretted.length <= MAX_FINGERS) {
    return { effectiveFingers: fretted.length, barre: null, isFullBarre: false };
  }

  const barre = detectBarre(frets);
  if (!barre) {
    return { effectiveFingers: fretted.length, barre: null, isFullBarre: false };
  }

  const effectiveFingers = fretted.length - barre.savings;
  const isFullBarre = barre.span >= 5;

  return { effectiveFingers, barre, isFullBarre };
}

// ─── PART 2: Physical playability filter ─────────────────────────────────────

/**
 * Check hand geometry constraints beyond basic finger count.
 */
function isPhysicallyPlayable(frets: number[]): boolean {
  const fretted: { s: number; f: number }[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! > 0) fretted.push({ s: i, f: frets[i]! });
  }
  if (fretted.length === 0) return true;

  // Fret stretch check
  const fretValues = fretted.map((x) => x.f);
  const minFret = Math.min(...fretValues);
  const maxFret = Math.max(...fretValues);
  if (maxFret - minFret > MAX_STRETCH) return false;

  // Effective finger count
  const analysis = analyzeFingers(frets);
  if (analysis.effectiveFingers > MAX_FINGERS) return false;

  // If full barre, verify it creates a compact shape (not wasteful)
  if (analysis.isFullBarre && analysis.barre) {
    // Full barre is only justified if there are notes above the barre fret
    const notesAboveBarre = fretted.filter((x) => x.f > analysis.barre!.fret);
    if (notesAboveBarre.length === 0) return false; // pointless full barre
  }

  // Open + fretted mixing: fretted notes must be ≤ fret 4
  const hasOpen = frets.some((f) => f === 0);
  if (hasOpen && maxFret > 4) return false;

  // Interior mutes: max 1 muted string between sounding strings
  let firstSounding = -1;
  let lastSounding = -1;
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! >= 0) {
      if (firstSounding === -1) firstSounding = i;
      lastSounding = i;
    }
  }
  if (firstSounding >= 0) {
    let interiorMutes = 0;
    for (let i = firstSounding; i <= lastSounding; i++) {
      if (frets[i]! === -1) interiorMutes++;
    }
    if (interiorMutes > 1) return false;
  }

  return true;
}

// ─── PART 1: Tiered tone validation ─────────────────────────────────────────

/**
 * Validate a voicing using tiered tone system.
 * Returns null if invalid, or a penalty score (0 = perfect, higher = worse).
 */
function validateTones(
  frets: number[],
  rootSemitone: number,
  formula: ChordFormula,
): number | null {
  const sounding: number[] = []; // pitch classes of sounding notes
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! >= 0) {
      sounding.push(pitchAt(i, frets[i]!));
    }
  }

  // Must have at least 3 sounding strings (2 for power chords)
  const minStrings = formula.intervals.length <= 2 ? 2 : 3;
  if (sounding.length < minStrings) return null;

  const presentPitches = new Set(sounding);
  const chordPitches = new Set(formula.intervals.map((i) => (rootSemitone + i) % 12));

  // All sounding notes must belong to the chord (no foreign notes)
  for (const p of presentPitches) {
    if (!chordPitches.has(p)) return null;
  }

  // Check avoid list (e.g., 3rd in sus chords)
  if (formula.avoid) {
    for (const avoidInterval of formula.avoid) {
      const avoidPitch = (rootSemitone + avoidInterval) % 12;
      if (presentPitches.has(avoidPitch)) return null;
    }
  }

  // Tier 1: required — must ALL be present
  for (const idx of formula.tier1) {
    const pitch = (rootSemitone + formula.intervals[idx]!) % 12;
    if (!presentPitches.has(pitch)) return null;
  }

  // Tier 2: strongly preferred — missing = penalty
  let penalty = 0;
  for (const idx of formula.tier2) {
    const pitch = (rootSemitone + formula.intervals[idx]!) % 12;
    if (!presentPitches.has(pitch)) penalty += 20;
  }

  return penalty;
}

// ─── Voicing search ──────────────────────────────────────────────────────────

function generateRawVoicings(rootSemitone: number, formula: ChordFormula): RawVoicing[] {
  const chordPitches = new Set(formula.intervals.map((i) => (rootSemitone + i) % 12));
  const avoidPitches = new Set((formula.avoid ?? []).map((i) => (rootSemitone + i) % 12));
  const rootPitch = rootSemitone % 12;

  const results: RawVoicing[] = [];

  for (let windowStart = 0; windowStart <= MAX_FRET - MAX_STRETCH; windowStart++) {
    const allowOpen = windowStart === 0;
    const options: number[][] = [];

    for (let s = 0; s < NUM_STRINGS; s++) {
      const stringOptions: number[] = [-1]; // muted

      if (allowOpen) {
        const openPitch = pitchAt(s, 0);
        if (chordPitches.has(openPitch) && !avoidPitches.has(openPitch)) {
          stringOptions.push(0);
        }
      }

      const fretStart = Math.max(1, windowStart);
      const fretEnd = Math.min(windowStart + MAX_STRETCH, MAX_FRET);
      for (let f = fretStart; f <= fretEnd; f++) {
        const pitch = pitchAt(s, f);
        if (chordPitches.has(pitch) && !avoidPitches.has(pitch)) {
          stringOptions.push(f);
        }
      }
      options.push(stringOptions);
    }

    const voicing: number[] = new Array(NUM_STRINGS).fill(-1);
    searchVoicings(voicing, 0, options, rootPitch, rootSemitone, formula, results);
  }

  return results;
}

function searchVoicings(
  voicing: number[],
  stringIdx: number,
  options: number[][],
  rootPitch: number,
  rootSemitone: number,
  formula: ChordFormula,
  results: RawVoicing[],
): void {
  if (stringIdx === NUM_STRINGS) {
    // Physical playability first (PART 2)
    if (!isPhysicallyPlayable(voicing)) return;

    // Tiered tone validation (PART 1)
    const penalty = validateTones(voicing, rootSemitone, formula);
    if (penalty === null) return;

    // Accepted — score it
    const score = scoreVoicing(voicing, rootPitch, rootSemitone, formula) - penalty;
    const frettedValues = voicing.filter((f) => f > 0);
    const lowestFret = frettedValues.length > 0 ? Math.min(...frettedValues) : 0;
    const frets = voicing.map((f) => (f === -1 ? 'x' as const : f));
    results.push({ frets, score, lowestFret, hasOpenStrings: voicing.some((f) => f === 0) });
    return;
  }

  for (const fret of options[stringIdx]!) {
    voicing[stringIdx] = fret;

    // Pruning: fret stretch
    const frettedSoFar = voicing.slice(0, stringIdx + 1).filter((f) => f > 0);
    if (frettedSoFar.length >= 2) {
      const span = Math.max(...frettedSoFar) - Math.min(...frettedSoFar);
      if (span > MAX_STRETCH) continue;
    }

    // Pruning: too many fretted strings already (rough limit)
    if (frettedSoFar.length > MAX_FINGERS + 2) continue;

    // Pruning: no sounding notes after checking half the strings
    if (stringIdx >= 3) {
      const soundCount = voicing.slice(0, stringIdx + 1).filter((f) => f >= 0).length;
      if (soundCount === 0) continue;
    }

    searchVoicings(voicing, stringIdx + 1, options, rootPitch, rootSemitone, formula, results);
  }
}

// ─── PART 5: Scoring ─────────────────────────────────────────────────────────

function scoreVoicing(
  voicing: number[],
  rootPitch: number,
  rootSemitone: number,
  formula: ChordFormula,
): number {
  let score = 0;

  const sounding: { s: number; f: number; pitch: number }[] = [];
  for (let i = 0; i < voicing.length; i++) {
    if (voicing[i]! >= 0) {
      sounding.push({ s: i, f: voicing[i]!, pitch: pitchAt(i, voicing[i]!) });
    }
  }

  // ── Root in bass ──
  if (sounding.length > 0 && sounding[0]!.pitch === rootPitch) {
    score += 50;
    if (sounding.length === 6) score += 20; // full chord with root bass
  }

  // ── Sounding strings ──
  score += sounding.length * 12;

  // ── Open strings ── small bonus
  score += voicing.filter((f) => f === 0).length * 2;

  // ── Finger efficiency (PART 3) ──
  const analysis = analyzeFingers(voicing);
  // Reward lower effective finger count
  score -= analysis.effectiveFingers * 5;
  // Penalize full barres slightly (RULE 6: they need justification)
  if (analysis.isFullBarre) score -= 5;

  // ── Fret position ── prefer lower
  const frettedValues = voicing.filter((f) => f > 0);
  if (frettedValues.length > 0) {
    const avgFret = frettedValues.reduce((a, b) => a + b, 0) / frettedValues.length;
    score -= avgFret * 2;
  }

  // ── Fret stretch ── smaller = easier
  if (frettedValues.length >= 2) {
    const stretch = Math.max(...frettedValues) - Math.min(...frettedValues);
    score -= stretch * 3;
  }

  // ── Interior mutes ── penalize
  let firstSounding = -1;
  let lastSounding = -1;
  for (let i = 0; i < voicing.length; i++) {
    if (voicing[i]! >= 0) {
      if (firstSounding === -1) firstSounding = i;
      lastSounding = i;
    }
  }
  for (let i = firstSounding; i <= lastSounding; i++) {
    if (voicing[i]! === -1) score -= 15;
  }

  // ── Pitch diversity ── penalize excessive duplicates
  const pitchCounts: Record<number, number> = {};
  for (const s of sounding) {
    pitchCounts[s.pitch] = (pitchCounts[s.pitch] ?? 0) + 1;
  }
  for (const count of Object.values(pitchCounts)) {
    if (count > 2) score -= (count - 2) * 5;
  }

  // ── Tier 3 tone completeness ── small bonus for optional tones present
  const presentPitches = new Set(sounding.map((s) => s.pitch));
  for (const idx of formula.tier3) {
    const pitch = (rootSemitone + formula.intervals[idx]!) % 12;
    if (presentPitches.has(pitch)) score += 3;
  }

  return score;
}

// ─── Dedup & selection ───────────────────────────────────────────────────────

function deduplicateVoicings(voicings: RawVoicing[]): RawVoicing[] {
  const seen = new Set<string>();
  return voicings.filter((v) => {
    const key = v.frets.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if two voicings are too similar (differ by only 1 string muted/played).
 * Does NOT consider voicings similar if they have different sounding-string counts
 * (e.g., open partial shape vs full barre are fundamentally different).
 */
function areTooSimilar(a: RawVoicing, b: RawVoicing): boolean {
  let diffs = 0;
  for (let i = 0; i < a.frets.length; i++) {
    if (a.frets[i] !== b.frets[i]) diffs++;
  }
  // Nearly identical: differ by only 1 string
  if (diffs <= 1) return true;

  // Different sounding-string count = different shape character
  const aSound = a.frets.filter((f) => f !== 'x').length;
  const bSound = b.frets.filter((f) => f !== 'x').length;
  if (Math.abs(aSound - bSound) >= 2) return false;

  // One has open strings, the other doesn't = different character
  if (a.hasOpenStrings !== b.hasOpenStrings) return false;

  return false;
}

function selectDiverseVoicings(voicings: RawVoicing[], count: number): RawVoicing[] {
  if (voicings.length <= count) return voicings;

  const sorted = [...voicings].sort((a, b) => b.score - a.score);
  const selected: RawVoicing[] = [];

  /** Check candidate is not too similar to any already selected */
  const isDiverse = (v: RawVoicing): boolean =>
    selected.every((s) => !areTooSimilar(s, v));

  // First: best open-position voicing
  const bestOpen = sorted.find((v) => v.hasOpenStrings);
  if (bestOpen) selected.push(bestOpen);

  // Then: best from each neck region (must be diverse)
  const regions = [
    { min: 0, max: 4 },
    { min: 3, max: 7 },
    { min: 5, max: 10 },
    { min: 8, max: 13 },
    { min: 10, max: 15 },
  ];

  for (const region of regions) {
    if (selected.length >= count) break;
    const candidate = sorted.find(
      (v) => !selected.includes(v) && isDiverse(v) &&
        v.lowestFret >= region.min && v.lowestFret <= region.max
    );
    if (candidate) selected.push(candidate);
  }

  // Fill remaining with next best diverse voicings
  for (const v of sorted) {
    if (selected.length >= count) break;
    if (!selected.includes(v) && isDiverse(v)) selected.push(v);
  }

  // If still not enough (all remaining are similar), just fill
  for (const v of sorted) {
    if (selected.length >= count) break;
    if (!selected.includes(v)) selected.push(v);
  }

  return selected.slice(0, count);
}

// ─── Output ──────────────────────────────────────────────────────────────────

function toChordDiagram(voicing: RawVoicing, chordName: string): ChordDiagram {
  const frettedValues = voicing.frets.filter((f): f is number => typeof f === 'number' && f > 0);
  const minFret = frettedValues.length > 0 ? Math.min(...frettedValues) : 1;
  const baseFret = minFret <= 4 ? 1 : minFret;

  const numericFrets = voicing.frets.map((f) => (f === 'x' ? -1 : f));
  const analysis = analyzeFingers(numericFrets as number[]);

  let barre: ChordDiagram['barre'] | undefined;
  if (analysis.barre) {
    barre = {
      fret: analysis.barre.fret,
      fromString: analysis.barre.from + 1,
      toString: analysis.barre.to + 1,
    };
  }

  return {
    name: chordName,
    instrument: 'guitar',
    baseFret,
    strings: NUM_STRINGS,
    frets: voicing.frets,
    ...(barre ? { barre } : {}),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateGuitarVoicings(chordName: string, count: number = 5): ChordDiagram[] {
  const parsed = parseChordName(chordName);
  if (!parsed) return [];

  const formula = getFormula(parsed.suffix);
  if (!formula) return [];

  const rootSemitone = noteToSemitone(parsed.root);
  const rawVoicings = generateRawVoicings(rootSemitone, formula);
  const unique = deduplicateVoicings(rawVoicings);
  const selected = selectDiverseVoicings(unique, count);

  selected.sort((a, b) => {
    if (a.hasOpenStrings && !b.hasOpenStrings) return -1;
    if (!a.hasOpenStrings && b.hasOpenStrings) return 1;
    return a.lowestFret - b.lowestFret;
  });

  return selected.map((v) => toChordDiagram(v, chordName));
}
