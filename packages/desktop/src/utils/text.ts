/**
 * Convert a string to title case for list displays.
 *
 * Splits on whitespace and common punctuation (hyphen/underscore/slash),
 * capitalises the first LETTER of each word and lowercases the rest.
 * Preserves the original separators so "up-tempo" → "Up-Tempo".
 *
 * Leading non-letters are skipped, not treated as the first character:
 * "¿qué pides tú?" → "¿Qué Pides Tú?", "(live)" → "(Live)", "'til" →
 * "'Til". Previously `charAt(0)` was uppercased — a no-op on `¿` — and
 * the actual first letter got lowercased with the rest of the word.
 * `\p{L}` (Unicode letter) so accented and non-Latin letters count.
 */
export function toTitleCase(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .split(/(\s+|[-_/])/)
    .map((part) => {
      if (part.length === 0 || /^\s+|[-_/]/.test(part)) return part;
      const m = /^([^\p{L}]*)(\p{L})(.*)$/su.exec(part);
      if (!m) return part; // no letter at all (e.g. "123", "--")
      return m[1]! + m[2]!.toUpperCase() + m[3]!.toLowerCase();
    })
    .join('');
}
