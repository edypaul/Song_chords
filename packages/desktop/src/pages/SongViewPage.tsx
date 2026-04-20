import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit2, ArrowLeft, X, Play, Square, Pause, Timer, Guitar, LayoutGrid, FileText, Maximize, Minimize, StickyNote, ListMusic, Star } from 'lucide-react';
import { useSongStore, usePlayerStore, useSettingsStore, useSetListStore, SONG_STYLE_PRESETS, getDiagramExact, getDiagramVariations } from '@song-chords/shared';
import SongRenderer from '../components/song/SongRenderer';
import SongDetails from '../components/song/SongDetails';
import AutoScrollControl from '../components/controls/AutoScrollControl';
import ChordDiagramBar from '../components/chord-diagram/ChordDiagramBar';
import ChordDiagramSVG from '../components/chord-diagram/ChordDiagramSVG';
import ChordForm from '../components/chord-diagram/ChordForm';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { useMetronome } from '../hooks/useMetronome';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';
import { db } from '../ipc/ipc-client';
import type { ViewMode } from '@song-chords/shared';
import { toTitleCase } from '../utils/text';

export default function SongViewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entryId = searchParams.get('entry');
  const favoriteFlag = searchParams.get('favorite') === '1';

  // Subscribe only to the specific song by ID — not the whole songs array.
  // This avoids re-rendering when unrelated songs change.
  const songFromStore = useSongStore((s) => s.songs.find((song) => song.id === id));
  const savePreferences = useSongStore((s) => s.savePreferences);

  // Setlist-entry context: when navigated from a setlist, transpose/capo
  // changes must save to the entry, not the song.
  const setlistEntry = useSetListStore((s) =>
    entryId ? s.activeSetList?.entries.find((e) => e.id === entryId) : undefined,
  );
  const activeSetListName = useSetListStore((s) => (entryId ? s.activeSetList?.name : undefined));
  const activeSetListId = useSetListStore((s) => (entryId ? s.activeSetList?.id : undefined));
  const updateEntry = useSetListStore((s) => s.updateEntry);
  const inEntryContext = !!setlistEntry;

  // Favorite-entry context: when navigated with ?favorite=1 for a favorited
  // song, transpose/capo changes save to the favorite entry instead of the
  // song. Setlist context takes precedence if both are somehow present.
  const favoriteEntry = useSongStore((s) => (id ? s.favoriteEntries[id] : undefined));
  const updateFavoriteEntry = useSongStore((s) => s.updateFavoriteEntry);
  const inFavoriteContext = !inEntryContext && favoriteFlag && !!favoriteEntry;

  // Individual player-store selectors — each re-renders only when its slice changes.
  const loadSong = usePlayerStore((s) => s.loadSong);
  const displayedSong = usePlayerStore((s) => s.displayedSong);
  const activeSong = usePlayerStore((s) => s.activeSong);
  const transposeSteps = usePlayerStore((s) => s.transposeSteps);
  const transposeUp = usePlayerStore((s) => s.transposeUp);
  const transposeDown = usePlayerStore((s) => s.transposeDown);
  const resetTranspose = usePlayerStore((s) => s.resetTranspose);
  const capo = usePlayerStore((s) => s.capo);
  const setCapo = usePlayerStore((s) => s.setCapo);
  const fontSize = usePlayerStore((s) => s.fontSize);
  const setFontSize = usePlayerStore((s) => s.setFontSize);
  const viewMode = usePlayerStore((s) => s.viewMode);
  const setViewMode = usePlayerStore((s) => s.setViewMode);
  const autoScrollActive = usePlayerStore((s) => s.autoScrollActive);
  const toggleAutoScroll = usePlayerStore((s) => s.toggleAutoScroll);
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const perfRunning = usePlayerStore((s) => s.perfRunning);
  const perfPaused = usePlayerStore((s) => s.perfPaused);
  const storeEnterPerf = usePlayerStore((s) => s.enterPerformance);
  const storeExitPerf = usePlayerStore((s) => s.exitPerformance);
  const storePerfStart = usePlayerStore((s) => s.perfStart);
  const storePerfStop = usePlayerStore((s) => s.perfStop);
  const storePerfPause = usePlayerStore((s) => s.perfPause);
  const storePerfResume = usePlayerStore((s) => s.perfResume);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const customPresets = useSettingsStore((s) => s.settings.customPresets ?? {});
  const effectiveTheme = useEffectiveTheme();
  const perfZoom = useSettingsStore((s) => s.settings.perfZoom ?? 1);
  const songCentered = useSettingsStore((s) => s.settings.songCentered ?? false);
  const chordBarPosition = useSettingsStore((s) => s.settings.chordBarPosition ?? 'top');
  const inlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const accidentalMode = useSettingsStore((s) => s.settings.accidentalMode ?? 'auto');
  const refreshDisplayed = usePlayerStore((s) => s.refreshDisplayed);
  useEffect(() => { refreshDisplayed(); }, [accidentalMode, refreshDisplayed]);
  const showChordDiagrams = useSettingsStore((s) => s.settings.showChordDiagrams ?? true);
  const [chordBarVisible, setChordBarVisible] = useState(showChordDiagrams);
  // Sync with the global default when the setting changes
  useEffect(() => { setChordBarVisible(showChordDiagrams); }, [showChordDiagrams]);
  // Lyrics-only mode hides all chord diagrams: force the chord bar off and
  // clear the inline-diagrams setting when it's activated.
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
    }
  }, [viewMode]);
  // In-session performance-mode toggles (no longer persisted settings)
  const [perfMetroWanted, setPerfMetroWanted] = useState(true);
  const [perfScrollWanted, setPerfScrollWanted] = useState(true);
  const metronome = useMetronome(activeSong?.tempo ?? 120, activeSong?.timeSig ?? '4/4');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef as React.RefObject<HTMLElement>);

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    storeEnterPerf();
  };

  const exitPerformance = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (metronome.isPlaying) metronome.toggle();
    if (autoScrollActive) toggleAutoScroll();
    storeExitPerf();
  };

  const perfStart = () => {
    storePerfStart();
    if (perfMetroWanted && activeSong?.tempo && !metronome.isPlaying) metronome.toggle();
    if (perfScrollWanted && !usePlayerStore.getState().autoScrollActive) toggleAutoScroll();
  };

  const perfStop = () => {
    // storePerfStop already sets autoScrollActive=false synchronously,
    // so only stop the metronome and scroll to top here.
    storePerfStop();
    if (metronome.isPlaying) metronome.toggle();
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const perfPauseToggle = () => {
    if (perfPaused) {
      // Resume: start metronome and auto-scroll if they were enabled at Start.
      storePerfResume();
      if (perfMetroWanted && activeSong?.tempo && !metronome.isPlaying) metronome.toggle();
      if (perfScrollWanted && !usePlayerStore.getState().autoScrollActive) toggleAutoScroll();
    } else {
      // Pause: storePerfPause already clears autoScrollActive; just stop the metronome.
      storePerfPause();
      if (metronome.isPlaying) metronome.toggle();
    }
  };

  useEffect(() => {
    if (!songFromStore) return;
    if (setlistEntry) {
      // In setlist-entry context, load the song with the entry's saved
      // overrides applied so transpose/capo/key/etc. reflect the setlist state
      // without mutating the song itself.
      loadSong({
        ...songFromStore,
        key: setlistEntry.key ?? songFromStore.key,
        tempo: setlistEntry.tempo ?? songFromStore.tempo,
        timeSig: setlistEntry.timeSig ?? songFromStore.timeSig,
        capo: setlistEntry.capo,
        preferences: {
          ...(songFromStore.preferences ?? {}),
          transposeSteps: setlistEntry.transpose,
        },
      });
    } else if (inFavoriteContext && favoriteEntry) {
      // In favorites context (?favorite=1), same pattern as setlist entries —
      // overrides are applied but never mutate the song.
      loadSong({
        ...songFromStore,
        key: favoriteEntry.key ?? songFromStore.key,
        tempo: favoriteEntry.tempo ?? songFromStore.tempo,
        timeSig: favoriteEntry.timeSig ?? songFromStore.timeSig,
        capo: favoriteEntry.capo,
        preferences: {
          ...(songFromStore.preferences ?? {}),
          transposeSteps: favoriteEntry.transpose,
        },
      });
    } else {
      loadSong(songFromStore);
    }
  }, [songFromStore, loadSong, setlistEntry, inFavoriteContext, favoriteEntry]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (performanceMode) { exitPerformance(); return; }
        navigate(-1);
      }
      if (e.key === 'ArrowUp' && e.ctrlKey) usePlayerStore.getState().transposeUp();
      if (e.key === 'ArrowDown' && e.ctrlKey) usePlayerStore.getState().transposeDown();
    };
    const handleFsChange = () => {
      if (!document.fullscreenElement && usePlayerStore.getState().performanceMode) storeExitPerf();
    };
    window.addEventListener('keydown', handleKey);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, [navigate, performanceMode]);

  // Zoom: Ctrl+wheel (mouse/trackpad) + two-finger pinch (touch screens).
  // Listeners attach ONCE. The handlers read/write zoom via refs and batch
  // state updates via requestAnimationFrame so rapid wheel/pinch events
  // don't trigger per-event React re-renders of the song content.
  const currentZoomRef = useRef(1);
  const pendingZoomRef = useRef(1);
  const zoomRafRef = useRef<number | null>(null);
  const pinchBaseZoom = useRef(1);
  const pinchStartDist = useRef(0);

  // Keep the ref in sync when external zoom changes (e.g. reset button)
  currentZoomRef.current = zoomLevel;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const scheduleZoomUpdate = (next: number) => {
      pendingZoomRef.current = next;
      currentZoomRef.current = next;
      if (zoomRafRef.current !== null) return;
      zoomRafRef.current = requestAnimationFrame(() => {
        zoomRafRef.current = null;
        setZoomLevel(pendingZoomRef.current);
      });
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.min(2.5, Math.max(0.5, currentZoomRef.current - e.deltaY * 0.002));
      scheduleZoomUpdate(next);
    };

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist.current = dist(e.touches[0]!, e.touches[1]!);
        pinchBaseZoom.current = currentZoomRef.current;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist.current > 0) {
        e.preventDefault();
        const d = dist(e.touches[0]!, e.touches[1]!);
        const s = d / pinchStartDist.current;
        const next = Math.min(2.5, Math.max(0.5, pinchBaseZoom.current * s));
        scheduleZoomUpdate(next);
      }
    };
    const handleTouchEnd = () => { pinchStartDist.current = 0; };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  // Auto-save debounced. In setlist-entry context, transpose/capo save to the
  // entry (never mutating the song). Otherwise transpose/viewMode save to the
  // song as before. viewMode always saves to the song regardless of context.
  const prefSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTranspose = useRef(transposeSteps);
  const prevCapo = useRef(capo);
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (!activeSong) return;
    const tChanged = prevTranspose.current !== transposeSteps;
    const cChanged = prevCapo.current !== capo;
    const vChanged = prevViewMode.current !== viewMode;
    if (!tChanged && !cChanged && !vChanged) return;
    prevTranspose.current = transposeSteps;
    prevCapo.current = capo;
    prevViewMode.current = viewMode;
    if (prefSaveTimer.current) clearTimeout(prefSaveTimer.current);
    prefSaveTimer.current = setTimeout(() => {
      if (inEntryContext && setlistEntry) {
        // Only write if the new value actually differs from what's saved on
        // the entry — avoids redundant writes right after loadSong syncs the
        // player state to the entry.
        const needsEntryWrite =
          (tChanged && setlistEntry.transpose !== transposeSteps)
          || (cChanged && setlistEntry.capo !== capo);
        if (needsEntryWrite) {
          void updateEntry(db, setlistEntry.id, { transpose: transposeSteps, capo });
        }
        // viewMode is a per-song display preference — still save it to the
        // song so user's "lyrics only" toggle etc. stick across contexts.
        if (vChanged) {
          const latestSong = useSongStore.getState().songs.find((s) => s.id === activeSong.id);
          const existing = latestSong?.preferences ?? {};
          savePreferences(db, activeSong.id, { ...existing, viewMode });
        }
      } else if (inFavoriteContext && favoriteEntry) {
        const needsFavWrite =
          (tChanged && favoriteEntry.transpose !== transposeSteps)
          || (cChanged && favoriteEntry.capo !== capo);
        if (needsFavWrite) {
          void updateFavoriteEntry(db, favoriteEntry.songId, { transpose: transposeSteps, capo });
        }
        if (vChanged) {
          const latestSong = useSongStore.getState().songs.find((s) => s.id === activeSong.id);
          const existing = latestSong?.preferences ?? {};
          savePreferences(db, activeSong.id, { ...existing, viewMode });
        }
      } else {
        const latestSong = useSongStore.getState().songs.find((s) => s.id === activeSong.id);
        const existing = latestSong?.preferences ?? {};
        savePreferences(db, activeSong.id, { ...existing, transposeSteps, viewMode });
      }
    }, 600);
    return () => { if (prefSaveTimer.current) clearTimeout(prefSaveTimer.current); };
  }, [transposeSteps, capo, viewMode, inEntryContext, setlistEntry, inFavoriteContext, favoriteEntry]);

  if (!displayedSong || !activeSong) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
        Song not found
      </div>
    );
  }

  if (performanceMode) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
        {/* Performance top bar */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          {!perfRunning ? (
            <>
              {/* Pre-play toggles: metronome + auto-scroll */}
              <button
                onClick={() => setPerfMetroWanted((v) => !v)}
                disabled={!activeSong?.tempo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{
                  background: perfMetroWanted && activeSong?.tempo ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: perfMetroWanted && activeSong?.tempo ? 'white' : 'var(--text-muted)',
                  opacity: activeSong?.tempo ? 1 : 0.4,
                  cursor: activeSong?.tempo ? 'pointer' : 'not-allowed',
                }}
                title={activeSong?.tempo ? 'Metronome' : 'No tempo set for this song'}
              >
                <Timer size={13} /> Metronome
              </button>
              <button
                onClick={() => setPerfScrollWanted((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{
                  background: perfScrollWanted ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: perfScrollWanted ? 'white' : 'var(--text-muted)',
                }}
                title="Auto-scroll"
              >
                <Play size={13} /> Auto-scroll
              </button>
              <button
                onClick={perfStart}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <Play size={13} /> Play
              </button>
            </>
          ) : (
            <>
              {/* Running: only Pause (toggles Resume when paused) + Stop */}
              <button
                onClick={perfPauseToggle}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--surface-elevated)', color: perfPaused ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                {perfPaused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
              </button>
              <button
                onClick={perfStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--danger, #ef4444)', color: 'white' }}
              >
                <Square size={13} /> Stop
              </button>
            </>
          )}

          {/* Beat indicator */}
          {metronome.isPlaying && (
            <div className="flex items-center gap-1 ml-1">
              {Array.from({ length: metronome.beatsPerMeasure }, (_, i) => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: i === metronome.currentBeat
                    ? (i === 0 ? 'var(--accent)' : 'var(--chord-color)')
                    : 'var(--border)',
                  transition: 'background 0.05s',
                }} />
              ))}
            </div>
          )}

          {/* Exit */}
          <button onClick={exitPerformance} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ml-auto" style={{ color: 'var(--text-muted)' }} title="Exit performance mode (Esc)">
            <X size={13} /> Exit
          </button>
        </div>

        {/* Chord bar top (performance) */}
        {chordBarVisible && chordBarPosition === 'top' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="top" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}

        <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-8">
          <div style={{ zoom: perfZoom * zoomLevel, ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}) } as React.CSSProperties}>
          <div className="mb-6" style={songCentered ? { textAlign: 'center' } : undefined}>
            <h2 className="font-bold" style={{ color: svs.title.color || 'var(--text-primary)', fontSize: svs.title.fontSize || undefined, fontFamily: svs.fontFamily || undefined, textTransform: svs.titleUppercase ? 'uppercase' : undefined }}>{svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}</h2>
            {activeSong.artist && <p className="mt-1" style={{ color: svs.details.color || 'var(--text-secondary)', fontSize: svs.details.fontSize || undefined, fontFamily: svs.fontFamily || undefined }}>{activeSong.artist}</p>}
            <SongDetails centered={songCentered} />
          </div>
          <SongRenderer song={displayedSong} fontSize={svs.lyrics.fontSize || 16} viewMode={viewMode} onChordClick={(chord) => setSelectedChord(chord)} chordVariations={activeSong?.preferences?.chordVariations} />
          </div>
        </div>

        {/* Chord bar right (performance) */}
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}
        </div>

        {/* Chord bar bottom (performance) */}
        {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}

        {selectedChord && <ChordModal chord={selectedChord} onClose={() => setSelectedChord(null)} songId={activeSong?.id} songPrefs={activeSong?.preferences} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {inEntryContext && activeSetListName && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0 text-xs"
          style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--border)' }}
        >
          <ListMusic size={13} />
          <span>
            Editing this song <strong>for set list</strong>: {toTitleCase(activeSetListName)}. Transpose and capo save to the set list only.
          </span>
          {activeSetListId && (
            <button
              onClick={() => navigate(`/setlists/${activeSetListId}`)}
              className="ml-auto underline hover:no-underline"
            >
              Back to set list
            </button>
          )}
        </div>
      )}
      {inFavoriteContext && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0 text-xs"
          style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--border)' }}
        >
          <Star size={13} fill="currentColor" />
          <span>
            Editing this song <strong>for favorites</strong>. Transpose and capo save to the favorite only.
          </span>
          <button
            onClick={() => navigate('/favorites')}
            className="ml-auto underline hover:no-underline"
          >
            Back to favorites
          </button>
        </div>
      )}
      {/* Toolbar — wraps so that if the title block is wide the control cluster
         drops to a second line, leaving title + key alone on the first row.
         `min-w-0` + `overflow-hidden` guarantee nothing overflows horizontally. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 flex-wrap min-w-0 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        {/* Left block — back + title/artist + key. Full width on narrow
           screens (forces the control cluster onto its own row after the
           key); natural width above `lg` where there's room for everything
           side-by-side. */}
        <div className="flex items-center gap-3 min-w-0 w-full lg:w-auto">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors shrink-0"
          >
            <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <div className="flex flex-col min-w-0">
            <span
              className="font-semibold text-sm truncate"
              style={{ color: 'var(--text-primary)', textTransform: svs.titleUppercase ? 'uppercase' : undefined }}
            >
              {svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}
            </span>
            {activeSong.artist && (
              <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{toTitleCase(activeSong.artist)}</span>
            )}
          </div>

          {activeSong.key && (
            <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold shrink-0" style={{ background: 'var(--surface-elevated)', color: 'var(--chord-color)' }}>
              {activeSong.key}
            </span>
          )}
        </div>

        {/* Control cluster — full-width on its own row below `lg`; shares
           the title row with `flex-1` above `lg`. `flex-wrap` inside means
           individual controls still wrap to additional rows if the window
           is extremely narrow. All controls are left-aligned. */}
        <div className="flex items-center gap-3 flex-wrap min-w-0 justify-start w-full lg:flex-1">
        {/* Transpose */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={transposeDown}
            disabled={transposeSteps <= -11}
            className="px-1.5 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-secondary)', opacity: transposeSteps <= -11 ? 0.35 : 1, cursor: transposeSteps <= -11 ? 'not-allowed' : 'pointer' }}
            title="Transpose down"
          >−</button>
          <span className="text-xs w-6 text-center font-mono font-semibold" style={{ color: transposeSteps !== 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
            {transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}
          </span>
          <button
            onClick={transposeUp}
            disabled={transposeSteps >= 11}
            className="px-1.5 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]"
            style={{ color: 'var(--text-secondary)', opacity: transposeSteps >= 11 ? 0.35 : 1, cursor: transposeSteps >= 11 ? 'not-allowed' : 'pointer' }}
            title="Transpose up"
          >+</button>
          {transposeSteps !== 0 && (
            <button onClick={resetTranspose} className="px-1 py-1 text-xs rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }} title="Reset transpose">↺</button>
          )}
        </div>

        {/* Capo */}
        <select
          value={capo}
          onChange={(e) => setCapo(Number(e.target.value))}
          className="text-xs rounded px-1.5 py-1"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          title="Capo"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i}>{i === 0 ? 'No capo' : `Capo ${i}`}</option>
          ))}
        </select>

        <div className="w-px h-6 mx-1" style={{ background: 'var(--border)' }} />

        <AutoScrollControl />

        {activeSong?.tempo && (
          <div className="w-px h-6 mx-1" style={{ background: 'var(--border)' }} />
        )}

        <div className="flex items-center gap-2">
          {activeSong?.tempo && (
            <>
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
            </>
          )}

          {/* Zoom indicator */}
          <button
            onClick={() => setZoomLevel(1)}
            className="text-xs font-semibold px-2 py-1 rounded-md transition-colors"
            style={{
              background: zoomLevel !== 1 ? 'var(--accent)' : 'var(--surface-elevated)',
              color: zoomLevel !== 1 ? 'white' : 'var(--text-muted)',
              fontFamily: 'monospace',
              minWidth: 44,
              textAlign: 'center',
            }}
            title="Click to reset zoom (Ctrl+scroll to zoom)"
          >
            {Math.round(zoomLevel * 100)}%
          </button>

          {/* Lyrics-only toggle — placed right of the zoom indicator */}
          {(() => {
            const lyricsOnly = viewMode === 'lyrics-only';
            return (
              <button
                onClick={() => setViewMode(lyricsOnly ? 'chords' : 'lyrics-only')}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  background: lyricsOnly ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: lyricsOnly ? 'white' : 'var(--text-muted)',
                }}
                title={lyricsOnly ? 'Show chords' : 'Lyrics only'}
              >
                <FileText size={14} />
              </button>
            );
          })()}

          {/* Chord bar toggle (disabled when lyrics-only or inline diagrams is on) */}
          {(() => {
            const chordBarDisabled = viewMode === 'lyrics-only' || inlineDiagrams;
            const chordBarOn = chordBarVisible && !chordBarDisabled;
            return (
              <button
                onClick={() => setChordBarVisible((v) => !v)}
                disabled={chordBarDisabled}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  background: chordBarOn ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: chordBarOn ? 'white' : 'var(--text-muted)',
                  opacity: chordBarDisabled ? 0.4 : 1,
                  cursor: chordBarDisabled ? 'not-allowed' : 'pointer',
                }}
                title={chordBarDisabled ? 'Unavailable while inline diagrams or lyrics-only mode is on' : (chordBarOn ? 'Hide chord diagrams bar' : 'Show chord diagrams bar')}
              >
                <Guitar size={14} />
              </button>
            );
          })()}
          {/* Inline diagrams toggle (disabled when lyrics-only or chord bar is on) */}
          {(() => {
            const inlineDisabled = viewMode === 'lyrics-only' || chordBarVisible;
            const inlineOn = inlineDiagrams && !inlineDisabled;
            return (
              <button
                onClick={() => void updateSetting(db, 'inlineChordDiagrams', !inlineDiagrams)}
                disabled={inlineDisabled}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  background: inlineOn ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: inlineOn ? 'white' : 'var(--text-muted)',
                  opacity: inlineDisabled ? 0.4 : 1,
                  cursor: inlineDisabled ? 'not-allowed' : 'pointer',
                }}
                title={inlineDisabled ? 'Unavailable while chord bar or lyrics-only mode is on' : (inlineOn ? 'Hide inline chord diagrams' : 'Show inline chord diagrams')}
              >
                <LayoutGrid size={14} />
              </button>
            );
          })()}

          {/* Style preset selector */}
          <select
            value={svs.preset}
            onChange={(e) => {
              const key = e.target.value;
              const builtin = SONG_STYLE_PRESETS[key];
              if (builtin) { void updateSetting(db, 'songViewStyle', { ...builtin.style }); return; }
              const custom = customPresets[key];
              if (custom) { void updateSetting(db, 'songViewStyle', { ...custom.style }); return; }
            }}
            className="text-xs rounded px-1.5 py-1 transition-colors"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', maxWidth: 120 }}
            title="Song style preset"
          >
            <optgroup label={effectiveTheme === 'dark' ? 'Dark' : 'Light'}>
              {Object.entries(SONG_STYLE_PRESETS).filter(([, p]) => p.mode === effectiveTheme).map(([k, p]) => (
                <option key={k} value={k}>{p.name}</option>
              ))}
            </optgroup>
            {Object.entries(customPresets).filter(([, p]) => p.mode === effectiveTheme).length > 0 && (
              <optgroup label="My Presets">
                {Object.entries(customPresets).filter(([, p]) => p.mode === effectiveTheme).map(([k, p]) => (
                  <option key={k} value={k}>{p.name}</option>
                ))}
              </optgroup>
            )}
            {svs.preset === 'custom' && <option value="custom">Custom</option>}
          </select>

          {activeSong.notes && activeSong.notes.trim() && (
            <button
              onClick={() => setShowNotes(true)}
              className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
              title="Song notes"
            >
              <StickyNote size={16} style={{ color: 'var(--accent)' }} />
            </button>
          )}
          <button onClick={() => navigate(`/song/${id}/edit`)} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors" title="Edit song">
            <Edit2 size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

          <button
            onClick={enterFullscreen}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
            style={{ background: 'var(--accent)', color: 'white' }}
            title="Full Screen"
          >
            <Maximize size={13} />
          </button>
        </div>
      </div>

      {/* Chord bar top */}
      {chordBarVisible && chordBarPosition === 'top' && displayedSong && (
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {/* Content area — flex-row when chord bar is on the right */}
      <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        {/* Song content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-8">
          <div style={{ zoom: zoomLevel, ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}) } as React.CSSProperties}>
          {/* Title block */}
          <div className="mb-6" style={songCentered ? { textAlign: 'center' } : undefined}>
            <h2 className="font-bold" style={{ color: svs.title.color || 'var(--text-primary)', fontSize: svs.title.fontSize || undefined, fontFamily: svs.fontFamily || undefined, textTransform: svs.titleUppercase ? 'uppercase' : undefined }}>{svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}</h2>
            {activeSong.artist && <p className="mt-1" style={{ color: svs.details.color || 'var(--text-secondary)', fontSize: svs.details.fontSize || undefined, fontFamily: svs.fontFamily || undefined }}>{activeSong.artist}</p>}
            <SongDetails centered={songCentered} />
          </div>

          <SongRenderer
            song={displayedSong}
            fontSize={svs.lyrics.fontSize || 16}
            viewMode={viewMode}
            onChordClick={(chord) => setSelectedChord(chord)}
            chordVariations={activeSong?.preferences?.chordVariations}
          />
          </div>
        </div>

        {/* Chord bar right */}
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}
      </div>

      {/* Chord bar bottom */}
      {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && (
        <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={activeSong?.preferences?.chordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {/* Chord diagram panel (shown when chord is selected) */}
      {selectedChord && (
        <ChordModal chord={selectedChord} onClose={() => setSelectedChord(null)} songId={activeSong?.id} songPrefs={activeSong?.preferences} />
      )}

      {/* Song-notes modal */}
      {showNotes && activeSong.notes && (
        <NotesModal title={activeSong.title} notes={activeSong.notes} onClose={() => setShowNotes(false)} />
      )}
    </div>
  );
}

function NotesModal({ title, notes, onClose }: { title: string; notes: string; onClose: () => void }): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border flex flex-col max-h-[70vh]"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <StickyNote size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notes — {title}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface-elevated)]" title="Close">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div
          className="p-5 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
        >
          {notes}
        </div>
      </div>
    </div>
  );
}


function ChordModal({ chord, onClose, songId, songPrefs }: {
  chord: string; onClose: () => void; songId?: string; songPrefs?: import('@song-chords/shared').SongPreferences;
}): React.ReactElement {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const { updateSetting } = useSettingsStore();
  const savePrefs = useSongStore((s) => s.savePreferences);
  const strings = instrument === 'guitar' ? 6 : 4;
  const emptyDiag = { name: chord, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as ('x')[] };

  const variations = getDiagramVariations(chord, instrument, custom);
  const hasDiagram = variations.length > 0;
  const allDiags = hasDiagram ? variations : [emptyDiag];
  const savedIdx = songPrefs?.chordVariations?.[chord] ?? 0;
  const [currentIdx, setCurrentIdx] = useState(Math.min(savedIdx, allDiags.length - 1));
  const [creatingCustom, setCreatingCustom] = useState(false);

  const diag = allDiags[currentIdx] ?? allDiags[0]!;
  const isRemembered = savedIdx === currentIdx && songPrefs?.chordVariations?.[chord] !== undefined;

  const saveCustomDiagram = (d: import('@song-chords/shared').ChordDiagram) => {
    const existing = { ...custom };
    existing[chord] = [...(existing[chord] ?? []), d];
    void updateSetting(db, 'customChords', existing);
    setCreatingCustom(false);
  };

  const handleRemember = () => {
    if (!songId) return;
    const existing = songPrefs?.chordVariations ?? {};
    const updated = { ...existing, [chord]: currentIdx };
    const newPrefs = { ...songPrefs, chordVariations: updated };
    void savePrefs(db, songId, newPrefs);
    // Update the player store's activeSong so the UI refreshes immediately
    const active = usePlayerStore.getState().activeSong;
    if (active && active.id === songId) {
      usePlayerStore.setState({ activeSong: { ...active, preferences: newPrefs } });
    }
  };

  const prev = () => setCurrentIdx((i) => (i > 0 ? i - 1 : allDiags.length - 1));
  const next = () => setCurrentIdx((i) => (i < allDiags.length - 1 ? i + 1 : 0));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 240, maxWidth: 860 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative mb-3">
          <span className="block text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>{chord}</span>
          <button onClick={onClose} className="absolute top-0 right-0 text-sm px-2 py-1 rounded hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {creatingCustom && (
          <ChordForm instrument={instrument} initialName={chord} nameDisabled hideNameInPreview
            onSave={saveCustomDiagram} onCancel={() => setCreatingCustom(false)} />
        )}

        {/* Diagram slider */}
        <div className="flex items-center gap-2">
          {allDiags.length > 1 && (
            <button onClick={prev} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)' }}>‹</button>
          )}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div key={currentIdx} className="chord-slide">
              <ChordDiagramSVG diagram={diag} width={180}
                lineColor={svs.lyrics.color || undefined} chordColor={svs.chords.color || undefined} hideName />
            </div>
          </div>
          {allDiags.length > 1 && (
            <button onClick={next} className="p-2 rounded-lg hover:bg-[var(--surface-elevated)]" style={{ color: 'var(--text-secondary)' }}>›</button>
          )}
        </div>

        {!hasDiagram && !creatingCustom && (
          <div className="flex flex-col items-center gap-2 mt-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No diagram found for this chord.</span>
            <button
              onClick={() => setCreatingCustom(true)}
              className="text-xs px-3 py-1 rounded-md transition-colors"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Create custom diagram
            </button>
          </div>
        )}

        {/* Dots + controls */}
        {allDiags.length > 1 && (
          <div className="flex flex-col items-center gap-2 mt-3">
            {/* Dot indicators */}
            <div className="flex gap-1.5">
              {allDiags.map((_, i) => (
                <button key={i} onClick={() => setCurrentIdx(i)}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: i === currentIdx ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer' }} />
              ))}
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Variation {currentIdx + 1} of {allDiags.length}
            </span>
            {/* Remember button */}
            {songId && (
              <button
                onClick={handleRemember}
                className="text-xs px-3 py-1 rounded-md transition-colors"
                style={{
                  background: isRemembered ? 'var(--surface-elevated)' : 'var(--accent)',
                  color: isRemembered ? 'var(--text-muted)' : 'white',
                }}
              >
                {isRemembered ? 'Remembered ✓' : 'Remember for this song'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
