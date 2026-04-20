import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Song } from '@song-chords/shared';
import { toTitleCase } from '../../utils/text';

const DIFFICULTY_LABELS = ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'];

interface Props {
  song: Song;
  onClose: () => void;
}

export default function SongInfoModal({ song, onClose }: Props): React.ReactElement {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const rows: { label: string; value?: React.ReactNode }[] = [
    { label: 'Artist', value: song.artist ? toTitleCase(song.artist) : undefined },
    { label: 'Album', value: song.album ? toTitleCase(song.album) : undefined },
    { label: 'Key', value: song.key },
    { label: 'Tempo', value: song.tempo ? `${song.tempo} BPM` : undefined },
    { label: 'Time Signature', value: song.timeSig },
    { label: 'Capo', value: song.capo > 0 ? `Capo ${song.capo}` : undefined },
    { label: 'Genre', value: song.genre ? toTitleCase(song.genre) : undefined },
    { label: 'Year', value: song.year },
    { label: 'Language', value: song.language ? toTitleCase(song.language) : undefined },
    { label: 'Duration', value: song.duration },
    { label: 'Difficulty', value: song.difficulty && song.difficulty > 0 ? DIFFICULTY_LABELS[song.difficulty] : undefined },
    { label: 'Tags', value: song.tags.length > 0 ? song.tags.map(toTitleCase).join(', ') : undefined },
    { label: 'Number of chords', value: song.chordsCount > 0 ? song.chordsCount : undefined },
  ];

  const visible = rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== '');

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Song info</p>
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No metadata set.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {visible.map((r) => (
              <React.Fragment key={r.label}>
                <dt className="font-semibold" style={{ color: 'var(--text-muted)' }}>{r.label}</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{r.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {song.notes && (
          <div className="flex flex-col gap-1 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Notes</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{song.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
