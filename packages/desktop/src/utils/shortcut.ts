/**
 * Keyboard shortcut serialisation + matching.
 *
 * A shortcut is stored as a string like "Ctrl+Shift+E", "Shift+ArrowUp",
 * "Space", or "M". The canonical form puts modifiers in the order
 * Ctrl → Alt → Shift → Meta, followed by the key name. The key name comes
 * from KeyboardEvent.key — except "Space" which represents the literal
 * space character for readability.
 */

export interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string; // lowercased, except arrows/function keys keep canonical casing
}

/** Normalise a KeyboardEvent.key into the form we store and compare against. */
function canonicaliseKey(raw: string): string {
  if (!raw) return '';
  // Space is stored as "Space" instead of " " so the string is human-readable.
  if (raw === ' ') return 'Space';
  // Arrows, Function keys, Enter, Escape, Tab, Backspace etc. keep their
  // canonical names from KeyboardEvent.key.
  if (raw.length > 1) return raw;
  // Letters are compared case-insensitively, so normalise to lowercase.
  // Digit and symbol keys stay as-is.
  return raw.toLowerCase();
}

/** Parse a stored shortcut string into its flag + key parts. */
export function parseShortcut(s: string): ParsedShortcut | null {
  if (!s) return null;
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const flags = { ctrl: false, alt: false, shift: false, meta: false };
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') flags.ctrl = true;
    else if (lower === 'alt' || lower === 'option') flags.alt = true;
    else if (lower === 'shift') flags.shift = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') flags.meta = true;
    else key = canonicaliseKey(part);
  }
  if (!key) return null;
  return { ...flags, key };
}

/** True when a keyboard event matches a stored shortcut string. */
export function matchShortcut(e: KeyboardEvent, stored: string): boolean {
  const spec = parseShortcut(stored);
  if (!spec) return false;
  if (e.ctrlKey !== spec.ctrl) return false;
  if (e.altKey !== spec.alt) return false;
  if (e.shiftKey !== spec.shift) return false;
  if (e.metaKey !== spec.meta) return false;
  return canonicaliseKey(e.key) === spec.key;
}

/** Build the canonical storage/display form from an event. Used by the
 * settings UI's "record binding" capture. Returns null for events that are
 * modifier-only (e.g. user holding Shift with no paired key yet). */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  const key = canonicaliseKey(e.key);
  if (!key) return null;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  // Capitalise single-character letter keys for display so "Ctrl+e" reads as "Ctrl+E".
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  parts.push(displayKey);
  return parts.join('+');
}

/** Pretty-print a stored shortcut for the UI (same as storage form). */
export function formatShortcut(stored: string): string {
  const parsed = parseShortcut(stored);
  if (!parsed) return stored || '(unbound)';
  const parts: string[] = [];
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.meta) parts.push('Meta');
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  return parts.join('+');
}

/** True when focus is inside an element the user is typing in. Used by the
 * global keydown handler to skip shortcut dispatch while editing text. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}
