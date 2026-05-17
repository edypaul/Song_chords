import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { networkInterfaces } from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserWindow } from 'electron';

/**
 * Local cast server — broadcasts content to receivers on the same
 * Wi-Fi network. Two modes:
 *
 *   - **mirror** (`setMirrorSource(window)`): capture the given
 *     BrowserWindow at ~5 fps, encode to JPEG, broadcast as base64
 *     data URLs. Used by the Cast page's full-app mirror.
 *
 *   - **html** (`setHtmlPayload(html)`): send a single self-contained
 *     HTML document over the WebSocket. The receiver replaces its
 *     own document with it. Used by the per-song "Lyrics only" /
 *     "Lyrics + chords" cast modes from the song toolbar.
 *
 * Switching modes via the corresponding setter is the only way to
 * change behavior — the server doesn't try to do both at once.
 */

export type CastView = 'app' | 'song' | 'fullscreen' | 'performance';
export type CastBroadcastMode = 'mirror' | 'html' | 'idle';

export interface CastStatus {
  running: boolean;
  host: string | null;
  port: number | null;
  clients: number;
  view: CastView;
  mode: CastBroadcastMode;
}

const DEFAULT_PORT = 4321;
const FRAME_INTERVAL_MS = 200;
const JPEG_QUALITY = 70;

function getLocalIp(): string {
  const ifaces = networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push(net.address);
    }
  }
  const home = candidates.find((ip) => ip.startsWith('192.168.'));
  if (home) return home;
  const ten = candidates.find((ip) => ip.startsWith('10.'));
  if (ten) return ten;
  const onetwo = candidates.find((ip) => {
    const m = ip.match(/^172\.(\d+)\./);
    if (!m) return false;
    const second = parseInt(m[1]!, 10);
    return second >= 16 && second <= 31;
  });
  if (onetwo) return onetwo;
  const real = candidates.find((ip) => !ip.startsWith('169.254.'));
  if (real) return real;
  return candidates[0] ?? '127.0.0.1';
}

/**
 * Inline HTML for the receiver page. Self-contained — no React, no
 * external deps. The WebSocket carries one of three message kinds:
 *   - `data:image/jpeg;base64,...` strings → JPEG mirror frames,
 *     dropped into the `<img>` tag.
 *   - JSON with `{"type":"html","html":"..."}` → full HTML document
 *     payload; the receiver swaps its own document for it.
 *   - JSON with `{"type":"clear"}` → reset to the connecting screen.
 *
 * The receiver auto-reconnects on disconnect.
 */
function receiverHtml(view: CastView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Song Chords — Cast (${view})</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    /* Use the dynamic viewport units so the receiver always sizes to
       the visible area, not the full document height. Without this,
       on desktop browsers the captured frame slightly overflows the
       visible viewport (the browser's URL bar / tab strip pushes the
       top of the image off-screen). 100dvh is supported on all
       evergreen browsers; the 100% fallback keeps very old browsers
       working. */
    height: 100%;
    height: 100dvh;
    width: 100%;
    width: 100dvw;
    background: #0f172a;
    color: #94a3b8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  #frame {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    /* Always preserve the WHOLE desktop window on the receiver — top
       toolbar, sidebar, and content — even when the receiver's aspect
       ratio differs from the desktop window. object-fit contain
       guarantees no cropping; any extra space becomes a thin
       letterbox bar that blends with the dark page background.
       Sizing the frame with 100dvh ensures we use the VISIBLE
       viewport, so the browser's URL bar / tab strip can't push the
       top of the image off-screen. */
    object-fit: contain;
    background: #0f172a;
    display: none;
  }
  /* Phone in portrait orientation: rotate the source 90 degrees so
     the wide desktop window fills the tall screen comfortably. The
     transform-origin centers around the viewport. With width / height
     swapped via 100vh / 100vw and the rotate, the captured frame
     uses the full screen real estate without forcing the user to
     hold the phone sideways. */
  @media (max-width: 640px) and (orientation: portrait) {
    #frame {
      width: 100vh;
      height: 100vw;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(90deg);
      transform-origin: center center;
      inset: auto;
    }
  }
  /* HTML payload host — fills the viewport when active. The
     payload itself sets its own background / padding / fonts. */
  #html-host {
    position: fixed;
    inset: 0;
    overflow: auto;
    background: #0f172a;
    display: none;
  }
  #html-host iframe { width: 100%; height: 100%; border: 0; display: block; }
  #status {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    text-align: center;
    pointer-events: none;
  }
  #status .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f59e0b;
    box-shadow: 0 0 6px #f59e0b;
    animation: pulse 1s ease-in-out infinite;
  }
  #status.live .dot { background: #22c55e; box-shadow: 0 0 6px #22c55e; animation: none; }
  #status .label { font-size: 13px; letter-spacing: 0.04em; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  /* Receiver-side fullscreen toggle. Sits in the top-right corner so
     it doesn't cover lyrics; only visible on hover / tap so it
     doesn't permanently dim a corner of the cast view. */
  #fs-toggle {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 100;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.65);
    color: #f1f5f9;
    border: 1px solid rgba(241, 245, 249, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.35;
    transition: opacity 180ms;
    -webkit-tap-highlight-color: transparent;
  }
  #fs-toggle:hover, #fs-toggle:focus, body:hover #fs-toggle { opacity: 1; }
  #fs-toggle svg { width: 16px; height: 16px; display: block; }
  @media (hover: none) {
    /* Touch devices don't fire hover — keep the button visible. */
    #fs-toggle { opacity: 0.7; }
  }
</style>
</head>
<body>
  <img id="frame" alt="cast frame" />
  <div id="html-host"></div>
  <div id="status"><div class="dot"></div><div class="label">Connecting…</div><div class="sub" style="font-size:11px;opacity:0.7;margin-top:4px"></div></div>
  <button id="fs-toggle" aria-label="Toggle full screen" title="Toggle full screen">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path id="fs-icon-enter" d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
      <path id="fs-icon-exit" d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" style="display:none"/>
    </svg>
  </button>
  <script>
    (function () {
      var img = document.getElementById('frame');
      var host = document.getElementById('html-host');
      var status = document.getElementById('status');
      var label = status.querySelector('.label');
      var sub = status.querySelector('.sub');
      var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      var ws;
      var lastFrame = 0;
      var frames = 0;
      var inHtmlMode = false;

      function setSub(t) { if (sub) sub.textContent = t || ''; }

      function showFrame(dataUrl) {
        if (inHtmlMode) {
          host.style.display = 'none';
          host.innerHTML = '';
          inHtmlMode = false;
        }
        img.src = dataUrl;
        frames++;
        if (img.style.display !== 'block') {
          img.style.display = 'block';
          status.style.display = 'none';
          status.classList.add('live');
        }
        lastFrame = Date.now();
      }

      function showHtml(html) {
        // Render the payload inside a sandboxed iframe so its <head>
        // / <body> / <script> can't conflict with the receiver scaffold.
        // srcdoc lets us inject the entire document in one go.
        if (img.style.display === 'block') img.style.display = 'none';
        host.innerHTML = '';
        var iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
        iframe.setAttribute('srcdoc', html);
        host.appendChild(iframe);
        host.style.display = 'block';
        status.style.display = 'none';
        status.classList.add('live');
        inHtmlMode = true;
      }

      function showClear() {
        img.style.display = 'none';
        host.style.display = 'none';
        host.innerHTML = '';
        inHtmlMode = false;
        status.style.display = 'flex';
        status.classList.remove('live');
        label.textContent = 'Waiting…';
        setSub('');
      }

      function handleMessage(data) {
        if (typeof data !== 'string') return;
        // JPEG-frame fast path.
        if (data.charAt(0) === 'd' && data.indexOf('data:image') === 0) {
          showFrame(data);
          return;
        }
        // Otherwise expect JSON.
        var msg;
        try { msg = JSON.parse(data); } catch (e) {
          setSub('Bad message: ' + data.slice(0, 40));
          return;
        }
        if (msg && msg.type === 'html' && typeof msg.html === 'string') {
          showHtml(msg.html);
          return;
        }
        if (msg && msg.type === 'clear') {
          showClear();
          return;
        }
        setSub('Unknown message type: ' + (msg && msg.type));
      }

      function connect() {
        setSub('Connecting to ' + url);
        try {
          ws = new WebSocket(url);
        } catch (err) {
          label.textContent = 'WebSocket failed';
          setSub(String(err && err.message || err));
          setTimeout(connect, 2000);
          return;
        }
        ws.onopen = function () {
          label.textContent = 'Waiting for content…';
          setSub('Connected to ' + url);
        };
        ws.onmessage = function (ev) { handleMessage(ev.data); };
        ws.onclose = function (ev) {
          label.textContent = 'Disconnected. Reconnecting…';
          setSub('Close code ' + ev.code + (ev.reason ? ' (' + ev.reason + ')' : ''));
          status.style.display = 'flex';
          status.classList.remove('live');
          setTimeout(connect, 1500);
        };
        ws.onerror = function () { setSub('WebSocket error'); try { ws.close(); } catch (e) {} };
      }
      connect();

      // Stale-frame watchdog only matters in mirror mode.
      setInterval(function () {
        if (img.style.display === 'block' && Date.now() - lastFrame > 8000) {
          status.style.display = 'flex';
          status.classList.remove('live');
          label.textContent = 'Stream paused…';
          setSub('Last frame ' + Math.floor((Date.now() - lastFrame) / 1000) + 's ago · total ' + frames);
        }
      }, 2000);

      // Fullscreen toggle — uses the browser Fullscreen API on the
      // receiver itself so the audience can hide the URL bar / tab
      // strip and see the cast edge-to-edge. The icon swaps between
      // the four-corners (enter) and inset-corners (exit) glyphs.
      var fsBtn = document.getElementById('fs-toggle');
      var fsEnterIcon = document.getElementById('fs-icon-enter');
      var fsExitIcon = document.getElementById('fs-icon-exit');
      function isInFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
      }
      function syncFsIcon() {
        var on = isInFullscreen();
        if (fsEnterIcon) fsEnterIcon.style.display = on ? 'none' : '';
        if (fsExitIcon) fsExitIcon.style.display = on ? '' : 'none';
      }
      if (fsBtn) {
        fsBtn.addEventListener('click', function () {
          if (isInFullscreen()) {
            var exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
          } else {
            var el = document.documentElement;
            var enter = el.requestFullscreen || el.webkitRequestFullscreen;
            if (enter) {
              try { enter.call(el); } catch (e) { /* user-gesture required, ignore */ }
            }
          }
        });
        document.addEventListener('fullscreenchange', syncFsIcon);
        document.addEventListener('webkitfullscreenchange', syncFsIcon);
      }
    })();
  </script>
</body>
</html>`;
}

class CastServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private clients: Set<WebSocket> = new Set();
  private view: CastView = 'performance';
  private port: number = DEFAULT_PORT;
  private host: string = '127.0.0.1';
  private mirrorWindow: BrowserWindow | null = null;
  private capturing = false;
  private firstFrameLogged = false;
  /** Active broadcast mode. 'idle' is allowed: the server can be running
   *  with no clients yet but no content source either. */
  private mode: CastBroadcastMode = 'idle';
  /** Latest HTML payload (only used when mode === 'html'). New
   *  WebSocket connections receive this immediately after connecting. */
  private htmlPayload: string | null = null;

  async start(window: BrowserWindow, view: CastView): Promise<{ host: string; port: number }> {
    if (this.http) return { host: this.host, port: this.port };

    this.mirrorWindow = window;
    this.view = view;
    this.host = getLocalIp();
    // Default to mirror mode for backward compatibility with the Cast
    // page's full-app mirror behaviour.
    this.mode = 'mirror';

    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => this.handleHttp(req, res));
      const wss = new WebSocketServer({ server: http });

      wss.on('connection', (ws) => {
        // eslint-disable-next-line no-console
        console.log('[cast] client connected, total =', this.clients.size + 1, 'mode =', this.mode);
        this.clients.add(ws);
        ws.on('close', () => {
          this.clients.delete(ws);
          // eslint-disable-next-line no-console
          console.log('[cast] client disconnected, remaining =', this.clients.size);
          if (this.clients.size === 0 && this.mode === 'mirror') this.stopCapture();
        });
        ws.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.warn('[cast] ws error', err);
        });
        // Resume / start whichever broadcast loop is appropriate.
        if (this.mode === 'mirror') {
          if (this.clients.size === 1) this.startCapture();
          void this.captureOne();
        } else if (this.mode === 'html' && this.htmlPayload) {
          // Send the cached HTML payload to the new client right away.
          try { ws.send(JSON.stringify({ type: 'html', html: this.htmlPayload })); }
          catch { /* ignore */ }
        }
      });

      http.on('error', (err) => {
        this.http = null;
        this.wss = null;
        reject(err);
      });

      http.listen(this.port, '0.0.0.0', () => {
        this.http = http;
        this.wss = wss;
        // eslint-disable-next-line no-console
        console.log(`[cast] server listening on http://${this.host}:${this.port} (bound to 0.0.0.0)`);
        resolve({ host: this.host, port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    this.stopCapture();
    this.firstFrameLogged = false;
    this.htmlPayload = null;
    this.mode = 'idle';
    for (const ws of this.clients) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
      this.wss = null;
    }
    if (this.http) {
      await new Promise<void>((resolve) => this.http?.close(() => resolve()));
      this.http = null;
    }
  }

  setView(view: CastView): void { this.view = view; }

  /** Switch to mirror mode and capture the given window. Cancels any
   *  active HTML payload so the next captured frame replaces it on the
   *  receiver. Idempotent. */
  setMirrorSource(window: BrowserWindow): void {
    this.mirrorWindow = window;
    this.firstFrameLogged = false;
    this.htmlPayload = null;
    this.mode = 'mirror';
    if (this.clients.size > 0) this.startCapture();
    // eslint-disable-next-line no-console
    console.log('[cast] mode → mirror');
  }

  /** Switch to HTML payload mode. Caches the document and pushes it to
   *  every connected client. New clients get it on connect. */
  setHtmlPayload(html: string): void {
    this.stopCapture();
    this.htmlPayload = html;
    this.mode = 'html';
    const msg = JSON.stringify({ type: 'html', html });
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(msg); } catch { /* drop for this client */ }
      }
    }
    // eslint-disable-next-line no-console
    console.log('[cast] mode → html, payload size =', html.length, 'bytes');
  }

  status(): CastStatus {
    return {
      running: this.http !== null,
      host: this.http ? this.host : null,
      port: this.http ? this.port : null,
      clients: this.clients.size,
      view: this.view,
      mode: this.mode,
    };
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    // eslint-disable-next-line no-console
    console.log(`[cast] http ${req.method} ${url} from ${req.socket.remoteAddress}`);
    if (url === '/' || url.startsWith('/?')) {
      const html = receiverHtml(this.view);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf8').toString(),
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }

  private startCapture(): void {
    if (this.captureTimer) return;
    this.captureTimer = setInterval(() => void this.captureOne(), FRAME_INTERVAL_MS);
  }

  private stopCapture(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    this.capturing = false;
  }

  private async captureOne(): Promise<void> {
    if (this.mode !== 'mirror') return;
    if (!this.mirrorWindow || this.mirrorWindow.isDestroyed()) {
      // eslint-disable-next-line no-console
      console.warn('[cast] mirror window destroyed, stopping capture');
      this.stopCapture();
      return;
    }
    if (this.clients.size === 0) {
      this.stopCapture();
      return;
    }
    if (this.capturing) return;
    this.capturing = true;
    try {
      const image = await this.mirrorWindow.webContents.capturePage();
      if (image.isEmpty()) {
        // eslint-disable-next-line no-console
        console.warn('[cast] capturePage returned empty image (window minimized?)');
        return;
      }
      const jpeg = image.toJPEG(JPEG_QUALITY);
      if (jpeg.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[cast] toJPEG produced empty buffer');
        return;
      }
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      let sent = 0;
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) {
          try { ws.send(dataUrl); sent++; } catch { /* drop */ }
        }
      }
      if (!this.firstFrameLogged && sent > 0) {
        this.firstFrameLogged = true;
        // eslint-disable-next-line no-console
        console.log('[cast] first frame sent, size =', jpeg.length, 'bytes,', sent, 'client(s)');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cast] capture failed', err);
    } finally {
      this.capturing = false;
    }
  }
}

export const castServer = new CastServer();
