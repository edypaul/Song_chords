import React, { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useSetListStore } from '@song-chords/shared';
import { db } from '../ipc/ipc-client';
import PerformPage, { type PerformItem } from '../components/song/PerformPage';

export default function SetListPlayerPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { activeSetList, openSetList, updateEntry } = useSetListStore();

  useEffect(() => { if (id) void openSetList(db, id); }, [id]);

  // Map the setlist's entries to PerformItems. Notes carry title + body;
  // song entries carry the snapshotted song + per-entry overrides so each
  // setlist performs independently of the source song.
  const items = useMemo<PerformItem[]>(() => {
    if (!activeSetList) return [];
    return activeSetList.entries.map((e) => {
      if (e.type === 'note') {
        return {
          id: e.id,
          type: 'note',
          noteTitle: e.noteTitle,
          noteBody: e.noteBody,
        };
      }
      return {
        id: e.id,
        type: 'song',
        song: e.song,
        overrides: {
          transpose: e.transpose,
          capo: e.capo,
          key: e.key,
          tempo: e.tempo,
          timeSig: e.timeSig,
        },
      };
    });
  }, [activeSetList]);

  if (!activeSetList) {
    return (
      <div className="flex items-center justify-center h-full fixed inset-0" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <PerformPage
      title={activeSetList.name}
      items={items}
      onOverridesChange={(entryId, { transpose, capo }) => {
        void updateEntry(db, entryId, { transpose, capo });
      }}
    />
  );
}
