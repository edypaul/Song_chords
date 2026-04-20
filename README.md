# Song Chords

A cross-platform chord chart and song management app for musicians, inspired by the best features of OnSong, SongBook Pro, and Songbook.

- **Android** — React Native (Expo)
- **Windows** — Electron + React

## Features

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Song library with search & filter | ✅ | ✅ |
| ChordPro format parsing & display | ✅ | ✅ |
| Transpose (up/down semitones) | ✅ | ✅ |
| Capo support | ✅ | ✅ |
| Auto-scroll (adjustable speed) | ✅ | ✅ |
| Set list management | ✅ | ✅ |
| Performance mode (fullscreen) | ✅ | ✅ |
| Chord diagrams (guitar/ukulele) | ✅ | planned |
| Dark / light / system theme | ✅ | ✅ |
| Import ChordPro & plain text | ✅ | ✅ |
| Export ChordPro | ✅ | — |
| Local SQLite database | ✅ | ✅ |
| Sort/filter by key, artist | ✅ | ✅ |
| View modes: chords / lyrics only | ✅ | ✅ |
| Adjustable font size | ✅ | ✅ |

## Project Structure

```
song_chords/
├── packages/
│   ├── shared/          # Shared logic: parser, transposer, DB, stores
│   ├── desktop/         # Electron + React (Windows)
│   └── mobile/          # Expo React Native (Android)
├── package.json         # Yarn workspaces root
└── tsconfig.base.json
```

## Prerequisites

- **Node.js** 18+
- **Yarn** (classic, v1): `npm install -g yarn`
- **For Android**: Expo CLI + Android Studio or Expo Go app
- **For Windows build**: nothing extra (Electron builds locally)

## Installation

```bash
# From the project root
yarn install
```

This installs all dependencies for all three packages.

## Running the Desktop App (Windows)

```bash
# Development mode (hot reload)
yarn desktop

# Or directly:
cd packages/desktop
yarn dev
```

The Electron window will open automatically. The SQLite database is stored in:
`%APPDATA%\song-chords\song-chords.db`

### Build for Distribution (Windows installer)
```bash
cd packages/desktop
yarn package
# Output: packages/desktop/release/
```

## Running the Mobile App (Android)

```bash
# Start the Expo dev server
yarn mobile

# Or:
cd packages/mobile
yarn start
```

Then:
- **Physical device**: Install [Expo Go](https://expo.dev/go) and scan the QR code
- **Emulator**: Press `a` in the terminal to open on Android emulator

### Build APK
```bash
cd packages/mobile
# Install EAS CLI first: npm install -g eas-cli
eas build --platform android --profile preview
```

## ChordPro Format

Songs are stored in [ChordPro](https://www.chordpro.org/) format:

```
{title: Amazing Grace}
{artist: Traditional}
{key: G}
{tempo: 72}

{verse: Verse 1}
[G]Amazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a [D]wretch like [G]me

{chorus}
[C]How great thou [G]art
[D7]How great thou [G]art
```

## Importing Songs

**Desktop**: File > Import Song... (or drag and drop onto the Import page)
**Mobile**: Use the Import screen (accessible from the song edit page)

Supported formats:
- `.cho`, `.chordpro`, `.chopro`, `.crd` — ChordPro
- `.txt` — Plain text (chord lines detected automatically)

## Architecture

The `shared` package contains all business logic shared between both platforms:

- **ChordPro parser** — `packages/shared/src/parser/chordpro-parser.ts`
- **Transposer** — `packages/shared/src/transpose/transposer.ts`
- **Database interface + repositories** — `packages/shared/src/db/`
- **Zustand stores** — `packages/shared/src/store/`
- **Chord diagrams** — `packages/shared/src/chord-diagrams/`

Each platform implements the `IDatabase` interface differently:
- **Desktop**: `better-sqlite3` (synchronous, via Electron IPC to main process)
- **Mobile**: `expo-sqlite` (async API)

## Keyboard Shortcuts (Desktop)

| Shortcut | Action |
|----------|--------|
| `Ctrl+Up` | Transpose up |
| `Ctrl+Down` | Transpose down |
| `Space` | Toggle auto-scroll |
| `Escape` | Go back |
| `→` / `PageDown` | Next song (in set list player) |
| `←` / `PageUp` | Previous song (in set list player) |
| `Ctrl+N` | New song |
| `Ctrl+O` | Import song |
