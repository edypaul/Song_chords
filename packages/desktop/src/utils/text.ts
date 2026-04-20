/**
 * Convert a string to title case for list displays.
 *
 * Splits on whitespace and common punctuation (hyphen/underscore/slash),
 * capitalises the first letter of each word and lowercases the rest.
 * Preserves the original separators so "up-tempo" → "Up-Tempo".
 */
export function toTitleCase(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .split(/(\s+|[-_/])/)
    .map((part) => (part.length === 0 || /^\s+|[-_/]/.test(part)
      ? part
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}
