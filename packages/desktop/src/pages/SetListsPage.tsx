import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListMusic, Trash2, Calendar, Pencil, Check, X, Play } from 'lucide-react';
import { useSetListStore } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import type { SetList } from '@song-chords/shared';
import ConfirmDialog from '../components/common/ConfirmDialog';

export default function SetListsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { setlists, createSetList, updateSetList, deleteSetList, isLoading } = useSetListStore();
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');

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
        <div className="grid gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', gridTemplateColumns: '2fr 2fr 1fr auto' }}>
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
            placeholder="Description (optional)"
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
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
          <div className="grid grid-cols-1 gap-3 max-w-2xl">
            {setlists.map((sl) => (
              <SetListCard
                key={sl.id}
                setlist={sl}
                onOpen={() => navigate(`/setlists/${sl.id}`)}
                onPerform={() => navigate(`/setlists/${sl.id}/player`)}
                onUpdate={(patch) => updateSetList(db, sl.id, patch)}
                onDelete={() => deleteSetList(db, sl.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SetListCardProps {
  setlist: SetList;
  onOpen: () => void;
  onPerform: () => void;
  onUpdate: (patch: Partial<Pick<SetList, 'name' | 'description' | 'date'>>) => Promise<void>;
  onDelete: () => void;
}

function SetListCard({ setlist, onOpen, onPerform, onUpdate, onDelete }: SetListCardProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [name, setName] = useState(setlist.name);
  const [desc, setDesc] = useState(setlist.description ?? '');
  const [date, setDate] = useState(setlist.date ? new Date(setlist.date).toISOString().slice(0, 10) : '');

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
      onClick={onOpen}
      className="flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-colors group"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="p-2 rounded-lg" style={{ background: 'var(--surface-elevated)' }}>
        <ListMusic size={20} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{setlist.name}</p>
        {setlist.description && <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{setlist.description}</p>}
        {setlist.date && (
          <p className="text-xs flex items-center gap-1 mt-1" style={{ color: 'var(--text-muted)' }}>
            <Calendar size={11} />{new Date(setlist.date).toLocaleDateString()}
          </p>
        )}
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
          className="p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--surface-elevated)]"
          title="Edit set list"
        >
          <Pencil size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
          className="p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--surface-elevated)]"
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
