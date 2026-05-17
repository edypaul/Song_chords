import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  db: {
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params ?? []),
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params ?? []),
    queryOne: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:queryOne', sql, params ?? []),
  },
  files: {
    openDialog: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('files:openDialog', filters),
    saveDialog: (options?: Record<string, unknown>) =>
      ipcRenderer.invoke('files:saveDialog', options),
    readFile: (filePath: string) =>
      ipcRenderer.invoke('files:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('files:writeFile', filePath, content),
    saveSongsFolder: (folderName: string, files: Array<{ filename: string; content: string }>): Promise<{ folder: string | null; error?: string }> =>
      ipcRenderer.invoke('files:saveSongsFolder', folderName, files),
    /** Native single-file picker with audio extensions filter. Returns
     *  the absolute path of the chosen file, or null if cancelled. */
    pickAudio: (): Promise<string | null> => ipcRenderer.invoke('files:pickAudio'),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url),
    /** Open a local file with the OS default app (audio -> VLC etc.).
     *  Resolves to '' on success or an OS error string on failure. */
    openPath: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('shell:openPath', filePath),
  },
  youtube: {
    /** Open a child BrowserWindow that loads the canonical YouTube
     *  watch page for the given URL. Used as the fallback for
     *  embed-disabled videos — the regular page has no embedding
     *  restrictions and plays anything. */
    openPopup: (url: string): Promise<void> => ipcRenderer.invoke('youtube:openPopup', url),
  },
  pdf: {
    savePdf: (html: string, defaultName: string, bgColor?: string): Promise<{ canceled: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke('pdf:savePdf', html, defaultName, bgColor),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Subscribe to maximize-state changes pushed from the main process.
     *  Returns an unsubscribe function. */
    onMaxStateChange: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('window:max-state', handler);
      return () => ipcRenderer.removeListener('window:max-state', handler);
    },
  },
  cast: {
    /** Start the local cast HTTP + WebSocket server. Defaults to
     *  mirror mode capturing the calling window. */
    start: (view: 'app' | 'song' | 'fullscreen' | 'performance'): Promise<{ host: string; port: number }> =>
      ipcRenderer.invoke('cast:start', view),
    stop: (): Promise<{ running: boolean; host: string | null; port: number | null; clients: number; view: string; mode: 'mirror' | 'html' | 'idle' }> =>
      ipcRenderer.invoke('cast:stop'),
    status: (): Promise<{ running: boolean; host: string | null; port: number | null; clients: number; view: string; mode: 'mirror' | 'html' | 'idle' }> =>
      ipcRenderer.invoke('cast:status'),
    setView: (view: 'app' | 'song' | 'fullscreen' | 'performance'): Promise<{ running: boolean; host: string | null; port: number | null; clients: number; view: string; mode: 'mirror' | 'html' | 'idle' }> =>
      ipcRenderer.invoke('cast:setView', view),
    /** Switch the cast to mirror mode (live JPEG capture of the
     *  caller's window). Used by the Cast page's full-app mirror. */
    setMirror: (): Promise<{ running: boolean; host: string | null; port: number | null; clients: number; view: string; mode: 'mirror' | 'html' | 'idle' }> =>
      ipcRenderer.invoke('cast:setMirror'),
    /** Push a self-contained HTML document to all receivers. Used by
     *  the per-song Cast button popovers (Lyrics only / Lyrics +
     *  chords). The HTML is built in the renderer via
     *  `buildCastHtml(song, mode)`. */
    setHtml: (html: string): Promise<{ running: boolean; host: string | null; port: number | null; clients: number; view: string; mode: 'mirror' | 'html' | 'idle' }> =>
      ipcRenderer.invoke('cast:setHtml', html),
  },
  onMenuAction: (callback: (action: string) => void) => {
    const actions = [
      'menu:new-song', 'menu:import', 'menu:export-chordpro', 'menu:export-pdf',
      'menu:transpose-up', 'menu:transpose-down', 'menu:toggle-scroll', 'menu:about',
    ];
    const handlers: Array<() => void> = actions.map((action) => {
      const handler = () => callback(action);
      ipcRenderer.on(action, handler);
      return () => ipcRenderer.removeListener(action, handler);
    });
    return () => handlers.forEach((off) => off());
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
