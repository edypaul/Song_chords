/**
 * Helpers for the song-audio playback path. Decides whether a song's
 * audio source is a local file or a remote URL, and converts an
 * absolute path into the `song-audio://` protocol URL the main
 * process serves. Mirrors the encoding used in
 * `electron/main/audio-protocol.ts`.
 */

export type AudioSourceKind = 'file' | 'url' | 'none';

export interface AudioSource {
  kind: AudioSourceKind;
  /** Playable URL — `song-audio://...` for files, the raw URL for
   *  remote sources. Empty when `kind === 'none'`. */
  url: string;
  /** The original input (file path or pasted URL), kept so the panel
   *  can show "Open in browser" / display the filename. */
  raw: string;
}

/** Pick the right source for a song. Local file beats remote link
 *  when both are set. */
export function resolveAudioSource(
  audioFile: string | undefined,
  link: string | undefined,
): AudioSource {
  const file = audioFile?.trim();
  if (file) return { kind: 'file', url: pathToAudioUrl(file), raw: file };
  const url = link?.trim();
  if (url) return { kind: 'url', url, raw: url };
  return { kind: 'none', url: '', raw: '' };
}

/** Convert an absolute file path to a `song-audio://local/<encoded>`
 *  URL the main process serves via its custom protocol.
 *
 *  We base64url-encode the path so Chromium's URL normalisation
 *  (which strips colons, collapses slashes, etc.) leaves it alone.
 *  The main-process handler decodes the same way. */
export function pathToAudioUrl(absPath: string): string {
  const encoded = base64UrlEncode(absPath);
  return `song-audio://local/${encoded}`;
}

function base64UrlEncode(s: string): string {
  // Standard btoa works on Latin-1 strings; we encode UTF-8 first so
  // non-ASCII paths (accents, spaces in filenames) survive intact.
  const utf8 = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Just the bare filename — for tooltip / panel header display. */
export function fileBasename(absPath: string): string {
  const parts = absPath.split(/[\\/]+/);
  return parts[parts.length - 1] ?? absPath;
}
