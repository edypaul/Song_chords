import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname, join, normalize, resolve } from 'path';

/**
 * Local HTTP server that serves the bundled renderer assets to the
 * BrowserWindow over `http://127.0.0.1:<port>`. Replaces the previous
 * `app://` custom protocol approach — third-party iframe embeds like
 * YouTube's player will refuse non-`http(s)` parent origins regardless
 * of how privileged the custom scheme is, so we give them a real
 * loopback HTTP origin.
 *
 *   - **Port**: ephemeral (`listen(0)`) so we never collide with
 *     anything else on the machine.
 *   - **Bind**: `127.0.0.1` only — never reachable from other devices
 *     on the LAN. (The cast feature has its own separate server that
 *     binds to all interfaces.)
 *   - **Cache**: `no-store` so a freshly-installed update isn't
 *     served from a cached previous build.
 *   - **SPA fallback**: any unknown path returns `index.html` so the
 *     hash router resolves cleanly even on hard refreshes.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.map':  'application/json; charset=utf-8',
};

let server: Server | null = null;
let activePort = 0;

export async function startRendererServer(rendererRoot: string): Promise<{ host: string; port: number; url: string }> {
  const root = resolve(rendererRoot);
  if (server && activePort > 0) {
    return { host: '127.0.0.1', port: activePort, url: `http://127.0.0.1:${activePort}/` };
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const s = createServer((req, res) => void serve(req, res, root));
    s.on('error', rejectPromise);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      server = s;
      activePort = port;
      // eslint-disable-next-line no-console
      console.log(`[renderer-server] serving ${root} on http://127.0.0.1:${port}`);
      resolvePromise({ host: '127.0.0.1', port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

export async function stopRendererServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((res) => server!.close(() => res()));
  server = null;
  activePort = 0;
}

async function serve(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!pathname || pathname.endsWith('/')) pathname += 'index.html';
    let filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    let s;
    try {
      s = await stat(filePath);
      if (s.isDirectory()) {
        filePath = join(filePath, 'index.html');
        s = await stat(filePath);
      }
    } catch {
      // SPA fallback — anything that doesn't exist on disk falls
      // back to index.html so the hash router can take over.
      filePath = join(root, 'index.html');
      try { s = await stat(filePath); }
      catch { res.writeHead(404); res.end('Not found'); return; }
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': s.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[renderer-server] error', err);
    try { res.writeHead(500); res.end('Server error'); } catch { /* socket gone */ }
  }
}
