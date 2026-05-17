import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import { join } from 'path';
import { appendFileSync, mkdirSync } from 'fs';
import { setupDatabase } from './db/better-sqlite-adapter';
import { registerIpcHandlers } from './ipc-handlers';
import { castServer } from './cast-server';
import { registerAudioProtocolPrivileges, registerAudioProtocolHandler } from './audio-protocol';
import { startRendererServer, stopRendererServer } from './renderer-server';

// Register custom protocols as privileged BEFORE app.ready.
// `registerSchemesAsPrivileged` is a one-shot call that must run at
// module load time, not inside whenReady.
registerAudioProtocolPrivileges();

let rendererUrl: string | null = null;
import { migrations } from '@song-chords/shared';

let mainWindow: BrowserWindow | null = null;

// Writes unhandled startup errors to %APPDATA%\Song Chords\startup-error.log so
// silent no-open failures on end-user machines can be diagnosed after the fact.
function logFatal(err: unknown): void {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'startup-error.log');
    const stamp = new Date().toISOString();
    const msg = err instanceof Error ? `${err.stack ?? err.message}` : String(err);
    appendFileSync(logPath, `[${stamp}] ${msg}\n\n`);
  } catch {
    // Nothing useful we can do if logging itself fails.
  }
}

process.on('uncaughtException', (err) => {
  logFatal(err);
  try {
    dialog.showErrorBox('Song Chords — startup error', String(err instanceof Error ? err.stack ?? err.message : err));
  } catch { /* dialog may not be ready yet */ }
});
process.on('unhandledRejection', (reason) => {
  logFatal(reason);
});

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // Mac keeps its native traffic lights via `hiddenInset` (the bar is
    // hidden but the buttons remain in their corner). Windows / Linux
    // are frameless — the renderer draws the entire title bar including
    // minimize / maximize / close.
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    frame: isMac ? true : false,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  // Notify the renderer when the window's maximize state changes so the
  // custom title bar can swap its maximize/restore icon. Sent on every
  // transition.
  const emitMaxState = () => {
    mainWindow?.webContents.send('window:max-state', mainWindow?.isMaximized() ?? false);
  };
  mainWindow.on('maximize', emitMaxState);
  mainWindow.on('unmaximize', emitMaxState);

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev: Vite dev server.
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else if (rendererUrl) {
    // Packaged: load via the local HTTP server (loopback only). Real
    // HTTP origin is required by third-party iframe embeds (YouTube
    // etc.) that refuse `file://` and also reject custom protocols.
    mainWindow.loadURL(rendererUrl);
  } else {
    // Should never happen — server starts before createWindow. Fall
    // back to file load so the user at least sees something.
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // Install a minimal hidden menu that only carries the standard edit
  // accelerators (undo / redo / cut / copy / paste / selectAll). Without
  // this, setApplicationMenu(null) strips those accelerators and keyboard
  // shortcuts like Ctrl+C / Ctrl+V stop working inside native inputs such
  // as the <input type="color"> hex field.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      // Hidden View menu that lets the user open DevTools with the
      // standard shortcuts (F12 / Ctrl+Shift+I). Without this, the
      // shortcuts don't fire because there's no menu to dispatch
      // them. We don't show the menu bar (`setMenuBarVisibility(false)`
      // in createWindow), but accelerators still work.
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]));

  const db = await setupDatabase();
  await db.runMigrations(migrations);
  registerIpcHandlers(db);
  // Bind handlers for our custom protocols now that `app.ready` has
  // resolved. `song-audio://` streams local audio files for the
  // floating audio panel.
  registerAudioProtocolHandler();

  // Spin up the loopback HTTP server that hosts the bundled renderer.
  // Skipped in dev — Vite's dev server already does this job.
  if (!process.env['ELECTRON_RENDERER_URL']) {
    try {
      const info = await startRendererServer(join(__dirname, '../renderer'));
      rendererUrl = info.url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[renderer-server] failed to start, falling back to file://', err);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err) => {
  logFatal(err);
  try {
    dialog.showErrorBox('Song Chords — startup failed', String(err instanceof Error ? err.stack ?? err.message : err));
  } catch { /* ignore */ }
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Tear down the local servers before the app exits so OS resources
// are released cleanly. Cast server runs only when the user has
// started a cast; the renderer server runs for the lifetime of the
// app.
app.on('before-quit', () => {
  void castServer.stop();
  void stopRendererServer();
});
