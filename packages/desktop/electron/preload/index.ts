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
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
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
