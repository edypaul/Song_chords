import { protocol, net } from 'electron';
import { pathToFileURL } from 'url';

/**
 * Custom protocol that streams local audio files to the renderer via
 * `<audio src="song-audio://...">`. Lets the floating player play
 * arbitrary on-disk mp3/wav/etc. without bundling Node's `fs.readFile`
 * → base64 (which would load the entire file into memory) and without
 * exposing the renderer to raw `file://` URLs (which Chromium blocks
 * for security).
 *
 *   - Path encoding: the renderer URL-encodes the absolute file path
 *     and appends it as the URL's pathname. The handler decodes it
 *     back, then defers to `net.fetch` against a `file://` URL — net
 *     handles range requests, MIME sniffing, and streaming for us.
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

/** Wire up the actual handler. Call once after `app.whenReady()`. */
export function registerAudioProtocolHandler(): void {
  protocol.handle(AUDIO_PROTOCOL, async (req) => {
    try {
      // We encode the absolute path as base64url in the URL's pathname.
      // That keeps the path opaque to Chromium's URL normalization
      // (which would otherwise strip colons, normalize backslashes,
      // collapse repeated slashes, etc. on Windows paths).
      const url = new URL(req.url);
      const encoded = url.pathname.replace(/^\/+/, '');
      const absPath = base64UrlDecode(encoded);
      // eslint-disable-next-line no-console
      console.log('[audio-protocol] resolving', absPath);
      const fileUrl = pathToFileURL(absPath).toString();
      return await net.fetch(fileUrl, { bypassCustomProtocolHandlers: true });
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
