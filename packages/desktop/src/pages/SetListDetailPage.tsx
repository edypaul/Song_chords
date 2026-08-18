import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Plus, GripVertical, Trash2, Search, FileText, Pencil, X } from 'lucide-react';
import { useSetListStore, useSongStore, transposeKey } from '@song-chords/shared';
import type { SetListEntry, Song } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toTitleCase } from '../utils/text';
import PlayLinkButton from '../components/song/PlayLinkButton';
import NotesLinkButton from '../components/song/NotesLinkButton';
import AnnotationsLinkButton from '../components/song/AnnotationsLinkButton';
import { useT } from '../i18n';

export default function SetListDetailPage(): React.ReactElement {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeSetList, openSetList, addSongToSetList, addNoteToSetList, updateNoteEntry, removeSongFromSetList, reorderSetList } = useSetListStore();
  const { songs } = useSongStore();
  const [showAddSong, setShowAddSong] = useState(false);
  const [search, setSearch] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: string | null; title: string; body: string } | null>(null);

  useEffect(() => {
    if (id) void openSetList(db, id);
  }, [id]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!activeSetList) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = activeSetList.entries.map((e) => e.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    const newOrder = arrayMove(ids, oldIdx, newIdx);
    await reorderSetList(db, activeSetList.id, newOrder);
  };

  const filteredSongs = songs.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.artist?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  if (!activeSetList) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => navigate('/setlists')} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
          <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <h1 className="font-bold text-lg flex-1" style={{ color: 'var(--text-primary)' }}>{activeSetList.name}</h1>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('setListDetail.itemCount', { count: activeSetList.entries.length })}</span>
        <button
          onClick={() => setShowAddSong(!showAddSong)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
        >
          <Plus size={14} />{t('setListDetail.addSong')}
        </button>
        <button
          onClick={() => setEditingNote({ id: null, title: '', body: '' })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
        >
          <FileText size={14} />{t('setListDetail.addNote')}
        </button>
        {activeSetList.entries.length > 0 && (
          <button
            onClick={() => navigate(`/setlists/${id}/player`)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Play size={14} />{t('setListDetail.perform')}
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Song list */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeSetList.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-muted)' }}>
              <p>{t('setListDetail.emptyList')}</p>
              <button onClick={() => setShowAddSong(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
                {t('setListDetail.addSongs')}
              </button>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={activeSetList.entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2 max-w-2xl">
                  {activeSetList.entries.map((entry, idx) => (
                    <SortableEntry
                      key={entry.id}
                      entry={entry}
                      index={idx + 1}
                      onRemove={() => removeSongFromSetList(db, entry.id)}
                      onOpen={() => {
                        if (entry.type === 'note') {
                          setEditingNote({ id: entry.id, title: entry.noteTitle ?? '', body: entry.noteBody ?? '' });
                        } else if (entry.songId) {
                          navigate(`/song/${entry.songId}?entry=${entry.id}`);
                        }
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Add song panel */}
        {showAddSong && (
          <div className="w-72 border-l flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('setListDetail.searchSongs')}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredSongs.map((song) => (
                <button
                  key={song.id}
                  onClick={() => addSongToSetList(db, activeSetList.id, song.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-elevated)] transition-colors border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</p>
                  {song.artist && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{toTitleCase(song.artist)}</p>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {editingNote && (
        <NoteEditor
          initialTitle={editingNote.title}
          initialBody={editingNote.body}
          onClose={() => setEditingNote(null)}
          onSave={async (title, body) => {
            if (editingNote.id) {
              await updateNoteEntry(db, editingNote.id, title, body);
            } else {
              await addNoteToSetList(db, activeSetList.id, title, body);
            }
            setEditingNote(null);
          }}
        />
      )}
    </div>
  );
}

function NoteEditor({ initialTitle, initialBody, onClose, onSave }: {
  initialTitle: string;
  initialBody: string;
  onClose: () => void;
  onSave: (title: string, body: string) => void;
}): React.ReactElement {
  const t = useT();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border flex flex-col" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <FileText size={16} style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
            {initialTitle || initialBody ? t('setListDetail.note.editTitle') : t('setListDetail.note.newTitle')}
          </p>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('setListDetail.note.titlePlaceholder')}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('setListDetail.note.bodyPlaceholder')}
            rows={10}
            className="px-3 py-2 rounded-lg text-sm outline-none resize-y font-mono"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', lineHeight: 1.5 }}
          />
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg" style={{ color: 'var(--text-muted)' }}>{t('common.cancel')}</button>
          <button
            onClick={() => onSave(title.trim(), body)}
            disabled={!title.trim() && !body.trim()}
            className="px-4 py-1.5 text-sm font-medium rounded-lg disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {t('setListDetail.note.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Notes use inline styles for the accent-tinted background, so Tailwind's
// `hover:bg-*` can't override them. This small wrapper drives the background
// + border via React state so hover actually takes effect.
const NoteRow = React.forwardRef<HTMLDivElement, {
  dndStyle: React.CSSProperties;
  children: React.ReactNode;
}>(function NoteRow({ dndStyle, children }, ref): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      ref={ref}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...dndStyle,
        background: hover
          ? 'color-mix(in srgb, var(--accent) 20%, var(--surface))'
          : 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
        borderColor: hover
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--accent) 35%, var(--border))',
      }}
      className="flex items-center gap-3 p-3 rounded-xl group transition-colors border border-dashed"
    >
      {children}
    </div>
  );
});

function SortableEntry({
  entry, index, onRemove, onOpen,
}: {
  entry: SetListEntry & { song?: Song };
  index: number;
  onRemove: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  // ── Note entry — simpler row, distinctive accent-tinted background. ────
  if (entry.type === 'note') {
    const title = entry.noteTitle?.trim() || t('setListDetail.note.untitled');
    const preview = entry.noteBody?.trim().split('\n')[0] ?? '';
    return (
      <NoteRow ref={setNodeRef} dndStyle={style}>
        <div {...attributes} {...listeners} className="cursor-grab p-1 rounded hover:bg-[var(--surface-elevated)]">
          <GripVertical size={16} style={{ color: 'var(--text-muted)' }} />
        </div>
        <span className="w-6 text-xs font-mono text-center" style={{ color: 'var(--text-muted)' }}>{index}</span>
        <FileText size={16} style={{ color: 'var(--accent)' }} />
        <button onClick={onOpen} className="flex-1 text-left min-w-0">
          <p className="font-medium truncate text-sm italic" style={{ color: 'var(--text-primary)' }}>{title}</p>
          {preview && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{preview}</p>}
        </button>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--accent)' }}>{t('setListDetail.note.badge')}</span>
        <button onClick={onOpen} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title={t('setListDetail.note.editTitle')}>
          <Pencil size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button onClick={onRemove} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
          <Trash2 size={14} style={{ color: 'var(--danger)' }} />
        </button>
      </NoteRow>
    );
  }

  // ── Song entry ────────────────────────────────────────────────────────
  const song = entry.song;
  if (!song) {
    // Defensive fallback for a song entry whose source song was deleted.
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 rounded-xl border border-dashed" title={t('setListDetail.entry.missingSongTitle')}>
        <span className="flex-1 text-sm italic" style={{ color: 'var(--text-muted)' }}>{t('setListDetail.entry.missingSong')}</span>
        <button onClick={onRemove} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
          <Trash2 size={14} style={{ color: 'var(--danger)' }} />
        </button>
      </div>
    );
  }

  const title = toTitleCase(song.title);
  const artist = song.artist ? toTitleCase(song.artist) : undefined;
  const baseKey = entry.key ?? song.key;
  const displayKey = baseKey ? transposeKey(baseKey, entry.transpose ?? 0) : undefined;
  const keyOverridden =
    (entry.key !== undefined && entry.key !== song.key) ||
    ((entry.transpose ?? 0) !== 0);
  const displayTempo = entry.tempo ?? song.tempo;
  const tempoOverridden = entry.tempo !== undefined && entry.tempo !== song.tempo;
  const capoOverridden = entry.capo !== (song.capo ?? 0);

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 rounded-xl group transition-colors bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-elevated)] hover:border-[var(--accent)]">
      <div {...attributes} {...listeners} className="cursor-grab p-1 rounded hover:bg-[var(--surface-elevated)]">
        <GripVertical size={16} style={{ color: 'var(--text-muted)' }} />
      </div>
      <span className="w-6 text-xs font-mono text-center" style={{ color: 'var(--text-muted)' }}>{index}</span>
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <p className="font-medium truncate text-sm" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {artist && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{artist}</p>}
      </button>
      <PlayLinkButton title={song.title} link={song.link} audioFile={song.audioFile} />
      <NotesLinkButton title={song.title} notes={song.notes} />
      {/* Annotations icon appears ONLY when this song has saved
          annotation sets — `hideWhenEmpty` suppresses the disabled-
          placeholder state that SongListTable uses for column
          alignment, so setlist rows stay uncluttered. */}
      <AnnotationsLinkButton
        title={song.title}
        annotationsJson={song.annotations}
        hideWhenEmpty
      />
      {displayKey && (
        <span
          className="text-xs font-mono"
          style={{ color: keyOverridden ? 'var(--accent)' : 'var(--chord-color)' }}
          title={keyOverridden ? t('setListDetail.entry.transposedFrom', { key: song.key ?? '—' }) : undefined}
        >
          {displayKey}
        </span>
      )}
      {entry.capo > 0 && (
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{
            background: 'var(--surface-elevated)',
            color: capoOverridden ? 'var(--accent)' : 'var(--text-muted)',
          }}
          title={capoOverridden ? t('setListDetail.entry.capoTitleOverridden', { capo: entry.capo, songCapo: song.capo ?? 0 }) : t('setListDetail.entry.capoTitle', { capo: entry.capo })}
        >
          {t('setListDetail.entry.capoLabel', { capo: entry.capo })}
        </span>
      )}
      {displayTempo && (
        <span
          className="text-[10px] font-mono"
          style={{ color: tempoOverridden ? 'var(--accent)' : 'var(--text-muted)' }}
          title={tempoOverridden ? t('setListDetail.entry.tempoOverridden', { tempo: song.tempo ?? '—' }) : undefined}
        >
          {t('setListDetail.entry.tempoBpm', { tempo: displayTempo })}
        </span>
      )}
      {song.duration && (
        <span
          className="text-[10px] font-mono"
          style={{ color: 'var(--text-muted)' }}
          title={t('setListDetail.entry.durationTitle')}
        >
          {song.duration}
        </span>
      )}
      <button onClick={onRemove} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
        <Trash2 size={14} style={{ color: 'var(--danger)' }} />
      </button>
    </div>
  );
}
