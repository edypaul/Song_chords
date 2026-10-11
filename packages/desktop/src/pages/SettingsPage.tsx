import React, { useState } from 'react';
import { useSettingsStore, useSongStore, useSetListStore, SONG_STYLE_PRESETS, FONT_FAMILIES, FONT_SIZE_LIMITS, DEFAULT_SONG_VIEW_STYLE, DEFAULT_SHORTCUTS, DEFAULT_SETTINGS } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { AppSettings, ThemeType, InstrumentType, SongViewStyle, SectionStyle, CustomPreset, ChordDiagram, CustomInstrument, KeyboardShortcuts, ShortcutAction, UiLanguage } from '@song-chords/shared';
import { LANGUAGE_LABELS, useT } from '../i18n';
import type { TKey } from '../i18n';
import SongListColumnsEditor from '../components/song/SongListColumnsEditor';
import ShortcutRecorder from '../components/common/ShortcutRecorder';
import { Download, Upload, Trash2, Palette, Music as MusicIcon, Layout, Keyboard, Database, AlertTriangle } from 'lucide-react';
import ConfirmDialog from '../components/common/ConfirmDialog';
import ChordSpellingWarning from '../components/common/ChordSpellingWarning';
import {
  downloadJson, pickJsonFile, timestampSlug,
  exportLibrary, importLibrary, mergeLibrary, buildChordsBackup, buildPresetsBackup,
  buildSettingsBackup, importSettings,
  type LibraryBackup, type CustomChordsBackup, type CustomPresetsBackup, type SettingsBackup,
} from '../utils/backup';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';
import { previewMetronome, normalizeMetronomeSound } from '../utils/metronome-sounds';

export default function SettingsPage(): React.ReactElement {
  const { settings, updateSetting } = useSettingsStore();
  const t = useT();

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    void updateSetting(db, key, value);
  };

  // One lazy AudioContext for the metronome preview bar. Overrides let
  // a change handler audition the value it just saved without waiting
  // for the async settings round-trip. Only ONE preview plays at a
  // time: while it runs the button is disabled and every preview
  // trigger (button, sound change, accent toggle) is ignored, so
  // previews can't stack on top of each other.
  const previewCtxRef = React.useRef<AudioContext | null>(null);
  const previewBusyRef = React.useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const playMetronomePreview = (over: { sound?: NonNullable<AppSettings['metronomeSound']>; volume?: number; accentFirst?: boolean }) => {
    if (previewBusyRef.current) return;
    if (!previewCtxRef.current) previewCtxRef.current = new AudioContext();
    const duration = previewMetronome(previewCtxRef.current, {
      sound: over.sound ?? normalizeMetronomeSound(settings.metronomeSound),
      volume: over.volume ?? settings.metronomeVolume ?? 0.7,
      accentFirst: over.accentFirst ?? settings.metronomeAccent ?? true,
    });
    previewBusyRef.current = true;
    setPreviewBusy(true);
    window.setTimeout(() => {
      previewBusyRef.current = false;
      setPreviewBusy(false);
    }, Math.ceil(duration * 1000));
  };

  // Keep the active song-view style in sync with the effective theme.
  // The old logic only switched the preset when the user explicitly
  // picked Light/Dark from the dropdown — so on the default "System"
  // theme (or when the OS toggled day/night), the song view kept a
  // dark preset in light mode (unreadable) and vice-versa.
  // `useEffectiveTheme` resolves System → light|dark and updates on
  // OS change, so reacting to it covers every case. We only switch
  // when the CURRENT preset's mode no longer matches the effective
  // theme, so a deliberate same-mode preset choice is never clobbered.
  const effectiveTheme = useEffectiveTheme();
  React.useEffect(() => {
    const currentPresetKey = settings.songViewStyle?.preset;
    const currentPreset = currentPresetKey
      ? SONG_STYLE_PRESETS[currentPresetKey]
      : undefined;
    // Custom presets carry their own `mode`; fall back to that.
    const currentMode = currentPreset?.mode
      ?? settings.customPresets?.[currentPresetKey ?? '']?.mode;
    if (currentMode === effectiveTheme) return; // already correct
    const first = Object.values(SONG_STYLE_PRESETS).find((p) => p.mode === effectiveTheme);
    if (first) void updateSetting(db, 'songViewStyle', { ...first.style });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTheme]);

  // ─── Backup & restore ──────────────────────────────────────────────────
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);
  /** Pending import dialog state. `kind` distinguishes which backup type the
   *  user picked. The dialog asks them to Replace, Combine, or Cancel before
   *  any actual write happens. */
  const [pendingImport, setPendingImport] = useState<
    | { kind: 'library'; data: LibraryBackup; description: string }
    | { kind: 'chords'; data: CustomChordsBackup; description: string }
    | { kind: 'presets'; data: CustomPresetsBackup; description: string }
    | { kind: 'settings'; data: SettingsBackup; description: string }
    | null
  >(null);
  const flash = (kind: 'info' | 'error', message: string) => {
    setStatus({ kind, message });
    window.setTimeout(() => setStatus((s) => (s?.message === message ? null : s)), 4000);
  };

  // Small helper: build a "N songs, M set lists" style description with
  // singular/plural key selection driven by the count.
  const librarySongsDesc = (n: number) =>
    t(n === 1 ? 'settings.backup.description.librarySongsOne' : 'settings.backup.description.librarySongsMany', { count: n });
  const librarySetlistsDesc = (n: number) =>
    t(n === 1 ? 'settings.backup.description.librarySetlistsOne' : 'settings.backup.description.librarySetlistsMany', { count: n });
  const libraryDesc = (songs: number, setlists: number) =>
    librarySongsDesc(songs) + t('settings.backup.description.librarySeparator') + librarySetlistsDesc(setlists);
  const chordVoicingsDesc = (count: number, chords: number) => {
    if (count === 1 && chords === 1) return t('settings.backup.description.chordVoicingsOne', { count, chords });
    if (count === 1 && chords !== 1) return t('settings.backup.description.chordVoicingsOneMany', { count, chords });
    if (count !== 1 && chords === 1) return t('settings.backup.description.chordVoicingsManyOne', { count, chords });
    return t('settings.backup.description.chordVoicingsMany', { count, chords });
  };
  const presetsDesc = (n: number) =>
    t(n === 1 ? 'settings.backup.description.presetsOne' : 'settings.backup.description.presetsMany', { count: n });
  const settingsDesc = (n: number) =>
    t(n === 1 ? 'settings.backup.description.settingsOne' : 'settings.backup.description.settingsMany', { count: n });

  const handleExportLibrary = async () => {
    try {
      const backup = await exportLibrary(db);
      downloadJson(`songchords-library-${timestampSlug()}.json`, backup);
      flash('info', t('settings.backup.status.exportedLibrary', { songs: backup.songs.length, setlists: backup.setlists.length }));
    } catch (e) {
      flash('error', t('settings.backup.status.exportFailed', { error: String(e) }));
    }
  };

  const handleImportLibrary = async () => {
    const data = await pickJsonFile<LibraryBackup>();
    if (!data) return;
    if (!Array.isArray(data.songs)) {
      flash('error', t('settings.backup.status.notLibraryBackup'));
      return;
    }
    setPendingImport({
      kind: 'library',
      data,
      description: libraryDesc(data.songs.length, data.setlists.length),
    });
  };

  const runLibraryImport = async (mode: 'replace' | 'combine') => {
    const pending = pendingImport;
    if (!pending || pending.kind !== 'library') return;
    setPendingImport(null);
    try {
      if (mode === 'replace') await importLibrary(db, pending.data);
      else                    await mergeLibrary(db, pending.data);
      await useSongStore.getState().loadSongs(db);
      await useSetListStore.getState().loadSetLists(db);
      flash('info', mode === 'replace'
        ? t('settings.backup.status.replacedLibrary', { description: pending.description })
        : t('settings.backup.status.combinedLibrary', { description: pending.description }));
    } catch (e) {
      flash('error', t('settings.backup.status.importFailed', { error: String(e) }));
    }
  };

  const handleExportChords = () => {
    try {
      const backup = buildChordsBackup(settings.customChords ?? {}, settings.customInstruments ?? {});
      const count = Object.values(backup.customChords).reduce((n, arr) => n + arr.length, 0);
      downloadJson(`songchords-custom-chords-${timestampSlug()}.json`, backup);
      flash('info', t(count === 1 ? 'settings.backup.status.exportedChordsOne' : 'settings.backup.status.exportedChordsMany', { count }));
    } catch (e) {
      flash('error', t('settings.backup.status.exportFailed', { error: String(e) }));
    }
  };

  const handleImportChords = async () => {
    const data = await pickJsonFile<CustomChordsBackup>();
    if (!data || typeof data.customChords !== 'object') {
      if (data !== null) flash('error', t('settings.backup.status.notChordsBackup'));
      return;
    }
    const count = Object.values(data.customChords).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    setPendingImport({
      kind: 'chords',
      data,
      description: chordVoicingsDesc(count, Object.keys(data.customChords).length),
    });
  };

  const runChordsImport = (mode: 'replace' | 'combine') => {
    const pending = pendingImport;
    if (!pending || pending.kind !== 'chords') return;
    setPendingImport(null);
    try {
      let next: Record<string, ChordDiagram[]>;
      if (mode === 'replace') {
        // Keep only the imported chords; existing custom chords are wiped.
        next = {};
        for (const [name, list] of Object.entries(pending.data.customChords)) {
          if (Array.isArray(list)) next[name] = list;
        }
      } else {
        // Combine: imported entries overlay existing ones per chord name.
        next = { ...(settings.customChords ?? {}) };
        for (const [name, list] of Object.entries(pending.data.customChords)) {
          if (Array.isArray(list)) next[name] = list;
        }
      }
      set('customChords', next);
      // Custom instruments ride along in the same file (older files
      // have none — leave the current instruments alone then).
      const imported = pending.data.customInstruments;
      if (imported && typeof imported === 'object') {
        const nextInstruments: Record<string, CustomInstrument> = mode === 'replace'
          ? { ...imported }
          : { ...(settings.customInstruments ?? {}), ...imported };
        set('customInstruments', nextInstruments);
      }
      flash('info', mode === 'replace'
        ? t('settings.backup.status.replacedChords')
        : t('settings.backup.status.combinedChords'));
    } catch (e) {
      flash('error', t('settings.backup.status.importFailed', { error: String(e) }));
    }
  };

  const handleExportPresets = () => {
    try {
      const backup = buildPresetsBackup(settings.customPresets ?? {});
      const count = Object.keys(backup.customPresets).length;
      downloadJson(`songchords-custom-presets-${timestampSlug()}.json`, backup);
      flash('info', t(count === 1 ? 'settings.backup.status.exportedPresetsOne' : 'settings.backup.status.exportedPresetsMany', { count }));
    } catch (e) {
      flash('error', t('settings.backup.status.exportFailed', { error: String(e) }));
    }
  };

  const handleImportPresets = async () => {
    const data = await pickJsonFile<CustomPresetsBackup>();
    if (!data || typeof data.customPresets !== 'object') {
      if (data !== null) flash('error', t('settings.backup.status.notPresetsBackup'));
      return;
    }
    const count = Object.keys(data.customPresets).length;
    setPendingImport({
      kind: 'presets',
      data,
      description: presetsDesc(count),
    });
  };

  const runPresetsImport = (mode: 'replace' | 'combine') => {
    const pending = pendingImport;
    if (!pending || pending.kind !== 'presets') return;
    setPendingImport(null);
    try {
      const next: Record<string, CustomPreset> = mode === 'replace'
        ? { ...pending.data.customPresets }
        : { ...(settings.customPresets ?? {}), ...pending.data.customPresets };
      set('customPresets', next);
      flash('info', mode === 'replace'
        ? t('settings.backup.status.replacedPresets')
        : t('settings.backup.status.combinedPresets'));
    } catch (e) {
      flash('error', t('settings.backup.status.importFailed', { error: String(e) }));
    }
  };

  const handleExportSettings = () => {
    try {
      const backup = buildSettingsBackup(settings);
      const count = Object.keys(backup.settings).length;
      downloadJson(`songchords-settings-${timestampSlug()}.json`, backup);
      flash('info', t('settings.backup.status.exportedSettings', { count }));
    } catch (e) {
      flash('error', t('settings.backup.status.exportFailed', { error: String(e) }));
    }
  };

  const handleImportSettings = async () => {
    const data = await pickJsonFile<SettingsBackup>();
    if (!data || typeof data.settings !== 'object') {
      if (data !== null) flash('error', t('settings.backup.status.notSettingsBackup'));
      return;
    }
    const count = Object.keys(data.settings).length;
    setPendingImport({
      kind: 'settings',
      data,
      description: settingsDesc(count),
    });
  };

  const runSettingsImport = async () => {
    // Settings backups don't support "combine" — every key either
    // exists once per user or doesn't; there's no meaningful merge
    // for a scalar like `theme` or a fully-formed `songViewStyle`.
    // The confirm dialog is still shown so the user has an explicit
    // "yes overwrite" step and can review what's about to happen.
    const pending = pendingImport;
    if (!pending || pending.kind !== 'settings') return;
    setPendingImport(null);
    try {
      await importSettings(db, pending.data);
      // Rehydrate the in-memory store so every consumer picks up the
      // new values (theme, shortcuts, etc.) immediately without a
      // page reload.
      await useSettingsStore.getState().loadSettings(db);
      flash('info', t('settings.backup.status.restoredSettings'));
    } catch (e) {
      flash('error', t('settings.backup.status.importFailed', { error: String(e) }));
    }
  };

  // ─── Delete data ───────────────────────────────────────────────────────
  const [deleteSongs, setDeleteSongs] = useState(false);
  const [deleteChords, setDeleteChords] = useState(false);
  const [deletePresets, setDeletePresets] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const anyDeletionSelected = deleteSongs || deleteChords || deletePresets;

  const runDelete = async () => {
    setConfirmDelete(false);
    try {
      if (deleteSongs) {
        // Children first — matches the restore path and avoids depending on
        // sql.js's FK cascade behaviour.
        await db.execute('DELETE FROM favorite_entries', []);
        await db.execute('DELETE FROM setlist_entries', []);
        await db.execute('DELETE FROM setlists', []);
        await db.execute('DELETE FROM songs', []);
        await useSongStore.getState().loadSongs(db);
        await useSetListStore.getState().loadSetLists(db);
      }
      if (deleteChords) {
        set('customChords', {});
      }
      if (deletePresets) {
        set('customPresets', {});
      }
      const parts: string[] = [];
      if (deleteSongs) parts.push(t('settings.danger.deleted.songs'));
      if (deleteChords) parts.push(t('settings.danger.deleted.chords'));
      if (deletePresets) parts.push(t('settings.danger.deleted.presets'));
      flash('info', t('settings.danger.deleted.status', { parts: parts.join(' · ') }));
      setDeleteSongs(false);
      setDeleteChords(false);
      setDeletePresets(false);
    } catch (e) {
      flash('error', t('settings.danger.deleted.failed', { error: String(e) }));
    }
  };

  // Categories that drive the left-side navigation. The actual section
  // content stays inline below; we just gate each Section on the
  // active category so the page renders one logical group at a time.
  const CATEGORIES = [
    { id: 'general',   labelKey: 'settings.nav.general',   icon: <Palette size={14} /> },
    { id: 'display',   labelKey: 'settings.nav.display',   icon: <Layout size={14} /> },
    { id: 'playback',  labelKey: 'settings.nav.playback',  icon: <MusicIcon size={14} /> },
    { id: 'shortcuts', labelKey: 'settings.nav.shortcuts', icon: <Keyboard size={14} /> },
    { id: 'data',      labelKey: 'settings.nav.data',      icon: <Database size={14} /> },
    { id: 'danger',    labelKey: 'settings.nav.danger',    icon: <AlertTriangle size={14} /> },
  ] as const;
  type CategoryId = typeof CATEGORIES[number]['id'];
  const [activeCat, setActiveCat] = useState<CategoryId>('general');
  const showCat = (id: CategoryId) => activeCat === id;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Settings sub-nav — horizontal tab bar across the top of the
          page. Differs from the main app sidebar by:
            - horizontal orientation instead of vertical.
            - active item uses a bottom-edge accent stripe (tab bar
              convention) rather than the main nav's solid accent
              fill.
            - tighter rows, smaller font, scrolls horizontally on
              narrow viewports so every category stays reachable. */}
      <nav
        className="shrink-0 flex items-center gap-1 px-4 border-b overflow-x-auto"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        aria-label={t('settings.nav.aria')}
      >
        <h1
          className="text-[13px] font-semibold uppercase tracking-wider pr-4 mr-2 shrink-0"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.08em', borderRight: '1px solid var(--border)', paddingTop: 14, paddingBottom: 14 }}
        >
          {t('settings.title')}
        </h1>
        {CATEGORIES.map((c) => {
          const active = activeCat === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className="flex items-center gap-2 px-3 text-[13px] transition-colors shrink-0"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 450,
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
                paddingTop: 14,
                paddingBottom: 14,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 14, color: active ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                {c.icon}
              </span>
              <span>{t(c.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Right pane — scrolls independently. */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-2xl mx-auto">

      {showCat('general') && (<Section title={t('settings.language.title')}>
        <SettingRow label={t('settings.language.label')} hint={t('settings.language.hint')}>
          <select
            value={settings.uiLanguage ?? 'en'}
            onChange={(e) => set('uiLanguage', e.target.value as UiLanguage)}
            className="setting-select"
          >
            {(Object.entries(LANGUAGE_LABELS) as Array<[UiLanguage, string]>).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </SettingRow>
      </Section>)}

      {showCat('general') && (<Section title={t('settings.appearance.title')}>
        <SettingRow label={t('settings.appearance.theme.label')}>
          <select
            value={settings.theme}
            onChange={(e) => {
              // Just update the theme. The effect above watches the
              // resolved effective theme and swaps to the first
              // matching preset for ANY transition (explicit
              // Light/Dark pick, System, or OS day/night change).
              set('theme', e.target.value as ThemeType);
            }}
            className="setting-select"
          >
            <option value="system">{t('settings.appearance.theme.system')}</option>
            <option value="light">{t('settings.appearance.theme.light')}</option>
            <option value="dark">{t('settings.appearance.theme.dark')}</option>
          </select>
        </SettingRow>
      </Section>)}

      {showCat('general') && (<Section title={t('settings.music.title')}>
        <SettingRow label={t('settings.music.defaultInstrument.label')}>
          <select
            value={settings.defaultInstrument}
            onChange={(e) => set('defaultInstrument', e.target.value as InstrumentType)}
            className="setting-select"
          >
            <option value="guitar">{t('settings.music.defaultInstrument.guitar')}</option>
            <option value="ukulele">{t('settings.music.defaultInstrument.ukulele')}</option>
            <option value="piano">{t('settings.music.defaultInstrument.piano')}</option>
            {Object.values(settings.customInstruments ?? {}).length > 0 && (
              <optgroup label={t('settings.music.defaultInstrument.customGroup')}>
                {Object.values(settings.customInstruments ?? {})
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((ci) => (
                    <option key={ci.id} value={ci.id}>{ci.name}</option>
                  ))}
              </optgroup>
            )}
          </select>
        </SettingRow>
        <SettingRow label={t('settings.music.accidentals.label')} hint={t('settings.music.accidentals.hint')}>
          <select
            value={settings.accidentalMode ?? 'auto'}
            onChange={(e) => set('accidentalMode', e.target.value as 'auto' | 'flats' | 'sharps')}
            className="setting-select"
          >
            <option value="auto">{t('settings.music.accidentals.auto')}</option>
            <option value="flats">{t('settings.music.accidentals.flats')}</option>
            <option value="sharps">{t('settings.music.accidentals.sharps')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings.music.chordNotation.label')} hint={t('settings.music.chordNotation.hint')}>
          <select
            value={settings.chordNotation ?? 'letter'}
            onChange={(e) => set('chordNotation', e.target.value as 'letter' | 'latin')}
            className="setting-select"
          >
            <option value="letter">{t('settings.music.chordNotation.letter')}</option>
            <option value="latin">{t('settings.music.chordNotation.latin')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings.music.showChordDiagrams.label')} hint={t('settings.music.showChordDiagrams.hint')}>
          <Toggle checked={settings.showChordDiagrams} onChange={(v) => set('showChordDiagrams', v)} />
        </SettingRow>
      </Section>)}

      {showCat('playback') && (<Section title={t('settings.autoScroll.title')}>
        <SettingRow label={t('settings.autoScroll.speed.label')}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={100}
              value={settings.scrollSpeed}
              onChange={(e) => set('scrollSpeed', Number(e.target.value))}
              className="w-32 accent-[var(--accent)]"
            />
            <span className="w-8 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{settings.scrollSpeed}</span>
          </div>
        </SettingRow>
      </Section>)}

      {showCat('playback') && (<Section title={t('settings.metronome.title')}>
        <SettingRow label={t('settings.metronome.sound.label')} hint={t('settings.metronome.sound.hint')}>
          <div className="flex items-center gap-2">
            <select
              value={normalizeMetronomeSound(settings.metronomeSound)}
              onChange={(e) => { set('metronomeSound', e.target.value as AppSettings['metronomeSound']); playMetronomePreview({ sound: e.target.value as NonNullable<AppSettings['metronomeSound']> }); }}
              className="setting-select"
            >
              <option value="beep">{t('settings.metronome.sound.beep')}</option>
              <option value="wood">{t('settings.metronome.sound.wood')}</option>
              <option value="tick">{t('settings.metronome.sound.tick')}</option>
              <option value="clave">{t('settings.metronome.sound.clave')}</option>
            </select>
            <button
              onClick={() => playMetronomePreview({})}
              disabled={previewBusy}
              className="text-xs px-2.5 py-1.5 rounded-md transition-colors hover:opacity-80"
              style={{
                background: 'var(--surface-elevated)',
                color: previewBusy ? 'var(--text-muted)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                opacity: previewBusy ? 0.55 : 1,
                cursor: previewBusy ? 'not-allowed' : undefined,
              }}
              title={t('settings.metronome.preview')}
            >
              ▶ {t('settings.metronome.preview')}
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t('settings.metronome.volume.label')}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((settings.metronomeVolume ?? 0.7) * 100)}
              onChange={(e) => set('metronomeVolume', Number(e.target.value) / 100)}
              onMouseUp={(e) => playMetronomePreview({ volume: Number((e.target as HTMLInputElement).value) / 100 })}
              className="w-32 accent-[var(--accent)]"
            />
            <span className="w-10 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{Math.round((settings.metronomeVolume ?? 0.7) * 100)}%</span>
          </div>
        </SettingRow>
        <SettingRow label={t('settings.metronome.accent.label')} hint={t('settings.metronome.accent.hint')}>
          <Toggle checked={settings.metronomeAccent ?? true} onChange={(v) => { set('metronomeAccent', v); playMetronomePreview({ accentFirst: v }); }} />
        </SettingRow>
      </Section>)}

      {showCat('display') && (
        <SongViewStyleSection style={settings.songViewStyle} onChange={(v) => set('songViewStyle', v)}
          customPresets={settings.customPresets ?? {}} onCustomPresetsChange={(v) => set('customPresets', v)} />
      )}

      {showCat('display') && (<Section title={t('settings.songLayout.title')}>
        <SettingRow label={t('settings.songLayout.centerSong.label')} hint={t('settings.songLayout.centerSong.hint')}>
          <Toggle checked={settings.songCentered ?? false} onChange={(v) => set('songCentered', v)} />
        </SettingRow>
        <SettingRow label={t('settings.songLayout.chordBarPosition.label')} hint={t('settings.songLayout.chordBarPosition.hint')}>
          <select
            value={settings.chordBarPosition ?? 'top'}
            onChange={(e) => set('chordBarPosition', e.target.value as 'top' | 'bottom' | 'right' | 'off')}
            className="setting-select"
          >
            <option value="top">{t('settings.songLayout.chordBarPosition.top')}</option>
            <option value="bottom">{t('settings.songLayout.chordBarPosition.bottom')}</option>
            <option value="right">{t('settings.songLayout.chordBarPosition.right')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings.songLayout.perfZoom.label')} hint={t('settings.songLayout.perfZoom.hint')}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={50}
              max={250}
              step={10}
              value={Math.round((settings.perfZoom ?? 1) * 100)}
              onChange={(e) => set('perfZoom', Number(e.target.value) / 100)}
              className="w-32 accent-[var(--accent)]"
            />
            <span className="w-10 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{Math.round((settings.perfZoom ?? 1) * 100)}%</span>
          </div>
        </SettingRow>
      </Section>)}

      {showCat('display') && (<Section title={t('settings.notesAnnot.title')}>
        <SettingRow label={t('settings.notesAnnot.stickyPerform.label')} hint={t('settings.notesAnnot.stickyPerform.hint')}>
          <Toggle checked={settings.stickyNotesInPerform ?? false} onChange={(v) => set('stickyNotesInPerform', v)} />
        </SettingRow>
        <SettingRow label={t('settings.notesAnnot.stickySongView.label')} hint={t('settings.notesAnnot.stickySongView.hint')}>
          <Toggle checked={settings.stickyNotesInSongView ?? false} onChange={(v) => set('stickyNotesInSongView', v)} />
        </SettingRow>
        <SettingRow label={t('settings.notesAnnot.annotPerform.label')} hint={t('settings.notesAnnot.annotPerform.hint')}>
          <Toggle
            checked={settings.annotationsInPerform ?? settings.showAnnotations ?? true}
            onChange={(v) => set('annotationsInPerform', v)}
          />
        </SettingRow>
        <SettingRow label={t('settings.notesAnnot.annotSongView.label')} hint={t('settings.notesAnnot.annotSongView.hint')}>
          <Toggle
            checked={settings.annotationsInSongView ?? settings.showAnnotations ?? true}
            onChange={(v) => set('annotationsInSongView', v)}
          />
        </SettingRow>
      </Section>)}

      {showCat('display') && (<Section title={t('settings.songListColumns.title')}>
        <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {t('settings.songListColumns.description')}
          </p>
          <SongListColumnsEditor
            visible={settings.songListColumns ?? DEFAULT_SETTINGS.songListColumns}
            order={settings.songListColumnOrder ?? DEFAULT_SETTINGS.songListColumnOrder}
            onToggle={(col, on) => set('songListColumns', {
              ...(settings.songListColumns ?? DEFAULT_SETTINGS.songListColumns),
              [col]: on,
            })}
            onReorder={(next) => set('songListColumnOrder', next)}
            onReset={() => {
              set('songListColumns', { ...DEFAULT_SETTINGS.songListColumns });
              set('songListColumnOrder', [...DEFAULT_SETTINGS.songListColumnOrder]);
            }}
          />
        </div>
      </Section>)}

      {showCat('shortcuts') && (<Section title={t('settings.shortcuts.title')}>
        <KeyboardShortcutsEditor
          shortcuts={settings.shortcuts ?? DEFAULT_SHORTCUTS}
          onChange={(next) => set('shortcuts', next)}
        />
      </Section>)}

      {showCat('data') && (<Section title={t('settings.backup.title')}>
        {/* The chord-spelling warning lives ONLY inside the library
            import confirmation dialog (rendered further down via
            <ImportModeDialog showChordSpellingWarning>). The previous
            duplicate banner in this section was removed at the user's
            request — the dialog already shows it right before the
            irreversible action, which is where the caveat belongs. */}
        <BackupRow
          label={t('settings.backup.library.label')}
          hint={t('settings.backup.library.hint')}
          onExport={handleExportLibrary}
          onImport={handleImportLibrary}
        />
        <BackupRow
          label={t('settings.backup.chords.label')}
          hint={t('settings.backup.chords.hint')}
          onExport={handleExportChords}
          onImport={handleImportChords}
        />
        <BackupRow
          label={t('settings.backup.presets.label')}
          hint={t('settings.backup.presets.hint')}
          onExport={handleExportPresets}
          onImport={handleImportPresets}
        />
        <BackupRow
          label={t('settings.backup.appSettings.label')}
          hint={t('settings.backup.appSettings.hint')}
          onExport={handleExportSettings}
          onImport={handleImportSettings}
        />
        {status && (
          <div
            className="px-4 py-2 text-xs"
            style={{
              background: 'var(--surface)',
              color: status.kind === 'error' ? 'var(--danger)' : 'var(--text-secondary)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {status.message}
          </div>
        )}
      </Section>)}

      {showCat('danger') && (<Section title={t('settings.danger.title')}>
        <div className="flex flex-col gap-3 px-4 py-3" style={{ background: 'var(--surface)' }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.danger.intro')}
          </p>
          <DeleteCheck
            checked={deleteSongs}
            onChange={setDeleteSongs}
            label={t('settings.danger.songs.label')}
            hint={t('settings.danger.songs.hint')}
          />
          <DeleteCheck
            checked={deleteChords}
            onChange={setDeleteChords}
            label={t('settings.danger.chords.label')}
            hint={t('settings.danger.chords.hint')}
          />
          <DeleteCheck
            checked={deletePresets}
            onChange={setDeletePresets}
            label={t('settings.danger.presets.label')}
            hint={t('settings.danger.presets.hint')}
          />
          <div className="flex justify-end">
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={!anyDeletionSelected}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: anyDeletionSelected ? 'var(--danger)' : 'var(--surface-elevated)',
                color: anyDeletionSelected ? 'white' : 'var(--text-muted)',
                cursor: anyDeletionSelected ? 'pointer' : 'not-allowed',
              }}
            >
              <Trash2 size={14} /> {t('settings.danger.deleteSelected')}
            </button>
          </div>
        </div>
      </Section>)}

        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('settings.danger.confirm.title')}
          message={
            <div className="flex flex-col gap-2">
              <p>{t('settings.danger.confirm.willDelete')}</p>
              <ul className="list-disc pl-5 text-sm">
                {deleteSongs && <li>{t('settings.danger.confirm.songsItem')}</li>}
                {deleteChords && <li>{t('settings.danger.confirm.chordsItem')}</li>}
                {deletePresets && <li>{t('settings.danger.confirm.presetsItem')}</li>}
              </ul>
              <p>{t('settings.danger.confirm.cannotUndo')}</p>
            </div>
          }
          confirmLabel={t('settings.danger.confirm.button')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { void runDelete(); }}
        />
      )}

      {pendingImport && pendingImport.kind !== 'settings' && (
        <ImportModeDialog
          title={
            pendingImport.kind === 'library' ? t('settings.importDialog.library.title')
            : pendingImport.kind === 'chords' ? t('settings.importDialog.chords.title')
            : t('settings.importDialog.presets.title')
          }
          description={pendingImport.description}
          replaceWarning={
            pendingImport.kind === 'library'
              ? t('settings.importDialog.library.replaceWarning')
              : pendingImport.kind === 'chords'
              ? t('settings.importDialog.chords.replaceWarning')
              : t('settings.importDialog.presets.replaceWarning')
          }
          combineHint={
            pendingImport.kind === 'library'
              ? t('settings.importDialog.library.combineHint')
              : pendingImport.kind === 'chords'
              ? t('settings.importDialog.chords.combineHint')
              : t('settings.importDialog.presets.combineHint')
          }
          onReplace={() => {
            if (pendingImport.kind === 'library') void runLibraryImport('replace');
            else if (pendingImport.kind === 'chords') runChordsImport('replace');
            else runPresetsImport('replace');
          }}
          onCombine={() => {
            if (pendingImport.kind === 'library') void runLibraryImport('combine');
            else if (pendingImport.kind === 'chords') runChordsImport('combine');
            else runPresetsImport('combine');
          }}
          onCancel={() => setPendingImport(null)}
          // Only the LIBRARY import brings in song bodies (and therefore
          // chord names). The chord/preset backups don't, so the
          // spelling warning would be misleading for them.
          showChordSpellingWarning={pendingImport.kind === 'library'}
        />
      )}

      {/* Settings backup uses a plain confirm dialog — a "combine" mode
          isn't meaningful for scalar preferences (theme, songViewStyle,
          the whole shortcuts table). Restore either fully overwrites or
          not at all. */}
      {pendingImport && pendingImport.kind === 'settings' && (
        <ConfirmDialog
          title={t('settings.restoreDialog.title')}
          message={t('settings.restoreDialog.message', { description: pendingImport.description })}
          confirmLabel={t('settings.restoreDialog.confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { void runSettingsImport(); }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      <style>{`
        .setting-select {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface-elevated);
          color: var(--text-primary);
          font-size: 13px;
          outline: none;
          min-width: 140px;
        }
        .setting-select:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>{title}</h2>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {children}
      </div>
    </div>
  );
}

/** Dictionary-key lookup for shortcut-action labels. Kept as keys (not
 *  translated strings) so the module can stay a plain constant; the
 *  editor component below resolves them via `t()` at render time. */
const SHORTCUT_LABEL_KEYS: Record<ShortcutAction, TKey> = {
  toggleInlineDiagrams: 'settings.shortcuts.actions.toggleInlineDiagrams',
  toggleChordBar:       'settings.shortcuts.actions.toggleChordBar',
  toggleLyricsOnly:     'settings.shortcuts.actions.toggleLyricsOnly',
  toggleMetronome:      'settings.shortcuts.actions.toggleMetronome',
  toggleSongNotes:      'settings.shortcuts.actions.toggleSongNotes',
  toggleAutoScroll:     'settings.shortcuts.actions.toggleAutoScroll',
  transposeUp:          'settings.shortcuts.actions.transposeUp',
  transposeDown:        'settings.shortcuts.actions.transposeDown',
  resetTranspose:       'settings.shortcuts.actions.resetTranspose',
  exportSong:           'settings.shortcuts.actions.exportSong',
  editSong:             'settings.shortcuts.actions.editSong',
  toggleFavorite:       'settings.shortcuts.actions.toggleFavorite',
  cast:                 'settings.shortcuts.actions.cast',
  addToSetList:         'settings.shortcuts.actions.addToSetList',
  toggleFullscreen:     'settings.shortcuts.actions.toggleFullscreen',
  nextSong:             'settings.shortcuts.actions.nextSong',
  prevSong:             'settings.shortcuts.actions.prevSong',
  zoomIn:               'settings.shortcuts.actions.zoomIn',
  zoomOut:              'settings.shortcuts.actions.zoomOut',
  zoomReset:            'settings.shortcuts.actions.zoomReset',
  openSearch:           'settings.shortcuts.actions.openSearch',
  toggleToolbar:        'settings.shortcuts.actions.toggleToolbar',
  toggleSongTrainer:    'settings.shortcuts.actions.toggleSongTrainer',
};

interface ShortcutGroup {
  /** i18n key for the group heading. */
  titleKey: TKey;
  /** i18n key for the descriptive hint below the heading. */
  hintKey: TKey;
  actions: ShortcutAction[];
  includeCapo?: boolean;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'settings.shortcuts.groups.global.title',
    hintKey: 'settings.shortcuts.groups.global.hint',
    actions: ['openSearch'],
  },
  {
    titleKey: 'settings.shortcuts.groups.viewDisplay.title',
    hintKey: 'settings.shortcuts.groups.viewDisplay.hint',
    actions: ['toggleInlineDiagrams', 'toggleChordBar', 'toggleLyricsOnly', 'toggleSongNotes', 'toggleFullscreen', 'toggleToolbar', 'toggleSongTrainer'],
  },
  {
    titleKey: 'settings.shortcuts.groups.playback.title',
    hintKey: 'settings.shortcuts.groups.playback.hint',
    actions: ['toggleMetronome', 'toggleAutoScroll'],
  },
  {
    titleKey: 'settings.shortcuts.groups.setList.title',
    hintKey: 'settings.shortcuts.groups.setList.hint',
    actions: ['nextSong', 'prevSong'],
  },
  {
    titleKey: 'settings.shortcuts.groups.keyCapo.title',
    hintKey: 'settings.shortcuts.groups.keyCapo.hint',
    actions: ['transposeUp', 'transposeDown', 'resetTranspose'],
    includeCapo: true,
  },
  {
    titleKey: 'settings.shortcuts.groups.songActions.title',
    hintKey: 'settings.shortcuts.groups.songActions.hint',
    actions: ['toggleFavorite', 'cast', 'addToSetList', 'exportSong', 'editSong'],
  },
  {
    titleKey: 'settings.shortcuts.groups.zoom.title',
    hintKey: 'settings.shortcuts.groups.zoom.hint',
    actions: ['zoomIn', 'zoomOut', 'zoomReset'],
  },
];

function KeyboardShortcutsEditor({
  shortcuts, onChange,
}: {
  shortcuts: KeyboardShortcuts;
  onChange: (next: KeyboardShortcuts) => void;
}): React.ReactElement {
  const t = useT();
  const update = <K extends keyof KeyboardShortcuts>(key: K, value: KeyboardShortcuts[K]) => {
    onChange({ ...shortcuts, [key]: value });
  };

  return (
    <div>
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
        {t('settings.shortcuts.intro')}
      </div>
      {SHORTCUT_GROUPS.map((group, gi) => (
        <div key={group.titleKey} style={{ borderTop: gi === 0 ? undefined : '1px solid var(--border)' }}>
          <div
            className="px-4 py-2.5 flex flex-col gap-0.5"
            style={{ background: 'var(--bg-secondary)' }}
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {t(group.titleKey)}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t(group.hintKey)}</p>
          </div>
          <div>
            {group.actions.map((action) => (
              <div
                key={action}
                className="flex items-center gap-4 px-4 py-3"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
                  {t(SHORTCUT_LABEL_KEYS[action])}
                </p>
                <ShortcutRecorder value={shortcuts[action] ?? ''} onChange={(next) => update(action, next)} />
              </div>
            ))}
            {group.includeCapo && (
              <div
                className="flex items-center gap-4 px-4 py-3"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{t('settings.shortcuts.capo.label')}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t('settings.shortcuts.capo.hint')}
                  </p>
                </div>
                <div className="flex items-center gap-2 min-w-[10rem]">
                  <select
                    value={shortcuts.capoModifier}
                    onChange={(e) => update('capoModifier', e.target.value as KeyboardShortcuts['capoModifier'])}
                    className="px-3 py-1.5 rounded-lg text-sm text-left min-w-[8rem]"
                    style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    {/* Modifier key NAMES (Alt/Ctrl/Shift/Meta) are OS-level
                        keyboard identifiers rather than translated UI text —
                        they must match what the platform reports. Left as-is. */}
                    <option value="Alt">Alt</option>
                    <option value="Ctrl">Ctrl</option>
                    <option value="Shift">Shift</option>
                    <option value="Meta">Meta</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="px-4 py-2.5 flex flex-col gap-0.5"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.shortcuts.groups.help.title')}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('settings.shortcuts.groups.help.hint')}
          </p>
        </div>
        <div
          className="flex items-center gap-4 px-4 py-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
            {t('settings.shortcuts.help.label')}
          </p>
          <kbd
            className="px-2 py-1 rounded text-xs font-mono"
            style={{
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              minWidth: '2rem',
              textAlign: 'center',
            }}
          >
            ?
          </kbd>
        </div>
      </div>
      <div className="p-3 flex justify-center" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => onChange({ ...DEFAULT_SHORTCUTS })}
          className="text-xs px-3 py-1.5 rounded hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('settings.shortcuts.restoreDefaults')}
        </button>
      </div>
    </div>
  );
}


function DeleteCheck({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left w-full cursor-pointer select-none"
    >
      <span
        className="mt-0.5 flex items-center justify-center w-5 h-5 rounded border shrink-0"
        style={{
          borderColor: checked ? 'var(--danger)' : 'var(--border)',
          background: checked ? 'var(--danger)' : 'transparent',
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5L5 9L10 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        {hint && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
    </button>
  );
}

function ImportModeDialog({
  title, description, replaceWarning, combineHint,
  onReplace, onCombine, onCancel,
  showChordSpellingWarning = false,
}: {
  title: string;
  description: string;
  replaceWarning: string;
  combineHint: string;
  onReplace: () => void;
  onCombine: () => void;
  onCancel: () => void;
  /** Show the chord-spelling notice (library imports only). */
  showChordSpellingWarning?: boolean;
}): React.ReactElement {
  const t = useT();
  React.useEffect(() => {
    // Capture phase + stopImmediatePropagation so page-level Escape handlers
    // don't also fire when the user dismisses this dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onCancel]);

  // The prompt has an inline <strong>{description}</strong>, which we
  // can't build with a single interpolated string. Substitute a unique
  // sentinel token, then split the localized template around it so
  // both halves stay translatable while the value renders inside a
  // <strong>.
  const DESC_SENTINEL = '__DESCRIPTION__';
  const [promptBefore, promptAfter = ''] =
    t('settings.importDialog.prompt', { description: DESC_SENTINEL }).split(DESC_SENTINEL);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: 'var(--text-secondary)' }}>
          {promptBefore}<strong>{description}</strong>{promptAfter}
        </p>

        {showChordSpellingWarning && (
          <div className="mb-4">
            <ChordSpellingWarning variant="inline" />
          </div>
        )}

        <div className="flex flex-col gap-2 mb-5">
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('settings.importDialog.replace')}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{replaceWarning}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('settings.importDialog.combine')}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{combineHint}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onReplace}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--danger)', background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
          >
            {t('settings.importDialog.replace')}
          </button>
          <button
            onClick={onCombine}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {t('settings.importDialog.combine')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackupRow({
  label, hint, onExport, onImport,
}: {
  label: string;
  hint?: string;
  onExport: () => void | Promise<void>;
  onImport: () => void | Promise<void>;
}): React.ReactElement {
  const t = useT();
  return (
    <SettingRow label={label} hint={hint}>
      <div className="flex gap-2">
        <button
          onClick={() => void onExport()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          <Download size={12} /> {t('settings.backup.buttons.export')}
        </button>
        <button
          onClick={() => void onImport()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Upload size={12} /> {t('settings.backup.buttons.import')}
        </button>
      </div>
    </SettingRow>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        {hint && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-10 h-6 rounded-full transition-colors"
      style={{ background: checked ? 'var(--accent)' : 'var(--border)' }}
    >
      <span
        className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  );
}

function SongViewStyleSection({ style, onChange, customPresets, onCustomPresetsChange }: {
  style: SongViewStyle;
  onChange: (v: SongViewStyle) => void;
  customPresets: Record<string, CustomPreset>;
  onCustomPresetsChange: (v: Record<string, CustomPreset>) => void;
}): React.ReactElement {
  const t = useT();
  const [editing, setEditing] = useState<'save' | 'rename' | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editMode, setEditMode] = useState<'dark' | 'light'>('dark');

  const effectiveTheme = useEffectiveTheme();
  const customEntries = Object.entries(customPresets);

  const applyPreset = (key: string) => {
    const builtin = SONG_STYLE_PRESETS[key];
    if (builtin) { onChange({ ...builtin.style }); return; }
    const custom = customPresets[key];
    if (custom) { onChange({ ...custom.style }); return; }
  };

  const startSave = () => {
    setEditing('save');
    setEditValue('');
    setEditMode(effectiveTheme);
  };

  const commitSave = () => {
    if (!editValue.trim()) { setEditing(null); return; }
    const key = `custom_${Date.now()}`;
    const preset: CustomPreset = { name: editValue.trim(), mode: editMode, style: { ...style, preset: key } };
    onCustomPresetsChange({ ...customPresets, [key]: preset });
    onChange({ ...style, preset: key });
    setEditing(null);
  };

  const setPresetMode = (key: string, mode: 'dark' | 'light') => {
    if (!customPresets[key]) return;
    onCustomPresetsChange({ ...customPresets, [key]: { ...customPresets[key]!, mode } });
  };

  const startRename = (key: string) => {
    setEditing('rename');
    setEditKey(key);
    setEditValue(customPresets[key]?.name ?? '');
  };

  const commitRename = () => {
    if (!editValue.trim() || !editKey) { setEditing(null); return; }
    onCustomPresetsChange({ ...customPresets, [editKey]: { ...customPresets[editKey]!, name: editValue.trim() } });
    setEditing(null);
  };

  const commitEdit = () => {
    if (editing === 'save') commitSave();
    else if (editing === 'rename') commitRename();
  };

  const deletePreset = (key: string) => {
    const updated = { ...customPresets };
    delete updated[key];
    onCustomPresetsChange(updated);
    if (style.preset === key) onChange({ ...style, preset: 'custom' });
  };

  const updateCurrentPreset = () => {
    const key = style.preset;
    if (!customPresets[key]) return;
    const updated = { ...customPresets, [key]: { ...customPresets[key]!, style: { ...style } } };
    onCustomPresetsChange(updated);
  };

  const isCustomPreset = !!customPresets[style.preset];

  // When editing a custom preset, keep its key so the user can click Update
  // to save. Only fall back to 'custom' when the current preset is a built-in
  // one (which must not be mutated).
  const nextPreset = () => isCustomPreset ? style.preset : 'custom';

  const patch = (partial: Partial<SongViewStyle>) => onChange({ ...style, ...partial, preset: nextPreset() });
  const patchSec = (key: 'lyrics' | 'chords' | 'title' | 'details' | 'section', partial: Partial<SectionStyle>) => {
    onChange({ ...style, [key]: { ...style[key], ...partial }, preset: nextPreset() });
  };

  return (
    <Section title={t('settings.songView.title')}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('settings.songView.stylePreset')}</p>
        <div className="flex items-center gap-2">
          <select value={style.preset} onChange={(e) => applyPreset(e.target.value)} className="setting-select">
            <optgroup label={effectiveTheme === 'dark' ? t('settings.songView.darkMode') : t('settings.songView.lightMode')}>
              {Object.entries(SONG_STYLE_PRESETS).filter(([, p]) => p.mode === effectiveTheme).map(([key, p]) => (
                <option key={key} value={key}>{p.name}</option>
              ))}
            </optgroup>
            {customEntries.filter(([, p]) => p.mode === effectiveTheme).length > 0 && (
              <optgroup label={t('settings.songView.myPresets')}>
                {customEntries.filter(([, p]) => p.mode === effectiveTheme).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </optgroup>
            )}
            {style.preset === 'custom' && <option value="custom">{t('settings.songView.customOption')}</option>}
          </select>
          <button onClick={startSave} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--accent)' }} title={t('settings.songView.saveTitle')}>{t('settings.songView.save')}</button>
          {isCustomPreset && (
            <>
              <button onClick={updateCurrentPreset} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-secondary)' }} title={t('settings.songView.updateTitle')}>{t('settings.songView.update')}</button>
              <button onClick={() => startRename(style.preset)} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-secondary)' }} title={t('settings.songView.renameTitle')}>{t('settings.songView.rename')}</button>
              <button onClick={() => deletePreset(style.preset)} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--danger, #ef4444)' }} title={t('settings.songView.deleteTitle')}>{t('settings.songView.delete')}</button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{editing === 'save' ? t('settings.songView.editing.nameLabel') : t('settings.songView.editing.renameLabel')}</span>
          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
            placeholder={t('settings.songView.editing.placeholder')}
            className="flex-1 text-sm rounded px-2 py-1"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            autoFocus />
          {editing === 'save' && (
            <select value={editMode} onChange={(e) => setEditMode(e.target.value as 'dark' | 'light')}
              className="setting-select" title={t('settings.songView.editing.modeTitle')}>
              <option value="dark">{t('settings.songView.presetMode.dark')}</option>
              <option value="light">{t('settings.songView.presetMode.light')}</option>
            </select>
          )}
          <button onClick={commitEdit} className="px-2 py-1 text-xs rounded" style={{ color: 'var(--accent)' }}>{t('settings.songView.editing.ok')}</button>
          <button onClick={() => setEditing(null)} className="px-2 py-1 text-xs rounded" style={{ color: 'var(--text-muted)' }}>{t('settings.songView.editing.cancel')}</button>
        </div>
      )}
      {isCustomPreset && (
        <SettingRow label={t('settings.songView.presetMode.label')}>
          <select value={customPresets[style.preset]?.mode ?? 'dark'}
            onChange={(e) => setPresetMode(style.preset, e.target.value as 'dark' | 'light')}
            className="setting-select"
            title={t('settings.songView.presetMode.title')}>
            <option value="dark">{t('settings.songView.presetMode.dark')}</option>
            <option value="light">{t('settings.songView.presetMode.light')}</option>
          </select>
        </SettingRow>
      )}

      <SettingRow label={t('settings.songView.font')}>
        <select value={style.fontFamily || ''} onChange={(e) => patch({ fontFamily: e.target.value })} className="setting-select">
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>{f.label}</option>
          ))}
        </select>
      </SettingRow>

      <SizeColorRow label={t('settings.songView.lyrics')} sectionKey="lyrics" size={style.lyrics.fontSize} color={style.lyrics.color}
        onSize={(v) => patchSec('lyrics', { fontSize: v })} onColor={(v) => patchSec('lyrics', { color: v })} />
      <SizeColorRow label={t('settings.songView.chords')} sectionKey="chords" size={style.chords.fontSize} color={style.chords.color}
        onSize={(v) => patchSec('chords', { fontSize: v })} onColor={(v) => patchSec('chords', { color: v })} />
      <SizeColorRow label={t('settings.songView.songTitle')} sectionKey="title" size={style.title.fontSize} color={style.title.color}
        onSize={(v) => patchSec('title', { fontSize: v })} onColor={(v) => patchSec('title', { color: v })}
        uppercase={style.titleUppercase} onUppercase={(v) => patch({ titleUppercase: v })} />
      <SizeColorRow label={t('settings.songView.songDetails')} sectionKey="details" size={style.details.fontSize} color={style.details.color}
        onSize={(v) => patchSec('details', { fontSize: v })} onColor={(v) => patchSec('details', { color: v })} />
      <SizeColorRow label={t('settings.songView.sectionTitles')} sectionKey="section" size={style.section.fontSize} color={style.section.color} bg={style.section.background}
        onSize={(v) => patchSec('section', { fontSize: v })} onColor={(v) => patchSec('section', { color: v })} onBg={(v) => patchSec('section', { background: v })}
        uppercase={style.sectionUppercase} onUppercase={(v) => patch({ sectionUppercase: v })} />
      {/* Chorus border */}
      <SettingRow label={t('settings.songView.chorusBorder')}>
        <ColorInput value={style.chorusBorderColor} onChange={(v) => patch({ chorusBorderColor: v })} />
      </SettingRow>
    </Section>
  );
}

function SizeColorRow({ label, sectionKey, size, color, bg, uppercase, onSize, onColor, onBg, onUppercase }: {
  label: string; sectionKey: string; size: number; color?: string; bg?: string; uppercase?: boolean;
  onSize: (v: number) => void; onColor?: (v: string) => void; onBg?: (v: string) => void; onUppercase?: (v: boolean) => void;
}): React.ReactElement {
  const t = useT();
  const limits = FONT_SIZE_LIMITS[sectionKey] ?? { min: 8, max: 36 };
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="number" min={limits.min} max={limits.max} value={size || ''} placeholder="—"
            onChange={(e) => { const v = Number(e.target.value) || 0; onSize(Math.min(limits.max, Math.max(v ? limits.min : 0, v))); }}
            className="w-12 text-center text-xs rounded px-1 py-0.5"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          px
        </label>
        {onColor !== undefined && (
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.songView.sizeColor.color')} <ColorInput value={color ?? ''} onChange={onColor} />
          </label>
        )}
        {onBg !== undefined && (
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.songView.sizeColor.bg')} <ColorInput value={bg ?? ''} onChange={onBg} />
          </label>
        )}
        {onUppercase !== undefined && (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.songView.sizeColor.uppercase')} <Toggle checked={!!uppercase} onChange={onUppercase} />
          </label>
        )}
      </div>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  return (
    <input type="color" value={value || '#6366f1'} onChange={(e) => onChange(e.target.value)}
      className="w-6 h-6 rounded cursor-pointer border-0" style={{ padding: 0 }} />
  );
}
