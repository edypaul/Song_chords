import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, AlertCircle, Trash2, Pencil, ListPlus, ListMusic, Star, ClipboardPaste, Copy } from 'lucide-react';
import { importFromString, importSongsFromJson, useSongStore, useSetListStore, useSettingsStore } from '@song-chords/shared';
import type { Song, SongCreateInput } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import { toTitleCase } from '../utils/text';
import SetListPickerModal from '../components/song/SetListPickerModal';
import ChordSpellingWarning from '../components/common/ChordSpellingWarning';
import { useT } from '../i18n';

interface PendingImport {
  id: string;                     // temporary id for list keys
  filename: string;
  input?: SongCreateInput;        // successfully parsed payload
  selected: boolean;
  error?: string;                 // parse or save failure — stays in the list
  /** Set list ids to add the song to after import. */
  targetSetlistIds?: string[];
  /** Mark as favorite when imported. */
  favorite?: boolean;
}

const SUPPORTED_EXTENSIONS = new Set(['cho', 'chordpro', 'chopro', 'crd', 'pro', 'txt', 'json']);
const SUPPORTED_EXT_LABEL = '.cho, .chordpro, .chopro, .crd, .pro, .txt, .json';

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

const STORAGE_KEY = 'song-chords:import-staging';
// Use time + random so IDs stay unique across sessions + rehydration.
const makeId = () => `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function loadStaging(): PendingImport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingImport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveStaging(rows: PendingImport[]): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore quota errors */ }
}

export default function ImportPage(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { addSong, songs } = useSongStore();
  const addSongToSetList = useSetListStore((s) => s.addSongToSetList);
  const setlists = useSetListStore((s) => s.setlists);

  // Normalise for duplicate comparison: Unicode NFD + diacritic strip so
  // "Andrés" matches "Andres", collapse internal whitespace, trim, lowercase.
  // Different apps emit accented characters in either NFC or NFD form;
  // without normalising both sides, "é" (U+00E9) won't equal "e + U+0301".
  const normalise = (s: string | undefined | null): string =>
    (s ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  // Two indexes so duplicate detection is lenient: exact title+artist match
  // is strongest, but a title-only match is still surfaced because many
  // pasted songs omit the artist directive.
  const libraryIndex = useMemo(() => {
    const byTitleArtist = new Map<string, Song>();
    const byTitle = new Map<string, Song[]>();
    for (const s of songs) {
      const t = normalise(s.title);
      if (!t) continue;
      const a = normalise(s.artist);
      byTitleArtist.set(`${t}|${a}`, s);
      const list = byTitle.get(t) ?? [];
      list.push(s);
      byTitle.set(t, list);
    }
    return { byTitleArtist, byTitle };
  }, [songs]);
  const isDuplicate = (input?: SongCreateInput): boolean => {
    if (!input) return false;
    const t = normalise(input.title);
    if (!t) return false;
    const a = normalise(input.artist);
    if (libraryIndex.byTitleArtist.has(`${t}|${a}`)) return true;
    // Loose match: same title, and either side is missing the artist — or
    // the artists normalise the same way. Catches pasted ChordPro that has
    // a {title} but no {artist}, or vice versa.
    const candidates = libraryIndex.byTitle.get(t) ?? [];
    return candidates.some((s) => {
      const libA = normalise(s.artist);
      return !a || !libA || libA === a;
    });
  };
  // Seed from sessionStorage so navigating to edit and back keeps the list.
  const [pending, setPending] = useState<PendingImport[]>(() => loadStaging());
  const [pickerFor, setPickerFor] = useState<{ mode: 'selected' } | { mode: 'row'; id: string } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [importNotice, setImportNotice] = useState<{ kind: 'duplicate' | 'failed'; message: string } | null>(null);

  // Mirror any staging-list change into sessionStorage.
  useEffect(() => { saveStaging(pending); }, [pending]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Per-session dismiss for the chord-spelling banner under the
  // page heading. Reappears on the next visit unless the user picks
  // "Don't show again", which is persisted in settings below.
  const [warningDismissed, setWarningDismissed] = useState(false);
  // Persistent "Don't show again" flag from settings — once set,
  // the banner is hidden across app restarts.
  const dismissedHints = useSettingsStore((s) => s.settings.dismissedHints);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const showWarning = !warningDismissed && !dismissedHints?.chordSpelling;

  const allSelected = pending.length > 0 && pending.every((p) => p.selected || p.error);
  const pendingCount = pending.filter((p) => !p.error).length;
  const selectedCount = useMemo(
    () => pending.filter((p) => p.selected && !p.error).length,
    [pending],
  );
  // True when every currently-selected row is already flagged as favorite —
  // drives the "Favorite" toolbar button's on/off styling.
  const allSelectedFavorite = useMemo(() => {
    const sel = pending.filter((p) => p.selected && !p.error);
    return sel.length > 0 && sel.every((r) => r.favorite);
  }, [pending]);

  // ── File ingestion ────────────────────────────────────────────────────
  const ingestFiles = async (filePaths: string[]) => {
    setBusy(true);
    setImportNotice(null);
    const next: PendingImport[] = [];
    const skippedNow: string[] = [];
    const duplicates: string[] = [];
    for (const filePath of filePaths) {
      const filename = filePath.split(/[/\\]/).pop() ?? filePath;
      if (!SUPPORTED_EXTENSIONS.has(getExtension(filename))) {
        skippedNow.push(filename);
        continue;
      }
      try {
        const content = await window.electronAPI.files.readFile(filePath);
        // .json files are this app's own full-record export (single song or
        // an array of songs) — every metadata field transfers. Everything
        // else goes through the ChordPro/plain-text detector.
        const inputs = getExtension(filename) === 'json'
          ? importSongsFromJson(content)
          : [importFromString(content, filename)];
        for (const input of inputs) {
          next.push({ id: makeId(), filename, input, selected: true });
          if (isDuplicate(input)) {
            const label = [input.title, input.artist].filter(Boolean).map(toTitleCase).join(' — ');
            duplicates.push(label || filename);
          }
        }
      } catch (e) {
        next.push({ id: makeId(), filename, selected: false, error: String(e) });
      }
    }
    setPending((prev) => [...next, ...prev]);
    setSkipped(skippedNow);
    if (duplicates.length === 1) {
      setImportNotice({
        kind: 'duplicate',
        message: t('import.duplicate.one', { title: duplicates[0] ?? '' }),
      });
    } else if (duplicates.length > 1) {
      const preview = duplicates.slice(0, 3).join(', ');
      const rest = duplicates.length > 3 ? t('import.duplicate.andMore', { count: duplicates.length - 3 }) : '';
      setImportNotice({
        kind: 'duplicate',
        message: t('import.duplicate.many', { count: duplicates.length, preview, rest }),
      });
    }
    setBusy(false);
  };

  const handleBrowse = async () => {
    const paths = await window.electronAPI.files.openDialog([
      { name: t('import.fileFilter.chordproText'), extensions: ['cho', 'chordpro', 'chopro', 'crd', 'pro', 'txt', 'json'] },
      { name: t('import.fileFilter.allFiles'), extensions: ['*'] },
    ]);
    if (paths) await ingestFiles(paths);
  };

  /** Read the clipboard and route its text contents through the same import
   * pipeline. The format (ChordPro vs chords-over-lyrics) is detected
   * automatically by importFromString, and the new row lands at the top of
   * the staging list with a generated filename. If the parsed title + artist
   * match a song that's already in the library, a banner is shown right
   * away so the user doesn't miss the duplicate. */
  const handlePaste = async () => {
    setImportNotice(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setImportNotice({ kind: 'failed', message: t('import.clipboard.empty') });
        return;
      }
      // Pasted JSON (a copied .json export) gets the full-metadata pipeline.
      // Only treated as JSON when it actually parses as a song export;
      // otherwise the text falls through to the ChordPro/plain-text path so
      // lyrics that merely start with "{" or "[" still import normally.
      if (/^[[{]/.test(text.trim())) {
        try {
          const inputs = importSongsFromJson(text);
          const jsonFilename = `pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.json`;
          setPending((prev) => [
            ...inputs.map((input) => ({ id: makeId(), filename: jsonFilename, input, selected: true })),
            ...prev,
          ]);
          const dup = inputs.find((i) => isDuplicate(i));
          if (dup) {
            const label = [dup.title, dup.artist].filter(Boolean).map(toTitleCase).join(' — ');
            setImportNotice({ kind: 'duplicate', message: t('import.duplicate.one', { title: label }) });
          }
          return;
        } catch { /* not a song JSON — fall through to text import */ }
      }
      const filename = `pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.chordpro`;
      try {
        const input = importFromString(text, filename);
        // Detect the "pasted-HHMMSS" placeholder title — it means the text
        // had no {title: …} directive, so importFromString fell back to the
        // generated filename. Without a real title, duplicate detection has
        // nothing to compare against.
        const titleFromFilename = /^pasted \d+$/i.test((input.title ?? '').trim());
        if (titleFromFilename) {
          input.title = '';
        }
        setPending((prev) => [{ id: makeId(), filename, input, selected: true }, ...prev]);
        if (titleFromFilename) {
          setImportNotice({
            kind: 'failed',
            message: t('import.paste.noDirectives'),
          });
        } else if (isDuplicate(input)) {
          const label = [input.title, input.artist].filter(Boolean).map(toTitleCase).join(' — ');
          setImportNotice({
            kind: 'duplicate',
            message: t('import.duplicate.one', { title: label }),
          });
        }
      } catch (e) {
        setPending((prev) => [{ id: makeId(), filename, selected: false, error: String(e) }, ...prev]);
        setImportNotice({ kind: 'failed', message: t('import.paste.parseFailed', { error: String(e) }) });
      }
    } catch (e) {
      setImportNotice({ kind: 'failed', message: t('import.clipboard.unavailable', { error: String(e) }) });
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files: string[] = [];
    for (const item of Array.from(e.dataTransfer.files)) {
      const path = (item as { path?: string }).path;
      if (path) files.push(path);
    }
    if (files.length) await ingestFiles(files);
  };

  // ── Row-level actions ─────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setPending((p) => p.map((r) => r.id === id ? { ...r, selected: !r.selected } : r));
  };

  const toggleSelectAll = () => {
    // If everything importable is already selected, clear; otherwise select all.
    const anySelectable = pending.some((p) => !p.error && !p.selected);
    setPending((p) => p.map((r) =>
      r.error ? r : { ...r, selected: anySelectable },
    ));
  };

  const removeRow = (id: string) => {
    setPending((p) => p.filter((r) => r.id !== id));
  };

  const importOne = async (row: PendingImport): Promise<Song | null> => {
    if (!row.input) return null;
    try {
      const song = await addSong(db, { ...row.input, favorite: row.favorite ?? row.input.favorite ?? false });
      // Add to any set lists the user queued up before the import.
      for (const setlistId of row.targetSetlistIds ?? []) {
        // eslint-disable-next-line no-await-in-loop
        try { await addSongToSetList(db, setlistId, song.id); } catch { /* ignore individual failures */ }
      }
      // Imported songs leave the staging list — they live in the library now.
      setPending((p) => p.filter((r) => r.id !== row.id));
      return song;
    } catch (e) {
      setPending((p) => p.map((r) => r.id === row.id ? { ...r, error: String(e) } : r));
      return null;
    }
  };

  const handleEdit = (row: PendingImport) => {
    // The editor receives `?pending=<id>` so it reads/writes the sessionStorage
    // staging row — nothing is saved until the user clicks Import.
    if (!row.input) return;
    navigate(`/song/new?pending=${row.id}&return=${encodeURIComponent('/import')}`);
  };

  const removeSelected = () => {
    setPending((p) => p.filter((r) => !r.selected || r.error));
  };

  const applySetlistsToSelected = (setlistIds: string[]) => {
    setPending((p) => p.map((r) => r.selected && !r.error ? { ...r, targetSetlistIds: setlistIds } : r));
  };

  const applySetlistsToRow = (id: string, setlistIds: string[]) => {
    setPending((p) => p.map((r) => r.id === id ? { ...r, targetSetlistIds: setlistIds } : r));
  };

  // Flip the favorite flag on every currently-selected row to the opposite of
  // whatever they collectively hold (all-favorite → none; any mixed → all).
  const toggleFavoriteForSelected = () => {
    setPending((p) => {
      const selected = p.filter((r) => r.selected && !r.error);
      const allFav = selected.length > 0 && selected.every((r) => r.favorite);
      return p.map((r) => (r.selected && !r.error) ? { ...r, favorite: !allFav } : r);
    });
  };

  const toggleFavoriteRow = (id: string) => {
    setPending((p) => p.map((r) => r.id === id ? { ...r, favorite: !r.favorite } : r));
  };

  const handleImportSelected = async () => {
    setBusy(true);
    const toImport = pending.filter((p) => p.selected && !p.error && p.input);
    for (const row of toImport) {
      // eslint-disable-next-line no-await-in-loop
      await importOne(row);
    }
    setBusy(false);
  };

  // ── Render ────────────────────────────────────────────────────────────
  // Drag handlers attached at the page level: drop anywhere on Import to
  // ingest. We only set dragOver true when the drag carries files, so merely
  // reordering items inside the staging list doesn't trip the overlay.
  const pageDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const pageDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };

  return (
    <div
      className="flex flex-col h-full p-8 max-w-4xl mx-auto relative"
      onDrop={handleDrop}
      onDragOver={pageDragOver}
      onDragLeave={pageDragLeave}
    >
      {dragOver && (
        <div
          className="absolute inset-4 rounded-2xl border-2 border-dashed flex items-center justify-center pointer-events-none"
          style={{
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            borderColor: 'var(--accent)',
            zIndex: 50,
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} style={{ color: 'var(--accent)' }} />
            <p className="font-semibold" style={{ color: 'var(--accent)' }}>{t('import.dropOverlay')}</p>
          </div>
        </div>
      )}
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>{t('import.title')}</h1>

      {showWarning && (
        <div className="mb-6">
          <ChordSpellingWarning
            onClose={() => setWarningDismissed(true)}
            onDontShowAgain={() => {
              void updateSetting(db, 'dismissedHints', {
                ...(dismissedHints ?? {}),
                chordSpelling: true,
              });
            }}
          />
        </div>
      )}

      <div
        className="flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed transition-colors cursor-pointer mb-8"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-secondary)',
        }}
        onClick={handleBrowse}
      >
        <Upload size={36} style={{ color: dragOver ? 'var(--accent)' : 'var(--text-muted)' }} />
        <div className="text-center">
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('import.dropOrBrowse')}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('import.dropHint')}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={(e) => { e.stopPropagation(); void handleBrowse(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Upload size={14} />{t('import.browseFiles')}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handlePaste(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            title={t('import.pasteTitle')}
          >
            <ClipboardPaste size={14} />{t('import.paste')}
          </button>
        </div>
      </div>

      {importNotice && (
        <div
          className="flex items-start gap-3 p-3 rounded-xl mb-4"
          style={{
            background: importNotice.kind === 'duplicate'
              ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
              : 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: `1px solid color-mix(in srgb, ${importNotice.kind === 'duplicate' ? 'var(--accent)' : 'var(--danger)'} 40%, var(--border))`,
          }}
        >
          {importNotice.kind === 'duplicate'
            ? <Copy size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
            : <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          }
          <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{importNotice.message}</p>
          <button onClick={() => setImportNotice(null)} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title={t('import.dismiss')}>
            <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      )}

      {skipped.length > 0 && (
        <div
          className="flex items-start gap-3 p-3 rounded-xl mb-4"
          style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))' }}
        >
          <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <div className="flex-1 min-w-0 text-sm">
            <p style={{ color: 'var(--text-primary)' }}>
              {skipped.length === 1
                ? t('import.unsupported.one', { formats: SUPPORTED_EXT_LABEL })
                : t('import.unsupported.many', { count: skipped.length, formats: SUPPORTED_EXT_LABEL })}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }} title={skipped.join(', ')}>
              {skipped.join(', ')}
            </p>
          </div>
          <button onClick={() => setSkipped([])} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title={t('import.dismiss')}>
            <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* Bulk actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={pendingCount === 0}
              />
              {t('import.selectAll')}
            </label>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('import.selectedPending', { selected: selectedCount, pending: pendingCount })}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={toggleFavoriteForSelected}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{
                  background: allSelectedFavorite ? 'var(--accent)' : 'transparent',
                  color: allSelectedFavorite ? 'white' : 'var(--accent)',
                  border: `1px solid ${allSelectedFavorite ? 'var(--accent)' : 'var(--border)'}`,
                }}
                title={allSelectedFavorite ? t('import.actions.unfavoriteTitle') : t('import.actions.favoriteTitle')}
              >
                <Star size={13} fill={allSelectedFavorite ? 'currentColor' : 'none'} />
                {allSelectedFavorite ? t('import.actions.favorited') : t('import.actions.favorite')}
              </button>
              <button
                onClick={() => setPickerFor({ mode: 'selected' })}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                title={t('import.actions.addToSetListTitle')}
              >
                <ListPlus size={13} />{t('import.actions.addToSetList')}
              </button>
              <button
                onClick={removeSelected}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}
                title={t('import.actions.removeSelectedTitle')}
              >
                <Trash2 size={13} />{t('import.actions.removeSelected')}
              </button>
              <button
                onClick={handleImportSelected}
                disabled={busy || selectedCount === 0}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', color: 'white' }}
                title={t('import.actions.importSelectedTitle')}
              >
                {busy
                  ? t('import.actions.importing')
                  : (selectedCount > 0
                      ? t('import.actions.importCount', { count: selectedCount })
                      : t('import.actions.importToLibrary'))}
              </button>
            </div>
          </div>

          {/* Row list */}
          <div className="flex flex-col gap-2 mb-8 mt-4">
            {pending.map((row) => (
              <ImportRow
                key={row.id}
                row={row}
                isDuplicate={isDuplicate(row.input)}
                setlistNames={(row.targetSetlistIds ?? [])
                  .map((sid) => setlists.find((sl) => sl.id === sid)?.name)
                  .filter((n): n is string => !!n)}
                onToggleSelect={() => toggleSelect(row.id)}
                onRemove={() => removeRow(row.id)}
                onEdit={() => handleEdit(row)}
                onImport={() => void importOne(row)}
                onPickSetlists={() => setPickerFor({ mode: 'row', id: row.id })}
                onToggleFavorite={() => toggleFavoriteRow(row.id)}
              />
            ))}
          </div>
        </div>
      )}

      {pickerFor && (() => {
        const initial: string[] = pickerFor.mode === 'selected'
          // Pre-seed with ids already shared by every selected row, if any.
          ? (() => {
              const selected = pending.filter((p) => p.selected && !p.error);
              if (selected.length === 0) return [];
              const sets = selected.map((r) => new Set(r.targetSetlistIds ?? []));
              return [...sets[0]!].filter((id) => sets.every((s) => s.has(id)));
            })()
          : (pending.find((r) => r.id === pickerFor.id)?.targetSetlistIds ?? []);
        const hint = pickerFor.mode === 'selected'
          ? (selectedCount === 1
              ? t('import.picker.hintOne', { count: selectedCount })
              : t('import.picker.hintMany', { count: selectedCount }))
          : t('import.picker.hintRow');
        return (
          <SetListPickerModal
            initialSelected={initial}
            hint={hint}
            onClose={() => setPickerFor(null)}
            onConfirm={(ids) => {
              if (pickerFor.mode === 'selected') applySetlistsToSelected(ids);
              else applySetlistsToRow(pickerFor.id, ids);
              setPickerFor(null);
            }}
          />
        );
      })()}
    </div>
  );
}

function ImportRow({ row, isDuplicate, setlistNames, onToggleSelect, onRemove, onEdit, onImport, onPickSetlists, onToggleFavorite }: {
  row: PendingImport;
  isDuplicate: boolean;
  setlistNames: string[];
  onToggleSelect: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onImport: () => void;
  onPickSetlists: () => void;
  onToggleFavorite: () => void;
}): React.ReactElement {
  const t = useT();
  const title = row.input?.title ?? row.filename;
  const artist = row.input?.artist;
  const failed = !!row.error;

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-colors bg-[var(--surface)] hover:bg-[var(--surface-elevated)] hover:border-[var(--accent)]"
      style={{ border: `1px solid ${isDuplicate ? 'color-mix(in srgb, var(--accent) 55%, var(--border))' : 'var(--border)'}` }}
    >
      <input
        type="checkbox"
        checked={row.selected && !failed}
        onChange={onToggleSelect}
        disabled={failed || !row.input}
        title={failed ? t('import.row.failedToParse') : t('import.row.selectForImport')}
      />

      {failed
        ? <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
        : isDuplicate
          ? <Copy size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          : <span className="w-[18px]" />
      }

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {toTitleCase(title)}
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {artist ? `${toTitleCase(artist)} · ` : ''}{row.filename}
        </p>
        {isDuplicate && !failed && (
          <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            <Copy size={11} />{t('import.row.alreadyInLibrary')}
          </p>
        )}
        {setlistNames.length > 0 && (
          <p
            className="text-[11px] mt-0.5 truncate flex items-center gap-1"
            style={{ color: 'var(--accent)' }}
            title={t('import.row.willBeAddedTo', { names: setlistNames.join(', ') })}
          >
            <ListMusic size={11} /> → {setlistNames.map(toTitleCase).join(', ')}
          </p>
        )}
        {row.error && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--danger)' }}>{row.error}</p>
        )}
      </div>

      {/* Row actions */}
      <div className="flex items-center gap-1 shrink-0">
        {row.input && (
          <button
            onClick={onImport}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--accent)' }}
            title={t('import.row.importNow')}
          >
            {t('common.import')}
          </button>
        )}
        {row.input && (
          <button
            onClick={onToggleFavorite}
            className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
            title={row.favorite ? t('import.row.removeFavorite') : t('import.row.markFavorite')}
          >
            <Star
              size={14}
              style={{ color: row.favorite ? 'var(--accent)' : 'var(--text-secondary)' }}
              fill={row.favorite ? 'currentColor' : 'none'}
            />
          </button>
        )}
        {row.input && (
          <button
            onClick={onPickSetlists}
            className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
            title={t('import.row.pickSetLists')}
          >
            <ListPlus size={14} style={{ color: setlistNames.length > 0 ? 'var(--accent)' : 'var(--text-secondary)' }} />
          </button>
        )}
        {row.input && (
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
            title={t('import.row.editBeforeImport')}
          >
            <Pencil size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        <button
          onClick={onRemove}
          className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
          title={t('import.row.removeFromList')}
        >
          <Trash2 size={14} style={{ color: 'var(--danger)' }} />
        </button>
      </div>
    </div>
  );
}
