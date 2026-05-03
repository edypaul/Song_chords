import { useEffect } from 'react';
import { useSettingsStore } from '@song-chords/shared';
import type { ShortcutAction } from '@song-chords/shared';
import { matchShortcut, isEditableTarget } from '../utils/shortcut';

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>> & {
  /** Invoked when the user presses the capo modifier + a digit 0-9. Receives
   *  the capo value (0-9). The page can clamp / extend for 10-12 via Shift
   *  if needed — this hook only reports 0-9. */
  onCapo?: (fret: number) => void;
};

/**
 * Subscribes a page to the user-configured keyboard shortcuts. Only one
 * action fires per keydown; modifier-matching is strict (Ctrl+E won't
 * trigger an "E" binding). Typing in input / textarea / contentEditable
 * elements bypasses shortcut dispatch so users can still type the literal
 * keys inside form fields.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts);

  useEffect(() => {
    if (!shortcuts) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Capo: modifier (configurable) + digit 0-9 sets capo to that fret.
      const capoMod = shortcuts.capoModifier;
      const capoPressed =
        (capoMod === 'Alt'   && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) ||
        (capoMod === 'Ctrl'  && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) ||
        (capoMod === 'Shift' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) ||
        (capoMod === 'Meta'  && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey);
      if (capoPressed && /^[0-9]$/.test(e.key) && handlers.onCapo) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlers.onCapo(parseInt(e.key, 10));
        return;
      }

      for (const [action, binding] of Object.entries(shortcuts)) {
        if (action === 'capoModifier') continue;
        if (typeof binding !== 'string' || !binding) continue;
        if (!matchShortcut(e, binding)) continue;
        const fn = handlers[action as ShortcutAction];
        if (fn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          fn();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, handlers]);
}
