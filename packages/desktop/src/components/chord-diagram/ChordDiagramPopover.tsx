import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { getDiagramExact, useSettingsStore, formatChord } from '@song-chords/shared';
import ChordDiagramSVG from './ChordDiagramSVG';

interface Props {
  chord: string;
  children: React.ReactNode;
}

export default function ChordDiagramPopover({ chord, children }: Props): React.ReactElement {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const diagram = getDiagramExact(chord, instrument, custom);

  if (!diagram) return <>{children}</>;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="rounded-xl shadow-xl p-3 z-50"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          sideOffset={6}
        >
          <ChordDiagramSVG diagram={diagram} width={130} lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} displayName={formatChord(chord, notation)} />
          <Popover.Arrow style={{ fill: 'var(--border)' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
