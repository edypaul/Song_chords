/**
 * A favorited song carries a saved snapshot of the song's key/capo/tempo etc.
 * at the moment it was favorited, plus user edits made from the favorites
 * context (transpose, capo). This keeps the favorite independent from later
 * edits to the underlying song — same pattern as setlist entries.
 */
export interface FavoriteEntry {
  songId: string;
  transpose: number;
  capo: number;
  key?: string;
  tempo?: number;
  timeSig?: string;
  addedAt: number;
}
