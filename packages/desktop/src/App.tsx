import React, { useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('App error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#ef4444', background: '#fff', height: '100vh' }}>
          <h2>App Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8, color: '#666', fontSize: 12 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
import { useSongStore, useSetListStore, useSettingsStore } from '@song-chords/shared';
import { db } from './ipc/ipc-client';
import { detectPreferredLanguage } from './i18n';
import AppShell from './components/layout/AppShell';
import LibraryPage from './pages/LibraryPage';
import SongViewPage from './pages/SongViewPage';
import SongEditPage from './pages/SongEditPage';
import SetListsPage from './pages/SetListsPage';
import SetListDetailPage from './pages/SetListDetailPage';
import SetListPlayerPage from './pages/SetListPlayerPage';
import SettingsPage from './pages/SettingsPage';
import ImportPage from './pages/ImportPage';
import ChordLibraryPage from './pages/ChordLibraryPage';
import TunerPage from './pages/TunerPage';
import CategoriesPage from './pages/CategoriesPage';
import CategoryPlayerPage from './pages/CategoryPlayerPage';
import DashboardPage from './pages/DashboardPage';
import FavoritesPage from './pages/FavoritesPage';
import FavoritesPlayerPage from './pages/FavoritesPlayerPage';
import CastPage from './pages/CastPage';
import KeyboardShortcutsOverlay from './components/common/KeyboardShortcutsModal';
import GlobalZoomShortcuts from './components/common/GlobalZoomShortcuts';
import { NavigationGuardProvider } from './context/NavigationGuard';
import { AudioPlayerProvider } from './context/AudioPlayer';
import CastSync from './components/song/CastSync';

export default function App(): React.ReactElement {
  const loadSongs = useSongStore((s) => s.loadSongs);
  const loadSetLists = useSetListStore((s) => s.loadSetLists);
  const { loadSettings, settings, updateSetting } = useSettingsStore();

  useEffect(() => {
    // Boot sequence:
    //   1. Load settings from the DB. On very first launch, the DB
    //      row is either missing or defaults to `uiLanguage: 'en'`
    //      (from DEFAULT_SETTINGS).
    //   2. If the language field wasn't explicitly saved yet — i.e.
    //      this is the FIRST run on this machine — detect the OS
    //      locale from the renderer's `navigator.language(s)` and
    //      save it. Subsequent launches see the saved value and
    //      skip detection, so a user who deliberately picks a
    //      language in Settings later doesn't get overridden.
    //   3. Load songs + set lists.
    void (async () => {
      await loadSettings(db);
      const stored = useSettingsStore.getState().settings.uiLanguage;
      // Only auto-detect when the setting is truly unset (undefined).
      // A value of 'en' means the user (or a prior boot) explicitly
      // chose English and should be respected.
      if (stored === undefined || stored === null) {
        const detected = detectPreferredLanguage();
        await updateSetting(db, 'uiLanguage', detected);
      }
    })();
    void loadSongs(db);
    void loadSetLists(db);
  }, []);


  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [settings.theme]);

  return (
    <ErrorBoundary>
      <NavigationGuardProvider>
        <AudioPlayerProvider>
        <CastSync />
        <KeyboardShortcutsOverlay />
        <GlobalZoomShortcuts />
        <HashRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="song/:id" element={<SongViewPage />} />
            <Route path="song/:id/edit" element={<SongEditPage />} />
            <Route path="song/new" element={<SongEditPage />} />
            <Route path="setlists" element={<SetListsPage />} />
            <Route path="setlists/:id" element={<SetListDetailPage />} />
            <Route path="setlists/:id/player" element={<SetListPlayerPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="chords" element={<ChordLibraryPage />} />
            <Route path="tuner" element={<TunerPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="categories/:category" element={<CategoriesPage />} />
            <Route path="categories/:category/:value" element={<CategoriesPage />} />
            <Route path="categories/:category/:value/perform" element={<CategoryPlayerPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="favorites/perform" element={<FavoritesPlayerPage />} />
            <Route path="cast" element={<CastPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
        </HashRouter>
        </AudioPlayerProvider>
      </NavigationGuardProvider>
    </ErrorBoundary>
  );
}
