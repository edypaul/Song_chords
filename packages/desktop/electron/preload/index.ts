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
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url),
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
