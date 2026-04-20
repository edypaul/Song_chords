# Mobile Feature Parity Audit

Comparison of desktop (Electron) vs mobile (Expo/React Native) feature implementation.

## Implemented on Mobile

| Feature | Desktop | Mobile | Notes |
|---------|---------|--------|-------|
| Song library (list, search) | Yes | Yes | Mobile uses FlatList with search + key filter chips |
| Song viewer (transpose, capo, view modes) | Yes | Yes | `app/song/[id].tsx` |
| Song editor (create/edit) | Yes | Yes | `app/song/new.tsx`, `app/song/[id]/edit.tsx` |
| Set lists (list, create, delete) | Yes | Yes | `app/(tabs)/setlists.tsx` |
| Set list detail | Yes | Yes | `app/setlist/[id].tsx` |
| Set list player | Yes | Yes | `app/setlist/[id]/player.tsx` |
| Import (ChordPro + plaintext) | Yes | Yes | Uses expo-document-picker |
| Settings (theme, instrument, flats, scroll speed) | Yes | Yes | Full settings screen |
| Song view style presets + custom presets | Yes | Yes | Comprehensive preset UI |
| Song layout (centered, chord bar position) | Yes | Yes | In settings |
| Performance mode settings | Yes | Yes | Metro/scroll/zoom config |
| Dark/light/system theme | Yes | Yes | |

## Missing on Mobile

| Feature | Status | Effort |
|---------|--------|--------|
| **Chord library page** | Not implemented | Medium - no tab/screen exists for browsing all chord diagrams |
| **ChordPro export** | Not implemented | Low - `exportToChordPro` exists in shared, just needs UI wiring |
| **Library sort controls** | Not implemented | Low - only key filter chips; no sort-by title/artist/updatedAt UI |
| **Setlist drag-drop reorder** | Not implemented | Medium - no drag handles or reorder UI for setlist songs |
| **Keyboard shortcuts** | N/A | Not applicable on mobile |
| **Drag-drop file import** | N/A | Not applicable - uses document picker instead |

## Implemented (verified by audit)

These features were initially uncertain but are confirmed present on mobile:

| Feature | Notes |
|---------|-------|
| **Chord diagrams (bar + inline)** | Implemented with staff lines and repeat marks |
| **Auto-scroll** | Duration-based speed calculation |
| **Metronome** | Uses haptic feedback for beats (mobile-specific advantage) |
| **Pinch-to-zoom** | Native gesture support |
| **Performance mode** | Fullscreen with auto-scroll + metronome |

## Mobile-Only Features

| Feature | Notes |
|---------|-------|
| Haptic feedback | expo-haptics available in dependencies |
| Native file sharing | expo-sharing for share sheet integration |
| Bottom tab navigation | Tab bar UX (Library, Set Lists, Settings) |

## Recommendations (Priority Order)

1. **Add ChordPro export** - Lowest effort, highest value. Wire `exportToChordPro` + `expo-sharing` for share sheet.
2. **Add library sort controls** - Low effort. Add sort-by dropdown matching desktop (title, artist, key, updatedAt).
3. **Add setlist reorder** - Medium effort. Use `react-native-draggable-flatlist` (already in dependencies via gesture handler).
4. **Add chord library tab** - Medium effort. Add a new tab or modal screen for browsing all chord diagrams.
