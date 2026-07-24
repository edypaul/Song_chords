import { useCallback } from 'react';
import { useSettingsStore } from '@song-chords/shared';
import type { ShortcutAction } from '@song-chords/shared';
import { formatShortcut } from '../utils/shortcut';

/**
 * Read the user's currently-bound shortcut for an action and format it
 * as a tooltip suffix, e.g. `" (Ctrl+E)"`. Returns an empty string when
 * the action has no binding, so callers can safely concatenate:
 *
 *     const hint = useShortcutHint();
 *     <button title={`Export song${hint('exportSong')}`}>
 *
 * Auto-updates when the user rebinds the shortcut in Settings because
 * `useSettingsStore` subscribes the component to that slice.
 */
export function useShortcutHint(): (action: ShortcutAction) => string {
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts);
  return useCallback((action: ShortcutAction) => {
    const binding = shortcuts?.[action];
    if (!binding) return '';
    return ` (${formatShortcut(binding)})`;
  }, [shortcuts]);
}

/**
 * The capo modifier ("Alt" / "Ctrl" / "Shift" / "Meta") the user has
 * bound for capo-set shortcuts (e.g. Alt+0…9 → capo N). Returned as
 * a `" (Alt+0…9)"` suffix, or `""` when no capo modifier is set.
 */
export function useCapoHint(): string {
  const capoMod = useSettingsStore((s) => s.settings.shortcuts?.capoModifier);
  if (!capoMod) return '';
  return ` (${capoMod}+0…9)`;
}
