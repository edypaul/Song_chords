/**
 * Display-name conversion between letter chord notation (A-G) and Latin
 * solfège notation (Do/Re/Mi/Fa/Sol/La/Si).
 *
 * Storage stays in letter form. These helpers are display-only — apply
 * `toLatin` to a chord string just before rendering when the user has
 * picked the `latin` notation setting; apply `fromLatin` when reading
 * user-typed input that may be in either form.
 *
 * Casing rule for Latin output:
 *   - Major chord → UPPERCASE root, suffix as-is. `G7` → `SOL7`.
 *   - Minor chord (quality starts with `m` but not `maj`) → lowercase root
 *     and the leading `m` is dropped. `Gm` → `sol`, `Gm7` → `sol7`.
 *   - Diminished / augmented / sus / add / etc. stay uppercase root.
 *   - Bass note (`/X`) is always uppercased — it's a separate root.
 *
 * Accidentals (#, b) follow the root: `F#m7` → `fa#7`, `Bbmaj7` → `SIbmaj7`.
 */

const LETTER_TO_LATIN: Record<string, string> = {
  C: 'DO',
  D: 'RE',
  E: 'MI',
  F: 'FA',
  G: 'SOL',
  A: 'LA',
  B: 'SI',
};

// Reverse map. Both DO and Do match; we lowercase user input before lookup.
const LATIN_TO_LETTER: Record<string, string> = {
  DO: 'C',
  RE: 'D',
  MI: 'E',
  FA: 'F',
  SOL: 'G',
  LA: 'A',
  SI: 'B',
  // Common alternates from English / Italian solfège pedagogy.
  TI: 'B',
  UT: 'C',
};

/** Capture: 1=root letter, 2=optional accidental, 3=quality + extension. */
const LETTER_CHORD_RE = /^([A-G])([#b]?)(.*)$/;

/** Quality is "minor" when it begins with `m` followed by anything except
 *  `aj` (which would be `maj…`, a major-seventh family). Includes m, m7,
 *  m9, m11, m13, m6, madd9, m7b5 (half-diminished), etc. */
function isMinorQuality(quality: string): boolean {
  if (!quality.startsWith('m')) return false;
  if (quality.startsWith('maj')) return false;
  return true;
}

/**
 * Convert a single letter-chord string to Latin display form. Bass notes
 * after `/` are recursed (with bass=true) so they always uppercase.
 *
 * Returns the input unchanged when it doesn't start with a parseable letter
 * root — keeps unknown / pre-converted values from being mangled.
 */
export function toLatin(chord: string): string {
  if (!chord) return chord;

  // Split off bass: "Cm/G" → mainPart="Cm", bassPart="G"
  const slashIdx = chord.indexOf('/');
  if (slashIdx > 0) {
    const main = chord.slice(0, slashIdx);
    const bass = chord.slice(slashIdx + 1);
    return `${toLatin(main)}/${toLatinBass(bass)}`;
  }

  const m = chord.match(LETTER_CHORD_RE);
  if (!m) return chord;
  const letter = m[1]!;
  const accidental = m[2] ?? '';
  let quality = m[3] ?? '';
  const latin = LETTER_TO_LATIN[letter];
  if (!latin) return chord;

  if (isMinorQuality(quality)) {
    // Drop the leading `m`, lowercase the root.
    quality = quality.slice(1);
    return `${latin.toLowerCase()}${accidental}${quality}`;
  }
  return `${latin}${accidental}${quality}`;
}

/** Bass note: just the root + optional accidental (no quality). Always
 *  uppercase. Falls back to the input if not parseable. */
function toLatinBass(bass: string): string {
  const m = bass.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return bass;
  const latin = LETTER_TO_LATIN[m[1]!];
  if (!latin) return bass;
  return `${latin}${m[2] ?? ''}${m[3] ?? ''}`;
}

/** Latin solfège tokens accepted by `fromLatin` — matched case-insensitively
 *  at the start of a chord string. SOL must come before SI? No, longest-first
 *  matters: SOL (3) before SI (2) before DO/RE/MI/FA/LA (2). */
const LATIN_TOKENS = ['SOL', 'DO', 'RE', 'MI', 'FA', 'LA', 'SI', 'TI', 'UT'] as const;

/** Match the leading Latin token (case-insensitive) and return the letter
 *  + the rest of the string, or null if none matched. */
function stripLeadingLatin(s: string): { letter: string; rest: string; wasLower: boolean } | null {
  for (const tok of LATIN_TOKENS) {
    if (s.length < tok.length) continue;
    const head = s.slice(0, tok.length);
    if (head.toUpperCase() !== tok) continue;
    const rest = s.slice(tok.length);
    // Reject if the next char is a letter — e.g. "Domingo" shouldn't match "Do".
    // Quality suffixes start with a digit, m, M, +, -, /, #, b, ° (dim),
    // sus, add, maj, etc. Letters that legitimately come right after a
    // root are: m, M, b, # (accidentals/quality), and characters used in
    // qualities like 'sus', 'aug', 'dim', 'add'. Allow A-Z/a-z only when
    // they form one of those known continuations.
    if (rest.length > 0 && /^[A-Za-z]/.test(rest)) {
      // Whitelist: m, maj, M, sus, add, aug, dim, b, #. b/# are not letters
      // we'd hit here. Anything else letter-starting → reject.
      const tail = rest.toLowerCase();
      const ok =
        tail.startsWith('m') ||
        tail.startsWith('sus') ||
        tail.startsWith('add') ||
        tail.startsWith('aug') ||
        tail.startsWith('dim');
      if (!ok) continue;
    }
    return { letter: LATIN_TO_LETTER[tok]!, rest, wasLower: head[0] === head[0]!.toLowerCase() };
  }
  return null;
}

/**
 * Convert a single Latin-form chord back to letter form. Idempotent on
 * letter input (returns it unchanged). Used by Song Edit so users can
 * type in either notation and storage stays canonical.
 *
 * The lowercase-root form (`sol`, `lam7`) means minor — re-add the `m`
 * after the root. UPPERCASE form is taken as written (no `m` added).
 */
export function fromLatin(chord: string): string {
  if (!chord) return chord;

  const slashIdx = chord.indexOf('/');
  if (slashIdx > 0) {
    const main = chord.slice(0, slashIdx);
    const bass = chord.slice(slashIdx + 1);
    return `${fromLatin(main)}/${fromLatinBass(bass)}`;
  }

  // Already letter form?
  if (/^[A-G][#b]?/.test(chord)) return chord;

  const head = stripLeadingLatin(chord);
  if (!head) return chord;
  const { letter, rest, wasLower } = head;

  // Pull off optional accidental (#/b) right after the root.
  let accidental = '';
  let tail = rest;
  if (tail.startsWith('#') || tail.startsWith('b')) {
    accidental = tail[0]!;
    tail = tail.slice(1);
  }

  // Lowercase root → minor: prepend `m` to the quality (unless the user
  // already wrote `m...` after, in which case leave it).
  if (wasLower && !tail.startsWith('m')) {
    tail = `m${tail}`;
  }
  return `${letter}${accidental}${tail}`;
}

function fromLatinBass(bass: string): string {
  if (/^[A-G][#b]?/.test(bass)) return bass;
  const head = stripLeadingLatin(bass);
  if (!head) return bass;
  let { rest } = head;
  let accidental = '';
  if (rest.startsWith('#') || rest.startsWith('b')) {
    accidental = rest[0]!;
    rest = rest.slice(1);
  }
  return `${head.letter}${accidental}${rest}`;
}

/** Convenience: format a chord for display based on the user's notation
 *  setting. Most call sites use this as a thin wrapper. */
export function formatChord(chord: string, notation: 'letter' | 'latin'): string {
  return notation === 'latin' ? toLatin(chord) : chord;
}

/** Same idea but for keys (which have the same root + optional `m` shape
 *  as a chord, but no extension). Reuses toLatin. */
export function formatKey(key: string, notation: 'letter' | 'latin'): string {
  if (!key) return key;
  return notation === 'latin' ? toLatin(key) : key;
}

/**
 * Run a regex-driven pass over raw ChordPro / plain text content,
 * converting any Latin chord tokens inside `[...]` brackets and any bare
 * chord-line tokens back to letter form. Used by Song Edit on save.
 *
 * Conservative: only converts tokens that are recognizably Latin chord
 * names. Everything else is left untouched.
 */
export function normalizeContentToLetter(content: string): string {
  if (!content) return content;
  // Inline `[chord]` form — convert whatever's inside the brackets.
  let out = content.replace(/\[([^\]]+)\]/g, (_match, body: string) => `[${fromLatin(body)}]`);

  // Bare chord lines: convert whole lines that look like chord-only lines.
  // We split per line so lyric content with words like "Domingo" never
  // gets touched (those lines fail the chord-line heuristic).
  out = out
    .split('\n')
    .map((line) => {
      if (!isLikelyLatinChordLine(line)) return line;
      return line.replace(/(\S+)/g, (tok) => fromLatin(tok));
    })
    .join('\n');

  return out;
}

/** A line is treated as a chord line when every non-space token starts
 *  with a recognized Latin or letter chord root. This stops us from
 *  rewriting prose like `"Domingo"` even though it starts with `Do`. */
function isLikelyLatinChordLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return false;
  return tokens.every((t) => {
    // Letter root?
    if (/^[A-G][#b]?[a-zA-Z0-9/+\-°]*$/.test(t)) return true;
    // Latin root?
    const head = stripLeadingLatin(t);
    if (!head) return false;
    // The remainder after the Latin root + optional accidental should look
    // like a chord quality (digits, m/maj/sus/dim/aug/add/+/-/°/(/)).
    let tail = head.rest;
    if (tail.startsWith('#') || tail.startsWith('b')) tail = tail.slice(1);
    if (tail === '') return true;
    if (tail.startsWith('/')) {
      // Bass: must look like a known root.
      const after = tail.slice(1);
      return /^[A-G][#b]?/.test(after) || stripLeadingLatin(after) !== null;
    }
    return /^([mM]|maj|sus|add|aug|dim|°|\+|-|\d)/.test(tail);
  });
}
