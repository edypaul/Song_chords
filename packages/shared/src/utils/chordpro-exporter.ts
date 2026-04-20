import type { ParsedSong } from '../types/parser.types';

export function exportToChordPro(song: ParsedSong): string {
  const lines: string[] = [];

  // Metadata directives
  const { metadata } = song;
  if (metadata.title)    lines.push(`{title: ${metadata.title}}`);
  if (metadata.artist)   lines.push(`{artist: ${metadata.artist}}`);
  if (metadata.album)    lines.push(`{album: ${metadata.album}}`);
  if (metadata.key)      lines.push(`{key: ${metadata.key}}`);
  if (metadata.tempo)    lines.push(`{tempo: ${metadata.tempo}}`);
  if (metadata.timeSig)  lines.push(`{time: ${metadata.timeSig}}`);
  if (metadata.capo)     lines.push(`{capo: ${metadata.capo}}`);
  if (metadata.copyright) lines.push(`{copyright: ${metadata.copyright}}`);

  if (lines.length > 0) lines.push('');

  for (const line of song.lines) {
    if (line.isEmpty) {
      lines.push('');
      continue;
    }
    if (line.isSection) {
      const sectionToken = line.tokens[0];
      if (sectionToken?.type === 'section') {
        lines.push(`{${sectionToken.sectionType}${sectionToken.label ? `: ${sectionToken.label}` : ''}}`);
      }
      continue;
    }
    if (line.isComment) {
      const commentToken = line.tokens[0];
      if (commentToken?.type === 'comment') {
        lines.push(`# ${commentToken.text}`);
      }
      continue;
    }
    if (line.isDirective && !line.isSection) {
      // Skip metadata directives (already written above) but preserve unknown ones
      const dirToken = line.tokens[0];
      if (dirToken?.type === 'directive') {
        const metaNames = new Set(['title', 't', 'artist', 'a', 'album', 'key', 'k', 'tempo', 'capo', 'time', 'copyright', 'ccli']);
        if (!metaNames.has(dirToken.name)) {
          lines.push(`{${dirToken.name}${dirToken.value ? `: ${dirToken.value}` : ''}}`);
        }
      }
      continue;
    }

    // Regular line: reconstruct inline chord+lyric
    let lineStr = '';
    for (const token of line.tokens) {
      if (token.type === 'chord') {
        lineStr += `[${token.chord}]`;
      } else if (token.type === 'lyric') {
        lineStr += token.text;
      }
    }
    lines.push(lineStr);
  }

  return lines.join('\n');
}
