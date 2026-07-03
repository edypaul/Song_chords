import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit2, ArrowLeft, X, Play, Square, Pause, Timer, Guitar, LayoutGrid, FileText, Maximize, Minimize, StickyNote, ListMusic, Star, Download, ArrowUp, ChevronUp, ChevronDown } from 'lucide-react';
import { useSongStore, usePlayerStore, useSettingsStore, useSetListStore, SONG_STYLE_PRESETS, formatKey } from '@song-chords/shared';
import SongRenderer from '../components/song/SongRenderer';
import SongDetails from '../components/song/SongDetails';
import AutoScrollControl from '../components/controls/AutoScrollControl';
import MetronomeControl from '../components/controls/MetronomeControl';
import ChordDiagramBar from '../components/chord-diagram/ChordDiagramBar';
import { useEffectiveChordVariations } from '../hooks/useEffectiveChordVariations';
import ChordModal from '../components/chord-diagram/ChordModal';
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
  const globalInlineDiagrams = useSettingsStore((s) => s.settings.inlineChordDiagrams ?? false);
  // Effective "inline chord diagrams" flag: the entry's per-entry
  // override wins when in setlist context, otherwise the app-wide
  // setting. Read everywhere the old `inlineDiagrams` was used so the
  // rendering respects the entry.
  const inlineDiagrams = setlistEntry?.inlineChordDiagrams ?? globalInlineDiagrams;
  const instrument = useSettingsStore((s) => s.settings.defaultInstrument);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  /** Toggle "inline chord diagrams". Routes to the entry in setlist
   *  context, otherwise the app-wide setting — mirrors the
   *  autoScrollMode + viewMode routing pattern. */
  const setInlineDiagrams = (next: boolean) => {
    if (setlistEntry) void updateEntry(db, setlistEntry.id, { inlineChordDiagrams: next });
    else void updateSetting(db, 'inlineChordDiagrams', next);
  };
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
  // Chord-bar visibility. In setlist context, an entry-level override
  // wins over the global default and any change writes to the entry.
  // Outside setlist context, state is in-session only (matches the
  // previous behavior — the toggle didn't persist to settings then
  // either).
  const [chordBarVisibleLocal, setChordBarVisibleLocal] = useState(
    setlistEntry?.chordBarVisible ?? showChordDiagrams,
  );
  const chordBarVisible = setlistEntry?.chordBarVisible ?? chordBarVisibleLocal;
  const setChordBarVisible: React.Dispatch<React.SetStateAction<boolean>> = (next) => {
    const resolved = typeof next === 'function'
      ? (next as (prev: boolean) => boolean)(chordBarVisible)
      : next;
    if (setlistEntry) {
      void updateEntry(db, setlistEntry.id, { chordBarVisible: resolved });
    } else {
      setChordBarVisibleLocal(resolved);
    }
  };
  // Sync with the global default when the setting changes AND when the
  // active setlist entry's override changes — so navigating between
  // songs / setlists reflects the right state.
  useEffect(() => {
    setChordBarVisibleLocal(setlistEntry?.chordBarVisible ?? showChordDiagrams);
  }, [showChordDiagrams, setlistEntry?.id, setlistEntry?.chordBarVisible]);
  // Lyrics-only mode hides all chord diagrams: force the chord bar off and
  // clear the inline-diagrams setting when it's activated.
  useEffect(() => {
    if (viewMode === 'lyrics-only') {
      if (chordBarVisible) setChordBarVisible(false);
      if (inlineDiagrams) setInlineDiagrams(false);
    }
  }, [viewMode]);
  // In-session performance-mode toggles (no longer persisted settings)
  const [perfMetroWanted, setPerfMetroWanted] = useState(true);
  const [perfScrollWanted, setPerfScrollWanted] = useState(true);
  // Half / double-time multiplier — applies to the metronome only,
  // never the stored song tempo. Outside setlist context it resets to
  // 1× when the user opens a different song so the new song starts at
  // its natural BPM. In setlist context the entry's saved multiplier
  // wins on load and any change is persisted to the entry — mirrors
  // the pattern used for viewMode / autoScrollMode.
  const [tempoMultiplierLocal, setTempoMultiplierLocal] = useState<0.5 | 1 | 2>(
    setlistEntry?.tempoMultiplier ?? 1,
  );
  const tempoMultiplier = setlistEntry?.tempoMultiplier ?? tempoMultiplierLocal;
  const setTempoMultiplier = (next: 0.5 | 1 | 2) => {
    if (setlistEntry) {
      void updateEntry(db, setlistEntry.id, { tempoMultiplier: next });
    } else {
      setTempoMultiplierLocal(next);
    }
  };
  useEffect(() => {
    setTempoMultiplierLocal(setlistEntry?.tempoMultiplier ?? 1);
  }, [activeSong?.id, setlistEntry?.id, setlistEntry?.tempoMultiplier]);
  const baseTempo = activeSong?.tempo ?? 120;
  const metronome = useMetronome(Math.round(baseTempo * tempoMultiplier), activeSong?.timeSig ?? '4/4');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  // Guard for keeping native fullscreen alive across a chord-modal
  // Escape. The browser exits native fullscreen on ANY Escape press
  // (a non-cancelable UA action), which would otherwise tear down
  // performance mode via `handleFsChange`. While the modal is open we
  // arm this so the transient exit is ignored, then re-request
  // fullscreen on close. See the effect + keepFullscreenAfterModal.
  const suppressFsExitRef = useRef(false);
  const [showNotes, setShowNotes] = useState(false);
  // Auto-open the sticky note when a song that has notes becomes active.
  // Runs on song change so switching songs refreshes the visibility.
  useEffect(() => {
    setShowNotes(!!activeSong?.notes && activeSong.notes.trim().length > 0);
  }, [activeSong?.id, activeSong?.notes]);
  const [showExport, setShowExport] = useState(false);
  const [showSetListPicker, setShowSetListPicker] = useState(false);
  // Collapse the whole toolbar to give the song content more vertical
  // room. When hidden, a slim "show toolbar" tab stays visible so the
  // user can always bring it back.
  const [toolbarHidden, setToolbarHidden] = useState(false);
  // Toolbar visibility is INDEPENDENT of auto-scroll. Earlier versions
  // auto-hid the toolbar when auto-scroll started (and auto-showed it on
  // stop), which surprised users because pressing Space (the auto-scroll
  // shortcut) appeared to also toggle the toolbar. The toolbar now has its
  // own dedicated `toggleToolbar` shortcut (default `T`), and the collapse
  // chevron / "Show toolbar" tab are the only two things that ever move
  // `toolbarHidden`.
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
      setInlineDiagrams(!inlineDiagrams);
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
    toggleToolbar:        () => setToolbarHidden((v) => !v),
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

  // ── Keep fullscreen alive across a chord-modal Escape ────────────
  // The fullscreen song page runs in native browser fullscreen. The
  // browser exits native fullscreen on ANY Escape press — including
  // the one the user means as "close the chord modal" — and that exit
  // is a non-cancelable UA action that would normally tear down
  // performance mode via `handleFsChange`.
  //
  // The fix has two halves that BOTH must be in place before the
  // Escape lands, because the `fullscreenchange` (exit) event can fire
  // before our keydown handler runs — so we cannot wait for the
  // keypress to react. (1) While a chord modal is open in fullscreen,
  // arm the guard so `handleFsChange` ignores the transient exit.
  // (2) On close, re-request fullscreen synchronously inside the
  // Escape keydown (the modal calls keepFullscreenAfterModal from its
  // own keydown handler — the user-gesture context requestFullscreen()
  // needs).
  useEffect(() => {
    if (selectedChord && performanceMode) {
      suppressFsExitRef.current = true;
    } else {
      suppressFsExitRef.current = false;
    }
  }, [selectedChord, performanceMode]);

  const keepFullscreenAfterModal = () => {
    // At keydown time `document.fullscreenElement` is STILL set — the
    // browser hasn't processed its own Escape-exits-fullscreen yet
    // (that fires as a later async fullscreenchange task). So we can't
    // branch on the current fullscreen state; we ALWAYS re-request
    // fullscreen. The request queues and resolves after the browser's
    // exit, landing us back in fullscreen; if we were still fullscreen
    // it's a harmless no-op. The pre-armed guard swallows the
    // intervening exit so performance mode never tears down.
    suppressFsExitRef.current = true;
    document.documentElement.requestFullscreen?.().catch(() => {
      suppressFsExitRef.current = false;
    });
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
      // overrides applied so transpose/capo/key/viewMode/autoScrollMode
      // all reflect the setlist state without mutating the song
      // itself. Per-entry overrides fall back to the song's own
      // preference when unset, so existing entries that predate the
      // per-entry preference columns keep inheriting from the song
      // until the user changes something in setlist context — matching
      // the "no bulk snapshot" migration choice. `chordVariations` and
      // other per-song display preferences remain song-scoped by
      // design; only the setlist-controllable settings (transpose,
      // capo, view mode, auto-scroll mode, time-feel, chord-bar
      // visibility, inline diagrams) override on the entry. */
      const songPrefs = songFromStore.preferences ?? {};
      loadSong({
        ...songFromStore,
        key: setlistEntry.key ?? songFromStore.key,
        tempo: setlistEntry.tempo ?? songFromStore.tempo,
        timeSig: setlistEntry.timeSig ?? songFromStore.timeSig,
        capo: setlistEntry.capo,
        preferences: {
          ...songPrefs,
          transposeSteps: setlistEntry.transpose,
          viewMode: setlistEntry.viewMode ?? songPrefs.viewMode,
          autoScrollMode: setlistEntry.autoScrollMode ?? songPrefs.autoScrollMode,
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
      // Escape's ONLY job on this page is to leave fullscreen /
      // performance mode. It must NOT navigate away from the song view
      // — leaving the page is a deliberate action (the back button),
      // not an Esc gesture. Modals close themselves via their own
      // capture-phase Escape handlers (which stopImmediatePropagation
      // so this listener never even sees the event). All other keys
      // flow through the configurable useKeyboardShortcuts system.
      if (e.key === 'Escape') {
        if (performanceMode) exitPerformance();
        // When not in performance mode there is nothing for Esc to do
        // here — intentionally a no-op so we stay on the song view.
      }
    };
    const handleFsChange = () => {
      // Only an EXIT (no fullscreen element) can tear down perf mode;
      // re-entry events are always benign, so let them pass without
      // touching the guard. This avoids a re-entry event spuriously
      // consuming the guard before the exit it was meant to swallow.
      if (document.fullscreenElement) return;
      // A chord modal closing via Escape transiently drops native
      // fullscreen on purpose — ignore that one exit (we re-enter
      // fullscreen right after) so performance mode survives.
      if (suppressFsExitRef.current) { suppressFsExitRef.current = false; return; }
      if (usePlayerStore.getState().performanceMode) storeExitPerf();
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
        // Every user-facing change in setlist context routes to the
        // entry, never to the underlying song. This lets the same
        // song appear in multiple setlists with independent
        // transpose / capo / view-mode settings — which is the whole
        // point of the per-entry preference columns.
        const patch: Partial<Pick<
          typeof setlistEntry,
          'transpose' | 'capo' | 'viewMode'
        >> = {};
        if (tChanged && setlistEntry.transpose !== transposeSteps) patch.transpose = transposeSteps;
        if (cChanged && setlistEntry.capo !== capo) patch.capo = capo;
        if (vChanged && setlistEntry.viewMode !== viewMode) patch.viewMode = viewMode;
        if (Object.keys(patch).length > 0) {
          void updateEntry(db, setlistEntry.id, patch);
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

        {selectedChord && <ChordModal chord={selectedChord} onClose={() => setSelectedChord(null)} songId={activeSong?.id} songPrefs={activeSong?.preferences} onKeepFullscreen={keepFullscreenAfterModal} />}
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
      {/* Slim tab to bring the toolbar back when it's hidden. Always
         reachable so the user is never stranded without controls. It
         collapses with the same grid-rows animation as the toolbar, and
         its label fades in once expanded. */}
      <div
        className="grid shrink-0 overflow-hidden"
        style={{
          gridTemplateRows: toolbarHidden ? '1fr' : '0fr',
          transition: 'grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <button
            onClick={() => setToolbarHidden(false)}
            className="flex items-center justify-center gap-1.5 w-full border-b text-xs hover:bg-[var(--surface-elevated)] transition-colors"
            style={{
              height: 22,
              borderColor: 'var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-muted)',
              opacity: toolbarHidden ? 1 : 0,
              transition: 'opacity 200ms ease 120ms',
            }}
            title="Show toolbar"
            aria-label="Show toolbar"
            tabIndex={toolbarHidden ? 0 : -1}
          >
            <ChevronDown size={14} />
            <span>Show toolbar</span>
          </button>
        </div>
      </div>
      {/* Toolbar — a single flex-wrap row. The title/artist/key block and
         every control flow together and wrap onto additional rows ONLY when
         they genuinely run out of horizontal space (no fixed breakpoint that
         forces an early second row). `min-w-0` lets the title truncate
         instead of pushing controls off-screen.

         Show/hide animation: an always-mounted CSS grid whose single row
         animates between `1fr` (open) and `0fr` (collapsed). This grid-rows
         technique animates a smooth height collapse WITHOUT having to measure
         the toolbar's variable wrapped height. The inner wrapper carries the
         real toolbar so `overflow: hidden` clips it cleanly while collapsing,
         and the content fades in/out alongside. */}
      <div
        className="grid shrink-0 overflow-hidden"
        style={{
          gridTemplateRows: toolbarHidden ? '0fr' : '1fr',
          transition: 'grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
       <div
         className="min-h-0 overflow-hidden"
         style={{
           opacity: toolbarHidden ? 0 : 1,
           transition: 'opacity 200ms ease',
         }}
       >
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap min-w-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        {/* Title block — back + title/artist + key. Natural width; stays on
           the first row and lets its title truncate (max-w + min-w-0) so it
           never crowds the controls off the row. */}
        <div className="flex items-center gap-3 min-w-0 shrink" style={{ maxWidth: '100%' }}>
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

        {/* Control cluster — `display: contents` so every control is a DIRECT
           child of the toolbar's single flex-wrap row. That puts the title
           block and all controls in ONE wrap context: they share the first
           row, and any controls that overflow wrap to additional rows that
           left-align to the toolbar's left edge (not to a nested cluster's
           left edge). */}
        <div style={{ display: 'contents' }}>
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

        {/* `display: contents` so these controls are DIRECT flex children of
            the wrapping cluster above — each one wraps individually when the
            row fills, instead of the whole group wrapping as one block (which
            left a large empty gap on the first row). */}
        <div style={{ display: 'contents' }}>
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
              if (inlineDiagrams) setInlineDiagrams(false);
            };
            const activateChordBar = () => {
              // Toggle off when already active; otherwise activate and
              // clear the other two modes.
              if (chordBarOn) { setChordBarVisible(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (inlineDiagrams) setInlineDiagrams(false);
              setChordBarVisible(true);
            };
            const activateInline = () => {
              if (isPiano) return;
              // Toggle off when already active; otherwise activate and
              // clear the other two modes.
              if (inlineOn) { setInlineDiagrams(false); return; }
              if (lyricsOnly) setViewMode('chords');
              if (chordBarVisible) setChordBarVisible(false);
              if (!inlineDiagrams) setInlineDiagrams(true);
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

          {/* Favorite toggle — one-tap save-to-favorites during a session. */}
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

          {/* ── Actions formerly hidden in the three-dots menu, now in the
              main bar as icon-only buttons. They sit after the zoom
              indicator and wrap to a second row on narrow screens. ── */}

          {/* Add to set list */}
          <button
            onClick={() => setShowSetListPicker(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Add to set list"
            aria-label="Add to set list"
          >
            <ListMusic size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* Export song */}
          <button
            onClick={() => setShowExport(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Export song"
            aria-label="Export song"
          >
            <Download size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* Song notes toggle — disabled when the song has no notes. */}
          {(() => {
            const hasNotes = !!activeSong.notes && activeSong.notes.trim().length > 0;
            return (
              <button
                onClick={() => { if (hasNotes) setShowNotes((v) => !v); }}
                disabled={!hasNotes}
                className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
                style={{ opacity: hasNotes ? 1 : 0.4, cursor: hasNotes ? 'pointer' : 'not-allowed' }}
                title={hasNotes ? (showNotes ? 'Hide song notes' : 'Show song notes') : 'This song has no notes'}
                aria-label="Toggle song notes"
              >
                <StickyNote size={16} style={{ color: hasNotes && showNotes ? 'var(--accent)' : 'var(--text-secondary)' }} />
              </button>
            );
          })()}

          {/* Cast to receiver */}
          <CastQuickButton />

          {/* Edit song */}
          <button
            onClick={() => navigate(`/song/${id}/edit`)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Edit song"
            aria-label="Edit song"
          >
            <Edit2 size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* Style preset — compact dropdown (the one non-icon control,
              kept as a select because a preset list isn't an icon action). */}
          <select
            value={svs.preset}
            onChange={(e) => {
              const key = e.target.value;
              const builtin = SONG_STYLE_PRESETS[key];
              if (builtin) { void updateSetting(db, 'songViewStyle', { ...builtin.style }); return; }
              const custom = customPresets[key];
              if (custom) { void updateSetting(db, 'songViewStyle', { ...custom.style }); return; }
            }}
            className="text-xs rounded px-1.5 py-1 max-w-[9rem]"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            title="Style preset"
            aria-label="Style preset"
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

          <button
            onClick={enterFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
            style={{ background: 'var(--accent)', color: 'white' }}
            title="Full Screen"
          >
            <Maximize size={13} />
          </button>

          {/* Collapse the toolbar — a slim "Show toolbar" tab takes its
              place so it can be reopened. */}
          <button
            onClick={() => setToolbarHidden(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors"
            title="Hide toolbar"
            aria-label="Hide toolbar"
          >
            <ChevronUp size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>
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
        <ChordModal chord={selectedChord} onClose={() => setSelectedChord(null)} songId={activeSong?.id} songPrefs={activeSong?.preferences} onKeepFullscreen={keepFullscreenAfterModal} />
      )}

      {/* Song-notes sticky note — draggable & resizable, not modal */}
      {showNotes && activeSong && (
        <StickyNotePanel
          title={activeSong.title}
          notes={activeSong.notes ?? ''}
          positionKey={`songview:${activeSong.id}`}
          onClose={() => setShowNotes(false)}
          onSave={async (next) => {
            if (!activeSong.id) return;
            await updateSongInStore(db, activeSong.id, { notes: next });
            // Mirror onto the player store's activeSong (which this page
            // renders from) so the saved note shows immediately — updateSong
            // only refreshes the song store.
            const cur = usePlayerStore.getState().activeSong;
            if (cur && cur.id === activeSong.id) {
              usePlayerStore.setState({ activeSong: { ...cur, notes: next } });
            }
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

