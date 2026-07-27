import React from 'react';
import { usePlayerStore, useSettingsStore, transposeKey, formatKey } from '@song-chords/shared';
import { useT } from '../../i18n';

/**
 * Shared song-metadata block (Key / Capo / Tempo / Time-sig) rendered below
 * the song title in every view (library song page, set list player, category
 * player). Pulls live state from the player + settings stores so the key
 * updates as the user transposes.
 */
export default function SongDetails({ centered = false }: { centered?: boolean }): React.ReactElement | null {
  const t = useT();
  const activeSong = usePlayerStore((s) => s.activeSong);
  const transposeSteps = usePlayerStore((s) => s.transposeSteps);
  const capo = usePlayerStore((s) => s.capo);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  if (!activeSong) return null;

  const color = svs.details.color || 'var(--text-muted)';
  const label = (text: string) => <span style={{ fontWeight: 700, color }}>{text}</span>;
  const value = (text: React.ReactNode) => <span style={{ fontWeight: 400, opacity: 0.85, color }}>{text}</span>;

  const items: { key: string; node: React.ReactNode }[] = [];
  if (activeSong.key) items.push({ key: 'k', node: <span>{label(t('songDetails.key'))}{value(formatKey(transposeKey(activeSong.key, transposeSteps), notation))}</span> });
  if (capo > 0)       items.push({ key: 'c', node: <span>{label(t('songDetails.capo'))}{value(capo)}</span> });
  if (activeSong.tempo)   items.push({ key: 't',  node: <span>{label(t('songDetails.tempo'))}{value(t('songDetails.bpm', { tempo: activeSong.tempo }))}</span> });
  if (activeSong.timeSig) items.push({ key: 'ts', node: <span>{label(t('songDetails.time'))}{value(activeSong.timeSig)}</span> });

  if (items.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center mt-2"
      style={{
        fontSize: svs.details.fontSize || undefined,
        fontFamily: svs.fontFamily || undefined,
        ...(centered ? { justifyContent: 'center' } : {}),
      }}
    >
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 && <span style={{ margin: '0 8px', opacity: 0.5, color }}>|</span>}
          {item.node}
        </React.Fragment>
      ))}
    </div>
  );
}
