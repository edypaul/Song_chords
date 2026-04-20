import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Save, Trash2, ArrowLeft } from 'lucide-react';
import { useSongStore, ALL_KEYS, parseChordPro, extractUniqueChords, chordsOverLyricsToChordPro, chordProToChordsOverLyrics } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { SongCreateInput } from '@song-chords/shared';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { toTitleCase } from '../utils/text';
import { extractChordPattern, applyChordPattern, patternHasChords, type ChordPattern } from '../utils/chord-pattern';

const SECTION_DIRECTIVES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Instrumental', 'Outro'];
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

export default function SongEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Optional return path passed via `?return=<encoded-path>` so callers (e.g.
  // the context menu on list pages) can send the user back to where they
  // opened the editor from, on save or cancel.
  const returnTo = searchParams.get('return');
  const { songs, addSong, updateSong, deleteSong } = useSongStore();
  const isNew = !id || id === 'new';

  const existing = isNew ? null : songs.find((s) => s.id === id);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [artist, setArtist] = useState(existing?.artist ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [tempo, setTempo] = useState(existing?.tempo?.toString() ?? '');
  const [timeSig, setTimeSig] = useState(existing?.timeSig ?? '4/4');
  const [capo, setCapo] = useState(existing?.capo ?? 0);
  const [genre, setGenre] = useState(existing?.genre ?? '');
  const [year, setYear] = useState(existing?.year?.toString() ?? '');
  const [language, setLanguage] = useState(existing?.language ?? '');
  const [duration, setDuration] = useState(existing?.duration ?? '');
  // UI-only toggle for how the user wants to edit; all saves are ChordPro.
  const [format, setFormat] = useState<'chordpro' | 'plaintext'>('chordpro');
  const [content, setContent] = useState(existing?.content ?? exampleFor(format));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [difficulty, setDifficulty] = useState<number>(existing?.difficulty ?? 0);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'song'>('details');
  const [showDelete, setShowDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Right-click popover state — position in viewport + caret range at click.
  const [chordPopover, setChordPopover] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  // Clipboard for "Copy chords / Paste chords" — stores the chord pattern
  // extracted from one selection so it can be re-applied to another.
  const [chordClipboard, setChordClipboard] = useState<ChordPattern | null>(null);

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
      setContent(existing.content);
      setFormat('chordpro');
      setNotes(existing.notes ?? '');
      setTags(existing.tags ?? []);
      setDifficulty(existing.difficulty ?? 0);
      resetHistory(existing.content);
    }
  }, [existing?.id]);

  const handleSave = async () => {
    if (!title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      // Defaults applied only when the user leaves a field empty.
      const input: SongCreateInput = {
        title: title.trim(),
        artist: artist.trim() || 'Other',
        key: key || 'C',
        tempo: tempo ? parseInt(tempo) : undefined,
        timeSig: timeSig || undefined,
        capo,
        genre: genre.trim() || 'Other',
        year: year ? parseInt(year) : undefined,
        language: language.trim() || 'Spanish',
        duration: duration.trim() || undefined,
        // "Chords over lyrics" (plaintext) is an input-only mode: convert to
        // ChordPro so the chords get parsed and stored inline.
        content: format === 'plaintext' ? chordsOverLyricsToChordPro(content) : content,
        chordsCount: 0, // recomputed by the repository on write
        notes: notes.trim() || undefined,
        tags,
        difficulty: difficulty > 0 ? difficulty : 1, // 1 = Basic
        favorite: existing?.favorite ?? false,
        preferences: existing?.preferences ?? {},
        sortOrder: existing?.sortOrder ?? 0,
      };

      if (isNew) {
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button
          onClick={() => returnTo ? navigate(returnTo) : navigate(-1)}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
        >
          <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <h1 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{isNew ? 'New Song' : `Edit: ${existing?.title}`}</h1>
        <div className="flex gap-2 ml-auto">
          {!isNew && (
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
                <input value={artist} onChange={(e) => setArtist(e.target.value)} className="input-field" placeholder="Artist name" />
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
                  <input type="number" value={tempo} onChange={(e) => setTempo(e.target.value)} className="input-field" placeholder="120" min={40} max={300} />
                </Field>
                <Field label="Capo">
                  <select value={capo} onChange={(e) => setCapo(Number(e.target.value))} className="input-field">
                    {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i === 0 ? 'None' : `Capo ${i}`}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Genre">
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="input-field"
                >
                  <option value="">— Select genre —</option>
                  {['Pop', 'Rock', 'Country', 'Worship', 'Gospel', 'R&B', 'Soul', 'Jazz', 'Blues',
                    'Folk', 'Classical', 'Latin', 'Alternative', 'Indie', 'Hip-Hop', 'Electronic',
                    'Metal', 'Punk', 'Reggae', 'Christian'].map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="input-field"
                  placeholder="Or type a custom genre..."
                  style={{ marginTop: 6 }}
                />
              </Field>
              <div className="grid grid-cols-4 gap-4">
                <Field label="Duration (m:ss)">
                  <input
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="input-field"
                    placeholder="3:45"
                    pattern="[0-9]+:[0-5][0-9]"
                  />
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
                <Field label="Language">
                  <input
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="input-field"
                    placeholder="English"
                  />
                </Field>
              </div>
              <Field label="Tags" hint="Type a keyword and press Enter or comma to add.">
                <TagsInput value={tags} onChange={setTags} />
              </Field>
              <Field label="Difficulty">
                <DifficultyStars value={difficulty} onChange={setDifficulty} />
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
                    if (next === format) return;
                    setFormat(next);
                    // Swap built-in example as the user hasn't started typing.
                    if (content === EXAMPLE_CHORDPRO || content === EXAMPLE_PLAINTEXT) {
                      const swapped = exampleFor(next);
                      setContent(swapped);
                      commitHistory(swapped);
                      return;
                    }
                    // Otherwise convert the current content so the user sees
                    // their song reformatted in the newly-selected layout.
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
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                const v = e.target.value;
                setContent(v);
                scheduleTypingCommit(v);
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
              className="flex-1 p-4 font-mono text-sm outline-none resize-none"
              style={{ background: 'var(--bg)', color: 'var(--text-primary)', lineHeight: 1.6 }}
              spellCheck={false}
            />
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
        onClick={() => onChange('chordpro')}
        className="px-2 py-1 text-xs font-medium"
        style={btnStyle(format === 'chordpro')}
        title="Inline ChordPro format: [G]Amazing [C]grace"
      >
        ChordPro
      </button>
      <button
        type="button"
        onClick={() => onChange('plaintext')}
        className="px-2 py-1 text-xs font-medium"
        style={btnStyle(format === 'plaintext')}
        title="Chord names on one line, lyric directly below. Converted to ChordPro on save."
      >
        Chords over lyrics
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</span>}
    </div>
  );
}

function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }): React.ReactElement {
  const [draft, setDraft] = useState('');

  const addTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, '').trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) { setDraft(''); return; }
    onChange([...value, trimmed]);
    setDraft('');
  };

  const removeTag = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div
      className="input-field flex flex-wrap items-center gap-1.5 min-h-[40px]"
      onClick={(e) => {
        // Focus the inline input when the user clicks the chip container
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
          // Typing a comma commits the tag
          if (v.endsWith(',')) addTag(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); addTag(draft); }
          else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            removeTag(value.length - 1);
          }
        }}
        onBlur={() => { if (draft.trim()) addTag(draft); }}
        placeholder={value.length === 0 ? 'Add a tag…' : ''}
        className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
        style={{ color: 'var(--text-primary)' }}
      />
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
