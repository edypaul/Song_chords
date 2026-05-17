import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListMusic, Trash2, Calendar, Pencil, Check, X, Play, FileText, Music, Clock, Copy, Download, GripVertical } from 'lucide-react';
import { useSetListStore, useSongStore, SetListRepository } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { SetList, Song } from '@song-chords/shared';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SongExportModal from '../components/song/SongExportModal';
// Drag-and-drop via @dnd-kit — same library + sensors / strategy as
// the inner SetListDetailPage uses for entry reordering, so the two
// surfaces share consistent drag behavior (pointer + keyboard, animated
// translations, accessible drag-handles).
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function SetListsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { setlists, createSetList, updateSetList, deleteSetList, duplicateSetList, reorderSetLists, isLoading } = useSetListStore();
  const songs = useSongStore((s) => s.songs);
  const [pendingExport, setPendingExport] = useState<{ songs: Song[]; title: string } | null>(null);

  // Build the song list for a setlist with each entry's transpose / capo /
  // key / tempo / time-sig override applied on top of the underlying song,
  // then open the unified Export modal.
  const openExportForSetlist = async (sl: SetList) => {
    const repo = new SetListRepository(db);
    const entries = await repo.getEntries(sl.id);
    const songsForExport = entries
      .filter((e) => (e.type ?? 'song') === 'song' && e.songId)
      .map((e) => {
        const base = songs.find((s) => s.id === e.songId);
        if (!base) return null;
        return {
          ...base,
          key: e.key ?? base.key,
          tempo: e.tempo ?? base.tempo,
          timeSig: e.timeSig ?? base.timeSig,
          capo: e.capo ?? base.capo ?? 0,
          preferences: {
            ...(base.preferences ?? {}),
            transposeSteps: e.transpose ?? base.preferences?.transposeSteps ?? 0,
          },
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (songsForExport.length === 0) return;
    setPendingExport({ songs: songsForExport, title: sl.name });
  };
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [counts, setCounts] = useState<Record<string, { songs: number; notes: number }>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});

  // @dnd-kit setup — pointer + keyboard sensors so the cards are
  // reorderable by mouse / touch AND by keyboard (Tab to focus a
  // drag handle, Space to grab, arrows to move). Same configuration
  // as the entry-reorder DnD inside SetListDetailPage so behavior is
  // consistent across the two surfaces.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = setlists.map((s) => s.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(ids, oldIdx, newIdx);
    await reorderSetLists(db, newOrder);
  };

  // Reload songs/notes counts whenever the setlist collection changes (new
  // list, deleted list, entries added from elsewhere in the app).
  useEffect(() => {
    const repo = new SetListRepository(db);
    void repo.getEntryCountsByType().then(setCounts).catch(() => setCounts({}));
    void repo.getSetlistDurations().then(setDurations).catch(() => setDurations({}));
  }, [setlists]);

  const resetCreateForm = () => {
    setNewName('');
    setNewDesc('');
    setNewDate('');
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const sl = await createSetList(db, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        date: newDate ? new Date(newDate).getTime() : undefined,
      });
      resetCreateForm();
      navigate(`/setlists/${sl.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-bold flex-1" style={{ color: 'var(--text-primary)' }}>Set Lists</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Plus size={16} />New Set List
        </button>
      </div>

      {showCreate && (
        <div className="grid gap-x-2 gap-y-1 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', gridTemplateColumns: '2fr 2fr 1fr auto' }}>
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Name</label>
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Description</label>
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Performance date (optional)</label>
          <span />
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') resetCreateForm(); }}
            placeholder="Set list name..."
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--accent)' }}
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Short note, event, etc."
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            title="Date you'll perform this set list (optional)"
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <div className="flex items-center gap-2">
            <button onClick={handleCreate} disabled={creating} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
              Create
            </button>
            <button onClick={resetCreateForm} className="px-3 py-2 rounded-lg text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : setlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4" style={{ color: 'var(--text-muted)' }}>
            <ListMusic size={48} opacity={0.3} />
            <p>No set lists yet</p>
            <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
              Create your first set list
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={setlists.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 max-w-2xl">
                {setlists.map((sl) => (
                  <SetListCard
                    key={sl.id}
                    setlist={sl}
                    songCount={counts[sl.id]?.songs ?? 0}
                    noteCount={counts[sl.id]?.notes ?? 0}
                    durationSeconds={durations[sl.id] ?? 0}
                    onOpen={() => navigate(`/setlists/${sl.id}`)}
                    onPerform={() => navigate(`/setlists/${sl.id}/player`)}
                    onUpdate={(patch) => updateSetList(db, sl.id, patch)}
                    onDelete={() => deleteSetList(db, sl.id)}
                    onDuplicate={() => duplicateSetList(db, sl.id)}
                    onExport={() => openExportForSetlist(sl)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {pendingExport && (
        <SongExportModal
          songs={pendingExport.songs}
          bookTitle={pendingExport.title}
          onClose={() => setPendingExport(null)}
        />
      )}
    </div>
  );
}

interface SetListCardProps {
  setlist: SetList;
  songCount: number;
  noteCount: number;
  durationSeconds: number;
  onOpen: () => void;
  onPerform: () => void;
  onUpdate: (patch: Partial<Pick<SetList, 'name' | 'description' | 'date'>>) => Promise<void>;
  onDelete: () => void;
  onDuplicate: () => Promise<unknown>;
  onExport: () => void | Promise<void>;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SetListCard({ setlist, songCount, noteCount, durationSeconds, onOpen, onPerform, onUpdate, onDelete, onDuplicate, onExport }: SetListCardProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [name, setName] = useState(setlist.name);
  const [desc, setDesc] = useState(setlist.description ?? '');
  const [date, setDate] = useState(setlist.date ? new Date(setlist.date).toISOString().slice(0, 10) : '');
  // @dnd-kit sortable wiring: setNodeRef goes on the row element,
  // attributes + listeners go on the grip handle so a user can click
  // the body to navigate but must grab the handle to start a drag.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: setlist.id });
  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onUpdate({
      name: name.trim() || setlist.name,
      description: desc.trim() || undefined,
      date: date ? new Date(date).getTime() : undefined,
    });
    setEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setName(setlist.name);
    setDesc(setlist.description ?? '');
    setDate(setlist.date ? new Date(setlist.date).toISOString().slice(0, 10) : '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex flex-col gap-2 p-4 rounded-xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--accent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description"
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Check size={14} />Save
          </button>
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={14} />Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      onClick={onOpen}
      className="flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-colors group bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-elevated)] hover:border-[var(--accent)]"
    >
      {/* Drag handle — the only place dnd-kit listens for the start
          gesture. Clicking elsewhere on the card still navigates via
          the parent onClick; only this grip starts a reorder drag.
          Stop propagation on click so the navigate-to-detail handler
          on the parent div doesn't fire while the user is grabbing. */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center p-1 rounded cursor-grab active:cursor-grabbing"
        style={{ color: 'var(--text-muted)' }}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </div>
      <div className="p-2 rounded-lg" style={{ background: 'var(--surface-elevated)' }}>
        <ListMusic size={20} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{setlist.name}</p>
        {setlist.description && <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{setlist.description}</p>}
        <div className="flex items-center gap-3 text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1" title={`${songCount} song${songCount === 1 ? '' : 's'}`}>
            <Music size={11} />{songCount} song{songCount === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1" title={`${noteCount} note${noteCount === 1 ? '' : 's'}`}>
            <FileText size={11} />{noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
          {durationSeconds > 0 && (
            <span className="flex items-center gap-1" title="Approximate total runtime based on song durations">
              <Clock size={11} />~{formatDuration(durationSeconds)}
            </span>
          )}
          {setlist.date && (
            <span className="flex items-center gap-1">
              <Calendar size={11} />{new Date(setlist.date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onPerform(); }}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title="Perform this set list"
        >
          <Play size={16} style={{ color: 'var(--accent)' }} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title="Edit set list"
        >
          <Pencil size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void onDuplicate(); }}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title="Duplicate this set list"
        >
          <Copy size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void onExport(); }}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title="Export set list"
          disabled={songCount === 0}
          style={{ opacity: songCount === 0 ? 0.4 : 1 }}
        >
          <Download size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
          className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
          title="Delete set list"
        >
          <Trash2 size={16} style={{ color: 'var(--danger)' }} />
        </button>
      </div>

      {showDelete && (
        <ConfirmDialog
          title="Delete set list?"
          message={<>This will permanently delete <strong>{setlist.name}</strong>. The songs in it will not be deleted.</>}
          confirmLabel="Delete"
          danger
          onCancel={() => setShowDelete(false)}
          onConfirm={() => {
            setShowDelete(false);
            onDelete();
          }}
        />
      )}
    </div>
  );
}
