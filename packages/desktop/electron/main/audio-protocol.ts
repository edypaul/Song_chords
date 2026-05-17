import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname } from 'path';
import { Readable } from 'stream';

/**
 * Custom protocol that streams local audio files to the renderer via
 * `<audio src="song-audio://...">`. Lets the floating player play
 * arbitrary on-disk mp3/wav/etc. without loading the whole file into
 * memory and without exposing raw `file://` URLs (which Chromium
 * blocks for security).
 *
 *   - Path encoding: the renderer base64url-encodes the absolute file
 *     path into the URL pathname. The handler decodes it, then serves
 *     the file with EXPLICIT HTTP range support (206 Partial Content
 *     + Accept-Ranges + Content-Range) by streaming the requested byte
 *     window with fs.createReadStream. Explicit range handling is
 *     required for seeking: an <audio> element only treats a source
 *     as seekable if the server advertises range support, otherwise
 *     `currentTime` writes (the slider + ±skip buttons) silently
 *     no-op. Relying on `net.fetch(file://)` to do this was the bug —
 *     the incoming Range header was never forwarded.
 *
 * Must be registered as privileged BEFORE `app.ready` (we call it
 * from index.ts at module load).
 */

export const AUDIO_PROTOCOL = 'song-audio';

/** Register the protocol as privileged. Call once at startup, BEFORE
 *  `app.whenReady()`. */
export function registerAudioProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

/** Minimal extension → MIME map for the common audio container types
 *  users add. Falls back to a generic audio type so playback still
 *  works for anything unusual. */
function mimeForPath(p: string): string {
  switch (extname(p).toLowerCase()) {
    case '.mp3':  return 'audio/mpeg';
    case '.m4a':  return 'audio/mp4';
    case '.aac':  return 'audio/aac';
    case '.wav':  return 'audio/wav';
    case '.ogg':  return 'audio/ogg';
    case '.opus': return 'audio/opus';
    case '.flac': return 'audio/flac';
    case '.weba': return 'audio/webm';
    default:      return 'audio/mpeg';
  }
}

/** Parse a single `bytes=START-END` range against the file size.
 *  Returns null for an unsatisfiable / unparseable range so the
 *  caller can serve the full body instead. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  let start: number;
  let end: number;
  if (hasStart) {
    start = parseInt(m[1]!, 10);
    end = hasEnd ? parseInt(m[2]!, 10) : size - 1;
  } else if (hasEnd) {
    // Suffix range: last N bytes.
    const n = parseInt(m[2]!, 10);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Wire up the actual handler. Call once after `app.whenReady()`. */
export function registerAudioProtocolHandler(): void {
  protocol.handle(AUDIO_PROTOCOL, async (req) => {
    try {
      // The renderer base64url-encodes the absolute path into the URL
      // pathname so Chromium's URL normalization (stripping colons,
      // normalizing backslashes, collapsing slashes on Windows) can't
      // mangle it.
      const url = new URL(req.url);
      const encoded = url.pathname.replace(/^\/+/, '');
      const absPath = base64UrlDecode(encoded);
      const fileSize = (await stat(absPath)).size;
      const contentType = mimeForPath(absPath);

      const range = parseRange(
        req.headers.get('Range') ?? req.headers.get('range'),
        fileSize,
      );

      // A local file is immutable for the lifetime of a playback
      // session, so let Chromium cache the bytes. This is critical for
      // SEEKING: with `no-store` the media element must re-fetch on
      // every seek and cannot reuse already-buffered audio for a
      // BACKWARD seek — Chromium tears down and rebuilds the decode
      // pipeline on each backward scrub, which surfaced as "drag back
      // a little -> jumps to 0 and the slider freezes". Allowing the
      // cache lets backward seeks resolve from buffered data instantly
      // and keeps the pipeline (and `duration`) intact.
      const cacheControl = 'public, max-age=31536000, immutable';

      if (range) {
        // Partial content — this is the response that makes the media
        // element seekable. Without the 206 + Content-Range +
        // Accept-Ranges, the <audio> slider and ±skip buttons can't
        // move the playhead.
        const { start, end } = range;
        const stream = createReadStream(absPath, { start, end });
        // A read error mid-stream must not leave the element with a
        // truncated body (that resets duration -> NaN and currentTime
        // -> 0, exactly the reported freeze). Destroy the web stream
        // so the element sees a clean network error instead.
        stream.on('error', () => { /* surfaced via the stream below */ });
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': cacheControl,
          },
        });
      }

      // Full file — still advertise range support so the element
      // marks itself seekable up-front (subsequent seeks then issue
      // proper Range requests handled above).
      const stream = createReadStream(absPath);
      stream.on('error', () => { /* surfaced via the stream below */ });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': cacheControl,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[audio-protocol] failed to serve', req.url, err);
      return new Response('File not found', { status: 404 });
    }
  });
}

function base64UrlDecode(s: string): string {
  // Convert base64url back to standard base64, pad, decode UTF-8.
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? std : std + '='.repeat(4 - (std.length % 4));
  return Buffer.from(pad, 'base64').toString('utf8');
}
