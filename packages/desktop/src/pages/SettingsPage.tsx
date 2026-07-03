import React, { useState } from 'react';
import { useSettingsStore, useSongStore, useSetListStore, SONG_STYLE_PRESETS, FONT_FAMILIES, FONT_SIZE_LIMITS, DEFAULT_SONG_VIEW_STYLE, DEFAULT_SHORTCUTS, DEFAULT_SETTINGS } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { AppSettings, ThemeType, InstrumentType, SongViewStyle, SectionStyle, CustomPreset, ChordDiagram, KeyboardShortcuts, ShortcutAction } from '@song-chords/shared';
import SongListColumnsEditor from '../components/song/SongListColumnsEditor';
import ShortcutRecorder from '../components/common/ShortcutRecorder';
import { Download, Upload, Trash2, Palette, Music as MusicIcon, Layout, Keyboard, Database, AlertTriangle } from 'lucide-react';
import ConfirmDialog from '../components/common/ConfirmDialog';
import ChordSpellingWarning from '../components/common/ChordSpellingWarning';
import {
  downloadJson, pickJsonFile, timestampSlug,
  exportLibrary, importLibrary, mergeLibrary, buildChordsBackup, buildPresetsBackup,
  type LibraryBackup, type CustomChordsBackup, type CustomPresetsBackup,
} from '../utils/backup';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';

export default function SettingsPage(): React.ReactElement {
  const { settings, updateSetting } = useSettingsStore();

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    void updateSetting(db, key, value);
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
    | null
  >(null);
  const flash = (kind: 'info' | 'error', message: string) => {
    setStatus({ kind, message });
    window.setTimeout(() => setStatus((s) => (s?.message === message ? null : s)), 4000);
  };

  const handleExportLibrary = async () => {
    try {
      const backup = await exportLibrary(db);
      downloadJson(`songchords-library-${timestampSlug()}.json`, backup);
      flash('info', `Exported ${backup.songs.length} songs, ${backup.setlists.length} set lists.`);
    } catch (e) {
      flash('error', `Export failed: ${String(e)}`);
    }
  };

  const handleImportLibrary = async () => {
    const data = await pickJsonFile<LibraryBackup>();
    if (!data) return;
    if (!Array.isArray(data.songs)) {
      flash('error', 'This file does not look like a library backup.');
      return;
    }
    setPendingImport({
      kind: 'library',
      data,
      description: `${data.songs.length} song${data.songs.length === 1 ? '' : 's'}, ${data.setlists.length} set list${data.setlists.length === 1 ? '' : 's'}`,
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
        ? `Replaced library with ${pending.description}.`
        : `Combined backup (${pending.description}) with current library.`);
    } catch (e) {
      flash('error', `Import failed: ${String(e)}`);
    }
  };

  const handleExportChords = () => {
    try {
      const backup = buildChordsBackup(settings.customChords ?? {});
      const count = Object.values(backup.customChords).reduce((n, arr) => n + arr.length, 0);
      downloadJson(`songchords-custom-chords-${timestampSlug()}.json`, backup);
      flash('info', `Exported ${count} custom chord voicing${count === 1 ? '' : 's'}.`);
    } catch (e) {
      flash('error', `Export failed: ${String(e)}`);
    }
  };

  const handleImportChords = async () => {
    const data = await pickJsonFile<CustomChordsBackup>();
    if (!data || typeof data.customChords !== 'object') {
      if (data !== null) flash('error', 'This file does not look like a custom chords backup.');
      return;
    }
    const count = Object.values(data.customChords).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    setPendingImport({
      kind: 'chords',
      data,
      description: `${count} custom chord voicing${count === 1 ? '' : 's'} across ${Object.keys(data.customChords).length} chord${Object.keys(data.customChords).length === 1 ? '' : 's'}`,
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
      flash('info', mode === 'replace'
        ? 'Replaced custom chords with backup.'
        : 'Combined backup with existing custom chords.');
    } catch (e) {
      flash('error', `Import failed: ${String(e)}`);
    }
  };

  const handleExportPresets = () => {
    try {
      const backup = buildPresetsBackup(settings.customPresets ?? {});
      const count = Object.keys(backup.customPresets).length;
      downloadJson(`songchords-custom-presets-${timestampSlug()}.json`, backup);
      flash('info', `Exported ${count} custom preset${count === 1 ? '' : 's'}.`);
    } catch (e) {
      flash('error', `Export failed: ${String(e)}`);
    }
  };

  const handleImportPresets = async () => {
    const data = await pickJsonFile<CustomPresetsBackup>();
    if (!data || typeof data.customPresets !== 'object') {
      if (data !== null) flash('error', 'This file does not look like a custom presets backup.');
      return;
    }
    const count = Object.keys(data.customPresets).length;
    setPendingImport({
      kind: 'presets',
      data,
      description: `${count} custom preset${count === 1 ? '' : 's'}`,
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
        ? 'Replaced custom presets with backup.'
        : 'Combined backup with existing custom presets.');
    } catch (e) {
      flash('error', `Import failed: ${String(e)}`);
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
      if (deleteSongs) parts.push('songs, favorites, set lists');
      if (deleteChords) parts.push('custom chords');
      if (deletePresets) parts.push('custom presets');
      flash('info', `Deleted: ${parts.join(' · ')}.`);
      setDeleteSongs(false);
      setDeleteChords(false);
      setDeletePresets(false);
    } catch (e) {
      flash('error', `Delete failed: ${String(e)}`);
    }
  };

  // Categories that drive the left-side navigation. The actual section
  // content stays inline below; we just gate each Section on the
  // active category so the page renders one logical group at a time.
  const CATEGORIES = [
    { id: 'general',   label: 'General',   icon: <Palette size={14} /> },
    { id: 'display',   label: 'Display',   icon: <Layout size={14} /> },
    { id: 'playback',  label: 'Playback',  icon: <MusicIcon size={14} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} /> },
    { id: 'data',      label: 'Data',      icon: <Database size={14} /> },
    { id: 'danger',    label: 'Danger Zone', icon: <AlertTriangle size={14} /> },
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
        aria-label="Settings categories"
      >
        <h1
          className="text-[13px] font-semibold uppercase tracking-wider pr-4 mr-2 shrink-0"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.08em', borderRight: '1px solid var(--border)', paddingTop: 14, paddingBottom: 14 }}
        >
          Settings
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
              <span>{c.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right pane — scrolls independently. */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-2xl mx-auto">

      {showCat('general') && (<Section title="Appearance">
        <SettingRow label="Theme">
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
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </SettingRow>
      </Section>)}

      {showCat('general') && (<Section title="Music">
        <SettingRow label="Default Instrument">
          <select
            value={settings.defaultInstrument}
            onChange={(e) => set('defaultInstrument', e.target.value as InstrumentType)}
            className="setting-select"
          >
            <option value="guitar">Guitar</option>
            <option value="ukulele">Ukulele</option>
            <option value="piano">Piano</option>
          </select>
        </SettingRow>
        <SettingRow label="Accidentals" hint="Flats / Sharps override the automatic key-based spelling; Auto uses the circle of fifths">
          <select
            value={settings.accidentalMode ?? 'auto'}
            onChange={(e) => set('accidentalMode', e.target.value as 'auto' | 'flats' | 'sharps')}
            className="setting-select"
          >
            <option value="auto">Auto</option>
            <option value="flats">Flats</option>
            <option value="sharps">Sharps</option>
          </select>
        </SettingRow>
        <SettingRow label="Chord Notation" hint="Letter (A–G) or Latin solfège (DO/RE/MI/FA/SOL/LA/SI). Latin uses uppercase for major and lowercase for minor (e.g. SOL = G, sol = Gm)">
          <select
            value={settings.chordNotation ?? 'letter'}
            onChange={(e) => set('chordNotation', e.target.value as 'letter' | 'latin')}
            className="setting-select"
          >
            <option value="letter">Letter (A–G)</option>
            <option value="latin">Latin (Do–Si)</option>
          </select>
        </SettingRow>
        <SettingRow label="Show chord diagrams bar" hint="Default visibility of the chord diagrams bar for all songs">
          <Toggle checked={settings.showChordDiagrams} onChange={(v) => set('showChordDiagrams', v)} />
        </SettingRow>
      </Section>)}

      {showCat('playback') && (<Section title="Auto-Scroll">
        <SettingRow label="Default Scroll Speed">
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

      {showCat('display') && (
        <SongViewStyleSection style={settings.songViewStyle} onChange={(v) => set('songViewStyle', v)}
          customPresets={settings.customPresets ?? {}} onCustomPresetsChange={(v) => set('customPresets', v)} />
      )}

      {showCat('display') && (<Section title="Song Layout">
        <SettingRow label="Center Song" hint="Center the song content on the page">
          <Toggle checked={settings.songCentered ?? false} onChange={(v) => set('songCentered', v)} />
        </SettingRow>
        <SettingRow label="Chord Diagrams Bar" hint="Position of the chord diagrams bar">
          <select
            value={settings.chordBarPosition ?? 'top'}
            onChange={(e) => set('chordBarPosition', e.target.value as 'top' | 'bottom' | 'right' | 'off')}
            className="setting-select"
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
            <option value="right">Right</option>
          </select>
        </SettingRow>
        <SettingRow label="Performance Zoom" hint="Zoom level when in performance mode">
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

      {showCat('display') && (<Section title="Song List Columns">
        <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            Columns to show in the Songs, Categories, and Favorites lists. Drag to reorder, uncheck to hide. Title is always shown.
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

      {showCat('shortcuts') && (<Section title="Keyboard Shortcuts">
        <KeyboardShortcutsEditor
          shortcuts={settings.shortcuts ?? DEFAULT_SHORTCUTS}
          onChange={(next) => set('shortcuts', next)}
        />
      </Section>)}

      {showCat('data') && (<Section title="Backup & Restore">
        {/* The chord-spelling warning lives ONLY inside the library
            import confirmation dialog (rendered further down via
            <ImportModeDialog showChordSpellingWarning>). The previous
            duplicate banner in this section was removed at the user's
            request — the dialog already shows it right before the
            irreversible action, which is where the caveat belongs. */}
        <BackupRow
          label="Songs library"
          hint="All songs, set lists, and favorites. Restoring replaces everything."
          onExport={handleExportLibrary}
          onImport={handleImportLibrary}
        />
        <BackupRow
          label="Custom chords"
          hint="Your custom chord voicings from the chord library. Restore merges into existing chords."
          onExport={handleExportChords}
          onImport={handleImportChords}
        />
        <BackupRow
          label="Custom style presets"
          hint="Song-view style presets you've created. Restore merges into existing presets."
          onExport={handleExportPresets}
          onImport={handleImportPresets}
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

      {showCat('danger') && (<Section title="Danger Zone">
        <div className="flex flex-col gap-3 px-4 py-3" style={{ background: 'var(--surface)' }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Pick what to delete. This cannot be undone — export a backup first if you want a copy.
          </p>
          <DeleteCheck
            checked={deleteSongs}
            onChange={setDeleteSongs}
            label="Songs, favorites and set lists"
            hint="Wipes every song, along with all favorites and set lists."
          />
          <DeleteCheck
            checked={deleteChords}
            onChange={setDeleteChords}
            label="Custom chords"
            hint="Removes every chord voicing you added from the chord library."
          />
          <DeleteCheck
            checked={deletePresets}
            onChange={setDeletePresets}
            label="Custom style presets"
            hint="Removes every song-view style preset you created."
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
              <Trash2 size={14} /> Delete selected
            </button>
          </div>
        </div>
      </Section>)}

        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete selected data?"
          message={
            <div className="flex flex-col gap-2">
              <p>This will permanently delete:</p>
              <ul className="list-disc pl-5 text-sm">
                {deleteSongs && <li>Songs, favorites and set lists</li>}
                {deleteChords && <li>Custom chords</li>}
                {deletePresets && <li>Custom style presets</li>}
              </ul>
              <p>This cannot be undone.</p>
            </div>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { void runDelete(); }}
        />
      )}

      {pendingImport && (
        <ImportModeDialog
          title={
            pendingImport.kind === 'library' ? 'Import songs library'
            : pendingImport.kind === 'chords' ? 'Import custom chords'
            : 'Import custom style presets'
          }
          description={pendingImport.description}
          replaceWarning={
            pendingImport.kind === 'library'
              ? 'Deletes all current songs, set lists, and favorites first. Cannot be undone.'
              : pendingImport.kind === 'chords'
              ? 'Discards all existing custom chord voicings before loading the backup.'
              : 'Discards all existing custom style presets before loading the backup.'
          }
          combineHint={
            pendingImport.kind === 'library'
              ? 'Adds new songs / set lists / favorites; existing items with the same id are kept untouched.'
              : pendingImport.kind === 'chords'
              ? 'Imported chord voicings overwrite any locally-defined voicings with the same chord name.'
              : 'Imported presets overwrite any locally-defined presets with the same name.'
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

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggleInlineDiagrams: 'Toggle inline chord diagrams',
  toggleChordBar:       'Toggle chord diagrams bar',
  toggleLyricsOnly:     'Toggle lyrics-only mode',
  toggleMetronome:      'Start / stop metronome',
  toggleSongNotes:      'Show / hide song notes',
  toggleAutoScroll:     'Start / pause auto-scroll',
  transposeUp:          'Transpose up',
  transposeDown:        'Transpose down',
  resetTranspose:       'Reset transpose to 0',
  exportSong:           'Open export modal',
  editSong:             'Enter edit page',
  toggleFavorite:       'Toggle favorite',
  cast:                 'Open cast popover',
  addToSetList:         'Add song to set list',
  toggleFullscreen:     'Toggle fullscreen / performance mode',
  nextSong:             'Next song (in a set list)',
  prevSong:             'Previous song (in a set list)',
  zoomIn:               'Zoom in',
  zoomOut:              'Zoom out',
  zoomReset:            'Reset zoom',
  openSearch:           'Open global search',
  toggleToolbar:        'Show / hide the toolbar',
};

interface ShortcutGroup {
  title: string;
  hint: string;
  actions: ShortcutAction[];
  includeCapo?: boolean;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    hint: 'Available from anywhere in the app.',
    actions: ['openSearch'],
  },
  {
    title: 'View & Display',
    hint: 'Active in the Song view and Perform pages.',
    actions: ['toggleInlineDiagrams', 'toggleChordBar', 'toggleLyricsOnly', 'toggleSongNotes', 'toggleFullscreen', 'toggleToolbar'],
  },
  {
    title: 'Playback',
    hint: 'Metronome and auto-scroll. Active in the Song view and Perform pages.',
    actions: ['toggleMetronome', 'toggleAutoScroll'],
  },
  {
    title: 'Set list navigation',
    hint: 'Move between songs while performing a set list.',
    actions: ['nextSong', 'prevSong'],
  },
  {
    title: 'Key & Capo',
    hint: 'Transpose the song up or down; hold the capo modifier with a digit to set the capo directly. Active in the Song view and Perform pages.',
    actions: ['transposeUp', 'transposeDown', 'resetTranspose'],
    includeCapo: true,
  },
  {
    title: 'Song actions',
    hint: 'Favorite, cast, add to set list, export, edit. Active when a song is open.',
    actions: ['toggleFavorite', 'cast', 'addToSetList', 'exportSong', 'editSong'],
  },
  {
    title: 'Zoom',
    hint: 'Zooms the Song view / Perform content when on those pages, otherwise scales the whole interface.',
    actions: ['zoomIn', 'zoomOut', 'zoomReset'],
  },
];

function KeyboardShortcutsEditor({
  shortcuts, onChange,
}: {
  shortcuts: KeyboardShortcuts;
  onChange: (next: KeyboardShortcuts) => void;
}): React.ReactElement {
  const update = <K extends keyof KeyboardShortcuts>(key: K, value: KeyboardShortcuts[K]) => {
    onChange({ ...shortcuts, [key]: value });
  };

  return (
    <div>
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
        Click any binding to record a new key combination. Press Escape while recording to cancel. Use the × button to disable the shortcut.
      </div>
      {SHORTCUT_GROUPS.map((group, gi) => (
        <div key={group.title} style={{ borderTop: gi === 0 ? undefined : '1px solid var(--border)' }}>
          <div
            className="px-4 py-2.5 flex flex-col gap-0.5"
            style={{ background: 'var(--bg-secondary)' }}
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {group.title}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{group.hint}</p>
          </div>
          <div>
            {group.actions.map((action) => (
              <div
                key={action}
                className="flex items-center gap-4 px-4 py-3"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
                  {SHORTCUT_LABELS[action]}
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
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Capo modifier</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Held with a digit 0-9 to set the capo to that fret.
                  </p>
                </div>
                <div className="flex items-center gap-2 min-w-[10rem]">
                  <select
                    value={shortcuts.capoModifier}
                    onChange={(e) => update('capoModifier', e.target.value as KeyboardShortcuts['capoModifier'])}
                    className="px-3 py-1.5 rounded-lg text-sm text-left min-w-[8rem]"
                    style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
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
            Help
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Built-in shortcut for opening this list. Cannot be changed.
          </p>
        </div>
        <div
          className="flex items-center gap-4 px-4 py-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
            Open keyboard shortcuts list
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
          Restore defaults
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
          The backup contains <strong>{description}</strong>. How should it be applied?
        </p>

        {showChordSpellingWarning && (
          <div className="mb-4">
            <ChordSpellingWarning variant="inline" />
          </div>
        )}

        <div className="flex flex-col gap-2 mb-5">
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Replace</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{replaceWarning}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Combine</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{combineHint}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onReplace}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--danger)', background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
          >
            Replace
          </button>
          <button
            onClick={onCombine}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Combine
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
  return (
    <SettingRow label={label} hint={hint}>
      <div className="flex gap-2">
        <button
          onClick={() => void onExport()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          <Download size={12} /> Export
        </button>
        <button
          onClick={() => void onImport()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Upload size={12} /> Import
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
    <Section title="Song View">
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Style Preset</p>
        <div className="flex items-center gap-2">
          <select value={style.preset} onChange={(e) => applyPreset(e.target.value)} className="setting-select">
            <optgroup label={effectiveTheme === 'dark' ? 'Dark Mode' : 'Light Mode'}>
              {Object.entries(SONG_STYLE_PRESETS).filter(([, p]) => p.mode === effectiveTheme).map(([key, p]) => (
                <option key={key} value={key}>{p.name}</option>
              ))}
            </optgroup>
            {customEntries.filter(([, p]) => p.mode === effectiveTheme).length > 0 && (
              <optgroup label="My Presets">
                {customEntries.filter(([, p]) => p.mode === effectiveTheme).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </optgroup>
            )}
            {style.preset === 'custom' && <option value="custom">Custom</option>}
          </select>
          <button onClick={startSave} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--accent)' }} title="Save current style as new preset">Save</button>
          {isCustomPreset && (
            <>
              <button onClick={updateCurrentPreset} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-secondary)' }} title="Update this preset with current settings">Update</button>
              <button onClick={() => startRename(style.preset)} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-secondary)' }} title="Rename preset">Rename</button>
              <button onClick={() => deletePreset(style.preset)} className="px-2 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--danger, #ef4444)' }} title="Delete preset">Delete</button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{editing === 'save' ? 'Name:' : 'Rename:'}</span>
          <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
            placeholder="Preset name"
            className="flex-1 text-sm rounded px-2 py-1"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            autoFocus />
          {editing === 'save' && (
            <select value={editMode} onChange={(e) => setEditMode(e.target.value as 'dark' | 'light')}
              className="setting-select" title="Which theme this preset is for">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          )}
          <button onClick={commitEdit} className="px-2 py-1 text-xs rounded" style={{ color: 'var(--accent)' }}>OK</button>
          <button onClick={() => setEditing(null)} className="px-2 py-1 text-xs rounded" style={{ color: 'var(--text-muted)' }}>Cancel</button>
        </div>
      )}
      {isCustomPreset && (
        <SettingRow label="Preset Mode">
          <select value={customPresets[style.preset]?.mode ?? 'dark'}
            onChange={(e) => setPresetMode(style.preset, e.target.value as 'dark' | 'light')}
            className="setting-select"
            title="Which theme this preset is for — controls which dropdown group lists it.">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </SettingRow>
      )}

      <SettingRow label="Font">
        <select value={style.fontFamily || ''} onChange={(e) => patch({ fontFamily: e.target.value })} className="setting-select">
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>{f.label}</option>
          ))}
        </select>
      </SettingRow>

      <SizeColorRow label="Lyrics" sectionKey="lyrics" size={style.lyrics.fontSize} color={style.lyrics.color}
        onSize={(v) => patchSec('lyrics', { fontSize: v })} onColor={(v) => patchSec('lyrics', { color: v })} />
      <SizeColorRow label="Chords" sectionKey="chords" size={style.chords.fontSize} color={style.chords.color}
        onSize={(v) => patchSec('chords', { fontSize: v })} onColor={(v) => patchSec('chords', { color: v })} />
      <SizeColorRow label="Song Title" sectionKey="title" size={style.title.fontSize} color={style.title.color}
        onSize={(v) => patchSec('title', { fontSize: v })} onColor={(v) => patchSec('title', { color: v })}
        uppercase={style.titleUppercase} onUppercase={(v) => patch({ titleUppercase: v })} />
      <SizeColorRow label="Song Details" sectionKey="details" size={style.details.fontSize} color={style.details.color}
        onSize={(v) => patchSec('details', { fontSize: v })} onColor={(v) => patchSec('details', { color: v })} />
      <SizeColorRow label="Section Titles" sectionKey="section" size={style.section.fontSize} color={style.section.color} bg={style.section.background}
        onSize={(v) => patchSec('section', { fontSize: v })} onColor={(v) => patchSec('section', { color: v })} onBg={(v) => patchSec('section', { background: v })}
        uppercase={style.sectionUppercase} onUppercase={(v) => patch({ sectionUppercase: v })} />
      {/* Chorus border */}
      <SettingRow label="Chorus Border">
        <ColorInput value={style.chorusBorderColor} onChange={(v) => patch({ chorusBorderColor: v })} />
      </SettingRow>
    </Section>
  );
}

function SizeColorRow({ label, sectionKey, size, color, bg, uppercase, onSize, onColor, onBg, onUppercase }: {
  label: string; sectionKey: string; size: number; color?: string; bg?: string; uppercase?: boolean;
  onSize: (v: number) => void; onColor?: (v: string) => void; onBg?: (v: string) => void; onUppercase?: (v: boolean) => void;
}): React.ReactElement {
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
            Color <ColorInput value={color ?? ''} onChange={onColor} />
          </label>
        )}
        {onBg !== undefined && (
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Bg <ColorInput value={bg ?? ''} onChange={onBg} />
          </label>
        )}
        {onUppercase !== undefined && (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            AA <Toggle checked={!!uppercase} onChange={onUppercase} />
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
