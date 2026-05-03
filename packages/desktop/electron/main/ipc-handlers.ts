import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  /**
   * Asks the user to pick a parent folder, then creates a sub-folder named
   * `folderName` inside it and writes every entry as an individual file.
   * Used by the multi-song export when the format is per-song (ChordPro,
   * plain text). Returns the created folder path or null on cancel.
   */
  ipcMain.handle(
    'files:saveSongsFolder',
    async (_event, folderName: string, files: Array<{ filename: string; content: string }>): Promise<{ folder: string | null; error?: string }> => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Choose a folder to export into',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) return { folder: null };
        const parent = result.filePaths[0]!;
        const target = join(parent, folderName);
        mkdirSync(target, { recursive: true });
        // Avoid filename collisions inside the chosen folder.
        const used = new Set<string>();
        for (const { filename, content } of files) {
          let name = filename;
          if (used.has(name)) {
            const dot = name.lastIndexOf('.');
            const base = dot >= 0 ? name.slice(0, dot) : name;
            const ext = dot >= 0 ? name.slice(dot) : '';
            let i = 2;
            while (used.has(`${base} (${i})${ext}`)) i++;
            name = `${base} (${i})${ext}`;
          }
          used.add(name);
          writeFileSync(join(target, name), content, 'utf-8');
        }
        return { folder: target };
      } catch (err) {
        return { folder: null, error: String(err) };
      }
    },
  );

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Render HTML off-screen, print it to a PDF buffer, then ask the user
  // where to save it — with the song title pre-filled as the default name.
  ipcMain.handle('pdf:savePdf', async (_event, html: string, defaultName: string, _bgColor?: string): Promise<{ canceled: boolean; filePath?: string; error?: string }> => {
    let tempPath: string | null = null;
    let win: BrowserWindow | null = null;
    try {
      // Write the HTML to a temp file and loadFile it — safer than data URLs,
      // which Chromium caps at ~2 MB (songs with embedded chord SVGs can
      // exceed that).
      tempPath = join(tmpdir(), `song-chords-pdf-${Date.now()}.html`);
      writeFileSync(tempPath, html, 'utf-8');

      win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
      });
      await win.loadFile(tempPath);
      // Let fonts/CSS settle before snapshotting.
      await new Promise((r) => setTimeout(r, 200));

      // Page margin comes from the CSS @page rule (preferCSSPageSize true).
      // displayHeaderFooter / margins / templates are intentionally NOT
      // passed — explicit margins here override the CSS rule, and
      // experimentally the templates were not enforcing the requested
      // padding on every page.
      const buffer = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });

      const result = await dialog.showSaveDialog({
        defaultPath: `${defaultName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      writeFileSync(result.filePath, buffer);
      return { canceled: false, filePath: result.filePath };
    } catch (err) {
      // Surface the error back to the renderer so the UI can show it.
      console.error('[pdf:savePdf] failed:', err);
      return { canceled: true, error: String(err) };
    } finally {
      if (win) try { win.close(); } catch { /* ignore */ }
      if (tempPath) try { unlinkSync(tempPath); } catch { /* ignore */ }
    }
  });

  // --- App lifecycle ---
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // --- Custom title bar window controls ---
  // The renderer draws minimize / maximize / close buttons; these handlers
  // route the click events back to the focused BrowserWindow. Each looks
  // up the sender's window via `BrowserWindow.fromWebContents` so the
  // controls work even if multiple windows ever exist.
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
}
