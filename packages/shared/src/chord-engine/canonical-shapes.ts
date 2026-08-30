/**
 * Canonical guitar shapes — the hand-curated layer on top of the
 * algorithmic voicing generator.
 *
 * The generator (voicing-generator.ts) is good at exhaustively finding
 * every *playable* grip, but scoring alone can't tell which grips are
 * the ones guitarists actually reach for. Left to itself it led `F`
 * with `1,0,3,2,1,x` instead of the `133211` barre, `Em7` with
 * `0,x,0,0,0,0`, and dropped textbook alternates like `G 320033` or
 * `Fmaj7 xx3210` as "too similar" to a stranger shape it had already
 * picked.
 *
 * This file fixes that by declaring, per chord quality, the standard
 * shapes in priority order:
 *
 *  1. `GUITAR_OPEN_SHAPES` — exact-name open-position chords (the
 *     first-position "cowboy" chords and their common variants).
 *     Listed in the order they should appear.
 *  2. `GUITAR_MOVEABLE_SHAPES` — per-suffix moveable templates (the
 *     CAGED system barres plus the standard 7th / extended grips),
 *     expressed as fret offsets from the root fret on a given string.
 *     Each is transposed to every key where it fits within frets 0–12.
 *
 * Every shape still goes through the engine's tone validation before
 * it is emitted (see `buildCanonicalVoicings` in voicing-generator.ts),
 * so a typo here produces a build-time warning rather than a wrong
 * diagram. The generator then tops the list up with distinct extras.
 *
 * Fret arrays are LOW string → HIGH string (E A D G B e), matching
 * `ChordDiagram.frets`. `'x'` = muted, `0` = open.
 */

export type Frets = Array<number | 'x'>;

/**
 * A moveable shape. `offsets` are relative to the fret of the ROOT
 * note on `rootString` (0 = low E … 5 = high e). Negative offsets are
 * allowed (C-form / G-form shapes sit *below* their root fret); an
 * instance is only emitted when every resulting fret is ≥ 0.
 *
 * `cls` (class) controls ordering after the open shapes:
 *   1 = primary shapes (E-form / A-form / D-form barres and their
 *       equivalents for the quality) — sorted by position, lowest first.
 *   2 = secondary shapes (C-form / G-form, alternate grips) — after
 *       all class-1 shapes, again lowest first.
 */
export interface MoveableShape {
  rootString: number;
  offsets: Frets;
  cls: 1 | 2;
  /** Human label for build-time diagnostics only. */
  form: string;
  /** Lowest root fret this template is emitted at. Jazz "root-6" grips
   *  like `3x343x` are only sensible fretted — at r=0 they degrade into
   *  odd open shapes (`0x010x`), so those declare `minRoot: 1`. */
  minRoot?: number;
}

const X = 'x' as const;

function mv(form: string, rootString: number, offsets: Frets, cls: 1 | 2 = 1, minRoot = 0): MoveableShape {
  return { form, rootString, offsets, cls, minRoot };
}

// ─── Open-position shapes (exact chord name) ─────────────────────────────────
//
// Only shapes that are NOT produced by a moveable template at r=0, or
// whose ORDER needs pinning (e.g. the open B7 must beat the A-form
// barre). Everything else (open A, D, E, Am, Em, Dm, A7, D7, E7, …)
// falls out of the templates below automatically.

export const GUITAR_OPEN_SHAPES: Record<string, Frets[]> = {
  // ── C ──
  'C':      [[X, 3, 2, 0, 1, 0]],
  'C7':     [[X, 3, 2, 3, 1, 0]],
  'Cmaj7':  [[X, 3, 2, 0, 0, 0]],
  'Cmaj9':  [[X, 3, 0, 0, 0, 0]],
  'C6':     [[X, 3, 2, 2, 1, 0]],
  'Cadd9':  [[X, 3, 2, 0, 3, 0], [X, 3, 2, 0, 3, 3]],
  'Csus2':  [[X, 3, 0, 0, 1, 3]],
  'Csus4':  [[X, 3, 3, 0, 1, 1]],

  // ── G ──
  'G':      [[3, 2, 0, 0, 0, 3], [3, 2, 0, 0, 3, 3]],
  'G7':     [[3, 2, 0, 0, 0, 1]],
  'Gmaj7':  [[3, 2, 0, 0, 0, 2]],
  'G6':     [[3, 2, 0, 0, 0, 0]],
  'Gsus4':  [[3, 3, 0, 0, 1, 3]],
  'Gadd9':  [[3, 2, 0, 2, 0, 3], [3, X, 0, 2, 0, 3]],

  // ── E ──
  'E7':     [[0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 3, 0]],
  'Em7':    [[0, 2, 0, 0, 0, 0], [0, 2, 2, 0, 3, 0]],
  'Emaj7':  [[0, 2, 1, 1, 0, 0]],

  // ── A ──
  'A7':     [[X, 0, 2, 0, 2, 0], [X, 0, 2, 2, 2, 3]],
  'Am7':    [[X, 0, 2, 0, 1, 0], [X, 0, 2, 0, 1, 3]],
  'A9':     [[X, 0, 2, 4, 2, 3]],
  'Aadd9':  [[X, 0, 2, 4, 2, 0]],
  'Am(add9)': [[X, 0, 2, 4, 1, 0]],

  // ── F ──
  'Fmaj7':  [[X, X, 3, 2, 1, 0], [1, 3, 3, 2, 1, 0]],

  // ── B ──
  'B7':     [[X, 2, 1, 2, 0, 2]],
};

// ─── Moveable shapes (per chord-quality suffix) ──────────────────────────────

export const GUITAR_MOVEABLE_SHAPES: Record<string, MoveableShape[]> = {
  // ── Major family ──
  '': [
    mv('E-form', 0, [0, 2, 2, 1, 0, 0]),
    mv('A-form', 1, [X, 0, 2, 2, 2, 0]),
    // Top four strings of the E-form — the "easy F" (xx3211), xx5432
    // for G, xx2100 for E. Listed before the D-form so it wins the
    // tie when both sit at the same root fret.
    mv('E-form (top 4)', 2, [X, X, 0, -1, -2, -2]),
    mv('D-form', 2, [X, X, 0, 2, 3, 2]),
    mv('C-form', 1, [X, 0, -1, -3, -2, -3], 2),
    mv('G-form', 0, [0, -1, -3, -3, -3, 0], 2),
  ],
  '5': [
    mv('E-form', 0, [0, 2, 2, X, X, X]),
    mv('A-form', 1, [X, 0, 2, 2, X, X]),
    mv('D-form', 2, [X, X, 0, 2, 3, X]),
  ],
  'sus4': [
    mv('E-form', 0, [0, 2, 2, 2, 0, 0]),
    mv('A-form', 1, [X, 0, 2, 2, 3, 0]),
    mv('E-form (top 4)', 2, [X, X, 0, 0, -2, -2]),
    mv('D-form', 2, [X, X, 0, 2, 3, 3]),
  ],
  'sus2': [
    mv('A-form', 1, [X, 0, 2, 2, 0, 0]),
    mv('D-form', 2, [X, X, 0, 2, 3, 0]),
  ],
  'add9': [
    // E-form only fits as the open Eadd9 (barre versions need 5
    // fingers); the fretted keys come from the C-form.
    mv('E-form', 0, [0, 2, 2, 1, 0, 2]),
    mv('C-form', 1, [X, 0, -1, -3, 0, -3], 2),
  ],
  '6': [
    mv('A-form', 1, [X, 0, 2, 2, 2, 2]),
    mv('D-form', 2, [X, X, 0, 2, 0, 2]),
    mv('C-form', 1, [X, 0, -1, -1, -2, -3], 2),
  ],
  '6/9': [
    mv('A-form', 1, [X, 0, -1, -1, 0, 0]),
    mv('E-form', 0, [0, -1, -1, -1, 0, 0], 2),
  ],
  'maj7': [
    mv('E-form (root-6 jazz)', 0, [0, X, 1, 1, 0, X], 1, 1),
    mv('A-form', 1, [X, 0, 2, 1, 2, 0]),
    mv('D-form', 2, [X, X, 0, 2, 2, 2]),
    mv('E-form barre', 0, [0, 2, 1, 1, 0, 0], 2),
    mv('F-form (top 4)', 2, [X, X, 0, -1, -2, -3], 2),
    mv('C-form', 1, [X, 0, -1, -3, -3, -3], 2),
  ],
  'maj9': [
    mv('A-form', 1, [X, 0, -1, 1, 0, X]),
    mv('E-form', 0, [0, -1, 1, -1, 0, X]),
  ],
  'maj7#11': [
    mv('A-form', 1, [X, 0, 1, 1, 2, X]),
  ],
  'maj13': [
    mv('A-form', 1, [X, 0, -1, 1, 2, 2]),
    mv('E-form', 0, [0, X, 1, 1, 2, X]),
  ],

  // ── Minor family ──
  'm': [
    mv('Em-form', 0, [0, 2, 2, 0, 0, 0]),
    mv('Am-form', 1, [X, 0, 2, 2, 1, 0]),
    mv('Em-form (top 4)', 2, [X, X, 0, -2, -2, -2]),
    mv('Dm-form', 2, [X, X, 0, 2, 3, 1]),
  ],
  'm(add9)': [
    mv('Em-form', 0, [0, 2, 2, 0, 0, 2]),
  ],
  'm6': [
    mv('Am-form', 1, [X, 0, 2, 2, 1, 2]),
    mv('Em-form', 0, [0, 2, 2, 0, 2, 0]),
    mv('Dm-form', 2, [X, X, 0, 2, 0, 1]),
  ],
  'mb6': [
    mv('Am-form', 1, [X, 0, 2, 2, 1, 1]),
    mv('Em-form', 0, [0, 2, 2, 0, 1, 0]),
  ],
  'm6/9': [
    mv('Am-form', 1, [X, 0, -2, -1, 0, X]),
  ],
  'm7': [
    mv('Em7-form', 0, [0, 2, 0, 0, 0, 0]),
    mv('Am7-form', 1, [X, 0, 2, 0, 1, 0]),
    mv('Dm7-form', 2, [X, X, 0, 2, 1, 1]),
    mv('Em7-form (5th on B)', 0, [0, 2, 2, 0, 3, 0], 2),
    mv('root-6 jazz', 0, [0, X, 0, 0, 0, X], 2, 1),
  ],
  'm7b5': [
    mv('A-form', 1, [X, 0, 1, 0, 1, X]),
    mv('E-form', 0, [0, X, 0, 0, -1, X]),
    mv('D-form', 2, [X, X, 0, 1, 1, 1]),
  ],
  'm(maj7)': [
    mv('Am-form', 1, [X, 0, 2, 1, 1, 0]),
    mv('Em-form', 0, [0, 2, 1, 0, 0, 0]),
    mv('Dm-form', 2, [X, X, 0, 2, 2, 1]),
  ],
  'm9': [
    mv('A-form', 1, [X, 0, -2, 0, 0, X]),
    mv('E-form', 0, [0, 2, 0, 0, 0, 2]),
  ],
  'm9(maj7)': [
    mv('A-form', 1, [X, 0, -2, 1, 0, X]),
  ],
  'm11': [
    mv('A-form', 1, [X, 0, -2, 0, 0, -2]),
  ],

  // ── Dominant family ──
  '7': [
    mv('E7-form', 0, [0, 2, 0, 1, 0, 0]),
    mv('A7-form', 1, [X, 0, 2, 0, 2, 0]),
    mv('D7-form', 2, [X, X, 0, 2, 1, 2]),
    mv('E7-form (5th on B)', 0, [0, 2, 0, 1, 3, 0], 2),
    mv('A7-form (b7 on top)', 1, [X, 0, 2, 2, 2, 3], 2),
    mv('root-6 jazz', 0, [0, X, 0, 1, 0, X], 2, 1),
  ],
  '7sus4': [
    mv('E-form', 0, [0, 2, 0, 2, 0, 0]),
    mv('A-form', 1, [X, 0, 2, 0, 3, 0]),
    mv('D-form', 2, [X, X, 0, 2, 1, 3]),
  ],
  '7b5': [
    mv('A-form', 1, [X, 0, 1, 0, 2, X]),
    mv('E-form', 0, [0, X, 0, 1, -1, X]),
  ],
  '9': [
    mv('E-form', 0, [0, 2, 0, 1, 0, 2]),
    mv('A-form', 1, [X, 0, -1, 0, 0, 0]),
    mv('A-form (4 strings)', 1, [X, 0, -1, 0, 0, X], 2),
  ],
  '9sus4': [
    mv('A-form', 1, [X, 0, 0, 0, 0, 0]),
  ],
  '9b5': [
    mv('A-form', 1, [X, 0, -1, 0, 0, -1]),
  ],
  '7b9': [
    mv('A-form', 1, [X, 0, -1, 0, -1, X]),
    mv('E-form', 0, [0, 2, 0, 1, 0, 1]),
    mv('A-form (5th on top)', 1, [X, 0, -1, 0, -1, 0], 2),
  ],
  '7#9': [
    mv('A-form (Hendrix)', 1, [X, 0, -1, 0, 1, X]),
  ],
  '7b5(#9)': [
    mv('A-form', 1, [X, 0, -1, 0, 1, -1]),
  ],
  '11': [
    mv('A-form', 1, [X, 0, 0, 0, 0, X]),
  ],
  '7#11': [
    mv('A-form', 1, [X, 0, 1, 0, 2, X]),
  ],
  '13': [
    // E-form only fits as the open E13; fretted keys use the A-forms.
    mv('E-form', 0, [0, X, 0, 1, 2, 2]),
    mv('A-form', 1, [X, 0, -1, 0, 2, 2]),
    mv('A-form (open-A style)', 1, [X, 0, 2, 0, 2, 2]),
    mv('A-form (jazz, no 9)', 1, [X, 0, -1, 0, X, 2], 2),
  ],
  '13sus4': [
    mv('A-form', 1, [X, 0, 0, 0, 0, 2]),
  ],

  // ── Augmented family ──
  '+': [
    mv('A-form', 1, [X, 0, -1, -2, -2, X]),
    mv('E-form', 0, [0, 3, 2, 1, 1, 0], 2),
  ],
  '+7': [
    mv('A-form', 1, [X, 0, 3, 0, 2, X]),
    mv('E-form', 0, [0, 3, 0, 1, 1, 0]),
  ],
  '+7b9': [
    mv('A-form', 1, [X, 0, -1, 0, -1, 1]),
  ],

  // ── Diminished family ──
  '°': [
    mv('A-form', 1, [X, 0, 1, 2, 1, X]),
  ],
  '°7': [
    mv('A-form', 1, [X, 0, 1, -1, 1, X]),
    mv('D-form', 2, [X, X, 0, 1, 0, 1]),
    mv('E-form', 0, [0, X, -1, 0, -1, X]),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// UKULELE (re-entrant GCEA — strings 0..3 = G C E A)
// ═══════════════════════════════════════════════════════════════════════════
//
// Same idea as guitar. Ukulele shapes are named after the open chord
// they derive from (the C-shape `0003`, A-shape `2100`, D-shape `2220`,
// G-shape `0232`, F-shape `2010`, and their minor / 7th relatives).
// Every template is moveable; the open chords ARE the templates at
// their lowest root fret, so `UKULELE_OPEN_SHAPES` only pins ordering
// / adds shapes the templates don't produce. Uke players rarely mute
// strings, so nearly all shapes sound all four.

export const UKULELE_OPEN_SHAPES: Record<string, Frets[]> = {
  'D7': [[2, 2, 2, 3], [2, 0, 2, 0]],
  'E':  [[4, 4, 4, 2], [1, 4, 0, 2]],
  'Fmaj7': [[2, 4, 1, 3]],
};

export const UKULELE_MOVEABLE_SHAPES: Record<string, MoveableShape[]> = {
  // ── Major family ──
  '': [
    mv('C-shape', 3, [-3, -3, -3, 0]),
    mv('A-shape', 0, [0, -1, -2, -2]),
    mv('D-shape', 1, [0, 0, 0, -2]),
    mv('G-shape', 0, [0, 2, 3, 2]),
    mv('F-shape', 2, [1, -1, 0, -1]),
  ],
  '5': [
    mv('C-shape', 3, [-3, -3, 0, 0]),
    mv('A-shape', 0, [0, 2, -2, -2]),
    mv('D-shape', 1, [0, 0, 3, 3]),
  ],
  'sus4': [
    mv('C-shape', 3, [-3, -3, -2, 0]),
    mv('A-shape', 0, [0, 0, -2, -2]),
    mv('D-shape', 1, [-2, 0, 1, -2]),
    mv('G-shape', 0, [0, 2, 3, 3]),
    mv('F-shape', 2, [2, -1, 0, 0]),
  ],
  'sus2': [
    mv('C-shape', 3, [-3, -1, 0, 0]),
    mv('A-shape', 0, [0, 2, -2, 0]),
    mv('D-shape', 1, [0, 0, -2, -2]),
    mv('G-shape', 0, [0, 2, 3, 0]),
    mv('F-shape', 2, [-1, -1, 0, 2]),
  ],
  'add9': [
    mv('C-shape', 3, [-3, -1, -3, 0]),
    mv('F-shape', 2, [-1, -1, 0, -1]),
    mv('A-shape', 0, [0, -1, -2, 0]),
    mv('D-shape', 1, [0, 2, 0, 3]),
  ],
  '6': [
    mv('C-shape', 3, [-3, -3, -3, -3]),
    mv('G-shape', 0, [0, 2, 0, 2]),
    mv('F-shape', 2, [1, 1, 0, 2]),
    mv('D-shape', 1, [0, 0, 0, 0]),
  ],
  '6/9': [
    mv('C-shape', 3, [-1, -1, -3, 0]),
    mv('rootless', 1, [0, 2, 0, 0]),
  ],
  'maj7': [
    mv('C-shape', 3, [-3, -3, -3, -1]),
    mv('A-shape', 0, [-1, -1, -2, -2]),
    mv('G-shape', 0, [0, 2, 2, 2]),
    mv('F-shape', 2, [1, 3, 0, 2]),
  ],
  'maj9': [
    mv('C-shape', 3, [-3, -1, -3, -1]),
    mv('A-shape', 0, [-1, -1, -2, 0]),
  ],
  'maj7#11': [
    mv('C-shape', 3, [X, 1, -1, -1]),
  ],
  'maj13': [
    mv('C-shape', 3, [-1, -1, -3, -1]),
  ],

  // ── Minor family ──
  'm': [
    mv('Am-shape', 0, [0, -2, -2, -2]),
    mv('Cm-shape', 3, [-3, 0, 0, 0]),
    mv('Dm-shape', 1, [0, 0, -1, -2]),
    mv('Gm-shape', 0, [0, 2, 3, 1]),
    // Em 0432: the root E sits on the C string (fret 4); only fits
    // as the open Em — moved up it needs a 4-fret stretch.
    mv('Em-shape', 1, [-4, 0, -1, -2]),
    mv('Fm-shape', 2, [0, -1, 0, 2]),
  ],
  'm(add9)': [
    mv('Am-shape', 0, [0, -2, -2, 0]),
  ],
  'm6': [
    mv('Am-shape', 0, [0, -2, 0, -2]),
    mv('Cm-shape', 3, [-1, 0, 0, 0]),
    mv('Dm-shape', 1, [0, 0, -1, 0]),
    mv('Gm-shape', 0, [0, 2, 0, 1]),
  ],
  'mb6': [
    mv('Am-shape', 0, [0, -2, -1, -2]),
  ],
  'm6/9': [
    mv('Am-shape', 0, [0, -2, 0, 0]),
  ],
  'm7': [
    mv('Am7-shape', 0, [-2, -2, -2, -2]),
    mv('Dm7-shape', 1, [0, 0, -1, 1]),
    mv('Em7-shape', 2, [0, 2, 0, 2]),
    mv('Gm7-shape', 0, [0, 2, 1, 1]),
  ],
  'm7b5': [
    mv('Cm7b5-shape', 3, [0, 0, -1, 0]),
    mv('Am7b5-shape', 0, [0, 1, 1, 1]),
  ],
  'm(maj7)': [
    mv('Am-shape', 0, [-1, -2, -2, -2]),
    mv('Cm-shape', 3, [-3, 0, 0, -1]),
    mv('Dm-shape', 1, [0, 0, -1, 2]),
  ],
  'm9': [
    mv('Am9-shape', 0, [0, -2, 1, 0]),
    mv('Cm9-shape', 3, [0, 0, 0, 2]),
  ],
  'm11': [
    mv('Cm11-shape', 3, [0, 0, -2, -2]),
  ],
  'm13': [
    mv('Cm13-shape', 3, [-1, 0, -2, -2]),
  ],

  // ── Dominant family ──
  '7': [
    mv('C7-shape', 3, [-3, -3, -3, -2]),
    mv('A7-shape', 0, [-2, -1, -2, -2]),
    mv('G7-shape', 0, [0, 2, 1, 2]),
    mv('E7-shape', 2, [1, 2, 0, 2]),
    mv('D7-shape (Hawaiian)', 1, [0, -2, 0, -2]),
  ],
  '7sus4': [
    mv('C-shape', 3, [-3, -3, -2, -2]),
    mv('G-shape', 0, [0, 2, 1, 3]),
    mv('A-shape', 0, [-2, 0, -2, -2]),
    mv('D-shape', 1, [0, 0, 1, 1]),
  ],
  '7b5': [
    mv('C-shape', 3, [0, 1, -1, 0]),
  ],
  '7#11': [
    mv('C-shape', 3, [0, 1, -1, 0]),
  ],
  '9': [
    mv('C9-shape', 3, [-3, -1, -3, -2]),
    mv('A9-shape', 0, [0, -1, 1, 0]),
    mv('D9-shape', 1, [0, 2, 0, 1]),
  ],
  '9sus4': [
    mv('C-shape', 3, [-3, -1, -2, -2]),
    mv('G-shape', 0, [0, 0, 1, 0]),
  ],
  '9b5': [
    mv('C-shape', 3, [0, 1, -1, 2]),
  ],
  '7b9': [
    mv('C-shape', 3, [-3, -2, -3, -2]),
    mv('A-shape', 0, [-2, -1, -2, -1]),
  ],
  '7#9': [
    mv('C-shape', 3, [-3, 0, -3, -2]),
  ],
  '11': [
    mv('C-shape', 3, [-3, -3, -2, -2]),
  ],
  '13': [
    mv('C13-shape', 3, [-1, -3, -3, -2]),
    mv('G13-shape', 0, [0, 4, 1, 2]),
  ],
  '13sus4': [
    mv('C-shape', 3, [-1, -3, -2, -2]),
  ],

  // ── Augmented family ──
  '+': [
    mv('C-shape', 3, [-2, -3, -3, 0]),
    mv('A-shape', 0, [0, -1, -1, -2]),
  ],
  '+7': [
    mv('C-shape', 3, [-2, -3, -3, -2]),
    mv('A-shape', 0, [-2, -1, -1, -2]),
  ],
  '+9': [
    mv('C-shape', 3, [-2, -1, -3, -2]),
  ],
  '+7b9': [
    mv('C-shape', 3, [-2, -2, -3, -2]),
  ],
  '+7#9': [
    mv('C-shape', 3, [-2, 0, -3, -2]),
  ],

  // ── Diminished family ──
  '°': [
    mv('C-shape', 3, [X, 0, -1, 0]),
  ],
  '°7': [
    mv('C-shape', 3, [-1, 0, -1, 0]),
  ],
};
