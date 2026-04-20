import React, { useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { X, Download, FileText, Code, FileCode, Braces, Printer, Guitar, Type, LayoutGrid, AlignLeft } from 'lucide-react';
import type { Song, ParsedSong, ChordDiagram, ChordGridToken } from '@song-chords/shared';
import {
  useSettingsStore,
  extractUniqueChords, getDiagramExact, getDiagramByIndex,
} from '@song-chords/shared';
import ChordDiagramSVG from '../chord-diagram/ChordDiagramSVG';
import ChordGrid from './ChordGrid';
import {
  EXPORT_FORMATS, EXPORT_LAYOUTS, exportSong, getRenderableSong,
  type ExportFormat, type ExportLayout, type ExportOptions,
} from '../../utils/song-export';
import { toTitleCase } from '../../utils/text';

const ICONS: Record<ExportFormat, React.ReactNode> = {
  pdf:       <Printer size={16} />,
  chordpro:  <Code size={16} />,
  plaintext: <FileText size={16} />,
  html:      <FileCode size={16} />,
  json:      <Braces size={16} />,
};

const LAYOUT_ICONS: Record<ExportLayout, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  'chords':           Type,
  'chords-with-bar':  Guitar,
  'inline-diagrams':  LayoutGrid,
  'lyrics-only':      AlignLeft,
};

interface Props {
  song: Song;
  onClose: () => void;
}

export default function SongExportModal({ song, onClose }: Props): React.ReactElement {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const customChords = useSettingsStore((s) => s.settings.customChords ?? {});
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const [layout, setLayout] = useState<ExportLayout>('chords');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Use the SAME transposed/capo-aware parsing as the exporter so the diagrams
  // we render match the chord names the exported file will actually show.
  const parsed: ParsedSong = useMemo(() => getRenderableSong(song), [song]);

  // Shared diagram lookup + SVG renderer for both the top bar and the inline-
  // diagrams mode. Uses the same voicing/custom-chord chain as the in-app
  // chord bar so the export matches what's on stage.
  const diagramSvgFor = (name: string): string => {
    const variations = song.preferences?.chordVariations ?? {};
    const varIdx = variations[name] ?? 0;
    const strings = instrument === 'guitar' ? 6 : 4;
    const d = (varIdx > 0
      ? getDiagramByIndex(name, instrument, varIdx, customChords)
      : getDiagramExact(name, instrument, customChords)) ?? {
        name, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as ('x')[],
      } as ChordDiagram;
    const lineColor = svs.lyrics.color || '#111';
    const chordColor = svs.chords.color || '#4b73ff';
    return renderToStaticMarkup(
      <ChordDiagramSVG
        diagram={d}
        width={layout === 'inline-diagrams' ? 80 : 96}
        lineColor={lineColor}
        chordColor={chordColor}
        nameColor={chordColor}
      />,
    );
  };

  const buildChordBarHtml = (): string => {
    const chords = extractUniqueChords(parsed);
    if (chords.length === 0) return '';
    const lineColor = svs.lyrics.color || '#111';
    const svgs = chords
      .map((name) => `<div style="flex-shrink:0;text-align:center;">${diagramSvgFor(name)}</div>`)
      .join('');
    return `<div style="display:flex;flex-wrap:wrap;justify-content:safe center;gap:12px;padding:10px 0 16px;margin-bottom:16px;border-bottom:1px solid ${lineColor}22;">${svgs}</div>`;
  };

  const buildInlineDiagramMap = (): Record<string, string> => {
    const chords = extractUniqueChords(parsed);
    const map: Record<string, string> = {};
    for (const name of chords) map[name] = diagramSvgFor(name);
    return map;
  };

  // Pre-render chord-grid lines (INTRO bars etc.) via the same ChordGrid
  // component the song view uses, so the exported HTML matches the on-screen
  // rendering exactly.
  const buildChordGridMap = (): Record<number, string> => {
    if (layout === 'lyrics-only') return {};
    const map: Record<number, string> = {};
    const chordColor = svs.chords.color;
    const fontSize = svs.lyrics.fontSize || 16;
    parsed.lines.forEach((line, i) => {
      if (!line.isChordGrid) return;
      const token = line.tokens[0];
      if (!token || token.type !== 'chord-grid') return;
      map[i] = renderToStaticMarkup(
        <ChordGrid token={token as ChordGridToken} fontSize={fontSize} chordColor={chordColor} />,
      );
    });
    return map;
  };

  const handlePick = (format: ExportFormat) => {
    if (format === 'html' || format === 'pdf') {
      const options: ExportOptions = {
        layout,
        style: svs,
        songCentered,
        chordBarHtml: layout === 'chords-with-bar' ? buildChordBarHtml() : undefined,
        inlineDiagrams: layout === 'inline-diagrams' ? buildInlineDiagramMap() : undefined,
        chordGrids: buildChordGridMap(),
      };
      exportSong(song, format, options);
    } else {
      exportSong(song, format);
    }
    onClose();
  };

  const layoutMattersFor = (format: ExportFormat) => format === 'html' || format === 'pdf';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Export song</p>
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{toTitleCase(song.title)}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Layout radios — affect HTML and PDF output only. */}
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            <Guitar size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
            Layout (HTML & PDF)
          </p>
          <div className="flex flex-col gap-1">
            {EXPORT_LAYOUTS.map((l) => {
              const checked = layout === l.id;
              const LayoutIcon = LAYOUT_ICONS[l.id];
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLayout(l.id)}
                  className="flex items-start gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--surface-elevated)] transition-colors"
                >
                  <LayoutIcon size={16} className="mt-0.5 shrink-0" style={{ color: checked ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span
                    className="mt-1 flex items-center justify-center w-4 h-4 rounded-full border shrink-0"
                    style={{
                      borderColor: checked ? 'var(--accent)' : 'var(--border)',
                      background: checked ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    {checked && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'white' }} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{l.label}</div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t" style={{ borderColor: 'var(--border)' }} />

        <div className="flex flex-col gap-1 p-3 overflow-y-auto">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => handlePick(f.id)}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[var(--surface-elevated)] transition-colors"
            >
              <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>{ICONS[f.id]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{f.label}</span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>.{f.ext}</span>
                  {layoutMattersFor(f.id) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>
                      {EXPORT_LAYOUTS.find((l) => l.id === layout)!.label}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{f.hint}</p>
              </div>
              <Download size={14} style={{ color: 'var(--text-muted)', marginTop: 4 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
