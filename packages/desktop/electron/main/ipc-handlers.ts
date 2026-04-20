import { app, ipcMain, dialog, shell } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import type { IDatabase } from '@song-chords/shared';

export function registerIpcHandlers(db: IDatabase): void {
  // --- Database IPC ---
  ipcMain.handle('db:query', async (_event, sql: string, params: unknown[]) => {
    return db.query(sql, params);
  });

  ipcMain.handle('db:execute', async (_event, sql: string, params: unknown[]) => {
    return db.execute(sql, params);
  });

  ipcMain.handle('db:queryOne', async (_event, sql: string, params: unknown[]) => {
    return db.queryOne(sql, params);
  });

  // --- File System IPC ---
  ipcMain.handle('files:openDialog', async (_event, filters: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters ?? [
        { name: 'ChordPro Files', extensions: ['cho', 'chordpro', 'chopro', 'crd'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('files:saveDialog', async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options ?? {});
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('files:readFile', async (_event, filePath: string) => {
    return readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('files:writeFile', async (_event, filePath: string, content: string) => {
    writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // --- App lifecycle ---
  ipcMain.handle('app:quit', () => {
    app.quit();
  });
}
