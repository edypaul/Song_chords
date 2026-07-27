import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Song } from '@song-chords/shared';
import { toTitleCase } from '../../utils/text';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';

/** Dictionary keys for each difficulty level (index matches value 0..5). */
const DIFFICULTY_KEYS: TKey[] = [
  'songList.difficulty.unset',
  'songList.difficulty.basic',
  'songList.difficulty.easy',
  'songList.difficulty.intermediate',
  'songList.difficulty.advanced',
  'songList.difficulty.professional',
];

interface Props {
  song: Song;
  onClose: () => void;
}

export default function SongInfoModal({ song, onClose }: Props): React.ReactElement {
  const t = useT();
  useEffect(() => {
    // Capture phase + stopImmediatePropagation so page-level Escape handlers
    // (e.g. "navigate back" on Song view / Perform) don't also fire.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [onClose]);

  const difficultyKey = song.difficulty && song.difficulty > 0
    ? DIFFICULTY_KEYS[song.difficulty]
    : undefined;
  const rows: { label: string; value?: React.ReactNode }[] = [
    { label: t('songInfo.rows.artist'), value: song.artist ? toTitleCase(song.artist) : undefined },
    { label: t('songInfo.rows.album'), value: song.album ? toTitleCase(song.album) : undefined },
    { label: t('songInfo.rows.key'), value: song.key },
    { label: t('songInfo.rows.tempo'), value: song.tempo ? t('songInfo.tempoValue', { tempo: song.tempo }) : undefined },
    { label: t('songInfo.rows.timeSignature'), value: song.timeSig },
    { label: t('songInfo.rows.capo'), value: song.capo > 0 ? t('songInfo.capoValue', { n: song.capo }) : undefined },
    { label: t('songInfo.rows.genre'), value: song.genre ? toTitleCase(song.genre) : undefined },
    { label: t('songInfo.rows.year'), value: song.year },
    { label: t('songInfo.rows.language'), value: song.language ? toTitleCase(song.language) : undefined },
    { label: t('songInfo.rows.duration'), value: song.duration },
    { label: t('songInfo.rows.difficulty'), value: difficultyKey ? t(difficultyKey) : undefined },
    { label: t('songInfo.rows.tags'), value: song.tags.length > 0 ? song.tags.map(toTitleCase).join(', ') : undefined },
    { label: t('songInfo.rows.chordsCount'), value: song.chordsCount > 0 ? song.chordsCount : undefined },
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
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('songInfo.title')}</p>
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('songInfo.empty')}</p>
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
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{t('songInfo.notes')}</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{song.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
