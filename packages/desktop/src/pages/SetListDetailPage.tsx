import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Plus, GripVertical, Trash2, Search } from 'lucide-react';
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

export default function SetListDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeSetList, openSetList, addSongToSetList, removeSongFromSetList, reorderSetList } = useSetListStore();
  const { songs } = useSongStore();
  const [showAddSong, setShowAddSong] = useState(false);
  const [search, setSearch] = useState('');

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
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => navigate('/setlists')} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
          <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <h1 className="font-bold text-lg flex-1" style={{ color: 'var(--text-primary)' }}>{activeSetList.name}</h1>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{activeSetList.entries.length} songs</span>
        <button
          onClick={() => setShowAddSong(!showAddSong)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
        >
          <Plus size={14} />Add Song
        </button>
        {activeSetList.entries.length > 0 && (
          <button
            onClick={() => navigate(`/setlists/${id}/player`)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Play size={14} />Perform
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Song list */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeSetList.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-muted)' }}>
              <p>No songs in this set list</p>
              <button onClick={() => setShowAddSong(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
                Add songs
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
                      onOpen={() => navigate(`/song/${entry.songId}?entry=${entry.id}`)}
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
                  placeholder="Search songs..."
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
    </div>
  );
}

function SortableEntry({
  entry, index, onRemove, onOpen,
}: {
  entry: SetListEntry & { song: Song };
  index: number;
  onRemove: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const title = toTitleCase(entry.song.title);
  const artist = entry.song.artist ? toTitleCase(entry.song.artist) : undefined;
  // Base key for display — an entry-level override wins over the song's key.
  // Then apply the entry's transpose so the displayed key reflects what the
  // performer will actually play in this setlist.
  const baseKey = entry.key ?? entry.song.key;
  const displayKey = baseKey ? transposeKey(baseKey, entry.transpose ?? 0) : undefined;
  const keyOverridden =
    (entry.key !== undefined && entry.key !== entry.song.key) ||
    ((entry.transpose ?? 0) !== 0);
  const displayTempo = entry.tempo ?? entry.song.tempo;
  const tempoOverridden = entry.tempo !== undefined && entry.tempo !== entry.song.tempo;
  const capoOverridden = entry.capo !== (entry.song.capo ?? 0);

  return (
    <div ref={setNodeRef} style={{ ...style, background: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center gap-3 p-3 rounded-xl group">
      <div {...attributes} {...listeners} className="cursor-grab p-1 rounded hover:bg-[var(--surface-elevated)]">
        <GripVertical size={16} style={{ color: 'var(--text-muted)' }} />
      </div>
      <span className="w-6 text-xs font-mono text-center" style={{ color: 'var(--text-muted)' }}>{index}</span>
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <p className="font-medium truncate text-sm" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {artist && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{artist}</p>}
      </button>
      {displayKey && (
        <span
          className="text-xs font-mono"
          style={{ color: keyOverridden ? 'var(--accent)' : 'var(--chord-color)' }}
          title={keyOverridden ? `Transposed from ${entry.song.key ?? '—'}` : undefined}
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
          title={`Capo ${entry.capo}${capoOverridden ? ` (song: ${entry.song.capo ?? 0})` : ''}`}
        >
          Capo {entry.capo}
        </span>
      )}
      {displayTempo && (
        <span
          className="text-[10px] font-mono"
          style={{ color: tempoOverridden ? 'var(--accent)' : 'var(--text-muted)' }}
          title={tempoOverridden ? `Overridden (song: ${entry.song.tempo ?? '—'} BPM)` : undefined}
        >
          {displayTempo} BPM
        </span>
      )}
      <button onClick={onRemove} className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-elevated)]">
        <Trash2 size={14} style={{ color: 'var(--danger)' }} />
      </button>
    </div>
  );
}
