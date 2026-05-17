import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { castServer, type CastView } from './cast-server';
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

  // Single-file picker with audio extension filters. Returns the
  // chosen absolute path or null if the user cancelled. Used by the
  // Song Edit form's "Audio File" field.
  ipcMain.handle('files:pickAudio', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!;
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

  // Spawn a child BrowserWindow that loads a YouTube watch page (full
  // YouTube UI — recommendations, controls, fullscreen). Used as the
  // fallback for embed-disabled videos: the regular YouTube page has
  // no embed restrictions, so any video plays.
  //
  // Window behaviour:
  //   - Compact 400×300 player so it sits in a corner without
  //     covering the song view.
  //   - Pinned `alwaysOnTop` so the user can keep playing audio
  //     while interacting with the main app underneath.
  //   - Anchored 100px from the right, 100px from the top of the
  //     primary display's work area on first open.
  ipcMain.handle('youtube:openPopup', async (_event, url: string) => {
    const POPUP_WIDTH = 400;
    const POPUP_HEIGHT = 300;
    const TOP_OFFSET = 100;
    const RIGHT_OFFSET = 100;

    // Position relative to the primary display's work area (excludes
    // taskbar etc.) so the popup lands inside the visible region
    // even on multi-monitor setups.
    const { screen } = await import('electron');
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - POPUP_WIDTH - RIGHT_OFFSET;
    const y = wa.y + TOP_OFFSET;

    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x,
      y,
      title: 'YouTube',
      backgroundColor: '#0f0f0f',
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // `alwaysOnTop` with the default level only floats above other
    // app windows — call again with the `floating` level so it
    // stays visible while the main song view is focused too.
    win.setAlwaysOnTop(true, 'floating');
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      void shell.openExternal(openUrl);
      return { action: 'deny' };
    });
    await win.loadURL(url);
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
        // Tagged PDF output is what makes internal anchor links
        // (e.g. the binder Contents page's <a href="#song-1"> entries)
        // emit as real clickable navigation in the PDF. Without this
        // flag Chromium prints anchor links as plain underlined text
        // with no jump-to-page behavior.
        generateTaggedPDF: true,
        // Emit a document outline (the sidebar bookmarks panel) from
        // the page heading hierarchy — each song's <h1> becomes a
        // top-level bookmark so users get a second nav mechanism
        // alongside the Contents page links.
        generateDocumentOutline: true,
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

  // --- Cast server ---
  // Starts a local HTTP + WebSocket server that broadcasts JPEG
  // snapshots of the calling window at ~5fps. The receiver page is
  // served at the returned host:port and connects via WebSocket to
  // pull frames. `view` is informational only at the moment — the
  // capture covers the entire window regardless.
  ipcMain.handle('cast:start', async (event, view: CastView) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window for cast source');
    return castServer.start(win, view);
  });
  ipcMain.handle('cast:stop', async () => {
    await castServer.stop();
    return castServer.status();
  });
  ipcMain.handle('cast:status', () => {
    return castServer.status();
  });
  ipcMain.handle('cast:setView', (_event, view: CastView) => {
    castServer.setView(view);
    return castServer.status();
  });

  /** Switch the cast to mirror mode capturing the calling window. */
  ipcMain.handle('cast:setMirror', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window for cast source');
    castServer.setMirrorSource(win);
    return castServer.status();
  });

  /** Push a self-contained HTML document to all connected receivers.
   *  The renderer builds the HTML (via `buildCastHtml`) and calls
   *  this whenever the source song / transpose / mode changes. */
  ipcMain.handle('cast:setHtml', (_event, html: string) => {
    castServer.setHtmlPayload(html);
    return castServer.status();
  });
}
