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
import {
  GUITAR_OPEN_SHAPES, GUITAR_MOVEABLE_SHAPES,
  UKULELE_OPEN_SHAPES, UKULELE_MOVEABLE_SHAPES,
} from './canonical-shapes';
import type { Frets } from './canonical-shapes';

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

/**
 * Finger count for a hand-curated shape, allowing a barre by ANY
 * finger — not just the index at the lowest fret, which is all
 * `detectBarre` models. Textbook grips like C9 `x32333` (ring barre
 * over G-B-e with the index below on D), Bb7 `x13334` and C6 `x35555`
 * (index on A, ring barre above it) are played with 3–4 fingers but
 * `analyzeFingers` counts them as 5 and rejects them.
 *
 * Model: pick one fret `fr` as the barre. The barre covers a maximal
 * run of ADJACENT strings whose fret is ≥ fr (strings inside the run
 * at a higher fret are pressed by other fingers on top of the bar;
 * a muted / open / lower-fretted string breaks the run because a flat
 * finger can't skip it). Each string in the run at exactly `fr` is
 * free; every other fretted note costs one finger. Fingers above the
 * barre may reach ≤ 3 frets. Best (lowest) count over all choices —
 * or the plain fretted count when no barre helps.
 */
function lenientFingerCount(frets: number[]): number {
  const fretted: { s: number; f: number }[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i]! > 0) fretted.push({ s: i, f: frets[i]! });
  }
  if (fretted.length <= MAX_FINGERS) return fretted.length;

  const maxF = Math.max(...fretted.map((x) => x.f));
  let best = fretted.length;
  const candidateFrets = new Set(fretted.map((x) => x.f));
  for (const fr of candidateFrets) {
    if (maxF - fr > 3) continue; // other fingers can't reach that far above a bar
    let s = 0;
    while (s < frets.length) {
      if (frets[s]! < fr) { s++; continue; }
      let e = s;
      while (e + 1 < frets.length && frets[e + 1]! >= fr) e++;
      let atFr = 0;
      for (let i = s; i <= e; i++) if (frets[i] === fr) atFr++;
      if (atFr >= 2) {
        let fingers = 1; // the bar itself
        for (const { s: si, f } of fretted) {
          if (!(f === fr && si >= s && si <= e)) fingers++;
        }
        if (fingers < best) best = fingers;
      }
      s = e + 1;
    }
  }
  return best;
}

// ─── PART 2: Physical playability filter ─────────────────────────────────────

/**
 * Check hand geometry constraints beyond basic finger count.
 *
 * `strict` (default) applies every heuristic, including the
 * split-barre / pointless-full-barre rejections that prune the
 * generator's blind search. Hand-curated canonical shapes pass
 * `strict = false`: they are known-good grips (e.g. the CAGED C-form
 * `x54232`, a barre at 2 with fingers reaching fret 5) that the
 * split-barre heuristic would wrongly throw out, so for them only the
 * hard physical limits — stretch, finger count, open/high mixing,
 * interior mutes — are enforced.
 */
function isPhysicallyPlayable(frets: number[], strict: boolean = true): boolean {
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
  if (strict) {
    const analysis = analyzeFingers(frets);
    if (analysis.effectiveFingers > MAX_FINGERS) return false;

    // If full barre, verify it creates a compact shape (not wasteful)
    if (analysis.isFullBarre && analysis.barre) {
      // Full barre is only justified if there are notes above the barre fret
      const notesAboveBarre = fretted.filter((x) => x.f > analysis.barre!.fret);
      if (notesAboveBarre.length === 0) return false; // pointless full barre
    }
  } else if (lenientFingerCount(frets) > MAX_FINGERS) {
    return false;
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
  if (strict && minFret > 0) {
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

  // On UKULELE only: dense chords physically can't hold every tier1
  // tone plus the named extension on 4 strings. Product rule (user):
  // keep the QUALITY tones (3rd/7th + the characteristic extension);
  // the ROOT is the one tier1 tone allowed to drop (a bass/piano
  // covers it — standard small-instrument voicing practice). We treat
  // a chord as "dense" when it has more distinct tones than the
  // instrument has strings, so basic triads/7ths are unaffected and
  // still require the root.
  let penalty = 0;
  const distinctChordTones = chordPitches.size;
  const rootMayDrop =
    ACTIVE_INSTRUMENT === 'ukulele' && distinctChordTones > NUM_STRINGS;

  // Tier 1: required — must ALL be present (except the droppable root
  // on a dense ukulele chord, which is penalty-scored instead).
  for (const idx of formula.tier1) {
    const interval = formula.intervals[idx]!;
    const pitch = (rootSemitone + interval) % 12;
    if (!presentPitches.has(pitch)) {
      if (rootMayDrop && interval === 0) {
        // Missing root on a dense uke chord: allowed, but penalised so
        // a root-present voicing (when one exists) still wins.
        penalty += 15;
        continue;
      }
      return null;
    }
  }

  // The chord's NAMED characteristic extension — the tone that gives
  // an extended chord its name (the 9 in a 9/m9/maj9, the 13 in a 13,
  // the 6/9's added 9, etc.). It's the highest interval above the b7
  // (interval > 11 once we account for compound, but our formulas
  // store it folded: 9→2, 11→5, 13→9). Concretely: the largest
  // non-core interval, where "core" = root/3rd/5th/7th region. Missing
  // THIS on a chord that's named for it makes E9 sound like E7 — a
  // dropped CHARACTERISTIC note, which the product spec forbids. On
  // ukulele we penalise its absence heavily (more than the droppable
  // root) so a voicing that keeps the extension always outranks one
  // that keeps the root instead, whenever such a voicing exists.
  const CORE = new Set([0, 3, 4, 7, 10, 11]); // 1, b3/3, 5, b7/7
  let namedExt = -1; // interval value of the characteristic extension
  for (const iv of formula.intervals) {
    if (!CORE.has(iv) && iv > namedExt) namedExt = iv;
  }

  // Tier 2: strongly preferred — missing = penalty. The named
  // extension (when this chord has one) is weighted far higher on
  // ukulele so the selector won't trade it away for the root.
  for (const idx of formula.tier2) {
    const interval = formula.intervals[idx]!;
    const pitch = (rootSemitone + interval) % 12;
    if (!presentPitches.has(pitch)) {
      if (ACTIVE_INSTRUMENT === 'ukulele' && interval === namedExt && namedExt >= 0) {
        penalty += 60; // characteristic tone — keep it over the root
      } else {
        penalty += 20;
      }
    }
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
 * Pick the most COMMON / practical voicings, up to `count` per chord.
 *
 * Product goal (user, 2026): as MANY common, practical shapes as
 * possible — the open / low shape PLUS the standard moveable barre
 * shapes and positional alternates across frets 1–12 — never dropping
 * characteristic notes (the tone/playability filters upstream already
 * guarantee guide tones + named extension are present and the shape is
 * humanly playable; this function only chooses WHICH of the valid
 * shapes to surface and in what order).
 *
 * Earlier revisions deliberately throttled this (low-position-only
 * pool, max-2-per-neck-zone, tight score band) to avoid a cramped
 * "same diagram three times" look. The user has now asked for maximum
 * practical coverage instead, so those throttles are lifted:
 *
 *  - The candidate pool is the FULL within-neck set (frets 1–12), not
 *    just shapes whose lowest fret ≤ 7. The standard E-shape / A-shape
 *    barres up the neck are common and now first-class alternates,
 *    not fallback-only.
 *  - No per-fretboard-zone cap — every distinct good shape can appear.
 *  - A generous score band keeps barre / alternate shapes (which
 *    naturally score below an open chord because of finger count and
 *    position) while still rejecting genuinely poor outliers.
 *  - `areTooSimilar` dedup is RETAINED, so near-identical shapes never
 *    appear as literal repeats even without the zone cap.
 *
 * Ordering: the lowest decent shape (the open chord a player reaches
 * for first) is emitted first; the rest follow by score then position.
 */
function selectDiverseVoicings(
  voicings: RawVoicing[],
  count: number,
  seeds: RawVoicing[] = [],
): RawVoicing[] {
  // `seeds` are pre-selected canonical shapes (guitar only — see
  // buildCanonicalVoicings). They occupy the first slots unconditionally
  // and in the order given; the rest of this function only tops the
  // list up with generator-found extras that are distinct from them.
  if (voicings.length === 0) return [...seeds];
  if (seeds.length >= count) return [...seeds];

  // Hard upper bound on the neck position we will emit: guitar
  // voicings live between frets 1–12; nothing higher unless it is the
  // ONLY playable shape for the chord.
  const MAX_EMITTED_FRET = 12;
  const maxFretOf = (v: RawVoicing): number => {
    const ff = v.frets.filter((f): f is number => typeof f === 'number' && f > 0);
    return ff.length ? Math.max(...ff) : 0;
  };
  const withinNeck = voicings.filter((v) => maxFretOf(v) <= MAX_EMITTED_FRET);
  // Fall back to the full set only if NOTHING fits below fret 12 (so a
  // chord that's only playable up high still returns a shape).
  const bounded = withinNeck.length > 0 ? withinNeck : voicings;

  // The pool is the ENTIRE within-neck set, best score first. No
  // low-position-only pre-filter: common barre shapes above fret 7
  // are legitimate alternates the user explicitly wants surfaced.
  const pool = [...bounded].sort((a, b) => b.score - a.score);

  const selected: RawVoicing[] = [...seeds];
  const isDistinct = (v: RawVoicing): boolean =>
    selected.every((s) => !areTooSimilar(s, v));

  const topScore = pool[0]!.score;

  // 1) First slot = the shape a player reaches for first. ONLY when
  //    there are no canonical seeds (rare qualities with no curated
  //    template) — otherwise the seeds already define slot 1.
  //    The raw top-scored shape is often a full barre up the neck
  //    (root-in-bass + 6 sounding strings score highly), but musicians
  //    expect the OPEN-position shape first. Among voicings within a
  //    tight score band of the top, prefer one that actually uses OPEN
  //    STRINGS, and only fall back to lowest-fret position when
  //    comparing two shapes of the same open/closed class.
  const PRIMARY_BAND = 45;
  let best: RawVoicing | null = null;
  if (seeds.length === 0) {
    const topTier = pool.filter((v) => topScore - v.score <= PRIMARY_BAND);
    best = topTier.reduce((bestSoFar, v) => {
      if (v.hasOpenStrings !== bestSoFar.hasOpenStrings) {
        return v.hasOpenStrings ? v : bestSoFar; // open beats closed
      }
      return v.lowestFret < bestSoFar.lowestFret ? v : bestSoFar; // else lower
    }, topTier[0]!);
    selected.push(best);
  }

  // ── Fretboard "zone" spread cap (re-added 2026 at MAX_PER_ZONE=3) ──
  // The renderer draws a fixed 5-fret window anchored at
  // `computeBaseFret`. Without a cap, several shapes whose windows land
  // on the same stretch of neck look like "the same diagram repeated"
  // (the original Dsus4 complaint). Product rule (user): at most 3
  // voicings per fretboard area. Zone = which 5-fret band the shape's
  // RENDERED window starts in (same anchor the renderer uses, so the
  // cap reflects exactly what the user sees).
  const ZONE_SIZE = 5;
  const zoneOf = (v: RawVoicing): number => {
    const ff = v.frets.filter((f): f is number => typeof f === 'number' && f > 0);
    const start = computeBaseFret(ff); // 1 = nut/open window
    return Math.floor((start - 1) / ZONE_SIZE);
  };
  const MAX_PER_ZONE = 3;
  const zoneCounts = new Map<number, number>();
  const bumpZone = (v: RawVoicing) => {
    const z = zoneOf(v);
    zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
  };
  // Every pre-selected shape (seeds, or the slot-1 pick) occupies its
  // zone. Seeds are exempt from the cap themselves — they're curated —
  // but they still count toward it so extras don't crowd their area.
  for (const s of seeds) bumpZone(s);
  if (best) bumpZone(best);

  // 2) Fill the remaining slots. A candidate must be (a) meaningfully
  //    different from every already-picked shape, (b) still good
  //    (within a wide score band — barre / positional alternates score
  //    below an open chord only for finger count + position, not
  //    because they're bad; foreign-note / missing-tone / heavily-
  //    muted / contorted shapes were already removed upstream and
  //    `areTooSimilar` blocks near-duplicates), and (c) NOT exceeding
  //    MAX_PER_ZONE in its fretboard area. Two passes: first prefer a
  //    NEW zone (positional variety, chord-book-like), then top up
  //    allowing up to MAX_PER_ZONE within already-used zones.
  const SCORE_BAND = 130;
  const tryAdd = (preferNewZone: boolean): void => {
    for (const v of pool) {
      if (selected.length >= count) break;
      if (selected.includes(v)) continue;
      if (!isDistinct(v)) continue;
      if (topScore - v.score > SCORE_BAND) continue; // reject only poor outliers
      const z = zoneOf(v);
      if ((zoneCounts.get(z) ?? 0) >= MAX_PER_ZONE) continue; // zone full
      if (preferNewZone && (zoneCounts.get(z) ?? 0) > 0) continue; // pass 1: new zones only
      selected.push(v);
      bumpZone(v);
    }
  };
  tryAdd(true);   // pass 1: spread across NEW zones first
  tryAdd(false);  // pass 2: top up, up to MAX_PER_ZONE per zone

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

/**
 * Drop voicings with too many muted strings. Product rule (user):
 * a guitar voicing that mutes 3+ strings (≤3 sounding on a 6-string)
 * is an uncommon, awkward grip and should be omitted — UNLESS the
 * chord is a power chord (the `5` suffix), where a 2-note shape with
 * 4 muted strings is the *correct* and expected voicing.
 *
 * Only applied on guitar: the ukulele only has 4 strings, so the same
 * absolute threshold would wrongly nuke normal uke shapes.
 */
function filterMutedHeavy(
  voicings: RawVoicing[],
  formula: ChordFormula,
): RawVoicing[] {
  if (ACTIVE_INSTRUMENT !== 'guitar') return voicings;
  const isPowerChord = formula.suffix === '5';
  if (isPowerChord) return voicings;
  const MAX_MUTED = 2; // >2 muted (i.e. ≥3) disqualifies a non-power chord
  return voicings.filter((v) => {
    const muted = v.frets.filter((f) => f === 'x').length;
    return muted <= MAX_MUTED;
  });
}

/**
 * The chord's NAMED characteristic extension: the tone the chord is
 * named for (the 9 in 9/m9/maj9/9sus4, the 13 in 13/maj13/m13, the
 * added 9 in 6/9, etc.) — the largest interval OUTSIDE the core
 * root/3rd/5th/7th region. Returns -1 when the chord has no such tone
 * (plain triads / 7ths), in which case there is nothing extra to
 * require.
 *
 * Mirrors the CORE set used by validateTones' ukulele penalty so the
 * "characteristic tone" is defined identically everywhere.
 */
const CORE_INTERVALS = new Set([0, 3, 4, 7, 10, 11]); // 1, b3/3, 5, b7/7
function namedExtensionInterval(formula: ChordFormula): number {
  let ext = -1;
  for (const iv of formula.intervals) {
    if (!CORE_INTERVALS.has(iv) && iv > ext) ext = iv;
  }
  return ext;
}

/**
 * HARD requirement (user): an emitted voicing of a named-extension
 * chord MUST contain that extension. An A9 without the 9th (B) is just
 * an A7 — dropping the characteristic note is not acceptable, even
 * though `formulas.ts` keeps the extension in tier2 so the *search*
 * can still find playable shapes (forcing it into tier1 historically
 * produced unplayable / empty chords). So we let the search keep its
 * tier2 flexibility, then FILTER the candidate pool here to only the
 * voicings that actually sound the named extension.
 *
 * Fallback: if NO playable voicing contains it (genuinely possible on
 * a 4-string ukulele for very dense chords; almost never on 6-string
 * guitar), return the unfiltered set so the chord is never empty —
 * the absolute physical limit wins over an empty diagram, but only
 * then.
 */
function filterMissingNamedExtension(
  voicings: RawVoicing[],
  rootSemitone: number,
  formula: ChordFormula,
): RawVoicing[] {
  const ext = namedExtensionInterval(formula);
  if (ext < 0) return voicings; // no named extension to enforce
  const extPitch = (rootSemitone + ext) % 12;
  const withExt = voicings.filter((v) => {
    for (let i = 0; i < v.frets.length; i++) {
      const f = v.frets[i];
      if (typeof f === 'number' && f >= 0 && pitchAt(i, f) === extPitch) return true;
    }
    return false;
  });
  return withExt.length > 0 ? withExt : voicings;
}

// ─── Canonical (curated) shapes — guitar only ────────────────────────────────

/** Build-time diagnostics: canonical shapes that failed validation
 *  (a typo in canonical-shapes.ts, or a template that doesn't fit a
 *  given key). Drained by the generate script so mistakes are loud. */
const canonicalWarnings: string[] = [];
export function drainCanonicalWarnings(): string[] {
  return canonicalWarnings.splice(0, canonicalWarnings.length);
}

/**
 * Validate a hand-curated shape with the same tone rules the search
 * uses (every sounding note in the chord, tier-1 tones present, avoid
 * list respected, named extension present, ≤2 muted strings unless a
 * power chord) plus the relaxed physical check. Returns the scored
 * RawVoicing or null (and records why) if it doesn't pass.
 */
function canonicalToRaw(
  frets: Frets,
  rootSemitone: number,
  formula: ChordFormula,
  label: string,
): RawVoicing | null {
  const numeric = frets.map((f) => (f === 'x' ? -1 : f));
  const muted = numeric.filter((f) => f < 0).length;
  if (formula.suffix !== '5' && muted > 2) {
    canonicalWarnings.push(`${label}: >2 muted strings`);
    return null;
  }
  if (!isPhysicallyPlayable(numeric, false)) {
    canonicalWarnings.push(`${label}: fails physical check`);
    return null;
  }
  const penalty = validateTones(numeric, rootSemitone, formula);
  if (penalty === null) {
    canonicalWarnings.push(`${label}: wrong / missing tones`);
    return null;
  }
  const ext = namedExtensionInterval(formula);
  if (ext >= 0) {
    const extPitch = (rootSemitone + ext) % 12;
    const hasExt = numeric.some((f, i) => f >= 0 && pitchAt(i, f) === extPitch);
    if (!hasExt) {
      canonicalWarnings.push(`${label}: missing named extension`);
      return null;
    }
  }
  const score = scoreVoicing(numeric, rootSemitone % 12, rootSemitone, formula) - penalty;
  const fretted = numeric.filter((f) => f > 0);
  return {
    frets: [...frets],
    score,
    lowestFret: fretted.length > 0 ? Math.min(...fretted) : 0,
    hasOpenStrings: numeric.some((f) => f === 0),
  };
}

/**
 * The curated shapes for a chord on the active instrument, in
 * display order:
 *   1. exact-name open shapes (`*_OPEN_SHAPES`), as listed;
 *   2. moveable templates for the quality (`*_MOVEABLE_SHAPES`)
 *      transposed to every root position that fits in frets 0–12,
 *      class 1 (primary forms) before class 2 (alternates), each
 *      class ordered lowest root position first (an open-string
 *      instance counts as position 0).
 * Exact-duplicate frets are dropped (e.g. the E-form at r=0 IS the
 * open E). Guitar and ukulele each have their own tables.
 */
function buildCanonicalVoicings(
  chordName: string,
  rootSemitone: number,
  formula: ChordFormula,
): RawVoicing[] {
  const openShapes = ACTIVE_INSTRUMENT === 'ukulele' ? UKULELE_OPEN_SHAPES : GUITAR_OPEN_SHAPES;
  const moveable = ACTIVE_INSTRUMENT === 'ukulele' ? UKULELE_MOVEABLE_SHAPES : GUITAR_MOVEABLE_SHAPES;
  const MAX_CANONICAL_FRET = 12;
  const out: RawVoicing[] = [];
  const seen = new Set<string>();
  const push = (v: RawVoicing | null): void => {
    if (!v) return;
    const key = v.frets.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  // 1) Open shapes for this exact chord name.
  for (const frets of openShapes[chordName] ?? []) {
    push(canonicalToRaw(frets, rootSemitone, formula, `${chordName} open ${frets.join('')}`));
  }

  // 2) Moveable templates for the quality.
  const templates = moveable[formula.suffix] ?? [];
  const instances: Array<{ v: RawVoicing; cls: number; pos: number; order: number }> = [];
  templates.forEach((t, order) => {
    for (let r = t.minRoot ?? 0; r <= MAX_CANONICAL_FRET; r++) {
      if (pitchAt(t.rootString, r) !== rootSemitone % 12) continue;
      const frets: Frets = t.offsets.map((o) => (o === 'x' ? 'x' : r + o));
      const nums = frets.filter((f): f is number => typeof f === 'number');
      if (nums.some((f) => f < 0)) continue;             // template sits below the nut here
      if (Math.max(...nums) > MAX_CANONICAL_FRET) continue; // off the displayed neck
      const v = canonicalToRaw(frets, rootSemitone, formula, `${chordName} ${t.form} @${r}`);
      if (!v) continue;
      // Position = the ROOT fret (an open-string instance counts as 0),
      // so a full barre at root 3 precedes a top-4 fragment at root 5
      // even though the fragment's lowest fretted note is lower.
      const pos = v.hasOpenStrings ? 0 : r;
      instances.push({ v, cls: t.cls, pos, order });
    }
  });
  instances.sort((a, b) => a.cls - b.cls || a.pos - b.pos || a.order - b.order);
  for (const inst of instances) push(inst.v);

  return out;
}

function generateVoicings(chordName: string, count: number, minFill: number = count): ChordDiagram[] {
  const parsed = parseChordName(chordName);
  if (!parsed) return [];

  const formula = getFormula(parsed.suffix);
  if (!formula) return [];

  const rootSemitone = noteToSemitone(parsed.root);
  const rawVoicings = generateRawVoicings(rootSemitone, formula);
  const unique = deduplicateVoicings(rawVoicings);
  // Remove awkward heavily-muted shapes (power chords exempt) BEFORE
  // selection, so the selector's diversity logic only ever picks from
  // the common, fuller grips.
  const playableSet = filterMutedHeavy(unique, formula);
  // Guard: if the mute filter removed everything (rare — e.g. a chord
  // whose only playable guitar shapes are sparse), fall back to the
  // unfiltered set so we never emit an empty chord.
  const muteFiltered = playableSet.length > 0 ? playableSet : unique;
  // Then drop any shape that omits the chord's NAMED EXTENSION (the
  // 9/11/13/6 it's named for). This is what stops "A9 with no B"
  // (an A7 mislabelled A9) from ever being emitted — including as
  // voicing #1. Self-falls-back if nothing has it.
  const candidates = filterMissingNamedExtension(muteFiltered, rootSemitone, formula);

  // Curated shapes lead (guitar only; [] on ukulele) in their declared
  // order — open chord, then the standard barres by position. The
  // generator's distinct extras follow, open-position ones first then
  // by fret, so the tail reads like the rest of a chord book page.
  const canonical = buildCanonicalVoicings(chordName, rootSemitone, formula).slice(0, count);

  // `count` is the hard ceiling; `minFill` is how far generator extras
  // may top the list up when the curated CAGED templates alone don't
  // reach it. With minFill < count (the bake scripts pass 3 for
  // guitar), a quality with enough canonical shapes emits ONLY those —
  // "the shapes guitarists actually use" — while a rare quality with
  // 0–2 templates still gets filled to minFill so every chord keeps a
  // real choice of variations. minFill = count (the default) is the
  // old fill-to-ceiling behavior, which the slash pipeline relies on
  // for its wide candidate pool.
  const target = Math.min(count, Math.max(canonical.length, minFill));
  const selected = selectDiverseVoicings(candidates, target, canonical);

  const extras = selected.filter((v) => !canonical.includes(v));
  extras.sort((a, b) => {
    if (a.hasOpenStrings && !b.hasOpenStrings) return -1;
    if (!a.hasOpenStrings && b.hasOpenStrings) return 1;
    return a.lowestFret - b.lowestFret;
  });

  return [...canonical, ...extras].slice(0, target).map((v) => toChordDiagram(v, chordName));
}

export function generateGuitarVoicings(chordName: string, count: number = 5, minFill: number = count): ChordDiagram[] {
  setActiveInstrument('guitar');
  return generateVoicings(chordName, count, minFill);
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

      // PHYSICAL PLAYABILITY GATE. The slash path synthesises a bass
      // and DROPS the parent's barre, which can leave a shape that
      // needs 5–6 independent fingers (e.g. A/G [3,7,7,6,5,5]: 6
      // distinct fretted notes, no barre — impossible). The main
      // generator runs every candidate through isPhysicallyPlayable
      // (stretch + effective finger count after barre detection +
      // split-barre / interior-mute rejection); the slash path only
      // checked MAX_STRETCH, so unplayable grips slipped through.
      // Re-use the SAME gate here so slash chords meet the same bar.
      // It re-detects any barre the shape can legitimately use, so a
      // genuinely barre-able grip still passes — only true >4-finger
      // shapes are rejected.
      const numericNext = next.map((f) => (f === 'x' ? -1 : f));
      if (!isPhysicallyPlayable(numericNext)) continue;

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
