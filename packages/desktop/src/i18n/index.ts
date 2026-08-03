import { useSettingsStore } from '@song-chords/shared';
import type { UiLanguage } from '@song-chords/shared';
import { en } from './dict/en';
import { es } from './dict/es';
import { pt } from './dict/pt';
import { it } from './dict/it';
import { fr } from './dict/fr';
import { de } from './dict/de';

/**
 * Lightweight i18n layer for the desktop app.
 *
 * The English dictionary in `dict/en.ts` is the SOURCE OF TRUTH — every
 * user-facing string in the app should have a key there, and its value
 * is the English rendering. Other locales (`es`, `pt`, …) provide a
 * *partial* dictionary; missing keys fall back to English at lookup
 * time so a half-translated feature never shows an empty label.
 *
 * The `TKey` union is derived from the English dictionary so callers
 * get autocomplete on `t('sidebar.songs')` and a TypeScript error on
 * typos. Other locales are typed as `Partial<Dict>` to reflect that
 * they may lag behind English.
 *
 * Interpolation: `t('key.with.count', { count: 5 })` replaces `{count}`
 * (or `{name}`, etc.) with the passed value. Zero deps.
 */

export type Dict = typeof en;
export type TKey = keyof Dict;
export type TVars = Record<string, string | number>;

const DICTS: Record<UiLanguage, Partial<Dict>> = {
  en, es, pt, it, fr, de,
};

/** Human-readable name of each supported language, in that language's
 *  own script. Used by the Settings language selector so the label is
 *  legible regardless of the current UI language. */
export const LANGUAGE_LABELS: Record<UiLanguage, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  fr: 'Français',
  de: 'Deutsch',
};

/** Replace `{name}` / `{count}` etc. tokens in `template` with values
 *  from `vars`. Missing vars leave the token in place — visible-loud
 *  so a broken caller is easy to spot. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const v = vars[key];
    return v === undefined ? m : String(v);
  });
}

/** Standalone lookup for the rare non-component call site. Prefer the
 *  `useT` hook in React components so re-renders pick up language
 *  changes automatically. */
export function translate(lang: UiLanguage, key: TKey, vars?: TVars): string {
  const dict = DICTS[lang] ?? en;
  const value = (dict as Partial<Dict>)[key] ?? en[key] ?? String(key);
  return interpolate(value, vars);
}

/** React hook that returns a `t(key, vars?)` function bound to the
 *  user's currently-selected UI language. Re-renders the component
 *  when the language changes because it subscribes to the settings
 *  store slice. */
export function useT(): (key: TKey, vars?: TVars) => string {
  const lang = useSettingsStore((s) => s.settings.uiLanguage ?? 'en');
  return (key: TKey, vars?: TVars) => translate(lang, key, vars);
}

/** Read the currently-active UI language reactively. Useful for the
 *  Settings selector and anywhere the caller needs the raw code (e.g.
 *  to build a `hreflang` attribute) rather than a translated string. */
export function useLanguage(): UiLanguage {
  return useSettingsStore((s) => s.settings.uiLanguage ?? 'en');
}

/** All supported UI language codes. Used by the auto-detect helper to
 *  match a browser locale tag against the shipped dictionaries. */
const SUPPORTED_LANGS: readonly UiLanguage[] = ['en', 'es', 'pt', 'it', 'fr', 'de'];

/** Best-effort mapping from an OS/browser locale tag (`navigator.language`
 *  or `navigator.languages[0]`) to one of the languages we actually ship.
 *  Only the PRIMARY subtag is considered — regional variants (`es-AR`,
 *  `pt-BR`, `de-CH`, …) all collapse to their base language. Returns
 *  `'en'` for anything we don't have a dictionary for. */
export function detectPreferredLanguage(): UiLanguage {
  const candidates: string[] = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (typeof navigator.language === 'string') candidates.push(navigator.language);
  }
  for (const tag of candidates) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LANGS.includes(primary as UiLanguage)) {
      return primary as UiLanguage;
    }
  }
  return 'en';
}
