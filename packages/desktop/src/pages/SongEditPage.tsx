import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Save, Trash2, ArrowLeft, Hand, RotateCcw } from 'lucide-react';
import { useSongStore, useSettingsStore, ALL_KEYS, parseChordPro, extractUniqueChords, chordsOverLyricsToChordPro, chordProToChordsOverLyrics, detectSongFormat, fromLatin, normalizeContentToLetter, bulkReplaceChord, isValidChordName } from '@song-chords/shared';
import ChordHighlightOverlay from '../components/song/ChordHighlightOverlay';
import { db } from '../ipc/ipc-client';
import type { SongCreateInput } from '@song-chords/shared';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNavigationGuard } from '../context/NavigationGuard';
import { toTitleCase } from '../utils/text';
import { extractChordPattern, applyChordPattern, patternHasChords, type ChordPattern } from '../utils/chord-pattern';

const SECTION_DIRECTIVES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Instrumental', 'Outro'];
const COMMON_GENRES = [
  'Pop', 'Rock', 'Country', 'Worship', 'Gospel', 'R&B', 'Soul', 'Jazz', 'Blues',
  'Folk', 'Classical', 'Latin', 'Alternative', 'Indie', 'Hip-Hop', 'Electronic',
  'Metal', 'Punk', 'Reggae', 'Christian',
];
const COMMON_CHORDS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'A7', 'B7', 'C7', 'D7', 'E7', 'G7', 'Cmaj7', 'Dmaj7', 'Fmaj7', 'Gmaj7'];

const EXAMPLE_CHORDPRO = `{c: Verse 1}
[G]Amazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a [D]wretch like [G]me

{c: Chorus}
[C]How great thou [G]art
[D]How great thou [G]art
`;

const EXAMPLE_PLAINTEXT = `{c: Verse 1}
G       G7        C         G
Amazing grace, how sweet the sound
G          D            G
That saved a wretch like me

{c: Chorus}
C              G
How great thou art
D              G
How great thou art
`;

function exampleFor(format: 'chordpro' | 'plaintext'): string {
  return format === 'chordpro' ? EXAMPLE_CHORDPRO : EXAMPLE_PLAINTEXT;
}

/**
 * Canonical form of the song body for dirty-tracking. The edit page
 * lets the user flip the SAME body between inline ChordPro and
 * chords-over-lyrics; that conversion is idempotent (a stable fixed
 * point) but is NOT a byte-identical text round trip in dense-chord
 * spots. Reducing both the current and the initial body to one
 * canonical ChordPro string means a pure format toggle compares equal
 * (no phantom "unsaved changes"), while any real edit still differs.
 *
 * `chordsOverLyricsToChordPro` passes inline-ChordPro lines through
 * untouched and converts chord/lyric pairs; running the pair
 * over->CP->over->CP lands on the fixed point regardless of which
 * format the text is currently in.
 */
function canonicalBody(body: string): string {
  return chordsOverLyricsToChordPro(
    chordProToChordsOverLyrics(chordsOverLyricsToChordPro(body)),
  );
}

export default function SongEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Optional return path passed via `?return=<encoded-path>` so callers (e.g.
  // the context menu on list pages) can send the user back to where they
  // opened the editor from, on save or cancel.
  const returnTo = searchParams.get('return');
  // "Pending" mode: editing a row from the Import staging list. We read/write
  // the row's payload directly in sessionStorage and never touch the DB —
  // actual import is deferred until the user clicks Import in the list.
  const pendingId = searchParams.get('pending');
  const isPending = !!pendingId;
  const { songs, addSong, updateSong, deleteSong } = useSongStore();
  const isNew = !id || id === 'new';

  // Unique artist list (keeping the most-recent casing) so the artist field
  // can autocomplete against existing library entries.
  const artistSuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of songs) {
      const name = s.artist?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [songs]);

  // Language suggestions: only the languages already used by songs in the
  // library (mirrors what shows up in Categories → Language). Casing is
  // preserved on first occurrence and case-insensitively deduped.
  const languageSuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of songs) {
      const name = s.language?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [songs]);

  // Genre + tag suggestions: same shape as language — only values already in
  // the library, deduped case-insensitively, alphabetically sorted.
  const genreSuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of songs) {
      const name = s.genre?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [songs]);
  const tagSuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of songs) {
      for (const t of s.tags ?? []) {
        const trimmed = t.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) seen.set(key, trimmed);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [songs]);

  const pendingRow = React.useMemo(() => {
    if (!isPending) return null;
    try {
      const raw = window.sessionStorage.getItem('song-chords:import-staging');
      if (!raw) return null;
      const list = JSON.parse(raw) as Array<{ id: string; input?: SongCreateInput }>;
      return list.find((r) => r.id === pendingId) ?? null;
    } catch { return null; }
  }, [isPending, pendingId]);
  const pendingInput = pendingRow?.input;

  const existing = isPending
    ? (pendingInput ? ({ ...pendingInput, id: 'pending', createdAt: 0, updatedAt: 0 } as unknown as typeof songs[number]) : null)
    : (isNew ? null : songs.find((s) => s.id === id));

  const [title, setTitle] = useState(existing?.title ?? '');
  const [artist, setArtist] = useState(existing?.artist ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [tempo, setTempo] = useState(existing?.tempo?.toString() ?? '');
  const [timeSig, setTimeSig] = useState(existing?.timeSig ?? '4/4');
  const [capo, setCapo] = useState(existing?.capo ?? 0);
  const [genre, setGenre] = useState(existing?.genre ?? '');
  // `genreCustomMode` is strictly controlled by the user clicking the
  // "Type custom genre…" option in the dropdown. It is NOT inferred
  // from the saved genre value, because the user wants the text input
  // hidden until they explicitly opt in — even when editing a song
  // whose stored genre isn't in COMMON_GENRES.
  const [genreCustomMode, setGenreCustomMode] = useState(false);
  const [year, setYear] = useState(existing?.year?.toString() ?? '');
  const [language, setLanguage] = useState(existing?.language ?? '');
  // Mirrors `genreCustomMode`. Strictly user-controlled: only flips
  // true when the "Type custom language…" sentinel is picked.
  const [languageCustomMode, setLanguageCustomMode] = useState(false);
  const [duration, setDuration] = useState(existing?.duration ?? '');
  const [link, setLink] = useState(existing?.link ?? '');
  const [audioFile, setAudioFile] = useState(existing?.audioFile ?? '');
  // UI-only toggle for how the user wants to edit; all saves are ChordPro.
  const [format, setFormat] = useState<'chordpro' | 'plaintext'>('plaintext');
  const [content, setContent] = useState(existing?.content ?? exampleFor(format));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [difficulty, setDifficulty] = useState<number>(existing?.difficulty ?? 0);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'song'>('details');
  const [showDelete, setShowDelete] = useState(false);
  /** Pending navigation intent shown in the unsaved-changes dialog. When set,
   *  the user sees three choices (Save / Discard / Cancel). On confirm the
   *  handler in `.run` performs the actual navigation / close action. */
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Right-click popover state — position in viewport + caret range at click.
  const [chordPopover, setChordPopover] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  // Clipboard for "Copy chords / Paste chords" — stores the chord pattern
  // extracted from one selection so it can be re-applied to another.
  const [chordClipboard, setChordClipboard] = useState<ChordPattern | null>(null);

  // Chord find & bulk-replace bar (Song tab).
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findChord, setFindChord] = useState('');
  const [replaceChord, setReplaceChord] = useState('');
  const [lastReplaceMsg, setLastReplaceMsg] = useState<string | null>(null);

  // Editor chord color comes from the user's active style preset so the
  // editor previews the same accent the Song View will render with.
  const chordColor = useSettingsStore((s) => s.settings.songViewStyle?.chords?.color) || 'var(--accent)';

  // Mirror the textarea scroll into the highlight overlay behind it.
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 });

  // ── Undo / redo history for the song content ──────────────────────────────
  // We maintain our own stack because programmatic value updates via React
  // clobber the textarea's native undo history.
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const typingTimerRef = useRef<number | null>(null);
  const [, setHistoryTick] = useState(0); // force re-render when history changes

  const commitHistory = (value: string) => {
    // Drop any redo entries past the current position.
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    if (historyRef.current[historyRef.current.length - 1] !== value) {
      historyRef.current.push(value);
      historyIdxRef.current = historyRef.current.length - 1;
      setHistoryTick((t) => t + 1);
    }
  };

  const flushTypingCommit = () => {
    if (typingTimerRef.current != null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  };

  const scheduleTypingCommit = (value: string) => {
    flushTypingCommit();
    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
      commitHistory(value);
    }, 500);
  };

  const resetHistory = (initial: string) => {
    flushTypingCommit();
    historyRef.current = [initial];
    historyIdxRef.current = 0;
    setHistoryTick((t) => t + 1);
  };

  const undo = () => {
    flushTypingCommit();
    // Snapshot the live value so a Ctrl+Z after typing walks back past the
    // current edit instead of landing on the last committed state.
    if (historyRef.current[historyIdxRef.current] !== content) commitHistory(content);
    if (historyIdxRef.current > 0) {
      historyIdxRef.current--;
      setContent(historyRef.current[historyIdxRef.current]!);
      setHistoryTick((t) => t + 1);
    }
  };

  const redo = () => {
    flushTypingCommit();
    if (historyIdxRef.current < historyRef.current.length - 1) {
      historyIdxRef.current++;
      setContent(historyRef.current[historyIdxRef.current]!);
      setHistoryTick((t) => t + 1);
    }
  };

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  // Seed history once on mount.
  useEffect(() => { resetHistory(content); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Insert text into `content` at an explicit caret range, then place the
  // caret after the inserted text. Programmatic edits are committed to
  // history immediately (no debounce).
  const insertAtRange = (start: number, end: number, text: string) => {
    flushTypingCommit();
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    commitHistory(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  };

  // Insert at the textarea's current selection.
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) { setContent(content + text); return; }
    insertAtRange(el.selectionStart, el.selectionEnd, text);
  };

  // Extract unique chords + basic stats from the current content.
  const stats = useMemo(() => {
    const chars = content.length;
    const lineCount = content === '' ? 0 : content.split('\n').length;
    let uniqueChords: string[] = [];
    try {
      const parsed = format === 'chordpro' ? parseChordPro(content) : parsePlainText(content);
      uniqueChords = extractUniqueChords(parsed);
    } catch { /* ignore parse errors while typing */ }
    return { chars, lineCount, uniqueChords };
  }, [content, format]);

  // Snapshot of the form's initial values. Compared against the current
  // state to detect unsaved edits in `isDirty` below.
  const initialSnapshotRef = useRef({
    title: existing?.title ?? '',
    artist: existing?.artist ?? '',
    key: existing?.key ?? '',
    tempo: existing?.tempo?.toString() ?? '',
    timeSig: existing?.timeSig ?? '4/4',
    capo: existing?.capo ?? 0,
    genre: existing?.genre ?? '',
    year: existing?.year?.toString() ?? '',
    language: existing?.language ?? '',
    duration: existing?.duration ?? '',
    link: existing?.link ?? '',
    audioFile: existing?.audioFile ?? '',
    content: existing?.content ?? exampleFor('plaintext'),
    notes: existing?.notes ?? '',
    tags: existing?.tags ?? [],
    difficulty: existing?.difficulty ?? 0,
  });

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setArtist(existing.artist ?? '');
      setKey(existing.key ?? '');
      setTempo(existing.tempo?.toString() ?? '');
      setTimeSig(existing.timeSig ?? '4/4');
      setCapo(existing.capo);
      setGenre(existing.genre ?? '');
      setYear(existing.year?.toString() ?? '');
      setLanguage(existing.language ?? '');
      setDuration(existing.duration ?? '');
      setLink(existing.link ?? '');
      setAudioFile(existing.audioFile ?? '');
      setContent(existing.content);
      setFormat('chordpro');
      setNotes(existing.notes ?? '');
      setTags(existing.tags ?? []);
      setDifficulty(existing.difficulty ?? 0);
      resetHistory(existing.content);
      // Re-seed the "initial" snapshot when the loaded song changes so
      // navigating between edits doesn't carry over a stale baseline.
      initialSnapshotRef.current = {
        title: existing.title,
        artist: existing.artist ?? '',
        key: existing.key ?? '',
        tempo: existing.tempo?.toString() ?? '',
        timeSig: existing.timeSig ?? '4/4',
        capo: existing.capo,
        genre: existing.genre ?? '',
        year: existing.year?.toString() ?? '',
        language: existing.language ?? '',
        duration: existing.duration ?? '',
        link: existing.link ?? '',
        audioFile: existing.audioFile ?? '',
        content: existing.content,
        notes: existing.notes ?? '',
        tags: existing.tags ?? [],
        difficulty: existing.difficulty ?? 0,
      };
    }
  }, [existing?.id]);

  const isDirty = useMemo(() => {
    const init = initialSnapshotRef.current;
    if (title !== init.title) return true;
    if (artist !== init.artist) return true;
    if (key !== init.key) return true;
    if (tempo !== init.tempo) return true;
    if (timeSig !== init.timeSig) return true;
    if (capo !== init.capo) return true;
    if (genre !== init.genre) return true;
    if (year !== init.year) return true;
    if (language !== init.language) return true;
    if (duration !== init.duration) return true;
    if (link !== init.link) return true;
    if (audioFile !== init.audioFile) return true;
    // Compare song body in a CANONICAL form, not raw text. Toggling
    // the editor between ChordPro and chords-over-lyrics rewrites the
    // text (a column-based grid can't always reproduce ChordPro byte-
    // for-byte when chords sit closer than a chord name is wide), so a
    // raw `content !== init.content` flagged a pure format toggle as
    // an unsaved edit and prompted to save. Both representations map
    // to the SAME canonical ChordPro via the (now idempotent) round
    // trip, so comparing canonical forms treats a format toggle as a
    // no-op while still catching every real edit (a genuine change
    // alters the canonical form too).
    if (canonicalBody(content) !== canonicalBody(init.content)) return true;
    if (notes !== init.notes) return true;
    if (difficulty !== init.difficulty) return true;
    if (tags.length !== init.tags.length) return true;
    for (let i = 0; i < tags.length; i++) if (tags[i] !== init.tags[i]) return true;
    return false;
  }, [title, artist, key, tempo, timeSig, capo, genre, year, language, duration, link, audioFile, content, notes, difficulty, tags]);

  // Warn on full window close / reload when there are unsaved edits.
  // Inline navigation (back button) is guarded by guardedLeave below.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  /** Wraps a navigation action so that when the form is dirty, the user
   *  first sees the Save / Discard / Cancel dialog. */
  const guardedLeave = (run: () => void) => {
    if (!isDirty) { run(); return; }
    setPendingLeave({ run });
  };

  // Register the guard with the app-wide NavigationGuard context so sidebar
  // links (and any other consumer of `tryNavigate`) route through the same
  // Save / Discard / Cancel dialog when leaving with unsaved changes.
  const { registerGuard } = useNavigationGuard();
  useEffect(() => {
    if (!isDirty) { registerGuard(null); return; }
    registerGuard((run) => setPendingLeave({ run }));
    return () => registerGuard(null);
  }, [isDirty, registerGuard]);

  const handleSave = async () => {
    if (!title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      // Normalize Latin (solfège) chord names back to canonical letter form
      // before storing — users may have typed `Do` / `Sol` if they prefer
      // that notation, but storage must stay portable. Both the inline-bracket
      // and bare-chord-line forms are handled.
      const normalizedContent = normalizeContentToLetter(
        format === 'plaintext' ? chordsOverLyricsToChordPro(content) : content,
      );
      // Defaults applied only when the user leaves a field empty.
      const input: SongCreateInput = {
        title: title.trim(),
        artist: artist.trim() || 'Other',
        // Keys may also be typed in Latin form (e.g. "Sol", "rem" for G minor).
        key: fromLatin(key || 'C') || 'C',
        tempo: tempo ? parseInt(tempo) : undefined,
        timeSig: timeSig || undefined,
        capo,
        genre: genre.trim() || 'Other',
        year: year ? parseInt(year) : undefined,
        language: language.trim() || 'Spanish',
        duration: duration.trim() || undefined,
        link: link.trim() || undefined,
        audioFile: audioFile.trim() || undefined,
        content: normalizedContent,
        chordsCount: 0, // recomputed by the repository on write
        notes: notes.trim() || undefined,
        tags,
        // 0/undefined = unrated; let the user leave it blank if they prefer.
        difficulty: difficulty > 0 ? difficulty : undefined,
        favorite: existing?.favorite ?? false,
        preferences: existing?.preferences ?? {},
        sortOrder: existing?.sortOrder ?? 0,
      };

      if (isPending && pendingId) {
        // Update the pending row in sessionStorage and return to Import.
        try {
          const raw = window.sessionStorage.getItem('song-chords:import-staging');
          const list = raw ? (JSON.parse(raw) as Array<{ id: string; input?: SongCreateInput; [k: string]: unknown }>) : [];
          const next = list.map((r) => r.id === pendingId ? { ...r, input } : r);
          window.sessionStorage.setItem('song-chords:import-staging', JSON.stringify(next));
        } catch { /* ignore quota errors */ }
        navigate(returnTo ?? '/import');
      } else if (isNew) {
        const song = await addSong(db, input);
        navigate(`/song/${song.id}`, { replace: true });
      } else {
        await updateSong(db, id!, input);
        navigate(returnTo ?? `/song/${id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await deleteSong(db, id!);
    navigate('/library', { replace: true });
  };

  // Ctrl+S / ⌘+S saves the song. We deliberately don't use the global
  // shortcut hook because that one ignores key events fired from inputs and
  // textareas — and the user is almost certainly typing in the lyrics
  // textarea when they hit Save. `capture: true` so we run before any
  // browser shortcut handling, and we always preventDefault to suppress the
  // browser's "save page as" dialog. The handler reads `saving` from a ref
  // so a single keypress can't queue multiple concurrent saves.
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S');
      if (!isSave) return;
      e.preventDefault();
      e.stopPropagation();
      if (savingRef.current) return;
      void handleSave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // handleSave closes over a lot of state; rebinding is fine since the
    // listener is cheap.
  }, [handleSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button
          onClick={() => guardedLeave(() => returnTo ? navigate(returnTo) : navigate(-1))}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title={isDirty ? 'Leave (unsaved changes)' : 'Back'}
        >
          <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <h1 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {isPending ? `Editing import: ${existing?.title || 'Untitled'}` : isNew ? 'New Song' : `Edit: ${existing?.title}`}
        </h1>
        <div className="flex gap-2 ml-auto">
          {!isNew && !isPending && (
            <button onClick={() => setShowDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--danger)' }}>
              <Trash2 size={14} />Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white', opacity: saving ? 0.7 : 1 }}
          >
            <Save size={14} />{saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        {(['details', 'song'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-6 py-2 text-sm font-medium capitalize"
            style={{
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >{t === 'details' ? 'Details' : 'Song'}</button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Details tab */}
        {tab === 'details' && (
          <div className="h-full overflow-y-auto p-6 text-sm" style={{ background: 'var(--bg-secondary)' }}>
            <div className="max-w-lg flex flex-col gap-4">
              <Field label="Title *">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="Song title" />
              </Field>
              <Field label="Artist">
                <SuggestionInput value={artist} onChange={setArtist} suggestions={artistSuggestions} placeholder="Artist name" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Key">
                  <select value={key} onChange={(e) => setKey(e.target.value)} className="input-field">
                    <option value="">— Select key —</option>
                    {ALL_KEYS.map((k) => <option key={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="Time Signature">
                  <select value={timeSig} onChange={(e) => setTimeSig(e.target.value)} className="input-field">
                    {['4/4', '3/4', '6/8', '2/4', '5/4', '7/8', '12/8'].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Tempo (BPM)">
                  <TempoInput value={tempo} onChange={setTempo} />
                </Field>
                <Field label="Capo">
                  <select value={capo} onChange={(e) => setCapo(Number(e.target.value))} className="input-field">
                    {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i === 0 ? 'None' : `Capo ${i}`}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Genre" hint="Pick a common genre, or choose Type custom genre to enter your own.">
                {/* The text input only appears AFTER the user picks
                    the "Type custom genre…" option. Otherwise the
                    Field is just the dropdown — even when editing a
                    song whose saved genre is non-common (the user can
                    still re-open the custom input by selecting the
                    sentinel option). */}
                <div className="flex items-center gap-2">
                  <select
                    value={genreCustomMode ? '__custom__' : (COMMON_GENRES.includes(genre) ? genre : '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') {
                        setGenreCustomMode(true);
                        // Clear any common-genre selection so the text
                        // input starts empty for the user to type into.
                        if (COMMON_GENRES.includes(genre)) setGenre('');
                        return;
                      }
                      setGenreCustomMode(false);
                      setGenre(v);
                    }}
                    className="input-field shrink-0"
                    style={{ maxWidth: genreCustomMode ? 220 : undefined }}
                  >
                    <option value="">— Select common genre —</option>
                    {COMMON_GENRES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                    <option value="__custom__">Type a custom genre…</option>
                  </select>
                  {genreCustomMode && (
                    <div className="flex-1 min-w-0">
                      <SuggestionInput
                        value={genre}
                        onChange={setGenre}
                        suggestions={genreSuggestions}
                        placeholder="Genre"
                      />
                    </div>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-4 gap-4">
                <Field label="Duration (mm:ss)">
                  <DurationInput value={duration} onChange={setDuration} />
                </Field>
                <Field label="Year">
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="input-field"
                    placeholder="1971"
                    min={1000}
                    max={9999}
                  />
                </Field>
                {/* Language sits in a 4-column grid that only has
                    three fields (Duration, Year, Language) — the 4th
                    column is empty. Span two columns so the field
                    fills the remaining horizontal space and the
                    dropdown reads cleanly. The same span applies in
                    custom mode so the inline text input has room. */}
                <div style={{ gridColumn: 'span 2', minWidth: 0, width: '100%' }}>
                  <Field label="Language">
                    {(() => {
                      const COMMON_LANGUAGES = ['Spanish', 'English', 'Portuguese', 'Italian', 'French'] as const;
                      const isCommon = (COMMON_LANGUAGES as readonly string[]).includes(language);
                      return (
                        <div className="flex items-center gap-2">
                          <select
                            value={languageCustomMode ? '__custom__' : (isCommon ? language : '')}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '__custom__') {
                                setLanguageCustomMode(true);
                                if (isCommon) setLanguage('');
                                return;
                              }
                              setLanguageCustomMode(false);
                              setLanguage(v);
                            }}
                            // Both modes use `flex-1 min-w-0` so the
                            // dropdown stretches: it fills the whole
                            // row when alone, and shares the row 50/50
                            // with the custom-input when that's
                            // visible (both flex-1 children grow
                            // equally from the same basis).
                            className="input-field flex-1 min-w-0"
                            aria-label="Pick a common language"
                          >
                            <option value="">— Select language —</option>
                            {COMMON_LANGUAGES.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                            <option value="__custom__">Type a custom language…</option>
                          </select>
                          {languageCustomMode && (
                            <div className="flex-1 min-w-0">
                              <SuggestionInput
                                value={language}
                                onChange={setLanguage}
                                suggestions={languageSuggestions}
                                placeholder="Language"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </Field>
                </div>
              </div>
              <Field label="Tags" hint="Type a keyword and press Enter or comma to add.">
                <TagsInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
              </Field>
              <Field label="Difficulty">
                <DifficultyStars value={difficulty} onChange={setDifficulty} />
              </Field>
              <Field label="Audio Link" hint="Paste a URL where the song can be played (YouTube, SoundCloud, Spotify, a direct mp3, etc.). Optional.">
                <input
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="input-field"
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </Field>
              <Field label="Audio File" hint="Pick a local audio file (mp3, m4a, ogg, wav, flac, aac, webm). Takes precedence over the link when both are set.">
                <AudioFilePicker value={audioFile} onChange={setAudioFile} />
              </Field>
              <Field label="Notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field" rows={4} placeholder="Performance notes..." />
              </Field>
            </div>
          </div>
        )}

        {/* Song tab */}
        {tab === 'song' && (
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 text-xs border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <FormatToggle
                  format={format}
                  onChange={(next) => {
                    setFormat(next);
                    // Swap built-in example when the user hasn't edited yet.
                    if (content === EXAMPLE_CHORDPRO || content === EXAMPLE_PLAINTEXT) {
                      const swapped = exampleFor(next);
                      setContent(swapped);
                      commitHistory(swapped);
                      return;
                    }
                    // Normalize to the target format regardless of the current
                    // label — the user may have pasted content whose actual
                    // format doesn't match the previous toggle state.
                    const converted = next === 'plaintext'
                      ? chordProToChordsOverLyrics(content)
                      : chordsOverLyricsToChordPro(content);
                    if (converted !== content) {
                      flushTypingCommit();
                      setContent(converted);
                      commitHistory(converted);
                    }
                  }}
                />
                <button type="button" onClick={undo} disabled={!canUndo}
                  className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  title="Undo (Ctrl+Z)">↶ Undo</button>
                <button type="button" onClick={redo} disabled={!canRedo}
                  className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  title="Redo (Ctrl+Shift+Z / Ctrl+Y)">↷ Redo</button>
                <SectionInsert onPick={(section) => insertAtCursor(`{c: ${section}}\n`)} />
                <button
                  type="button"
                  onClick={() => { setShowFindReplace((v) => !v); setLastReplaceMsg(null); }}
                  className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--surface-elevated)]"
                  style={{
                    color: showFindReplace ? 'var(--accent)' : 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                  title="Find a chord and replace every occurrence (lyrics are never touched)."
                >
                  Find / Replace chords
                </button>
                {format === 'chordpro' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const el = textareaRef.current;
                        if (!el) return;
                        const s = el.selectionStart, e = el.selectionEnd;
                        if (s === e) { alert('Select the source section first (the one that already has chords).'); return; }
                        const pattern = extractChordPattern(content.slice(s, e));
                        if (!patternHasChords(pattern)) { alert('The selection has no chords to copy.'); return; }
                        setChordClipboard(pattern);
                      }}
                      className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--surface-elevated)]"
                      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      title="Select a section that has chords, then click to copy its chord pattern (chords + their positions)."
                    >
                      Copy chords
                    </button>
                    <button
                      type="button"
                      disabled={!chordClipboard}
                      onClick={() => {
                        if (!chordClipboard) return;
                        const el = textareaRef.current;
                        if (!el) return;
                        const s = el.selectionStart, e = el.selectionEnd;
                        if (s === e) { alert('Select the target section (lyrics) first, then paste the chords.'); return; }
                        const patched = applyChordPattern(chordClipboard, content.slice(s, e));
                        insertAtRange(s, e, patched);
                      }}
                      className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}
                      title="Select the target lyrics and click to insert the copied chords at the same line-relative positions."
                    >
                      Paste chords
                    </button>
                  </>
                )}
              </div>
            </div>
            {showFindReplace && (
              <div
                className="px-4 py-2 border-b flex items-center gap-2 flex-wrap text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}>Replace chord</span>
                <input
                  value={findChord}
                  onChange={(e) => { setFindChord(e.target.value); setLastReplaceMsg(null); }}
                  placeholder="e.g. D"
                  className="input-field"
                  style={{ width: 90 }}
                  spellCheck={false}
                />
                <span style={{ color: 'var(--text-muted)' }}>with</span>
                <input
                  value={replaceChord}
                  onChange={(e) => { setReplaceChord(e.target.value); setLastReplaceMsg(null); }}
                  placeholder="e.g. E"
                  className="input-field"
                  style={{ width: 90 }}
                  spellCheck={false}
                />
                <button
                  type="button"
                  disabled={!isValidChordName(findChord) || !isValidChordName(replaceChord) || findChord.trim() === replaceChord.trim()}
                  onClick={() => {
                    const { text: nextText, count } = bulkReplaceChord(content, findChord, replaceChord);
                    if (count > 0) {
                      flushTypingCommit();
                      setContent(nextText);
                      commitHistory(nextText);
                    }
                    setLastReplaceMsg(
                      count === 0
                        ? `No "${findChord.trim()}" chords found`
                        : `Replaced ${count} occurrence${count === 1 ? '' : 's'}`,
                    );
                  }}
                  className="px-2 py-1 rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                  title="Replace every standalone occurrence of this exact chord. Lyrics and other chords (e.g. Dm when replacing D) are left untouched."
                >
                  Replace all
                </button>
                {lastReplaceMsg && (
                  <span style={{ color: 'var(--text-secondary)' }}>{lastReplaceMsg}</span>
                )}
                <button
                  type="button"
                  onClick={() => { setShowFindReplace(false); setLastReplaceMsg(null); }}
                  className="ml-auto px-2 py-1 rounded hover:bg-[var(--surface-elevated)]"
                  style={{ color: 'var(--text-muted)' }}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex-1 relative" style={{ background: 'var(--bg)' }}>
              <ChordHighlightOverlay
                text={content}
                chordColor={chordColor}
                scrollTop={editorScroll.top}
                scrollLeft={editorScroll.left}
              />
              <textarea
                ref={textareaRef}
                value={content}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  setEditorScroll({ top: el.scrollTop, left: el.scrollLeft });
                }}
                onChange={(e) => {
                  const v = e.target.value;
                  setContent(v);
                  scheduleTypingCommit(v);
                }}
              onPaste={(e) => {
                // After the browser applies the paste, look at the resulting
                // text and align the toggle with whichever format the pasted
                // song actually uses. This way the user can paste either
                // format into either mode and the toggle becomes accurate.
                const pasted = e.clipboardData?.getData('text') ?? '';
                if (!pasted.trim()) return;
                const detected = detectSongFormat(pasted);
                if (detected && detected !== format) {
                  // Defer to next tick so React sees the textarea's final value.
                  requestAnimationFrame(() => setFormat(detected));
                }
              }}
              onKeyDown={(e) => {
                const ctrl = e.ctrlKey || e.metaKey;
                if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
                  e.preventDefault();
                  undo();
                } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                  e.preventDefault();
                  redo();
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                const el = textareaRef.current;
                if (!el) return;
                // Browsers move the caret to the click point before
                // contextmenu fires, so selectionStart is the clicked position.
                setChordPopover({ x: e.clientX, y: e.clientY, start: el.selectionStart, end: el.selectionEnd });
              }}
                className="outline-none resize-none song-body-editor"
                style={{
                  // Fill the relative wrapper, sitting ON TOP of the
                  // ChordHighlightOverlay.
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  // Text is transparent so the colored overlay shows
                  // through; the caret stays visible via caret-color.
                  // Selection highlight still works (browser default).
                  background: 'transparent',
                  color: 'transparent',
                  caretColor: 'var(--text-primary)',
                  // MUST match ChordHighlightOverlay's inner box exactly
                  // or the colored chords drift from the caret.
                  padding: 16,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                }}
                spellCheck={false}
              />
            </div>
            {chordPopover && (
              <ChordPopover
                x={chordPopover.x}
                y={chordPopover.y}
                inSong={stats.uniqueChords}
                onPick={(chord) => {
                  insertAtRange(chordPopover.start, chordPopover.end, format === 'plaintext' ? chord : `[${chord}]`);
                  setChordPopover(null);
                }}
                onClose={() => setChordPopover(null)}
              />
            )}
            <div className="px-4 py-2 text-xs border-t flex items-center gap-4 flex-wrap" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
              <span>{stats.lineCount} line{stats.lineCount === 1 ? '' : 's'}</span>
              <span>{stats.chars} char{stats.chars === 1 ? '' : 's'}</span>
              <span>{stats.uniqueChords.length} unique chord{stats.uniqueChords.length === 1 ? '' : 's'}</span>
              {stats.uniqueChords.length > 0 && (
                <span className="truncate" style={{ fontFamily: 'monospace' }} title={stats.uniqueChords.join(', ')}>
                  {stats.uniqueChords.join(' · ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .input-field {
          width: 100%;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-primary);
          font-size: 13px;
          outline: none;
        }
        .input-field:focus { border-color: var(--accent); }
        /* The song-body editor textarea has transparent text (the
           colored chord overlay shows through), so the browser's
           default selection — which tints the transparent glyphs —
           would be invisible. Force a visible selection band. */
        .song-body-editor::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }
        .song-body-editor::-moz-selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }
      `}</style>

      {showDelete && existing && (
        <ConfirmDialog
          title="Delete song?"
          message={<>This will permanently delete <strong>{toTitleCase(existing.title)}</strong>. This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onCancel={() => setShowDelete(false)}
          onConfirm={async () => {
            setShowDelete(false);
            await handleDelete();
          }}
        />
      )}

      {pendingLeave && (
        <UnsavedChangesDialog
          onSave={async () => {
            const run = pendingLeave.run;
            setPendingLeave(null);
            // handleSave already navigates on success, so we don't invoke
            // `run` after it. If the save fails, the user stays on the
            // page with their edits intact.
            await handleSave();
            // If handleSave didn't navigate (e.g. title missing), still run
            // the requested navigation only when the form is now clean.
            // The alert() in handleSave returns early so we use saving flag
            // to infer success. Simpler: just no-op here; the user can
            // try the navigation again.
            void run;
          }}
          onDiscard={() => {
            const run = pendingLeave.run;
            setPendingLeave(null);
            run();
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}
    </div>
  );
}

function UnsavedChangesDialog({
  onSave, onDiscard, onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Capture + stopImmediatePropagation so page-level Escape handlers
    // don't also fire.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onSave, onCancel]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Unsaved changes</h3>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          You've made changes that haven't been saved. What would you like to do?
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--danger)', background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function FormatToggle({ format, onChange }: {
  format: 'chordpro' | 'plaintext';
  onChange: (next: 'chordpro' | 'plaintext') => void;
}): React.ReactElement {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? 'white' : 'var(--text-secondary)',
    border: '1px solid var(--border)',
  });
  return (
    <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={() => onChange('plaintext')}
        className="px-2 py-1 text-xs font-medium"
        style={btnStyle(format === 'plaintext')}
        title="Chord names on one line, lyric directly below. Converted to ChordPro on save."
      >
        Chords over lyrics
      </button>
      <button
        type="button"
        onClick={() => onChange('chordpro')}
        className="px-2 py-1 text-xs font-medium"
        style={btnStyle(format === 'chordpro')}
        title="Inline ChordPro format: [G]Amazing [C]grace"
      >
        ChordPro
      </button>
    </div>
  );
}

function SectionInsert({ onPick }: { onPick: (section: string) => void }): React.ReactElement {
  return (
    <select
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v) { onPick(v); e.target.value = ''; }
      }}
      className="px-2 py-1 rounded text-xs"
      style={{ background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
      title="Insert a section directive at the cursor"
    >
      <option value="">+ Section</option>
      {SECTION_DIRECTIVES.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

function ChordPopover({ x, y, inSong, onPick, onClose }: {
  x: number; y: number; inSong: string[]; onPick: (chord: string) => void; onClose: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Capture + stopImmediatePropagation so page-level Escape handlers
      // don't also fire — otherwise closing the chord picker would navigate.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [onClose]);

  // Flip the popover to stay within the viewport.
  const WIDTH = 240;
  const HEIGHT_GUESS = 180;
  const left = Math.min(x, window.innerWidth - WIDTH - 8);
  const top = y + HEIGHT_GUESS > window.innerHeight ? Math.max(8, y - HEIGHT_GUESS) : y;

  return (
    <div
      ref={ref}
      className="fixed p-2 rounded-lg shadow-lg z-50"
      style={{ left, top, width: WIDTH, background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {inSong.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>In this song</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {inSong.map((c) => (
              <button key={c} type="button"
                onClick={() => onPick(c)}
                className="px-1.5 py-0.5 rounded text-xs font-mono hover:bg-[var(--surface-elevated)]"
                style={{ color: 'var(--accent)', background: 'var(--surface-elevated)' }}>
                {c}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Common</div>
      <div className="flex flex-wrap gap-1">
        {COMMON_CHORDS.filter((c) => !inSong.includes(c)).map((c) => (
          <button key={c} type="button"
            onClick={() => onPick(c)}
            className="px-1.5 py-0.5 rounded text-xs font-mono hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-secondary)' }}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Text input that shows a dropdown of suggestions filtered by what the
 * user has typed so far. Clicking (or pressing Enter on) a suggestion fills
 * the field with that suggestion's canonical casing. Used by both the
 * Artist and Language fields. */
function SuggestionInput({
  value, onChange, suggestions, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions
      .filter((a) => a.toLowerCase().includes(q) && a.toLowerCase() !== q)
      .slice(0, 8);
  }, [suggestions, value]);

  const showDropdown = focused && filtered.length > 0;

  const pick = (choice: string) => {
    onChange(choice);
    setFocused(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[activeIdx]) { e.preventDefault(); pick(filtered[activeIdx]); }
    else if (e.key === 'Escape') { setFocused(false); }
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setActiveIdx(0); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setTimeout(() => setFocused(false), 120); }}
        onKeyDown={handleKey}
        className="input-field w-full"
        placeholder={placeholder}
        autoComplete="off"
      />
      {showDropdown && (
        <ul
          className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg overflow-hidden shadow-lg max-h-56 overflow-y-auto"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              className="px-3 py-2 cursor-pointer text-sm"
              style={{
                background: i === activeIdx ? 'var(--accent)' : 'transparent',
                color: i === activeIdx ? 'white' : 'var(--text-primary)',
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Numeric BPM input with a tap-tempo button. Each click (or Space/Enter
 * press) records a beat timestamp; the displayed BPM is the mean interval
 * across the most recent taps. Taps that arrive after a long pause are
 * treated as the start of a fresh sequence instead of a huge outlier. */
function TempoInput({
  value, onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const tapsRef = useRef<number[]>([]);
  const [flash, setFlash] = useState(false);

  const reset = () => {
    tapsRef.current = [];
    onChange('');
  };

  const handleTap = () => {
    const now = Date.now();
    const taps = tapsRef.current;
    // If the gap since the last tap is > 2s, start over — the user is probably
    // re-tapping rather than continuing the same sequence.
    const last = taps[taps.length - 1];
    if (last !== undefined && now - last > 2000) {
      tapsRef.current = [now];
    } else {
      tapsRef.current = [...taps, now];
      // Keep only the last 8 taps so old timings don't skew the average.
      if (tapsRef.current.length > 8) tapsRef.current = tapsRef.current.slice(-8);
    }
    const arr = tapsRef.current;
    if (arr.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < arr.length; i++) intervals.push(arr[i]! - arr[i - 1]!);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 40 && bpm <= 300) onChange(String(bpm));
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => { tapsRef.current = []; onChange(e.target.value); }}
        className="input-field flex-1"
        placeholder="120"
        min={40}
        max={300}
      />
      <button
        type="button"
        onClick={handleTap}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleTap(); } }}
        title="Tap to set tempo"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: flash ? 'var(--accent)' : 'var(--surface-elevated)',
          color: flash ? 'white' : 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <Hand size={14} />Tap
      </button>
      <button
        type="button"
        onClick={reset}
        title="Clear tempo"
        className="p-2 rounded-lg transition-colors"
        style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}

/** Sanitise a duration string typed by the user. Keeps only digits + a single
 * colon, caps minutes at 3 digits (~999 minutes), and restricts seconds so
 * the first digit is 0-5 and the value is at most 2 digits. */
function sanitizeDurationInput(raw: string): string {
  const cleaned = raw.replace(/[^\d:]/g, '');
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx === -1) {
    return cleaned.slice(0, 3);
  }
  const before = cleaned.slice(0, colonIdx).slice(0, 3);
  let after = cleaned.slice(colonIdx + 1).replace(/[^\d]/g, '').slice(0, 2);
  if (after.length >= 1 && parseInt(after[0]!, 10) > 5) {
    after = after.slice(1);
  }
  return `${before}:${after}`;
}

/** Normalise on blur: pad seconds, reject standalone bare values to enforce
 * the mm:ss shape. Empty stays empty (duration is optional). */
function normaliseDurationOnBlur(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    // Bare number — treat as minutes.
    const m = trimmed.replace(/[^\d]/g, '');
    return m ? `${parseInt(m, 10)}:00` : '';
  }
  const before = trimmed.slice(0, colonIdx).replace(/[^\d]/g, '');
  const after = trimmed.slice(colonIdx + 1).replace(/[^\d]/g, '');
  if (!before) return '';
  const m = parseInt(before, 10);
  const s = after === '' ? 0 : parseInt(after, 10);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DURATION_RE = /^\d+:[0-5]\d$/;

function DurationInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const isInvalid = value.trim() !== '' && !DURATION_RE.test(value);
  return (
    <input
      value={value}
      onChange={(e) => onChange(sanitizeDurationInput(e.target.value))}
      onBlur={(e) => onChange(normaliseDurationOnBlur(e.target.value))}
      className="input-field"
      placeholder="3:45"
      inputMode="numeric"
      style={isInvalid ? { borderColor: 'var(--danger)' } : undefined}
      title="Format: mm:ss (e.g. 3:45)"
    />
  );
}

/** Read-only file path display + Browse / Clear buttons. The browse
 *  picker uses Electron's native file dialog with audio extension
 *  filters; the chosen absolute path is what we save on the song. */
function AudioFilePicker({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const pick = async () => {
    const path = await window.electronAPI.files.pickAudio();
    if (path) onChange(path);
  };
  const filename = value ? value.split(/[\\/]+/).pop() : '';
  return (
    <div className="flex items-center gap-2">
      <div
        className="input-field flex-1 min-w-0 flex items-center"
        style={{ cursor: 'default', overflow: 'hidden' }}
        title={value || 'No file selected'}
      >
        {value ? (
          <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{filename}</span>
        ) : (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No file selected</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void pick()}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{ background: 'var(--accent)', color: 'white' }}
      >
        Browse…
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="px-2.5 py-1.5 rounded-lg text-xs transition-colors"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
          title="Remove file"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</span>}
    </div>
  );
}

function TagsInput({
  value, onChange, suggestions = [],
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const addTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, '').trim();
    if (!trimmed) return;
    if (value.some((t) => t.toLowerCase() === trimmed.toLowerCase())) { setDraft(''); return; }
    onChange([...value, trimmed]);
    setDraft('');
    setActiveIdx(0);
  };

  const removeTag = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  // Filtered suggestions: omit anything already added; prefix-tolerant match
  // on the current draft. Empty draft shows the first 8 alphabetically.
  const filtered = useMemo(() => {
    const taken = new Set(value.map((t) => t.toLowerCase()));
    const q = draft.trim().toLowerCase();
    const pool = suggestions.filter((s) => !taken.has(s.toLowerCase()));
    if (!q) return pool.slice(0, 8);
    return pool.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 8);
  }, [suggestions, value, draft]);

  const showDropdown = focused && filtered.length > 0;

  return (
    <div className="relative">
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[40px]"
        onClick={(e) => {
          const input = (e.currentTarget as HTMLDivElement).querySelector('input');
          input?.focus();
        }}
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              className="ml-0.5 rounded-full w-4 h-4 flex items-center justify-center leading-none hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
              title={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) addTag(v.slice(0, -1));
            else { setDraft(v); setActiveIdx(0); }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Slight delay so a click on a suggestion item still registers.
            setTimeout(() => setFocused(false), 120);
            if (draft.trim()) addTag(draft);
          }}
          onKeyDown={(e) => {
            if (showDropdown && e.key === 'ArrowDown') {
              e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (showDropdown && e.key === 'ArrowUp') {
              e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (showDropdown && filtered[activeIdx]) addTag(filtered[activeIdx]);
              else addTag(draft);
            } else if (e.key === 'Escape') {
              setFocused(false);
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              removeTag(value.length - 1);
            }
          }}
          placeholder={value.length === 0 ? 'Add a tag…' : ''}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>
      {showDropdown && (
        <ul
          className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg overflow-hidden shadow-lg max-h-56 overflow-y-auto"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              className="px-3 py-2 cursor-pointer text-sm"
              style={{
                background: i === activeIdx ? 'var(--accent)' : 'transparent',
                color: i === activeIdx ? 'white' : 'var(--text-primary)',
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

function DifficultyStars({ value, onChange }: { value: number; onChange: (v: number) => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? 0 : n)}
              className="text-lg leading-none px-0.5"
              style={{ color: filled ? 'var(--accent)' : 'var(--text-muted)', opacity: filled ? 1 : 0.5 }}
              title={DIFFICULTY_LABELS[n]}
            >
              {filled ? '★' : '☆'}
            </button>
          );
        })}
      </div>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {DIFFICULTY_LABELS[value] ?? 'Unset'}
      </span>
    </div>
  );
}
