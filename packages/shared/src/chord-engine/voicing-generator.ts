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

// Open-string pitch classes per instrument (low → high string).
const GUITAR_TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E
const UKULELE_TUNING = [7, 0, 4, 9];       // G C E A (re-entrant high-G)
const MAX_FRET = 15;
const MAX_FINGERS = 4;   // maximum effective finger count
// Max fret span among fretted notes. Instrument-dependent: a ukulele's
// short scale makes a 4-fret stretch much harder than on guitar, and
// it was the main source of awkward generated uke shapes — so uke is
// capped at 3. Set by setActiveInstrument().
const GUITAR_MAX_STRETCH = 4;
const UKULELE_MAX_STRETCH = 3;
let MAX_STRETCH = GUITAR_MAX_STRETCH;

// The generator was originally guitar-only with these as constants.
// Ukulele support reuses the entire search / playability / barre /
// scoring pipeline unchanged — only the open-string tuning and the
// string count differ. Rather than thread a config object through the
// recursive search (high regression risk on the guitar path), the
// public entry points set this module-level "active instrument"
// context up-front. Generation is synchronous and single-threaded so
// there is no re-entrancy hazard; `generateGuitarVoicings` /
// `generateUkuleleVoicings` each set it before doing any work.
let ACTIVE_TUNING: number[] = GUITAR_TUNING;
let NUM_STRINGS = GUITAR_TUNING.length;
let ACTIVE_INSTRUMENT: 'guitar' | 'ukulele' = 'guitar';

function setActiveInstrument(instrument: 'guitar' | 'ukulele'): void {
  ACTIVE_INSTRUMENT = instrument;
  ACTIVE_TUNING = instrument === 'ukulele' ? UKULELE_TUNING : GUITAR_TUNING;
  NUM_STRINGS = ACTIVE_TUNING.length;
  MAX_STRETCH = instrument === 'ukulele' ? UKULELE_MAX_STRETCH : GUITAR_MAX_STRETCH;
}

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
  return (ACTIVE_TUNING[stringIdx]! + fret) % 12;
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

    // RULE 2: barred strings must be a continuous range — no muted or
    // open strings between the endpoints (a flat finger can't skip a
    // string).
    let continuous = true;
    for (let i = from; i <= to; i++) {
      if (frets[i]! <= 0) { continuous = false; break; }
    }
    if (!continuous) continue;

    // RULE 3: barre must not be blocked by a LOWER-fret note anywhere
    // in the voicing — you can't lay the index finger flat at fret F
    // if some string needs a fret below F.
    let blocked = false;
    for (let i = 0; i < frets.length; i++) {
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

    // RULE 7b: limit how far the OTHER fingers reach above the barre.
    // With the index finger committed to the barre, the remaining
    // three fingers realistically cover frets F+1..F+3 — a reach of
    // 3. Anything beyond that (e.g. F#add9 [2,4,6,3,2,2]: barre at
    // fret 2 but the D string needs fret 6, a reach of 4) is not
    // humanly playable and was previously accepted, producing the
    // bogus "full barre + impossible stretch" diagrams.
    const MAX_REACH_ABOVE_BARRE = 3;
    const maxFretted = Math.max(...fretted.map((x) => x.f));
    if (maxFretted - fr > MAX_REACH_ABOVE_BARRE) continue;

    // ── Rendered barre range ──
    // The physical index-finger bar spans from the first to the last
    // string AT this fret (`from`..`to`). Strings in between that are
    // fretted HIGHER are played by other fingers on top of the bar —
    // the bar still presses fret `fr` underneath them, so it is one
    // continuous bar and SHOULD be drawn full-width (e.g. Csus2
    // [x,3,5,5,3,3]: fret 3 on strings 2,5,6 with 3,4 at fret 5 — a
    // real index bar across strings 2-6, not a tiny 5-6 bar plus a
    // stray dot on string 2).
    //
    // The ONLY thing that breaks the bar is a string between the
    // endpoints that is MUTED or OPEN (fret ≤ 0): a flat finger
    // cannot lie across a string that must ring open or stay silent.
    // In that case the same-fret strings are split into separate
    // finger actions and we don't draw a single bar across the gap.
    let interrupted = false;
    for (let i = from + 1; i < to; i++) {
      if (frets[i]! <= 0) { interrupted = true; break; }
    }
    if (interrupted) continue; // not a single coherent bar — skip
    const renderFrom = from;
    const renderTo = to;
    const renderSpan = renderTo - renderFrom + 1;

    // RULE 5 & 6: prefer smaller barres; full barres need justification
    // We pick the barre that gives the best savings
    // Between equal savings, prefer smaller span (mini-barre)
    if (!bestBarre || savings > bestBarre.savings ||
        (savings === bestBarre.savings && renderSpan < bestBarre.span)) {
      bestBarre = { fret: fr, from: renderFrom, to: renderTo, span: renderSpan, savings };
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

  // Split-barre rejection. A genuine barre chord is one index finger
  // flat across a CONTIGUOUS block of strings at the lowest fret,
  // anchored at the bass-most sounding string (e.g. F [1,3,3,2,1,1] —
  // bar all 6 at fret 1). The awkward, never-actually-played
  // contortion is when a lone string sits at the lowest fret but is
  // ISOLATED from the main bar by higher-fretted strings on the
  // bass side AND the bass-most sounding string is NOT at the bar
  // fret (so there's no real full barre to justify it) — e.g. Csus4
  // x33563: string 1 muted, bar would be strings 2-3 at fret 3, then
  // strings 4-5 at frets 5-6, then a stray fret-3 on string 6.
  // Split-barre / awkward-barre rejection.
  //
  // A barre chord is comfortable when it's either a FULL barre (the
  // index finger lies across every sounding string at minFret, the
  // bass-most sounding string included — F [1,3,3,2,1,1]) OR a small
  // partial bar with the other fingers reaching only a couple of
  // frets above it. The shape musicians never play — and the spec
  // wants removed — is a PARTIAL bar (the bass-most sounding string
  // is muted or above the bar fret on one side) combined with notes
  // reaching well above the bar AND another isolated string back
  // down at the bar fret. Csus4 x33563 = [x,3,3,5,6,3]: string 1
  // muted (not a full barre), bar on 2-3, then 5 & 6, then a stray
  // fret-3 on string 6 — a 4-finger contortion.
  //
  // Rule: when the lowest fret is held on 2+ strings (a bar) AND the
  // bass-most SOUNDING string is muted-side (i.e. it's NOT a full
  // barre because string 1 / lowest index doesn't sound), reject if
  // any note reaches more than 2 frets above minFret. A real partial
  // barre (e.g. A-shape barre) keeps everything within ~2 frets of
  // the bar; the contortions blow past that.
  if (minFret > 0) {
    let minFretCount = 0;
    for (const f of frets) if (f === minFret) minFretCount++;
    const isBarShape = minFretCount >= 2;
    const bassMostSounds = frets[0]! >= 0; // string index 0 sounds
    if (isBarShape && !bassMostSounds) {
      if (maxFret - minFret > 2) return false;
    }
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

/**
 * Pick the most COMMON / practical voicings, 1–4 per chord.
 *
 * Previous behaviour forced one voicing from each of five neck regions
 * (including frets 8–13 and 10–15), so every chord ended up with
 * 12th-fret shapes a normal player would never use. The product rule
 * is now: only the voicings musicians actually reach for —
 * open / low-position first, at most one extra mid-neck shape, and
 * NEVER a high-neck filler when a lower voicing already covers the
 * chord.
 *
 * Algorithm:
 *  1. Sort by score (already favours root-in-bass, open strings, low
 *     frets, small stretch, low finger count).
 *  2. Drop voicings starting above `MAX_PRACTICAL_FRET` unless nothing
 *     lower exists for this chord (some high voicings are the only
 *     playable shape — keep one as a fallback).
 *  3. Take the top-scoring voicing, then add further voicings only
 *     when they are genuinely DIFFERENT (open vs barre, clearly
 *     different position) and still practical — capped at `count`.
 */
function selectDiverseVoicings(voicings: RawVoicing[], count: number): RawVoicing[] {
  if (voicings.length === 0) return [];

  // A voicing whose lowest fretted note is above this is "up the
  // neck" — fine as a deliberate alternative, but not as filler.
  const MAX_PRACTICAL_FRET = 7;

  const sorted = [...voicings].sort((a, b) => b.score - a.score);

  // Prefer the practical (low) ones; keep the high ones only as a
  // last-resort pool so chords that genuinely have no low voicing
  // still return something.
  const practical = sorted.filter((v) => v.lowestFret <= MAX_PRACTICAL_FRET);
  const pool = practical.length > 0 ? practical : sorted;

  const selected: RawVoicing[] = [];
  const isDistinct = (v: RawVoicing): boolean =>
    selected.every((s) => !areTooSimilar(s, v));

  const topScore = pool[0]!.score;

  // 1) The default voicing a player reaches for first. The raw
  //    top-scored shape is often a full barre higher up the neck
  //    (root-in-bass + 6 sounding strings score highly). Musicians
  //    overwhelmingly prefer the LOWEST decent shape (open chords).
  //    So among voicings within a tight score band of the top, pick
  //    the one with the lowest position — that's the "common" voicing
  //    the user expects to see first.
  const PRIMARY_BAND = 45;
  const topTier = pool.filter((v) => topScore - v.score <= PRIMARY_BAND);
  const best = topTier.reduce((lo, v) =>
    v.lowestFret < lo.lowestFret ? v : lo, topTier[0]!);
  selected.push(best);

  // The lowest position any decent voicing reaches for this chord.
  // We anchor the "stay near the action" window to THIS, not to the
  // score-best voicing: the score-best is often a fuller barre shape
  // higher up (root-in-bass + more strings score well), while the
  // shape a player actually wants first is the lowest open one. If we
  // anchored to the best voicing's fret, a chord whose best shape is
  // at fret 5 would happily accept a fret-9 "alternative" — exactly
  // the high-neck filler we're trying to remove.
  const minLow = Math.min(...pool.map((v) => v.lowestFret));

  // 2) Add further voicings only if they are (a) meaningfully
  //    different, (b) close to the action — within 4 frets of the
  //    LOWEST available position, and (c) still GOOD — within a score
  //    band of the best one. The score band stops the selector from
  //    padding out to `count` with mediocre shapes; a chord with only
  //    one or two genuinely common voicings now returns just those
  //    (the spec allows 1–4 — fewer is fine).
  const SCORE_BAND = 70;
  for (const v of pool) {
    if (selected.length >= count) break;
    if (selected.includes(v)) continue;
    if (!isDistinct(v)) continue;
    if (v.lowestFret > minLow + 4) continue;           // near the lowest position
    if (topScore - v.score > SCORE_BAND) continue;     // must still be a good shape
    selected.push(v);
  }

  return selected.slice(0, count);
}

// ─── Output ──────────────────────────────────────────────────────────────────

// The chord-diagram renderer shows a fixed 5-fret window starting at
// `baseFret`. `baseFret` MUST be chosen so the ENTIRE voicing
// (minFret..maxFret) fits in that window — otherwise the renderer
// silently drops any dot whose fret falls outside the window.
//
// The old rule `minFret <= 4 ? 1 : minFret` only looked at minFret, so
// a voicing like Csus4 [x,3,5,5,6,x] (min 3, max 6) got baseFret 1 →
// the renderer's 5-fret window is frets 1–5 → the fret-6 note (the
// sus4's 4th) was dropped, making the chord look like a power chord.
//
// Correct: if the highest fret is within the first 5 frets, anchor at
// the nut (baseFret 1) for the familiar open-position look; otherwise
// anchor so the window's last fret is the highest fretted note
// (`maxFret - 4`). Since MAX_STRETCH ≤ 4, `maxFret - 4 ≤ minFret`
// always, so the whole voicing is guaranteed to fit.
const DIAGRAM_FRET_WINDOW = 5;
function computeBaseFret(frettedValues: number[]): number {
  if (frettedValues.length === 0) return 1;
  const maxFret = Math.max(...frettedValues);
  if (maxFret <= DIAGRAM_FRET_WINDOW) return 1;
  return maxFret - (DIAGRAM_FRET_WINDOW - 1);
}

function toChordDiagram(voicing: RawVoicing, chordName: string): ChordDiagram {
  const frettedValues = voicing.frets.filter((f): f is number => typeof f === 'number' && f > 0);
  const baseFret = computeBaseFret(frettedValues);

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
    instrument: ACTIVE_INSTRUMENT,
    baseFret,
    strings: NUM_STRINGS,
    frets: voicing.frets,
    ...(barre ? { barre } : {}),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

function generateVoicings(chordName: string, count: number): ChordDiagram[] {
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

export function generateGuitarVoicings(chordName: string, count: number = 5): ChordDiagram[] {
  setActiveInstrument('guitar');
  return generateVoicings(chordName, count);
}

/** Generate ukulele (GCEA, 4 strings) voicings using the exact same
 *  search / playability / barre / scoring pipeline as guitar. The
 *  re-entrant high-G tuning is intentional — it's the standard
 *  soprano/concert/tenor ukulele tuning. */
export function generateUkuleleVoicings(chordName: string, count: number = 5): ChordDiagram[] {
  setActiveInstrument('ukulele');
  return generateVoicings(chordName, count);
}

/**
 * Generate slash-chord voicings: the parent chord (`chordName`) voiced
 * so the LOWEST sounding string is the requested bass pitch
 * (`bassNote`). Reuses the normal pipeline, then filters the candidate
 * voicings to those whose lowest sounding note matches the bass — a
 * true slash voicing, not a relabeled plain chord.
 *
 * On ukulele the high-G string is re-entrant (not the lowest pitch),
 * so "lowest sounding string" means the lowest STRING INDEX that
 * sounds, which is what a player frets/visually reads as the bass.
 *
 * Returns [] when no playable voicing puts that bass on the bottom —
 * the caller (slash-chord build) then skips that entry rather than
 * emit a wrong shape.
 */
function generateSlashVoicingsInternal(
  chordName: string,
  bassNote: string,
  count: number,
): ChordDiagram[] {
  const pool = generateVoicings(chordName, 12);
  if (pool.length === 0) return [];
  const bassPc = ((noteToSemitone(bassNote) % 12) + 12) % 12;

  // Lowest open-string index (the visual "bass-most" string). For
  // guitar that's string 0 (low E); for ukulele the re-entrant high-G
  // makes string 0 not the lowest pitch, but it's still the string a
  // player reads as the bass position, which is what matters visually.
  const results: ChordDiagram[] = [];
  const seen = new Set<string>();

  for (const d of pool) {
    // ChordDiagram.frets allows `null` (hidden string); the generator
    // never emits it, but normalize defensively so the slash logic
    // only ever deals with number | 'x'.
    const frets: Array<number | 'x'> = d.frets.map((f) => (f === null ? 'x' : f)) as Array<number | 'x'>;

    // Find the lowest string we can use for the bass: scan from
    // string 0 up; the FIRST string gets the bass, everything strictly
    // below it is muted, the chord shape above is preserved.
    // Try placing the bass on string 0, then string 1, etc., picking
    // the first placement that is within reach of the existing shape.
    let placed = false;
    for (let bassStr = 0; bassStr < frets.length - 1 && !placed; bassStr++) {
      // Fret on `bassStr` that yields the bass pitch (prefer the
      // lowest non-negative fret within the playable window).
      let bassFret = -1;
      for (let f = 0; f <= MAX_FRET; f++) {
        if (pitchAt(bassStr, f) === bassPc) { bassFret = f; break; }
      }
      if (bassFret < 0) continue;

      // The chord notes that sound ABOVE the bass string.
      const upper = frets.slice(bassStr + 1).filter((x) => x !== 'x') as number[];
      const upperFretted = upper.filter((f) => f > 0);
      // Keep the bass within a sane span of the chord shape so the
      // result is actually playable (reuse the global stretch limit;
      // an open bass string — fret 0 — is always reachable).
      if (bassFret > 0 && upperFretted.length > 0) {
        const lo = Math.min(bassFret, ...upperFretted);
        const hi = Math.max(bassFret, ...upperFretted);
        if (hi - lo > MAX_STRETCH) continue;
      }

      const next: Array<number | 'x'> = frets.map((f, i) => {
        if (i < bassStr) return 'x';          // mute everything below the bass
        if (i === bassStr) return bassFret;   // the slash bass
        return f;                              // preserve the chord shape
      });

      // Must still sound at least 3 notes total (bass + chord).
      const sounding = next.filter((f) => f !== 'x').length;
      if (sounding < 3) continue;

      const key = next.join(',');
      if (seen.has(key)) { placed = true; break; }
      seen.add(key);

      // Recompute baseFret from the actual frets (muting lower
      // strings can change the lowest fret). Use the shared
      // computeBaseFret so the whole grip fits the 5-fret render
      // window (same Csus4-style drop bug applies here otherwise).
      // Drop any inherited barre — muting the low strings invalidates
      // the parent's barre and these slash grips are small enough not
      // to need one.
      const fretted = next.filter((f): f is number => typeof f === 'number' && f > 0);
      const baseFret = computeBaseFret(fretted);

      results.push({
        name: chordName + '/' + bassNote,
        instrument: d.instrument,
        baseFret,
        strings: d.strings,
        frets: next,
      });
      placed = true;
    }
    if (results.length >= count) break;
  }

  return results.slice(0, count);
}

export function generateGuitarSlashVoicings(chordName: string, bassNote: string, count = 3): ChordDiagram[] {
  setActiveInstrument('guitar');
  return generateSlashVoicingsInternal(chordName, bassNote, count);
}

export function generateUkuleleSlashVoicings(chordName: string, bassNote: string, count = 3): ChordDiagram[] {
  setActiveInstrument('ukulele');
  return generateSlashVoicingsInternal(chordName, bassNote, count);
}
