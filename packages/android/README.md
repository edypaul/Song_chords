# Song Chords — Android (Native Kotlin)

Native Android app for Song Chords, built with **Kotlin**, **Jetpack Compose**, and **Room** (SQLite).

This replaces the previous React Native / Expo mobile package. Shares no code with the Electron desktop app — the core logic (ChordPro parser, transposer, data layer) is re-implemented in Kotlin.

## Requirements

- **Android Studio** Koala (2024.1) or newer — downloads the right Gradle, JDK, and SDK automatically
- **Android SDK** with platform 35 (Android 15) and build-tools 35.0.0
- **JDK 17** (bundled with Android Studio)

If you want to build from the command line outside Android Studio, you also need:
- `ANDROID_HOME` environment variable pointing to your SDK (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`)
- `JAVA_HOME` pointing to a JDK 17

## First-time setup

1. Open **Android Studio**
2. **File → Open** → select this `packages/android/` folder
3. Wait for Gradle sync to finish (downloads dependencies, ~5 min first time)
4. If prompted to install the Gradle wrapper, accept
5. Android Studio will also prompt to install any missing SDK components — accept

## Running the app

### On an Android emulator
1. Open the **Device Manager** (Tools → Device Manager)
2. Create a new virtual device if you don't have one (Pixel 6, API 34 or 35 recommended)
3. Start the emulator (▶ button)
4. Click **Run 'app'** (green play button) in the toolbar, OR press **Shift+F10**

### On a physical device
1. Enable **USB Debugging** on your phone (Settings → About phone → tap Build number 7 times → Developer options → USB debugging)
2. Connect via USB and approve the debugging prompt
3. Select your device from the device dropdown
4. Click **Run 'app'**

## Project structure

```
packages/android/
├── app/
│   ├── build.gradle.kts          # App module build config
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/songchords/app/
│       │   ├── MainActivity.kt           # Entry point + navigation
│       │   ├── SongChordsApp.kt          # Application class (DI container)
│       │   ├── parser/                   # ChordPro parser (Kotlin)
│       │   │   ├── ParserTypes.kt
│       │   │   └── ChordProParser.kt
│       │   ├── transpose/
│       │   │   └── Transposer.kt         # Semitone + capo math
│       │   ├── data/                     # Room database layer
│       │   │   ├── AppDatabase.kt
│       │   │   ├── SongRepository.kt
│       │   │   ├── SetListRepository.kt
│       │   │   ├── entities/             # Room @Entity classes
│       │   │   └── dao/                  # Room @Dao interfaces
│       │   ├── viewmodel/                # Android ViewModels
│       │   │   ├── LibraryViewModel.kt
│       │   │   ├── SongViewModel.kt
│       │   │   └── ViewModelFactory.kt
│       │   └── ui/                       # Jetpack Compose screens
│       │       ├── theme/                # Material 3 theme
│       │       ├── library/              # Song list screen
│       │       └── song/                 # Song view + renderer
│       └── res/                          # Android resources
├── build.gradle.kts              # Project-level build config
├── settings.gradle.kts           # Module list + plugin repositories
└── gradle.properties             # Gradle JVM + feature flags
```

## Features implemented

- **Library screen** — list all songs with search, sortable by title/artist/key/date
- **Song view screen** — view chord charts with transpose up/down, font size controls
- **ChordPro parser** — full port of the TypeScript parser: directives, sections, inline chords, chord grids, comments
- **Transposer** — semitone shifts for chords and keys, with flat/sharp preference and capo math
- **Room database** — local SQLite with `songs`, `setlists`, `setlist_entries` tables
- **Material 3 theme** — light/dark scheme following system
- **Navigation** — Compose Navigation between library and song view

## Features to add next

- Song editor (create/edit songs with metadata)
- Set lists (list, create, add/remove songs, player)
- Settings screen (theme, instrument, font sizes, etc.)
- Chord library (browse all chord diagrams)
- Import from ChordPro/plain text files
- Chord diagram rendering (SVG fretboard)
- Auto-scroll
- Metronome (native audio via `SoundPool` or `AudioTrack`)
- Performance mode
- Export to ChordPro

## Architecture notes

- **Single-activity**: One `MainActivity` with Compose Navigation for all screens
- **No DI framework**: Application class holds singletons (database, repos); ViewModels constructed via `AppViewModelFactory`. Can migrate to Hilt later if complexity grows
- **StateFlow for reactive state**: ViewModels expose `StateFlow<T>` that Compose collects with `collectAsStateWithLifecycle`
- **Coroutines + Flow**: DAOs return `Flow<List<Entity>>`, Repository methods are `suspend`, ViewModelScope for lifecycle-aware launches
- **Pure Kotlin logic**: Parser and transposer have no Android dependencies — can be unit tested with JUnit

## Desktop app unchanged

The Electron desktop app at `packages/desktop/` is untouched and still uses the TypeScript shared layer at `packages/shared/`. Run it with:

```bash
yarn desktop    # from the repo root
```
