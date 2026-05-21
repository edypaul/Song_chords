/**
 * Frequency ↔ note conversion with configurable A4 reference.
 *
 * The equal-tempered chromatic scale defines every note as a power-
 * of-two interval from a single reference. We use the user-chosen
 * A4 (432, 440, 441…445, or custom) so the tuner can produce
 * "Just-Intonation A=432" style results on demand.
 *
 *   f(n) = A4 * 2^((n - 69) / 12)         where n is MIDI number,
 *                                          A4 = 69, A0 = 21, …
 *
 * Cents between an observed frequency and a target:
 *   c = 1200 * log2(observed / target)
 * Positive = sharp, negative = flat.
 */

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export interface ParsedNote {
  /** Note letter + accidental, e.g. 'A', 'C#', 'Eb'. */
  name: string;
  /** Pitch class 0..11 (C=0). */
  pc: number;
  /** Scientific octave (A4 = 4). */
  octave: number;
  /** MIDI number (A4 = 69). */
  midi: number;
}

/**
 * Convert a frequency to its nearest note + cents offset, given a
 * reference A4. Returns null for non-positive / non-finite input
 * (caller should silence-gate before this).
 */
export function frequencyToNote(
  frequency: number,
  a4Hz: number,
  useFlats = false,
): { note: ParsedNote; cents: number; targetHz: number } | null {
  if (!Number.isFinite(frequency) || frequency <= 0 || a4Hz <= 0) return null;
  // Continuous "MIDI-like" number; round to nearest integer to pick
  // the note, the fractional part * 100 gives cents.
  const midiFloat = 69 + 12 * Math.log2(frequency / a4Hz);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  const targetHz = a4Hz * Math.pow(2, (midi - 69) / 12);
  return { note: midiToNote(midi, useFlats), cents, targetHz };
}

/** MIDI integer → parsed note. */
export function midiToNote(midi: number, useFlats = false): ParsedNote {
  // MIDI 0 = C-1 in scientific pitch notation.
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return { name: names[pc]!, pc, octave, midi };
}

/** "A4", "C#3", "Db5" → MIDI integer, or null if unparseable. */
export function parseNoteName(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const accidental = m[2]!;
  const octave = parseInt(m[3]!, 10);
  const letterPc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = letterPc[letter];
  if (pc === undefined) return null;
  if (accidental === '#') pc += 1;
  else if (accidental === 'b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return (octave + 1) * 12 + pc;
}

/** Note name "A4" + A4 reference → frequency in Hz. Returns null
 *  when the name doesn't parse. */
export function noteNameToFrequency(name: string, a4Hz: number): number | null {
  const midi = parseNoteName(name);
  if (midi === null) return null;
  return a4Hz * Math.pow(2, (midi - 69) / 12);
}

/** Cents between observed and target frequencies. */
export function centsBetween(observed: number, target: number): number {
  if (observed <= 0 || target <= 0) return 0;
  return 1200 * Math.log2(observed / target);
}

/**
 * Pick the target string a note belongs to from a list of strings
 * (used by instrument mode). Returns the index with the smallest
 * absolute cent distance, plus that distance — so we can show "you
 * played E2 closest to the low-E string, +12¢".
 */
export function nearestStringIndex(
  frequency: number,
  stringFrequencies: ReadonlyArray<number>,
): { index: number; cents: number } | null {
  if (stringFrequencies.length === 0 || frequency <= 0) return null;
  let best = 0;
  let bestAbs = Infinity;
  let bestCents = 0;
  for (let i = 0; i < stringFrequencies.length; i++) {
    const c = centsBetween(frequency, stringFrequencies[i]!);
    if (Math.abs(c) < bestAbs) {
      bestAbs = Math.abs(c);
      best = i;
      bestCents = c;
    }
  }
  return { index: best, cents: bestCents };
}

/** Format a note display name like "A4", "C#3". */
export function formatNote(n: ParsedNote): string {
  return n.name + n.octave;
}
