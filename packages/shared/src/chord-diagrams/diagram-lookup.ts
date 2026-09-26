import type { ChordDiagram, InstrumentType } from '../types/chord.types';
import { GUITAR_DIAGRAMS } from './guitar-diagrams';
import { UKULELE_DIAGRAMS } from './ukulele-diagrams';
import { GUITAR_SLASH_DIAGRAMS, UKULELE_SLASH_DIAGRAMS } from './slash-diagrams';
import { PIANO_DIAGRAMS, getAllPianoChordNames } from './piano-diagrams';
import { noteToSemitone, canonicalizeSuffix } from '../chord-engine/formulas';

type DiagramMap = Record<string, ChordDiagram[]>;

// ── Enharmonic resolution ────────────────────────────────────────────
//
// The baked guitar/ukulele tables (and the curated slash table) use
// ONE spelling per pitch class — the generator's root list:
//   C C# D Eb E F F# G Ab A Bb B
// so e.g. `Abm7b5` exists but `G#m7b5` does not, even though they are
// the SAME chord. Lookups are exact object-key, so a user who writes
// the other valid spelling (G#, D#, A#, Db, Gb, Cb, B#, E#, Fb …) got
// no diagram at all. This maps any note spelling to the table's
// canonical spelling via pitch class so every enharmonic equivalent
// resolves; the returned diagram is then re-labelled to the spelling
// the user actually typed so the chart header matches the song.
const CANONICAL_ROOT_BY_PC = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Match a leading note name: A–G, optional accidental(s). Accepts the
 *  common single #/b plus the rarer double and natural-spelling cases
 *  noteToSemitone understands. */
const LEADING_NOTE_RE = /^([A-G](?:#|b)?)/;

// The note spellings `noteToSemitone` actually maps. Anything else
// (double accidentals…) is NOT in its table and would silently fall
// back to 0 (= C), which would MIS-map Cb→C instead of B. Guard with
// this allow-list so an unrecognized spelling is left as-is rather
// than wrongly re-spelled.
const KNOWN_NOTES = new Set([
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F',
  'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
]);

// The four white-key enharmonics `noteToSemitone` does NOT know.
// They're rare but perfectly valid spellings (Cb major exists!) and
// used to resolve to NO diagram at all.
const WHITE_KEY_ENHARMONICS: Record<string, string> = {
  'Cb': 'B', 'Fb': 'E', 'E#': 'F', 'B#': 'C',
};

/** Re-spell a single note to the table's canonical spelling for its
 *  pitch class. Notes outside the known-spelling set are returned
 *  unchanged (no guessing). */
function canonicalNote(note: string): string {
  const mapped = WHITE_KEY_ENHARMONICS[note] ?? note;
  if (!KNOWN_NOTES.has(mapped)) return note;
  const pc = ((noteToSemitone(mapped) % 12) + 12) % 12;
  return CANONICAL_ROOT_BY_PC[pc] ?? note;
}

/**
 * Re-spell a chord name's ROOT (and slash-bass, if any) to the
 * canonical baked spelling, leaving the quality/suffix untouched.
 * Returns null when there's no leading note to normalize, or when the
 * result is identical to the input (so callers can skip the retry).
 */
function toCanonicalChordName(chordName: string): string | null {
  const m = LEADING_NOTE_RE.exec(chordName);
  if (!m) return null;
  const root = m[1]!;
  let rest = chordName.slice(root.length);

  // Normalize a slash-bass note too: "C/G#" must find the curated
  // "C/Ab" entry. Only the part after the LAST '/' that is itself a
  // bare note name is a bass (quality suffixes like 6/9 are not).
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const bass = rest.slice(slash + 1);
    const bm = /^([A-G](?:#|b)?)$/.exec(bass);
    if (bm) {
      rest = rest.slice(0, slash + 1) + canonicalNote(bm[1]!);
    }
  }

  const canonical = canonicalNote(root) + rest;
  return canonical === chordName ? null : canonical;
}

/** Return copies of `diagrams` with `name` set to `displayName` so the
 *  rendered chart header shows the spelling the user wrote, not the
 *  canonical table key. */
function relabel(diagrams: ChordDiagram[], displayName: string): ChordDiagram[] {
  if (diagrams.length === 0) return diagrams;
  return diagrams.map((d) => (d.name === displayName ? d : { ...d, name: displayName }));
}

/**
 * Re-spell a chord name's SUFFIX to its canonical form via the
 * suffix-alias table (`aug` → `+`, `dim` → `°`, `sus` → `sus4`,
 * `(add9)` → `add9`, etc.). Root and slash-bass are preserved
 * verbatim — only the quality/extension portion is rewritten.
 * Returns null when no alias applied (so callers can skip the retry).
 */
function toAliasCanonicalChordName(chordName: string): string | null {
  const m = LEADING_NOTE_RE.exec(chordName);
  if (!m) return null;
  const root = m[1]!;
  const rest = chordName.slice(root.length);
  // Split off the slash bass (if any) so the alias rules see ONLY
  // the suffix proper. Same "last slash whose RHS is a note name"
  // rule the enharmonic path uses.
  const slash = rest.lastIndexOf('/');
  let suffix = rest;
  let bass = '';
  if (slash >= 0 && /^[A-G](?:#|b)?$/.test(rest.slice(slash + 1))) {
    suffix = rest.slice(0, slash);
    bass = rest.slice(slash);
  }
  const canonicalSuffix = canonicalizeSuffix(suffix);
  if (canonicalSuffix === suffix) return null;
  return root + canonicalSuffix + bass;
}

/** Look up a chord by name in the relevant built-in library. Piano is
 *  generated lazily, so its `[name]` access always returns an array
 *  (possibly empty for unrecognized names). */
function getBuiltin(chordName: string, instrument: InstrumentType): ChordDiagram[] {
  if (instrument === 'guitar') {
    return GUITAR_DIAGRAMS[chordName] ?? GUITAR_SLASH_DIAGRAMS[chordName] ?? [];
  }
  if (instrument === 'ukulele') {
    return UKULELE_DIAGRAMS[chordName] ?? UKULELE_SLASH_DIAGRAMS[chordName] ?? [];
  }
  // Piano: Proxy-backed lazy generator — already resolves slash
  // chords at runtime (splitChord + bass note), so no slash table.
  if (instrument === 'piano') return PIANO_DIAGRAMS[chordName] ?? [];
  // Custom instruments ship no built-in library — every voicing is
  // user-made and comes from the custom map.
  return [];
}

/** Canonical GROUPING key for a chord name: root (and slash bass)
 *  re-spelled to the baked canonical spelling. All enharmonic
 *  spellings of the same chord map to the SAME key, so custom
 *  voicings saved as "G#m7" and the baked "Abm7" set form one group. */
export function canonicalChordKey(chordName: string): string {
  return toCanonicalChordName(chordName) ?? chordName;
}
const canonicalKey = canonicalChordKey;

/** Filter a custom-chord map to entries matching the active
 *  instrument, RE-KEYED by canonical chord name so enharmonic
 *  spellings group together no matter which spelling they were
 *  saved under (custom chords are stored across all instruments in
 *  one map, keyed by whatever the user typed at save time). */
function customForInstrument(custom: DiagramMap | undefined, instrument: InstrumentType): DiagramMap {
  if (!custom) return {};
  const out: DiagramMap = {};
  for (const [name, diagrams] of Object.entries(custom)) {
    const matched = diagrams.filter((d) => d.instrument === instrument);
    if (!matched.length) continue;
    const key = canonicalKey(name);
    out[key] = [...(out[key] ?? []), ...matched];
  }
  return out;
}

function lookup(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram[] {
  const custMap = customForInstrument(custom, instrument);
  const canonKey = canonicalKey(chordName);

  // 1) Built-ins: prefer the entry under the exact spelling the user
  //    wrote; otherwise the canonical enharmonic spelling's entry
  //    (the baked tables use one spelling per pitch class — Ab not
  //    G#, Eb not D#, …), re-labelled back to what the user typed so
  //    the chart header still reads "G#m7b5", not "Abm7b5".
  let builtin = getBuiltin(chordName, instrument);
  if (!builtin.length && canonKey !== chordName) {
    builtin = relabel(getBuiltin(canonKey, instrument), chordName);
  }
  // Custom voicings are grouped by canonical key (see
  // customForInstrument), so a variation saved as "G#m7" merges into
  // an "Abm7" query and vice versa — ALWAYS appended after the
  // built-ins, shown under the requested spelling.
  const userVariants = relabel(custMap[canonKey] ?? [], chordName);
  const merged = [...builtin, ...userVariants];
  if (merged.length) return merged;

  // 2) Suffix-alias fallback: re-spell `aug`/`dim`/`sus`/`(add9)`/
  //    `(sus2)`/`(sus4)` to the canonical suffix and re-look. Users
  //    importing songs from other apps frequently spell chords this
  //    way; the engine should treat them as the same chord. The
  //    enharmonic re-spell applies on top (e.g. "G#aug" → "G#+",
  //    still keyed under "Ab+").
  const aliasName = toAliasCanonicalChordName(chordName);
  if (aliasName && aliasName !== chordName) {
    const aliasKey = canonicalKey(aliasName);
    let ab = getBuiltin(aliasName, instrument);
    if (!ab.length && aliasKey !== aliasName) {
      ab = getBuiltin(aliasKey, instrument);
    }
    const au = custMap[aliasKey] ?? [];
    const alias = [...ab, ...au];
    if (alias.length) return relabel(alias, chordName);
  }

  return [];
}

/** Exact match — returns first variation. */
export function getDiagramExact(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  return lookup(chordName, instrument, custom)[0] ?? null;
}

/** Exact match — returns ALL variations (built-in + custom). */
export function getDiagramVariations(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram[] {
  return lookup(chordName, instrument, custom);
}

/** Returns a specific variation by index. */
export function getDiagramByIndex(chordName: string, instrument: InstrumentType, index: number, custom?: DiagramMap): ChordDiagram | null {
  const all = getDiagramVariations(chordName, instrument, custom);
  if (all.length === 0) return null;
  return all[Math.min(index, all.length - 1)] ?? all[0]!;
}

/** Get all chord names available (built-in + custom). For piano this
 *  enumerates the algorithmic library. */
export function getAllChordNames(instrument: InstrumentType, custom?: DiagramMap): string[] {
  let names: string[];
  if (instrument === 'guitar') {
    names = [...Object.keys(GUITAR_DIAGRAMS), ...Object.keys(GUITAR_SLASH_DIAGRAMS)];
  } else if (instrument === 'ukulele') {
    names = [...Object.keys(UKULELE_DIAGRAMS), ...Object.keys(UKULELE_SLASH_DIAGRAMS)];
  } else if (instrument === 'piano') {
    names = getAllPianoChordNames();
  } else {
    names = []; // custom instrument: custom chords only (added below)
  }

  // Add custom chord names that don't already exist in the built-in list.
  const custMap = customForInstrument(custom, instrument);
  for (const name of Object.keys(custMap)) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Check if a chord name has any custom (user-added) variations for any
 *  instrument. The customChords map mixes instruments together.
 *  Enharmonic spellings count as the same chord (a custom "G#m7"
 *  makes "Abm7" report custom variations too). */
export function hasCustomVariations(chordName: string, custom?: DiagramMap): boolean {
  if (!custom) return false;
  if (custom[chordName]?.length) return true;
  const key = canonicalKey(chordName);
  for (const [name, list] of Object.entries(custom)) {
    if (list?.length && canonicalKey(name) === key) return true;
  }
  return false;
}

// Enharmonic alternative spelling per pitch class, used to surface
// both spellings in the Chord Library enumeration. Indexed by pc:
//   C C# D D# E F F# G G# A A# B
// White-key pcs (0,2,4,5,7,9,11) have no alternative.
const ALT_ROOT_BY_PC: ReadonlyArray<string | null> = [
  null, // C
  'Db', // C# -> Db
  null, // D
  'Eb', // D# -> Eb
  null, // E
  null, // F
  'Gb', // F# -> Gb
  null, // G
  'Ab', // G# -> Ab
  null, // A
  'Bb', // A# -> Bb
  null, // B
];

/**
 * Expand a baked diagram map with both spellings per enharmonic root.
 * The baked tables (and the piano enumeration) each use ONE canonical
 * spelling per pitch class — guitar/uke pick `Ab` over `G#`, piano
 * picks `G#` over `Ab`. The Chord Library page shows a single 12-key
 * filter and users expect every common spelling to resolve; before
 * this, picking the "other" spelling in the dropdown silently
 * returned nothing for 1 root (guitar/uke) or 4 roots (piano).
 *
 * For every baked chord with a sharp/flat root, we add a duplicate
 * entry keyed by the alternative spelling AND re-label its
 * `ChordDiagram.name` so the rendered chart header matches the
 * user's chosen spelling. Slash-bass notes inside the suffix are
 * intentionally left untouched here — the per-name `getDiagram`
 * lookup already handles enharmonic bass notes for actual queries;
 * this only widens what the library ENUMERATES.
 */
function expandEnharmonics(map: DiagramMap): DiagramMap {
  const out: DiagramMap = { ...map };
  for (const [name, diagrams] of Object.entries(map)) {
    const rm = /^([A-G])(#|b)?/.exec(name);
    if (!rm) continue;
    const root = rm[0];
    if (!KNOWN_NOTES.has(root)) continue;
    const pc = ((noteToSemitone(root) % 12) + 12) % 12;
    const alt = ALT_ROOT_BY_PC[pc];
    if (!alt || alt === root) continue;
    const rest = name.slice(root.length);
    const altName = alt + rest;
    if (out[altName]) continue; // already present (custom or baked) — don't clobber
    out[altName] = diagrams.map((d) =>
      d.name === altName ? d : { ...d, name: altName },
    );
  }
  return out;
}

/** Get built-in diagram map directly, with BOTH enharmonic spellings
 *  surfaced per pitch class so the chord-library filter (which offers
 *  one fixed dropdown of 12 keys) finds every chord regardless of
 *  which spelling the user picks. Piano returns a snapshot of the
 *  generated library — sufficient for callers that only iterate names.
 *  Use the lookup helpers above when querying by name. */
export function getBuiltinDiagrams(instrument: InstrumentType): DiagramMap {
  if (instrument === 'guitar') {
    return expandEnharmonics({ ...GUITAR_DIAGRAMS, ...GUITAR_SLASH_DIAGRAMS });
  }
  if (instrument === 'ukulele') {
    return expandEnharmonics({ ...UKULELE_DIAGRAMS, ...UKULELE_SLASH_DIAGRAMS });
  }
  // Custom instruments have no built-in library.
  if (instrument !== 'piano') return {};
  // Piano: materialize the full set so callers that iterate (e.g. chord
  // library) get every name. The library is small (~300 entries) so the
  // up-front cost is fine.
  const out: DiagramMap = {};
  for (const name of getAllPianoChordNames()) {
    const list = PIANO_DIAGRAMS[name];
    if (list && list.length) out[name] = list;
  }
  return expandEnharmonics(out);
}

/** Fuzzy lookup with fallbacks. */
export function getDiagram(chordName: string, instrument: InstrumentType, custom?: DiagramMap): ChordDiagram | null {
  const exact = lookup(chordName, instrument, custom);
  if (exact.length) return exact[0]!;

  // Strip slash bass note: "G/B" -> "G"
  const slashIdx = chordName.lastIndexOf('/');
  if (slashIdx > 0) {
    const withoutBass = chordName.slice(0, slashIdx);
    const matched = lookup(withoutBass, instrument, custom);
    if (matched.length) return matched[0]!;
  }

  // Simplify: try root+m or root
  const root = chordName.match(/^[A-G][#b]?/)?.[0];
  if (root) {
    const quality = chordName.slice(root.length);
    const simplifications = [chordName, root + (quality.startsWith('m') ? 'm' : ''), root];
    for (const candidate of simplifications) {
      const matched = lookup(candidate, instrument, custom);
      if (matched.length) return matched[0]!;
    }
  }

  return null;
}
