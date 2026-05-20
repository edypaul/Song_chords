import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit2, ArrowLeft, X, Play, Square, Pause, Timer, Guitar, LayoutGrid, FileText, Maximize, Minimize, StickyNote, ListMusic, Star, Download, ArrowUp, MoreVertical } from 'lucide-react';
import { useSongStore, usePlayerStore, useSettingsStore, useSetListStore, SONG_STYLE_PRESETS, getDiagramExact, getDiagramVariations, formatKey, formatChord, resolveChordVariation } from '@song-chords/shared';
import SongRenderer from '../components/song/SongRenderer';
import SongDetails from '../components/song/SongDetails';
import AutoScrollControl from '../components/controls/AutoScrollControl';
import MetronomeControl from '../components/controls/MetronomeControl';
import ChordDiagramBar from '../components/chord-diagram/ChordDiagramBar';
import { useEffectiveChordVariations } from '../hooks/useEffectiveChordVariations';
import ChordDiagramSVG from '../components/chord-diagram/ChordDiagramSVG';
import ChordForm from '../components/chord-diagram/ChordForm';
import SongExportModal from '../components/song/SongExportModal';
import SetListPickerModal from '../components/song/SetListPickerModal';
import StickyNotePanel from '../components/song/StickyNotePanel';
import SectionNavigator from '../components/song/SectionNavigator';
import BottomSectionSpacer from '../components/song/BottomSectionSpacer';
import CastQuickButton from '../components/song/CastQuickButton';
import PlayLinkButton from '../components/song/PlayLinkButton';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { useMetronome } from '../hooks/useMetronome';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
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
  const updateSongInStore = useSongStore((s) => s.updateSong);
  const markSongViewed = useSongStore((s) => s.markSongViewed);

  // Stamp the view timestamp once per song open so the Dashboard's
  // "Recently viewed" list reflects what the user actually opens.
  useEffect(() => {
    if (id) void markSongViewed(db, id);
  }, [id]);

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
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  // Merged chord-variation map (per-song overrides win over the global
  // default for this instrument). Pass this to every renderer instead
  // of the raw per-song map so the Chord-Library "Set as default for
  // all songs" voicings reach the rendered diagrams.
  const effectiveChordVariations = useEffectiveChordVariations(instrument);
  const accidentalMode = useSettingsStore((s) => s.settings.accidentalMode ?? 'auto');
  const chordNotation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
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
  // Half / double-time multiplier — applies to the metronome only,
  // never the stored song tempo. Resets to 1× when the user opens a
  // different song so the new song starts at its natural BPM. Mirrors
  // the same control on the Perform page.
  const [tempoMultiplier, setTempoMultiplier] = useState<0.5 | 1 | 2>(1);
  useEffect(() => { setTempoMultiplier(1); }, [activeSong?.id]);
  const baseTempo = activeSong?.tempo ?? 120;
  const metronome = useMetronome(Math.round(baseTempo * tempoMultiplier), activeSong?.timeSig ?? '4/4');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  // Auto-open the sticky note when a song that has notes becomes active.
  // Runs on song change so switching songs refreshes the visibility.
  useEffect(() => {
    setShowNotes(!!activeSong?.notes && activeSong.notes.trim().length > 0);
  }, [activeSong?.id, activeSong?.notes]);
  const [showExport, setShowExport] = useState(false);
  const [showSetListPicker, setShowSetListPicker] = useState(false);
  // Three-dots "more" menu — collects the actions that aren't useful
  // during live performance (style preset, favorite, set-list, export,
  // notes, audio link, edit) so the main toolbar stays uncluttered.
  // The menu is portaled into <body> because the toolbar container has
  // `overflow: hidden`, which would otherwise clip the absolute-
  // positioned dropdown. `moreMenuPos` tracks the screen-space anchor
  // computed from the trigger button's bounding rect.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!moreMenuOpen) return;
    const place = () => {
      const btn = moreMenuTriggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMoreMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [moreMenuOpen]);
  useEffect(() => {
    if (!moreMenuOpen) return;
    // Use `click` (not `mousedown`) so a click on a menu item's
    // button has a chance to run its own onClick handler before the
    // menu unmounts. mousedown fires earlier than click, and the
    // CastQuickButton inside the menu relies on its own click handler
    // to open its popover — closing the menu on mousedown would
    // unmount CastQuickButton before the click reaches it.
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreMenuRef.current && moreMenuRef.current.contains(t)) return;
      if (moreMenuTriggerRef.current && moreMenuTriggerRef.current.contains(t)) return;
      // The cast popover portals to <body>, OUTSIDE the menu. Any
      // click inside an element with [data-cast-popover] (the popover
      // root) should keep the menu open so the user can interact with
      // the popover without it disappearing under them.
      if ((t as HTMLElement).closest?.('[data-cast-popover]')) return;
      setMoreMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [moreMenuOpen]);
  const toggleFavorite = useSongStore((s) => s.toggleFavorite);
  const addSongToSetList = useSetListStore((s) => s.addSongToSetList);

  // User-configurable keyboard shortcuts. Each handler mirrors what clicking
  // the equivalent UI control does — transposes, toggles, capo set, export /
  // edit navigation, and zoom.
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
    toggleSongNotes:      () => { if (activeSong?.notes?.trim()) setShowNotes((v) => !v); },
    toggleAutoScroll:     () => toggleAutoScroll(),
    transposeUp:          () => transposeUp(),
    transposeDown:        () => transposeDown(),
    resetTranspose:       () => resetTranspose(),
    exportSong:           () => setShowExport(true),
    editSong:             () => { if (id) navigate(`/song/${id}/edit`); },
    toggleFavorite:       () => { if (activeSong) void toggleFavorite(db, activeSong.id); },
    cast:                 () => {
      // CastQuickButton encapsulates its own popover state; the
      // simplest cross-component trigger is to click its rendered
      // icon (title="Cast"). It sits inside the More menu's
      // .cast-menu-row, so we scope the query to that container
      // when the menu's open OR fall back to a global lookup.
      const btn = document.querySelector('button[title="Cast"]') as HTMLButtonElement | null;
      btn?.click();
    },
    addToSetList:         () => setShowSetListPicker(true),
    toggleFullscreen:     () => { if (performanceMode) exitPerformance(); else enterFullscreen(); },
    zoomIn:               () => setZoomLevel((z) => Math.min(z + 0.1, 3)),
    zoomOut:              () => setZoomLevel((z) => Math.max(z - 0.1, 0.5)),
    zoomReset:            () => setZoomLevel(1),
    onCapo:               (fret) => setCapo(fret),
  });
  // Tracks whether the perf-mode scroll container is at (or very near) the
  // bottom of the song — drives the visibility of the floating back-to-top
  // button.
  const [atBottom, setAtBottom] = useState(false);
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
    // Flip the store state — the transition effect below silences the
    // metronome. The scroll-to-top is scoped to this button so that
    // auto-scroll hitting the bottom leaves the page where it is (the
    // floating arrow covers that case).
    storePerfStop();
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // When performance mode STOPS (either manually or when auto-scroll hits
  // the bottom), silence the metronome. Scrolling back to the top is now a
  // deliberate action via the floating "go to top" button, not automatic.
  const prevPerfRunningRef = useRef(perfRunning);
  useEffect(() => {
    const was = prevPerfRunningRef.current;
    prevPerfRunningRef.current = perfRunning;
    if (was && !perfRunning && metronome.isPlaying) metronome.toggle();
  }, [perfRunning, metronome]);

  // Track whether the scroll container is at the bottom, so the floating
  // "Back to top" button can appear only when there's actually something
  // to scroll back up from. Applies to both the normal view and the
  // full-screen perf view — both branches mount to the same scrollRef.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { setAtBottom(false); return; }
    const update = () => {
      const total = el.scrollHeight - el.clientHeight;
      setAtBottom(total > 0 && el.scrollTop >= total - 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [performanceMode, displayedSong?.rawContent]);

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
      // Escape is the only hardcoded key here — it's a universal
      // "exit/back" gesture that we don't want users to be able to
      // re-bind (Esc is the page-close pact across every modal /
      // panel). All other keys flow through the configurable
      // useKeyboardShortcuts system above, including F for the
      // fullscreen toggle.
      if (e.key === 'Escape') {
        if (performanceMode) { exitPerformance(); return; }
        navigate(-1);
        return;
      }
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
    // Re-run when the scroll element actually exists. On a COLD first
    // visit the song loads asynchronously, so this component first
    // renders the "Song not found" placeholder (no scrollRef element)
    // and only later re-renders with the real content + the
    // `<div ref={scrollRef}>`. With `[]` deps the effect ran once
    // against a null ref, bailed, and never re-bound — so zoom was
    // dead until the page was remounted (second visit, song already
    // cached). Keying on song readiness (the exact condition that
    // gates whether the scroll div is rendered, in BOTH the normal
    // and performance-mode branches) makes the effect re-run and bind
    // the wheel/pinch listeners as soon as the element mounts.
  }, [displayedSong, activeSong, performanceMode]);

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
        // Capo lives on the song row (not in preferences) — persist it too so
        // that when the loadSong effect re-runs after savePreferences writes,
        // it reads the fresh capo instead of overwriting the user's change
        // with the song's stale original value.
        if (cChanged && latestSong && latestSong.capo !== capo) {
          void updateSongInStore(db, activeSong.id, { capo });
        }
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

          {/* Audio source + Cast (full-screen perf) */}
          <div className="ml-auto flex items-center gap-1">
            <PlayLinkButton title={activeSong.title} link={activeSong.link} audioFile={activeSong.audioFile} size="md" />
            <CastQuickButton />
          </div>

          {/* Exit */}
          <button onClick={exitPerformance} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)' }} title="Exit performance mode (Esc)">
            <X size={13} /> Exit
          </button>
        </div>

        {/* Chord bar top (performance) */}
        {chordBarVisible && chordBarPosition === 'top' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="top" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}

        <div className="flex-1 flex min-h-0" style={{ flexDirection: chordBarVisible && chordBarPosition === 'right' ? 'row' : 'column' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-8">
          <div style={{ zoom: perfZoom * zoomLevel, ...(songCentered ? { width: 'fit-content', maxWidth: '100%', marginLeft: 'auto', marginRight: 'auto' } : {}) } as React.CSSProperties}>
          <div className="mb-6" style={songCentered ? { textAlign: 'center' } : undefined}>
            <h2 className="font-bold" style={{ color: svs.title.color || 'var(--text-primary)', fontSize: svs.title.fontSize || undefined, fontFamily: svs.fontFamily || undefined, textTransform: svs.titleUppercase ? 'uppercase' : undefined }}>{svs.titleUppercase ? activeSong.title : toTitleCase(activeSong.title)}</h2>
            {activeSong.artist && <p className="mt-1" style={{ color: svs.details.color || 'var(--text-secondary)', fontSize: svs.details.fontSize || undefined, fontFamily: svs.fontFamily || undefined }}>{activeSong.artist}</p>}
            <SongDetails centered={songCentered} />
          </div>
          <SongRenderer song={displayedSong} fontSize={svs.lyrics.fontSize || 16} viewMode={viewMode} onChordClick={(chord) => setSelectedChord(chord)} chordVariations={effectiveChordVariations} />
          </div>
          <BottomSectionSpacer scrollRef={scrollRef} recomputeKey={`${perfZoom}|${zoomLevel}|${viewMode}`} />
        </div>

        {/* Chord bar right (performance) */}
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}
        </div>

        {/* Chord bar bottom (performance) */}
        {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}

        {/* Floating "back to top" button — bottom-right of the perf view,
            shown only when the user has scrolled all the way down. */}
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

        <SectionNavigator
          song={displayedSong}
          scrollRef={scrollRef}
          recomputeKey={`${perfZoom}|${zoomLevel}|${viewMode}`}
        />

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
              {formatKey(activeSong.key, chordNotation)}
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
            <MetronomeControl
              tempo={activeSong.tempo}
              timeSig={activeSong.timeSig}
              isPlaying={metronome.isPlaying}
              currentBeat={metronome.currentBeat}
              beatsPerMeasure={metronome.beatsPerMeasure}
              tempoMultiplier={tempoMultiplier}
              onToggle={metronome.toggle}
              onMultiplierChange={setTempoMultiplier}
            />
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

          {/* Mutually-exclusive view toggle: Lyrics-only / Chord-bar /
              Inline-diagrams. Acts like a 3-position nav — clicking any
              button activates that mode and deactivates the others.
              None of the buttons disable themselves; the only exception
              is inline-diagrams when the instrument is piano (those
              shapes are too wide to read inline). */}
          {(() => {
            const isPiano = instrument === 'piano';
            const lyricsOnly = viewMode === 'lyrics-only';
            const inlineOn = !lyricsOnly && !chordBarVisible && inlineDiagrams && !isPiano;
            const chordBarOn = !lyricsOnly && chordBarVisible && !inlineOn;
            const activateLyricsOnly = () => {
              // Toggle off when already active — drops back to the
              // default chord-over-lyric view. Otherwise activate it
              // and clear the other two modes.
              if (lyricsOnly) { setViewMode('chords'); return; }
              setViewMode('lyrics-only');
              if (chordBarVisible) setChordBarVisible(false);
              if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
            };
            const activateChordBar = () => {
              // Toggle off when already active; otherwise activate and
              // clear the other two modes.
              if (chordBarOn) { setChordBarVisible(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', false);
              setChordBarVisible(true);
            };
            const activateInline = () => {
              if (isPiano) return;
              // Toggle off when already active; otherwise activate and
              // clear the other two modes.
              if (inlineOn) { void updateSetting(db, 'inlineChordDiagrams', false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (chordBarVisible) setChordBarVisible(false);
              if (!inlineDiagrams) void updateSetting(db, 'inlineChordDiagrams', true);
            };
            const btnStyle = (active: boolean, faded: boolean) => ({
              background: active ? 'var(--accent)' : 'var(--surface-elevated)',
              color: active ? 'white' : 'var(--text-muted)',
              opacity: faded ? 0.4 : 1,
              cursor: faded ? 'not-allowed' : 'pointer',
            });
            return (
              <>
                <button
                  onClick={activateLyricsOnly}
                  className="p-1.5 rounded-md transition-colors"
                  style={btnStyle(lyricsOnly, false)}
                  title={lyricsOnly ? 'Show chord names' : 'Show lyrics only'}
                >
                  <FileText size={14} />
                </button>
                <button
                  onClick={activateChordBar}
                  className="p-1.5 rounded-md transition-colors"
                  style={btnStyle(chordBarOn, false)}
                  title={chordBarOn ? 'Hide chord diagrams bar' : 'Show chord diagrams bar'}
                >
                  <Guitar size={14} />
                </button>
                <button
                  onClick={activateInline}
                  disabled={isPiano}
                  className="p-1.5 rounded-md transition-colors"
                  style={btnStyle(inlineOn, isPiano)}
                  title={isPiano
                    ? 'Inline diagrams are unavailable for piano'
                    : (inlineOn ? 'Hide inline chord diagrams' : 'Show inline chord diagrams')}
                >
                  <LayoutGrid size={14} />
                </button>
              </>
            );
          })()}

          {/* Play link / audio file — kept in the main bar because it's
              a one-tap action used live (start the song's reference
              audio or open the source link). PlayLinkButton renders
              nothing when the song has neither a link nor an audio
              file, so it's safe to leave unconditional. */}
          <PlayLinkButton title={activeSong.title} link={activeSong.link} audioFile={activeSong.audioFile} size="md" />

          {/* Cast was moved into the three-dots menu (below) — it's
              still a one-tap action once the menu is open, but it
              doesn't need to sit in the live-performance toolbar. */}

          {/* Song notes toggle lives in the three-dots menu — keeping it
              out of the main bar keeps the live-performance surface
              from changing shape when notes are shown / hidden. */}

          {/* Favorite toggle — lives in the main bar (not the menu)
              because performers like the one-tap save-to-favorites
              gesture during a session. */}
          <button
            onClick={() => void toggleFavorite(db, activeSong.id)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title={activeSong.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={activeSong.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={16}
              fill={activeSong.favorite ? 'currentColor' : 'none'}
              style={{ color: activeSong.favorite ? 'var(--accent)' : 'var(--text-secondary)' }}
            />
          </button>

          {/* Three-dots "More" menu — non-performance actions live here
              so the live-use surface stays uncluttered. The menu itself
              is portaled into <body> (further below) so the toolbar's
              `overflow-hidden` doesn't clip it. */}
          <button
            ref={moreMenuTriggerRef}
            onClick={() => setMoreMenuOpen((v) => !v)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            style={{ background: moreMenuOpen ? 'var(--surface-elevated)' : undefined }}
            title="More options"
            aria-label="More options"
            aria-expanded={moreMenuOpen}
          >
            <MoreVertical size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
          {moreMenuOpen && moreMenuPos && createPortal(
            (
              <div
                ref={moreMenuRef}
                className="rounded-lg shadow-2xl py-1"
                style={{
                  position: 'fixed',
                  top: moreMenuPos.top,
                  right: moreMenuPos.right,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  minWidth: 220,
                  zIndex: 1000,
                }}
              >
                {/* Style preset */}
                <div className="px-3 py-2">
                  <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                    Style preset
                  </label>
                  <select
                    value={svs.preset}
                    onChange={(e) => {
                      const key = e.target.value;
                      const builtin = SONG_STYLE_PRESETS[key];
                      if (builtin) { void updateSetting(db, 'songViewStyle', { ...builtin.style }); return; }
                      const custom = customPresets[key];
                      if (custom) { void updateSetting(db, 'songViewStyle', { ...custom.style }); return; }
                    }}
                    className="w-full text-xs rounded px-2 py-1.5"
                    style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
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
                </div>

                <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />

                <MoreMenuItem
                  icon={<ListMusic size={14} style={{ color: 'var(--text-secondary)' }} />}
                  label="Add to set list"
                  onClick={() => { setShowSetListPicker(true); setMoreMenuOpen(false); }}
                />
                <MoreMenuItem
                  icon={<Download size={14} style={{ color: 'var(--text-secondary)' }} />}
                  label="Export song"
                  onClick={() => { setShowExport(true); setMoreMenuOpen(false); }}
                />
                {(() => {
                  // Always render the row — disabled when the song
                  // has no notes — so the menu shape stays consistent
                  // and the user can see the action even when it's
                  // not applicable to the current song.
                  const hasNotes = !!activeSong.notes && activeSong.notes.trim().length > 0;
                  return (
                    <MoreMenuItem
                      icon={<StickyNote size={14} style={{ color: hasNotes ? 'var(--accent)' : 'var(--text-muted)' }} />}
                      label={showNotes && hasNotes ? 'Hide song notes' : 'Show song notes'}
                      disabled={!hasNotes}
                      disabledTitle="This song has no notes"
                      onClick={() => { setShowNotes((v) => !v); setMoreMenuOpen(false); }}
                    />
                  );
                })()}
                {/* Play link / audio file moved back to the main bar
                    — it's a single-tap action that performers use live
                    (start reference audio, open source URL). */}
                {/* Cast — the entire row is clickable and delegates to
                    CastQuickButton's inner button so the click target is
                    as large as the other menu entries. The wrapper
                    `.cast-menu-row` neutralises CastQuickButton's own
                    p-2 padding so its icon lines up with the 16px
                    icon-slot used by the other MoreMenuItem rows. */}
                <div
                  className="cast-menu-row flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer"
                  onClick={(e) => {
                    // If the click already hit the inner button, let
                    // CastQuickButton handle it natively. Otherwise
                    // synthesize a click on the cast button so clicking
                    // the label or empty row area still opens the cast
                    // popover.
                    const target = e.target as HTMLElement;
                    if (target.closest('button[title="Cast"]')) return;
                    const btn = e.currentTarget.querySelector('button[title="Cast"]') as HTMLButtonElement | null;
                    btn?.click();
                  }}
                >
                  <span className="shrink-0 flex items-center justify-center" style={{ width: 16 }}>
                    <CastQuickButton />
                  </span>
                  <span className="flex-1" style={{ color: 'var(--text-primary)' }}>
                    Cast to receiver
                  </span>
                </div>
                <style>{`
                  .cast-menu-row button[title="Cast"] {
                    padding: 0 !important;
                    border-radius: 0 !important;
                    background: transparent !important;
                  }
                `}</style>
                <MoreMenuItem
                  icon={<Edit2 size={14} style={{ color: 'var(--text-secondary)' }} />}
                  label="Edit song"
                  onClick={() => { setMoreMenuOpen(false); navigate(`/song/${id}/edit`); }}
                />
              </div>
            ),
            document.body,
          )}
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
        <ChordDiagramBar song={displayedSong} position="top" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
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
            chordVariations={effectiveChordVariations}
          />
          </div>
          <BottomSectionSpacer scrollRef={scrollRef} recomputeKey={`${zoomLevel}|${viewMode}`} />
        </div>

        {/* Chord bar right */}
        {chordBarVisible && chordBarPosition === 'right' && displayedSong && (
          <ChordDiagramBar song={displayedSong} position="right" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
        )}
      </div>

      {/* Chord bar bottom */}
      {chordBarVisible && chordBarPosition === 'bottom' && displayedSong && (
        <ChordDiagramBar song={displayedSong} position="bottom" chordVariations={effectiveChordVariations} onChordClick={(chord) => setSelectedChord(chord)} />
      )}

      {/* Floating "back to top" button — bottom-right of the normal view,
          shown only when the user has scrolled all the way down. */}
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

      <SectionNavigator
        song={displayedSong}
        scrollRef={scrollRef}
        recomputeKey={`${zoomLevel}|${viewMode}`}
      />

      {/* Chord diagram panel (shown when chord is selected) */}
      {selectedChord && (
        <ChordModal chord={selectedChord} onClose={() => setSelectedChord(null)} songId={activeSong?.id} songPrefs={activeSong?.preferences} />
      )}

      {/* Song-notes sticky note — draggable & resizable, not modal */}
      {showNotes && activeSong && (
        <StickyNotePanel
          title={activeSong.title}
          notes={activeSong.notes ?? ''}
          onClose={() => setShowNotes(false)}
          onSave={async (next) => {
            if (!activeSong.id) return;
            await updateSongInStore(db, activeSong.id, { notes: next });
          }}
        />
      )}

      {/* Export modal */}
      {showExport && activeSong && (
        <SongExportModal songs={[activeSong]} onClose={() => setShowExport(false)} />
      )}

      {/* Set list picker */}
      {showSetListPicker && activeSong && (
        <SetListPickerModal
          initialSelected={[]}
          hint={`"${toTitleCase(activeSong.title)}" will be added to the chosen set list${'' /* plural handled by user */}.`}
          onClose={() => setShowSetListPicker(false)}
          onConfirm={async (ids) => {
            for (const slId of ids) {
              await addSongToSetList(db, slId, activeSong.id);
            }
            setShowSetListPicker(false);
          }}
        />
      )}
    </div>
  );
}

/** Single item inside the toolbar's three-dots menu. Renders as a
 *  full-width row with a small leading icon and a label, mirroring the
 *  styling of any standard popover-menu entry in the app. */
function MoreMenuItem({ icon, label, onClick, disabled, disabledTitle }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  /** When true the row is rendered greyed-out and ignores clicks.
   *  Used for actions that should always be visible but aren't
   *  applicable right now (e.g. "Show song notes" when the song has
   *  no notes). */
  disabled?: boolean;
  /** Optional tooltip shown when hovering a disabled item, so users
   *  know WHY it's unavailable. */
  disabledTitle?: string;
}): React.ReactElement {
  return (
    <button
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors"
      style={{
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? 'transparent' : undefined,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span className="shrink-0 flex items-center justify-center" style={{ width: 16 }}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function ChordModal({ chord, onClose, songId, songPrefs }: {
  chord: string; onClose: () => void; songId?: string; songPrefs?: import('@song-chords/shared').SongPreferences;
}): React.ReactElement {
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const svs = useSettingsStore((s) => s.settings.songViewStyle);
  const custom = useSettingsStore((s) => s.settings.customChords ?? {});
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');
  const { updateSetting } = useSettingsStore();
  const savePrefs = useSongStore((s) => s.savePreferences);
  const strings = instrument === 'guitar' ? 6 : instrument === 'ukulele' ? 4 : 0;
  const emptyDiag: import('@song-chords/shared').ChordDiagram = instrument === 'piano'
    ? { name: chord, instrument, baseFret: 1, strings: 0, frets: [], pianoNotes: [] }
    : { name: chord, instrument, baseFret: 1, strings, frets: Array(strings).fill('x') as ('x')[] };

  const variations = getDiagramVariations(chord, instrument, custom);
  const hasDiagram = variations.length > 0;
  const allDiags = hasDiagram ? variations : [emptyDiag];
  // Initial voicing: per-song override > global default for this
  // instrument > 0. Resolved through the shared helper so the modal
  // opens on the same voicing the song actually renders.
  const globalDefaults = useSettingsStore((s) => s.settings.defaultChordVariations);
  const savedIdx = resolveChordVariation(
    chord, instrument, songPrefs?.chordVariations, globalDefaults,
  );
  const [currentIdx, setCurrentIdx] = useState(Math.min(savedIdx, allDiags.length - 1));
  const [creatingCustom, setCreatingCustom] = useState(false);

  const diag = allDiags[currentIdx] ?? allDiags[0]!;
  // "Remembered ✓" still strictly means "this SONG pinned this index"
  // — the per-song layer, not the global default. The label has to
  // stay narrow because clicking the button writes a per-song
  // override regardless of any global default.
  const isRemembered =
    songPrefs?.chordVariations?.[chord] === currentIdx;

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
          <span className="block text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>{formatChord(chord, notation)}</span>
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
