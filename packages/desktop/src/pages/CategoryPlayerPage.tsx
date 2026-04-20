import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Guitar, LayoutGrid, FileText, Timer } from 'lucide-react';
import type { Song } from '@song-chords/shared';
import { useSongStore, usePlayerStore, useSettingsStore } from '@song-chords/shared';
import SongRenderer from '../components/song/SongRenderer';
import SongDetails from '../components/song/SongDetails';
import ChordDiagramBar from '../components/chord-diagram/ChordDiagramBar';
import TransposeControl from '../components/controls/TransposeControl';
import AutoScrollControl from '../components/controls/AutoScrollControl';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { useMetronome } from '../hooks/useMetronome';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { db } from '../ipc/ipc-client';
import { toTitleCase } from '../utils/text';

type CategoryKey = 'artist' | 'genre' | 'key' | 'difficulty' | 'tags' | 'year' | 'decade' | 'language';

function extractValues(category: CategoryKey, song: Song): string[] {
  switch (category) {
    case 'artist':     return song.artist ? [song.artist] : [];
    case 'genre':      return song.genre ? [song.genre] : [];
    case 'key':        return song.key ? [song.key] : [];
    case 'difficulty': return song.difficulty && song.difficulty > 0 ? [String(song.difficulty)] : [];
    case 'tags':       return song.tags ?? [];
    case 'year':       return song.year ? [String(song.year)] : [];
    case 'decade':     return song.year ? [`${Math.floor(song.year / 10) * 10}s`] : [];
    case 'language':   return song.language ? [song.language] : [];
  }
}

export default function CategoryPlayerPage(): React.ReactElement {
  const { category, value } = useParams<{ category: CategoryKey; value: string }>();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const { loadSong, displayedSong, activeSong, fontSize } = usePlayerStore();
  const metronome = useMetronome(activeSong?.tempo ?? 120, activeSong?.timeSig ?? '4/4');
  const viewMode = usePlayerStore((s) => s.viewMode);
  const setViewMode = usePlayerStore((s) => s.setViewMode);
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const perfZoom = useSettingsStore((s) => s.settings.perfZoom ?? 1);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const chordBarPosition = useSettingsStore((s) => s.settings.chordBarPosition ?? 'top');
  const inlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const showChordDiagrams = useSettingsStore((s) => s.settings.showChordDiagrams ?? true);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [chordBarVisible, setChordBarVisible] = useState(showChordDiagrams);
  // Lyrics-only forces the other two off (same mutual-exclusion as SongViewPage).
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
    }
  }, [viewMode]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef as React.RefObject<HTMLElement>);

  const decoded = value ? decodeURIComponent(value) : '';
  const matches = useMemo(() => {
    if (!category) return [];
    return songs.filter((s) => extractValues(category, s).includes(decoded));
  }, [category, decoded, songs]);

  const [activeIndex, setActiveIndex] = useState(0);
  const total = matches.length;
  const current = matches[activeIndex];

  const [navDirection, setNavDirection] = useState<'next' | 'prev'>('next');
  const next = () => { setNavDirection('next'); setActiveIndex((i) => Math.min(i + 1, total - 1)); };
  const prev = () => { setNavDirection('prev'); setActiveIndex((i) => Math.max(i - 1, 0)); };
  const swipe = useSwipeNavigation({ onNext: next, onPrev: prev });

  useEffect(() => {
    if (current) loadSong(current);
  }, [current?.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, total]);

  // Enter fullscreen on mount; exit on unmount. Browsers require a recent
  // user gesture — the click that navigated here counts as that gesture.
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  if (!category || !value) {
    return <div className="flex items-center justify-center h-full fixed inset-0" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>Missing category.</div>;
  }
  if (total === 0) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)', color: 'var(--text-muted)', zIndex: 100 }}>
        <p>No songs in this category.</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>Back</button>
      </div>
    );
  }

  const label = category === 'difficulty'
    ? ['Unset', 'Basic', 'Easy', 'Intermediate', 'Advanced', 'Professional'][parseInt(decoded)] ?? decoded
    : (category === 'artist' || category === 'tags' || category === 'language')
      ? toTitleCase(decoded)
      : decoded;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--bg)', zIndex: 100 }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
          <X size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>

        <div
          className="font-semibold"
          style={{
            color: 'var(--text-primary)',
            // Key values are chord labels (e.g. "F#", "Am") — never case-fold them.
            textTransform: category !== 'key' && svs.titleUppercase ? 'uppercase' : undefined,
          }}
        >
          {category === 'key'
            ? label
            : (svs.titleUppercase ? label : toTitleCase(label))}
        </div>
        <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>
          {activeIndex + 1} / {total}
        </span>

        <div className="flex gap-1 mx-2">
          <button onClick={prev} disabled={activeIndex === 0} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <button onClick={next} disabled={activeIndex >= total - 1} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>

        <TransposeControl />
        <div className="ml-2"><AutoScrollControl /></div>

        {/* Metronome */}
        {activeSong?.tempo && (
          <div className="flex items-center gap-2">
            <button
              onClick={metronome.toggle}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors"
              style={{ background: metronome.isPlaying ? 'var(--accent)' : 'var(--surface-elevated)', color: metronome.isPlaying ? 'white' : 'var(--text-secondary)' }}
              title={`Metronome — ${activeSong.tempo} BPM, ${activeSong.timeSig ?? '4/4'}`}
            >
              <Timer size={13} />
              <span>{activeSong.tempo}</span>
            </button>
            {metronome.isPlaying && (
              <div className="flex items-center gap-1">
                {Array.from({ length: metronome.beatsPerMeasure }, (_, i) => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i === metronome.currentBeat ? (i === 0 ? 'var(--accent)' : 'var(--chord-color)') : 'var(--border)', transition: 'background 0.05s' }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lyrics only */}
        {(() => {
          const lyricsOnly = viewMode === 'lyrics-only';
          return (
            <button
              onClick={() => setViewMode(lyricsOnly ? 'chords' : 'lyrics-only')}
              className="p-1.5 rounded-md"
              style={{ background: lyricsOnly ? 'var(--accent)' : 'var(--surface-elevated)', color: lyricsOnly ? 'white' : 'var(--text-muted)' }}
              title={lyricsOnly ? 'Show chords' : 'Lyrics only'}
            >
              <FileText size={14} />
            </button>
          );
        })()}
        {/* Chord bar */}
        {(() => {
          const disabled = viewMode === 'lyrics-only' || inlineDiagrams;
          const on = chordBarVisible && !disabled;
          return (
            <button
              onClick={() => setChordBarVisible((v) => !v)}
              disabled={disabled}
              className="p-1.5 rounded-md"
              style={{
                background: on ? 'var(--accent)' : 'var(--surface-elevated)',
                color: on ? 'white' : 'var(--text-muted)',
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              title={disabled ? 'Unavailable while inline diagrams or lyrics-only is on' : (on ? 'Hide chord diagrams bar' : 'Show chord diagrams bar')}
            >
              <Guitar size={14} />
            </button>
          );
        })()}
        {/* Inline diagrams */}
        {(() => {
          const disabled = viewMode === 'lyrics-only' || chordBarVisible;
          const on = inlineDiagrams && !disabled;
          return (
            <button
              onClick={() => void updateSetting(db, 'inlineChordDiagrams', !inlineDiagrams)}
              disabled={disabled}
              className="p-1.5 rounded-md"
              style={{
                background: on ? 'var(--accent)' : 'var(--surface-elevated)',
                color: on ? 'white' : 'var(--text-muted)',
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              title={disabled ? 'Unavailable while chord bar or lyrics-only is on' : (on ? 'Hide inline chord diagrams' : 'Show inline chord diagrams')}
            >
              <LayoutGrid size={14} />
            </button>
          );
        })()}

        {/* Next-song hint + song indicators */}
        <div className="ml-auto flex items-center gap-3">
          {matches[activeIndex + 1] && (
            <span
              className="text-xs truncate max-w-xs"
              style={{ color: 'var(--text-muted)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
            >
              Next: <strong style={{ color: 'var(--text-secondary)' }}>
                {svs.titleUppercase ? matches[activeIndex + 1]!.title : toTitleCase(matches[activeIndex + 1]!.title)}
              </strong>
            </span>
          )}
          <div className="flex gap-1">
            {matches.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className="w-2 h-2 rounded-full transition-colors"
                style={{ background: i === activeIndex ? 'var(--accent)' : 'var(--border)' }}
                title={toTitleCase(matches[i]!.title)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Chord bar — top */}
      {chordBarVisible && chordBarPosition === 'top' && displayedSong && (
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={activeSong?.preferences?.chordVariations} />
      )}

      {/* Song content + optional right-side chord bar */}
      <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-16 py-10" {...swipe}>
          <div
            key={activeSong?.id}
            className={navDirection === 'next' ? 'song-slide-next' : 'song-slide-prev'}
            style={{
              zoom: perfZoom,
              ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}),
            } as React.CSSProperties}
          >
            {activeSong && (
              <div className="mb-8" style={songCentered ? { textAlign: 'center' } : undefined}>
                <h2
                  className="font-bold"
                  style={{
                    color: svs.title.color || 'var(--text-primary)',
                    fontSize: svs.title.fontSize || undefined,
                    fontFamily: svs.fontFamily || undefined,
                    textTransform: svs.titleUppercase ? 'uppercase' : undefined,
                  }}
                >
                  {svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}
                </h2>
                {activeSong.artist && (
                  <p
                    className="mt-1"
                    style={{
                      color: svs.details.color || 'var(--text-secondary)',
                      fontSize: svs.details.fontSize || undefined,
                      fontFamily: svs.fontFamily || undefined,
                    }}
                  >
                    {toTitleCase(activeSong.artist)}
                  </p>
                )}
                <SongDetails centered={songCentered} />
              </div>
            )}
            {displayedSong && (
              <SongRenderer song={displayedSong} fontSize={svs.lyrics.fontSize || (fontSize + 2)} viewMode={viewMode} />
            )}
          </div>
        </div>
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={activeSong?.preferences?.chordVariations} />
        )}
      </div>

      {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && (
        <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={activeSong?.preferences?.chordVariations} />
      )}
    </div>
  );
}
