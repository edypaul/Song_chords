import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Guitar, LayoutGrid, FileText, Timer, StickyNote, ArrowUp } from 'lucide-react';
import { usePlayerStore, useSettingsStore, useSongStore } from '@song-chords/shared';
import type { Song } from '@song-chords/shared';
import SongRenderer from './SongRenderer';
import SongDetails from './SongDetails';
import ChordDiagramBar from '../chord-diagram/ChordDiagramBar';
import TransposeControl from '../controls/TransposeControl';
import AutoScrollControl from '../controls/AutoScrollControl';
import StickyNotePanel from './StickyNotePanel';
import SectionNavigator from './SectionNavigator';
import BottomSectionSpacer from './BottomSectionSpacer';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useMetronome } from '../../hooks/useMetronome';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';

/**
 * One item in a perform queue. Songs carry an optional `overrides` patch that's
 * merged on top of the song before it's loaded (so setlist / favorite contexts
 * can perform with their own key / capo / tempo / transpose without touching
 * the original song). Notes carry free-form title + body text.
 */
export interface PerformItem {
  id: string;
  type: 'song' | 'note';
  song?: Song;
  overrides?: {
    transpose: number;
    capo: number;
    key?: string;
    tempo?: number;
    timeSig?: string;
  };
  noteTitle?: string;
  noteBody?: string;
}

interface PerformPageProps {
  /** Page header title (e.g. setlist name, category value, or "Favorites"). */
  title: string;
  /** Optional leading icon rendered next to the title. */
  icon?: React.ReactNode;
  /** Ordered list of items to perform. */
  items: PerformItem[];
  /** Persist transpose/capo changes for a specific song item. Called on every
   *  distinct change — caller is responsible for debouncing/deduping if needed. */
  onOverridesChange?: (itemId: string, overrides: { transpose: number; capo: number }) => void;
  /** Rendered instead of the normal UI when `items` is empty. */
  emptyState?: React.ReactNode;
}

export default function PerformPage({ title, icon, items, onOverridesChange, emptyState }: PerformPageProps): React.ReactElement {
  const navigate = useNavigate();
  const updateSongInStore = useSongStore((s) => s.updateSong);

  const loadSong = usePlayerStore((s) => s.loadSong);
  const displayedSong = usePlayerStore((s) => s.displayedSong);
  const activeSong = usePlayerStore((s) => s.activeSong);
  const fontSize = usePlayerStore((s) => s.fontSize);
  const viewMode = usePlayerStore((s) => s.viewMode);
  const setViewMode = usePlayerStore((s) => s.setViewMode);

  // Half/double-time applies only to the metronome, not the stored song
  // tempo. Reset when switching songs so the new song starts at 1×.
  const [tempoMultiplier, setTempoMultiplier] = useState<0.5 | 1 | 2>(1);
  const baseTempo = activeSong?.tempo ?? 120;
  const metronome = useMetronome(Math.round(baseTempo * tempoMultiplier), activeSong?.timeSig ?? '4/4');
  useEffect(() => { setTempoMultiplier(1); }, [activeSong?.id]);

  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const perfZoom = useSettingsStore((s) => s.settings.perfZoom ?? 1);
  const chordBarPosition = useSettingsStore((s) => s.settings.chordBarPosition ?? 'top');
  const inlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const showChordDiagrams = useSettingsStore((s) => s.settings.showChordDiagrams ?? true);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [chordBarVisible, setChordBarVisible] = useState(showChordDiagrams);
  useEffect(() => { setChordBarVisible(showChordDiagrams); }, [showChordDiagrams]);
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
    }
  }, [viewMode]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef as React.RefObject<HTMLElement>);

  const [activeIndex, setActiveIndex] = useState(0);
  // Clamp in case the items list shrinks.
  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  const total = items.length;
  const currentItem = items[activeIndex];
  const isNoteActive = currentItem?.type === 'note';

  // Slide direction for the content wrapper.
  const [navDirection, setNavDirection] = useState<'next' | 'prev'>('next');
  const goNext = useCallback(() => {
    setNavDirection('next');
    setActiveIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);
  const goPrev = useCallback(() => {
    setNavDirection('prev');
    setActiveIndex((i) => Math.max(i - 1, 0));
  }, []);
  const swipe = useSwipeNavigation({ onNext: goNext, onPrev: goPrev });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeIndex]);

  // Track whether the scroll container has bottomed out, so the floating
  // "Back to top" button only appears when there's actually somewhere to
  // scroll back from. The bottom spacer (mounted while the section panel
  // is open) inflates `scrollHeight`, so subtract it before deciding.
  const [atBottom, setAtBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { setAtBottom(false); return; }
    const update = () => {
      const spacer = el.querySelector<HTMLElement>('[data-bottom-spacer]');
      const spacerHeight = spacer ? spacer.offsetHeight : 0;
      const total = el.scrollHeight - el.clientHeight - spacerHeight;
      setAtBottom(total > 0 && el.scrollTop >= total - 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [activeIndex]);

  const [showSongNotes, setShowSongNotes] = useState(false);

  // Shortcut handlers — transpose/capo mutate the player store, which in
  // turn fires the overrides-changed subscription to persist them onto the
  // setlist / favorite entry. Zoom adjusts the global perfZoom setting.
  useKeyboardShortcuts({
    toggleInlineDiagrams: () => {
      // Piano can't render inline; ignore the shortcut so the setting
      // doesn't silently flip on with no visible effect.
      if (instrument === 'piano') return;
      void updateSetting(db, 'inlineChordDiagrams', !inlineDiagrams);
    },
    toggleChordBar:       () => setChordBarVisible((v) => !v),
    toggleLyricsOnly:     () => setViewMode(viewMode === 'lyrics-only' ? 'chords' : 'lyrics-only'),
    toggleMetronome:      () => { if (activeSong?.tempo) metronome.toggle(); },
    toggleSongNotes:      () => { if (activeSong?.notes?.trim() && !isNoteActive) setShowSongNotes((v) => !v); },
    toggleAutoScroll:     () => usePlayerStore.getState().toggleAutoScroll(),
    transposeUp:          () => usePlayerStore.getState().transposeUp(),
    transposeDown:        () => usePlayerStore.getState().transposeDown(),
    zoomIn:               () => void updateSetting(db, 'perfZoom', Math.min((perfZoom ?? 1) + 0.1, 3)),
    zoomOut:              () => void updateSetting(db, 'perfZoom', Math.max((perfZoom ?? 1) - 0.1, 0.5)),
    zoomReset:            () => void updateSetting(db, 'perfZoom', 1),
    onCapo:               (fret) => usePlayerStore.getState().setCapo(fret),
  });
  // Auto-open the sticky note only for SONG entries that have notes. When
  // the current entry is a standalone text note (type 'note'), the sticky
  // stays hidden — the note's own content is already the main view.
  useEffect(() => {
    const isSong = currentItem?.type === 'song';
    setShowSongNotes(isSong && !!activeSong?.notes && activeSong.notes.trim().length > 0);
  }, [currentItem?.id, currentItem?.type, activeSong?.id, activeSong?.notes]);

  // Load the current song (merging its overrides) when the index changes.
  useEffect(() => {
    if (!currentItem || currentItem.type !== 'song' || !currentItem.song) return;
    const s = currentItem.song;
    const o = currentItem.overrides;
    const merged = o ? {
      ...s,
      key: o.key ?? s.key,
      tempo: o.tempo ?? s.tempo,
      timeSig: o.timeSig ?? s.timeSig,
      capo: o.capo,
      preferences: {
        ...(s.preferences ?? {}),
        transposeSteps: o.transpose,
      },
    } : s;
    loadSong(merged);
  }, [currentItem?.id, currentItem?.overrides?.transpose, currentItem?.overrides?.capo]);

  // Persist transpose/capo edits via the provided callback. The value check
  // prevents redundant writes triggered by loadSong syncing player state to
  // match the item.
  useEffect(() => {
    if (!onOverridesChange) return;
    return usePlayerStore.subscribe((state, prev) => {
      if (state.transposeSteps === prev.transposeSteps && state.capo === prev.capo) return;
      const item = items[activeIndex];
      if (!item || item.type !== 'song') return;
      const o = item.overrides;
      if (o && state.transposeSteps === o.transpose && state.capo === o.capo) return;
      onOverridesChange(item.id, { transpose: state.transposeSteps, capo: state.capo });
    });
  }, [onOverridesChange, items, activeIndex]);

  // Keyboard navigation.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goNext();
      if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, goNext, goPrev]);

  // Fullscreen on mount.
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  if (total === 0) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)', color: 'var(--text-muted)', zIndex: 100 }}>
        {emptyState ?? <p>Nothing to perform.</p>}
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-lg" style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>Back</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--bg)', zIndex: 100 }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 flex-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]">
          <X size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>

        <div
          className="flex items-center gap-2 font-semibold"
          style={{ color: 'var(--text-primary)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
        >
          {icon}
          <span>{svs.titleUppercase ? title : toTitleCase(title)}</span>
        </div>
        <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>
          {activeIndex + 1} / {total}
        </span>

        <div className="flex gap-1 mx-2">
          <button onClick={goPrev} disabled={activeIndex === 0} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <button onClick={goNext} disabled={activeIndex >= total - 1} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Song-only controls — dimmed & non-interactive when a note is active. */}
        <div
          className="flex items-center gap-3 flex-wrap"
          style={{
            opacity: isNoteActive ? 0.35 : 1,
            pointerEvents: isNoteActive ? 'none' : undefined,
          }}
          aria-disabled={isNoteActive}
          title={isNoteActive ? 'Not available on a note entry' : undefined}
        >
          <TransposeControl />
          <div className="ml-2"><AutoScrollControl /></div>

          {/* Metronome */}
          {activeSong?.tempo && (
            <div className="flex items-center gap-2">
              <button
                onClick={metronome.toggle}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors"
                style={{ background: metronome.isPlaying ? 'var(--accent)' : 'var(--surface-elevated)', color: metronome.isPlaying ? 'white' : 'var(--text-secondary)' }}
                title={`Metronome — ${Math.round(activeSong.tempo * tempoMultiplier)} BPM, ${activeSong.timeSig ?? '4/4'}`}
              >
                <Timer size={13} />
                <span>{Math.round(activeSong.tempo * tempoMultiplier)}</span>
              </button>
              {/* Half / double time */}
              <div className="flex items-center rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {([0.5, 1, 2] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTempoMultiplier(m)}
                    className="px-1.5 py-1 text-[10px] font-mono"
                    style={{
                      background: tempoMultiplier === m ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: tempoMultiplier === m ? 'white' : 'var(--text-muted)',
                    }}
                    title={m === 0.5 ? 'Half-time' : m === 2 ? 'Double-time' : 'Normal tempo'}
                  >
                    {m === 0.5 ? '½×' : m === 2 ? '2×' : '1×'}
                  </button>
                ))}
              </div>
              {metronome.isPlaying && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: metronome.beatsPerMeasure }, (_, i) => (
                    <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i === metronome.currentBeat ? (i === 0 ? 'var(--accent)' : 'var(--chord-color)') : 'var(--border)', transition: 'background 0.05s' }} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lyrics-only */}
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
            const inlineEffective = inlineDiagrams && instrument !== 'piano';
            const disabled = viewMode === 'lyrics-only' || inlineEffective;
            const on = chordBarVisible && !disabled;
            return (
              <button
                onClick={() => setChordBarVisible((v) => !v)}
                disabled={disabled}
                className="p-1.5 rounded-md"
                style={{ background: on ? 'var(--accent)' : 'var(--surface-elevated)', color: on ? 'white' : 'var(--text-muted)', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                title={disabled ? 'Unavailable while inline diagrams or lyrics-only is on' : (on ? 'Hide chord diagrams bar' : 'Show chord diagrams bar')}
              >
                <Guitar size={14} />
              </button>
            );
          })()}
          {/* Inline diagrams (disabled for piano — keyboard shapes don't fit cleanly inline). */}
          {(() => {
            const isPiano = instrument === 'piano';
            const disabled = viewMode === 'lyrics-only' || chordBarVisible || isPiano;
            const on = inlineDiagrams && !disabled;
            const reason = isPiano
              ? 'Inline diagrams are unavailable for piano'
              : 'Unavailable while chord bar or lyrics-only is on';
            return (
              <button
                onClick={() => void updateSetting(db, 'inlineChordDiagrams', !inlineDiagrams)}
                disabled={disabled}
                className="p-1.5 rounded-md"
                style={{ background: on ? 'var(--accent)' : 'var(--surface-elevated)', color: on ? 'white' : 'var(--text-muted)', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                title={disabled ? reason : (on ? 'Hide inline chord diagrams' : 'Show inline chord diagrams')}
              >
                <LayoutGrid size={14} />
              </button>
            );
          })()}
        </div>

        {/* Song notes — shown right of the inline-diagrams toggle, always reachable. */}
        {activeSong && !isNoteActive && activeSong.notes && activeSong.notes.trim() && (
          <button
            onClick={() => setShowSongNotes((v) => !v)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]"
            style={{ background: showSongNotes ? 'var(--surface-elevated)' : undefined }}
            title={showSongNotes ? 'Hide song notes' : 'Show song notes'}
          >
            <StickyNote size={16} style={{ color: 'var(--accent)' }} />
          </button>
        )}

        {/* Next-item hint + indicator dots — stacked so dots sit below. */}
        <div className="ml-auto flex flex-col items-start gap-1">
          {(() => {
            const nextItem = items[activeIndex + 1];
            if (!nextItem) {
              const raw = 'Last song — end of set list';
              return (
                <span
                  className="text-xs italic"
                  style={{ color: 'var(--text-muted)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
                >
                  {svs.titleUppercase ? raw : toTitleCase(raw)}
                </span>
              );
            }
            const label = nextItem.type === 'note'
              ? (nextItem.noteTitle?.trim() || 'Note')
              : (nextItem.song ? (svs.titleUppercase ? nextItem.song.title : toTitleCase(nextItem.song.title)) : '');
            return (
              <span
                className="text-xs truncate max-w-xs"
                style={{ color: 'var(--text-muted)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
              >
                Next: <strong style={{ color: 'var(--text-secondary)' }}>{label}</strong>
              </span>
            );
          })()}
          <div className="flex gap-1 items-center">
            {items.map((it, i) => {
              const active = i === activeIndex;
              const isNote = it.type === 'note';
              const tip = isNote
                ? (it.noteTitle?.trim() || 'Note')
                : (it.song?.title ?? 'Song');
              if (isNote) {
                return (
                  <button
                    key={it.id}
                    onClick={() => setActiveIndex(i)}
                    className="w-2 h-2 transition-colors"
                    style={{
                      background: active ? 'var(--accent)' : 'transparent',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--text-muted)'}`,
                      borderRadius: 2,
                    }}
                    title={tip}
                  />
                );
              }
              return (
                <button
                  key={it.id}
                  onClick={() => setActiveIndex(i)}
                  className="w-2 h-2 rounded-full transition-colors"
                  style={{ background: active ? 'var(--accent)' : 'var(--border)' }}
                  title={tip}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Chord bar — top */}
      {chordBarVisible && chordBarPosition === 'top' && displayedSong && !isNoteActive && (
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={activeSong?.preferences?.chordVariations} />
      )}

      {/* Main content + optional right-side chord bar */}
      <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-16 py-10" {...swipe}>
          {isNoteActive ? (
            <div
              key={currentItem!.id}
              className={navDirection === 'next' ? 'song-slide-next' : 'song-slide-prev'}
              style={{ zoom: perfZoom, maxWidth: '80ch', marginLeft: 'auto', marginRight: 'auto' }}
            >
              {currentItem!.noteTitle?.trim() && (
                <h2
                  className="font-bold mb-6"
                  style={{
                    color: svs.title.color || 'var(--accent)',
                    fontSize: svs.title.fontSize || undefined,
                    fontFamily: svs.fontFamily || undefined,
                    textTransform: svs.titleUppercase ? 'uppercase' : undefined,
                    textAlign: 'center',
                  }}
                >
                  {currentItem!.noteTitle}
                </h2>
              )}
              <div
                className="whitespace-pre-wrap"
                style={{
                  color: svs.lyrics.color || 'var(--text-primary)',
                  fontSize: (svs.lyrics.fontSize || fontSize + 2) + 2,
                  fontFamily: svs.fontFamily || undefined,
                  lineHeight: 1.7,
                }}
              >
                {currentItem!.noteBody ?? ''}
              </div>
            </div>
          ) : (
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
          )}
          {!isNoteActive && (
            <BottomSectionSpacer scrollRef={scrollRef} recomputeKey={`${perfZoom}|${viewMode}|${activeSong?.id}`} />
          )}
        </div>
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && !isNoteActive && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={activeSong?.preferences?.chordVariations} />
        )}
      </div>

      {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && !isNoteActive && (
        <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={activeSong?.preferences?.chordVariations} />
      )}

      {showSongNotes && activeSong && !isNoteActive && (
        <StickyNotePanel
          title={activeSong.title}
          notes={activeSong.notes ?? ''}
          onClose={() => setShowSongNotes(false)}
          onSave={async (next) => { await updateSongInStore(db, activeSong.id, { notes: next }); }}
        />
      )}

      {/* Floating "back to top" button — bottom-right of the perform view,
          only when the user has scrolled to the bottom. */}
      {atBottom && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors"
          style={{ background: 'var(--accent)', color: 'white', zIndex: 60 }}
          title="Back to top"
          aria-label="Back to top"
        >
          <ArrowUp size={18} />
        </button>
      )}

      {displayedSong && !isNoteActive && (
        <SectionNavigator
          song={displayedSong}
          scrollRef={scrollRef}
          recomputeKey={`${perfZoom}|${viewMode}|${activeSong?.id}`}
        />
      )}
    </div>
  );
}
