import React, { useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { X, Download, FileText, Code, FileCode, Braces, Printer, Guitar, Type, LayoutGrid, AlignLeft, ChevronLeft } from 'lucide-react';
import type { Song, ParsedSong, ChordDiagram, ChordGridToken, SongViewStyle } from '@song-chords/shared';
import {
  useSettingsStore,
  extractUniqueChords, getDiagramExact, getDiagramByIndex,
  SONG_STYLE_PRESETS,
} from '@song-chords/shared';
import ChordDiagramSVG from '../chord-diagram/ChordDiagramSVG';
import ChordGrid from './ChordGrid';
import {
  EXPORT_FORMATS, EXPORT_LAYOUTS, exportSong, exportSongs, getRenderableSong,
  type ExportFormat, type ExportLayout, type ExportOptions, type PerSongExtras,
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
  /** Songs to export. Length 1 = single-song export with full layout
   *  options; length > 1 forces a "binder"-style multi-song export. */
  songs: Song[];
  /** Title shown in the modal header and used as the filename for batch
   *  exports (e.g. "Favorites", "Set list: Easter morning"). For single
   *  songs the song's own title is used automatically. */
  bookTitle?: string;
  onClose: () => void;
}

export default function SongExportModal({ songs, bookTitle, onClose }: Props): React.ReactElement | null {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const customChords = useSettingsStore((s) => s.settings.customChords ?? {});
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const [layout, setLayout] = useState<ExportLayout>('chords');
  // Format the user has picked — actual export only fires on the Export
  // button click, so the layout block can show conditionally based on this.
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');

  // Light-mode preset overrides for PDF / HTML exports — built-in plus any
  // user-defined custom preset whose mode is light. Defaults to "Classic".
  // The selection is local to the modal and never updates the app's
  // current style.
  const customPresets = useSettingsStore((s) => s.settings.customPresets ?? {});
  const lightPresets = useMemo(() => {
    const builtin = Object.entries(SONG_STYLE_PRESETS)
      .filter(([, p]) => p.mode === 'light')
      .map(([key, p]) => ({ key, name: p.name, style: p.style }));
    const custom = Object.entries(customPresets)
      .filter(([, p]) => p.mode === 'light')
      .map(([key, p]) => ({ key, name: `${p.name} (custom)`, style: p.style }));
    return [...builtin, ...custom];
  }, [customPresets]);
  const [exportPresetKey, setExportPresetKey] = useState<string>('classic');
  const exportStyle: SongViewStyle = useMemo(() => {
    const found = lightPresets.find((p) => p.key === exportPresetKey);
    return found?.style ?? svs;
  }, [lightPresets, exportPresetKey, svs]);

  // No-op render guard so callers can mount the modal unconditionally and
  // pass an empty list when nothing's selected.
  const isMulti = songs.length > 1;
  const song = songs[0];
  const defaultHeading = isMulti ? (bookTitle ?? `${songs.length} songs`) : (song ? toTitleCase(song.title) : 'Export');
  // User-editable document heading — used as the title page label and the
  // file name for multi-song PDF/HTML exports. Always seeded from the
  // caller's bookTitle (or song title for single-song).
  const [heading, setHeading] = useState(defaultHeading);
  useEffect(() => { setHeading(defaultHeading); }, [defaultHeading]);

  useEffect(() => {
    // Capture phase + stopImmediatePropagation so the page's Escape handler
    // doesn't also fire (otherwise closing the modal also triggers navigation).
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

  // Per-song chord SVG renderer — the modal pre-renders SVGs so PDF/HTML
  // exports look identical to the in-app song view, including each song's
  // selected variation (`song.preferences.chordVariations`) and any custom
  // chord shape from settings.
  const diagramSvgFor = (s: Song, name: string): string => {
    const variations = s.preferences?.chordVariations ?? {};
    const varIdx = variations[name] ?? 0;
    const strings = instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0;
    const found = varIdx > 0
      ? getDiagramByIndex(name, instrument, varIdx, customChords)
      : getDiagramExact(name, instrument, customChords);
    const d: ChordDiagram = found ?? (instrument === 'piano'
      ? { name, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
      : { name, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as ('x')[] });
    // Use the user-chosen export preset (light-mode preset for PDF/HTML)
    // so the diagrams match the rest of the exported document — not the
    // app's currently-active preset.
    const lineColor = exportStyle.lyrics.color || '#111';
    const chordColor = exportStyle.chords.color || '#4b73ff';
    return renderToStaticMarkup(
      <ChordDiagramSVG
        diagram={d}
        width={layout === 'inline-diagrams' ? 80 : 96}
        lineColor={lineColor}
        chordColor={chordColor}
        nameColor={chordColor}
        fontFamily={exportStyle.fontFamily || undefined}
        nameFontSize={exportStyle.chords.fontSize || undefined}
      />,
    );
  };

  const buildChordBarFor = (s: Song, parsed: ParsedSong): string => {
    const chords = extractUniqueChords(parsed);
    if (chords.length === 0) return '';
    const lineColor = svs.lyrics.color || '#111';
    const svgs = chords
      .map((name) => `<div style="flex-shrink:0;text-align:center;">${diagramSvgFor(s, name)}</div>`)
      .join('');
    return `<div style="display:flex;flex-wrap:wrap;justify-content:safe center;gap:12px;padding:10px 0 16px;margin-bottom:16px;border-bottom:1px solid ${lineColor}22;">${svgs}</div>`;
  };

  const buildInlineDiagramMapFor = (s: Song, parsed: ParsedSong): Record<string, string> => {
    const chords = extractUniqueChords(parsed);
    const map: Record<string, string> = {};
    for (const name of chords) map[name] = diagramSvgFor(s, name);
    return map;
  };

  // Pre-render chord-grid lines (INTRO bars etc.) via the same ChordGrid
  // component the song view uses, so the exported HTML matches the on-screen
  // rendering exactly. Uses the chosen export preset (not the app's active
  // preset) so the colors match the rest of the exported document.
  const buildChordGridMapFor = (parsed: ParsedSong): Record<number, string> => {
    if (layout === 'lyrics-only') return {};
    const map: Record<number, string> = {};
    const chordColor = exportStyle.chords.color || '#6366f1';
    const fontSize = exportStyle.lyrics.fontSize || 16;
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

  const buildExtrasFor = (s: Song): PerSongExtras => {
    const parsed = getRenderableSong(s);
    return {
      chordBarHtml: layout === 'chords-with-bar' ? buildChordBarFor(s, parsed) : undefined,
      inlineDiagrams: layout === 'inline-diagrams' ? buildInlineDiagramMapFor(s, parsed) : undefined,
      chordGrids: buildChordGridMapFor(parsed),
    };
  };

  const handlePick = (format: ExportFormat) => {
    if (songs.length === 0) { onClose(); return; }
    const needsLayout = format === 'html' || format === 'pdf';
    let options: ExportOptions | undefined;
    if (needsLayout) {
      // Theme variable fallbacks for slots the chosen preset leaves empty.
      // The export preset picker only shows light-mode presets, so we use
      // hardcoded light-theme values rather than capturing the app's
      // current DOM (which is dark when the user runs the app in dark
      // mode and would otherwise leak the dark bg into the PDF).
      options = {
        layout,
        style: exportStyle,
        songCentered,
        themeBackground: '#ffffff',
        themeForeground: '#0f172a',
        themeMuted: '#94a3b8',
        themeChord: '#6366f1',
        themeAccent: '#6366f1',
        themeSection: '#64748b',
      };
      // Single-song path expects extras inline on the options object.
      if (!isMulti && song) {
        const extras = buildExtrasFor(song);
        options.chordBarHtml = extras.chordBarHtml;
        options.inlineDiagrams = extras.inlineDiagrams;
        options.chordGrids = extras.chordGrids;
      }
    }
    if (isMulti) {
      // Build a per-song extras map only when the chosen layout actually
      // needs them — keeps text and JSON exports cheap.
      const perSongExtras: Record<string, PerSongExtras> = {};
      if (needsLayout && (layout === 'chords-with-bar' || layout === 'inline-diagrams' || layout !== 'lyrics-only')) {
        for (const s of songs) perSongExtras[s.id] = buildExtrasFor(s);
      }
      void exportSongs(songs, format, heading.trim() || (bookTitle ?? `${songs.length} songs`), options, perSongExtras);
    } else if (song) {
      exportSong(song, format, options);
    }
    onClose();
  };

  const layoutMattersFor = (format: ExportFormat) => format === 'html' || format === 'pdf';
  // Two-step wizard: step 1 picks the format. PDF and HTML lead to a step
  // 2 with style preset + layout options; the other formats export
  // directly from step 1.
  const [step, setStep] = useState<1 | 2>(1);

  // Reset to step 1 each time the modal opens (when songs identity changes)
  useEffect(() => { setStep(1); }, [songs.length === 0]);

  if (songs.length === 0) return null;

  const onPrimaryAction = () => {
    if (step === 1 && layoutMattersFor(selectedFormat)) {
      setStep(2);
      return;
    }
    handlePick(selectedFormat);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isMulti ? `Export ${songs.length} songs` : 'Export song'}
            </p>
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{heading || defaultHeading}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Document name — multi-song only. Becomes the title page heading
            and the file/folder name for the export. Shown on step 1 since
            it's a property of "what" the user is exporting. */}
        {isMulti && step === 1 && (
          <div className="px-5 pb-3">
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Document title
            </label>
            <input
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder={defaultHeading}
            />
          </div>
        )}

        {/* ── STEP 1 — pick a format ─────────────────────────────────── */}
        {step === 1 && (
          <div className="px-3 pb-3 flex flex-col gap-1" role="radiogroup" aria-label="Export format">
            {EXPORT_FORMATS.map((f) => {
              const active = selectedFormat === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelectedFormat(f.id)}
                  className="flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors hover:bg-[var(--surface-elevated)]"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined,
                    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  <span
                    className="mt-0.5 shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{
                      background: active ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: active ? 'white' : 'var(--text-muted)',
                    }}
                  >
                    {ICONS[f.id]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{f.label}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>.{f.ext}</span>
                      {isMulti && (f.id === 'chordpro' || f.id === 'plaintext') && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>
                          One file per song
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{f.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── STEP 2 — preset + layout (PDF / HTML only) ─────────────── */}
        {step === 2 && (
          <>
            <div className="px-5 py-3 flex flex-col gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-muted)' }}>
                  Style preset
                </label>
                <select
                  value={exportPresetKey}
                  onChange={(e) => setExportPresetKey(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  title="Light-mode preset used for the exported document. Doesn't change the app's active preset."
                >
                  {lightPresets.map((p) => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              </div>
              <PresetPreview style={exportStyle} />
            </div>

            <div className="border-t" style={{ borderColor: 'var(--border)' }} />
            <div className="px-5 py-4 flex flex-col min-h-0" style={{ flex: '1 1 auto', overflow: 'hidden' }}>
              <p className="text-xs font-semibold mb-2 shrink-0" style={{ color: 'var(--text-muted)' }}>
                <Guitar size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                Layout
              </p>
              <div className="flex flex-col gap-1 overflow-y-auto">
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
          </>
        )}

        {/* Footer */}
        <div className="border-t" style={{ borderColor: 'var(--border)' }} />
        <div className="px-5 py-3 flex items-center gap-2">
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={14} />
              Back
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onPrimaryAction}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {step === 1 && layoutMattersFor(selectedFormat) ? (
              <>Continue</>
            ) : (
              <><Download size={14} />Export</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Larger preview of a preset's exported look. Renders title, artist,
 * details row, a section chip, and a sample chord+lyric line using the
 * preset's actual colors, fonts, and uppercase settings on the printed
 * (white) background — gives the user a good sense of what the PDF /
 * HTML will look like before committing. */
function PresetPreview({ style }: { style: SongViewStyle }): React.ReactElement {
  const fontFamily = style.fontFamily || 'monospace';
  const lyricsBg = style.lyrics.background || '#ffffff';
  const lyricsColor = style.lyrics.color || '#0f172a';
  const titleColor = style.title.color || lyricsColor;
  const detailsColor = style.details.color || '#94a3b8';
  const chordColor = style.chords.color || '#6366f1';
  const sectionBg = style.section.background || chordColor;
  const sectionColor = style.section.color || '#ffffff';
  const titleSize = Math.min(style.title.fontSize || 22, 22);
  const detailsSize = Math.min(style.details.fontSize || 12, 12);
  const lyricSize = Math.min(style.lyrics.fontSize || 14, 14);
  const chordSize = Math.min(style.chords.fontSize || 12, 12);
  const sectionSize = Math.min(style.section.fontSize || 10, 11);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: lyricsBg, border: '1px solid var(--border)', fontFamily, padding: '14px 16px' }}
      title="Preview of the preset's colors as they'll appear in the exported PDF / HTML"
    >
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div
          style={{
            color: titleColor,
            fontWeight: 700,
            fontSize: titleSize,
            textTransform: style.titleUppercase ? 'uppercase' : undefined,
            lineHeight: 1.1,
            marginBottom: 2,
          }}
        >
          Sample Song
        </div>
        <div style={{ color: detailsColor, fontSize: detailsSize, marginBottom: 4 }}>
          Artist Name
        </div>
        <div style={{ color: detailsColor, fontSize: detailsSize, opacity: 0.85 }}>
          <strong style={{ fontWeight: 700 }}>Key:</strong> G
          <span style={{ margin: '0 6px', opacity: 0.5 }}>|</span>
          <strong style={{ fontWeight: 700 }}>Tempo:</strong> 120 BPM
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <span
          style={{
            display: 'inline-block',
            background: sectionBg,
            color: sectionColor,
            fontWeight: 700,
            fontSize: sectionSize,
            letterSpacing: '0.06em',
            textTransform: style.sectionUppercase ? 'uppercase' : undefined,
            padding: '3px 8px',
            borderRadius: 4,
          }}
        >
          Verse 1
        </span>
      </div>
      <div style={{ lineHeight: 1.1 }}>
        <span style={{ color: chordColor, fontWeight: 600, fontSize: chordSize, marginRight: 16 }}>C</span>
        <span style={{ color: chordColor, fontWeight: 600, fontSize: chordSize, marginRight: 16 }}>G</span>
        <span style={{ color: chordColor, fontWeight: 600, fontSize: chordSize }}>Am</span>
      </div>
      <div style={{ color: lyricsColor, fontSize: lyricSize, lineHeight: 1.4 }}>
        Sample lyric line for this preset
      </div>
    </div>
  );
}
