# Song Chords — Feature Comparison Report
## Desktop (Electron) vs Android (Kotlin/Compose)
### Date: April 2026

---

## 1. Executive Summary

The desktop app (Electron + React + TypeScript) has approximately **150+ features** across 10 screens. The Android app (Kotlin + Jetpack Compose) currently implements approximately **90 features** across 9 screens. The Android app covers all core CRUD workflows but is missing several advanced features from the desktop version, particularly around customization, performance mode, and advanced chord diagram management.

**Overall parity: ~60%**

---

## 2. Feature-by-Feature Comparison

### 2.1 Library Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Search songs by title/artist | ✅ | ✅ | ✅ Parity |
| Clear search button | ✅ | ✅ | ✅ Parity |
| Song count display | ✅ | ✅ | ✅ Parity |
| New Song button / FAB | ✅ | ✅ | ✅ Parity |
| Song list with title, artist, key, tempo | ✅ | ✅ | ✅ Parity |
| Click song to view | ✅ | ✅ | ✅ Parity |
| Filter by key (chips) | ✅ | ✅ | ✅ Parity |
| Sort by Title/Artist/Key/Updated | ✅ | ✅ | ✅ Parity |
| Sort direction toggle (asc/desc) | ✅ | ✅ | ✅ Parity |
| Filter panel toggle button | ✅ | ✅ | ✅ Parity |
| Empty state with action button | ✅ | ✅ | ✅ Parity |
| Hover effect on rows | ✅ | N/A | N/A (mobile) |

**Library parity: 11/11 (100%) ✅**

### 2.2 Song View Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Back navigation | ✅ | ✅ | ✅ Parity |
| Song title/artist in toolbar | ✅ | ✅ | ✅ Parity |
| Edit button → editor | ✅ | ✅ | ✅ Parity |
| Transpose up/down buttons | ✅ | ✅ | ✅ Parity |
| Transpose display (±N) | ✅ | ✅ | ✅ Parity |
| Reset transpose button | ✅ | ✅ | ✅ Parity |
| Capo selector (0-11) | ✅ | ✅ | ✅ Parity |
| Auto-scroll toggle | ✅ | ✅ | ✅ Parity |
| Auto-scroll speed control | ✅ | ✅ | ✅ Parity |
| Font size A-/A+ | ✅ | ✅ | ✅ Parity |
| View mode selector (3 modes) | ✅ | ✅ | ✅ Parity |
| Metronome button + beat dots | ✅ | ❌ | ❌ Missing (native audio needed) |
| Zoom (Ctrl+Wheel / pinch) | ✅ | ❌ | ❌ Missing |
| Zoom reset button | ✅ | ❌ | ❌ Missing |
| Performance mode (fullscreen) | ✅ | ✅ | ✅ Parity |
| Performance Start/Stop/Pause | ✅ | ✅ | ✅ Parity |
| Chord diagram bar (top/bottom/right) | ✅ | ✅ (top) | ⚠️ Partial (top only) |
| Inline chord diagrams toggle | ✅ | ❌ | ❌ Missing |
| Chord click → diagram modal | ✅ | ✅ | ✅ Parity |
| Chord modal variation browser | ✅ | ✅ | ✅ Parity |
| "Remember variation" for song | ✅ | ❌ | ❌ Missing |
| Style preset selector | ✅ | ❌ | ❌ Missing |
| Key badge in toolbar | ✅ | ✅ | ✅ Parity |
| Song metadata display (key, capo, tempo, time) | ✅ | ✅ | ✅ Parity |
| Keyboard: Ctrl+Up/Down transpose | ✅ | N/A | N/A (mobile) |
| Keyboard: Esc exit perf/back | ✅ | N/A | N/A (mobile) |

**Song View parity: 19/24 applicable features (79%) ⬆️**

### 2.3 Song Editor Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Back navigation | ✅ | ✅ | ✅ Parity |
| Title (required) | ✅ | ✅ | ✅ Parity |
| Artist field | ✅ | ✅ | ✅ Parity |
| Key selector | ✅ | ✅ | ✅ Parity |
| Tempo (BPM) | ✅ | ✅ | ✅ Parity |
| Time Signature selector | ✅ | ✅ | ✅ Parity |
| Capo selector (0-11) | ✅ | ✅ | ✅ Parity |
| Genre (text + quick-select) | ✅ | ✅ | ✅ Parity |
| Duration (m:ss) | ✅ | ✅ | ✅ Parity |
| Format selector (ChordPro/Plain) | ✅ | ✅ | ✅ Parity |
| Notes textarea | ✅ | ✅ | ✅ Parity |
| Content editor (monospace) | ✅ | ✅ | ✅ Parity |
| Details/Song tabs | ✅ | ✅ | ✅ Parity |
| Save button with loading state | ✅ | ✅ | ✅ Parity |
| Delete with confirmation dialog | ✅ | ✅ | ✅ Parity |
| Validation (title required) | ✅ | ✅ | ✅ Parity |
| Save → redirect to song view | ✅ | ✅ | ✅ Parity |
| Delete → redirect to library | ✅ | ✅ | ✅ Parity |

**Song Editor parity: 18/18 (100%)**

### 2.4 Set Lists Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| List all set lists | ✅ | ✅ | ✅ Parity |
| Create new set list | ✅ | ✅ | ✅ Parity |
| Delete set list | ✅ | ✅ | ✅ Parity |
| Set list name display | ✅ | ✅ | ✅ Parity |
| Set list description display | ✅ | ✅ | ✅ Parity |
| Date display | ✅ | ❌ | ❌ Missing |
| Empty state with icon | ✅ | ✅ | ✅ Parity |
| Card layout with icon | ✅ | ✅ | ✅ Parity |
| Create form inline (Enter/Esc) | ✅ | ✅ (dialog) | ⚠️ Different UX |

**Set Lists parity: 7/9 (78%)**

### 2.5 Set List Detail Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Set list name display | ✅ | ✅ | ✅ Parity |
| Song count display | ✅ | ✅ | ✅ Parity |
| Add Song button | ✅ | ✅ | ✅ Parity |
| Add Song search panel | ✅ | ✅ (dialog) | ✅ Parity |
| Perform button | ✅ | ✅ | ✅ Parity |
| Song reorder (drag-drop) | ✅ | ✅ (up/down buttons) | ⚠️ Different UX |
| Song index numbers | ✅ | ✅ | ✅ Parity |
| Song title/artist/key display | ✅ | ✅ | ✅ Parity |
| Remove song button | ✅ | ✅ | ✅ Parity |
| Click song to view | ✅ | ✅ | ✅ Parity |
| Empty state | ✅ | ✅ | ✅ Parity |
| Set list name editing | ✅ | ❌ | ❌ Missing |

**Set List Detail parity: 10/12 (83%)**

### 2.6 Set List Player Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Fullscreen player | ✅ | ❌ | ❌ Missing (placeholder) |
| Close button | ✅ | ❌ | ❌ Missing |
| Set list name display | ✅ | ❌ | ❌ Missing |
| Song position (N/Total) | ✅ | ❌ | ❌ Missing |
| Previous/Next buttons | ✅ | ❌ | ❌ Missing |
| Song indicator dots | ✅ | ❌ | ❌ Missing |
| Transpose controls | ✅ | ❌ | ❌ Missing |
| Auto-scroll toggle | ✅ | ❌ | ❌ Missing |
| Large title/artist display | ✅ | ❌ | ❌ Missing |
| Metadata (key, tempo) | ✅ | ❌ | ❌ Missing |
| Song content rendering | ✅ | ❌ | ❌ Missing |
| Keyboard: Left/Right navigate | ✅ | N/A | N/A (mobile) |
| Keyboard: Esc close | ✅ | N/A | N/A (mobile) |

**Set List Player parity: 0/11 applicable (0%) — NOT IMPLEMENTED**

### 2.7 Import Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| File picker / browse button | ✅ | ✅ | ✅ Parity |
| Multiple file selection | ✅ | ✅ | ✅ Parity |
| ChordPro format support | ✅ | ✅ | ✅ Parity |
| Plain text format support | ✅ | ✅ | ✅ Parity |
| Import results list | ✅ | ✅ | ✅ Parity |
| Success/error icons | ✅ | ✅ | ✅ Parity |
| Error message display | ✅ | ✅ | ✅ Parity |
| Drag-and-drop zone | ✅ | N/A | N/A (mobile) |
| "View" link for imported songs | ✅ | ❌ | ❌ Missing |
| Clear results button | ✅ | ❌ | ❌ Missing |
| Importing state indicator | ✅ | ✅ | ✅ Parity |

**Import parity: 7/9 applicable (78%)**

### 2.8 Chord Library Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Instrument toggle (Guitar/Ukulele) | ✅ | ✅ | ✅ Parity |
| Root note filter | ✅ | ✅ | ✅ Parity |
| Chord type filter (major/minor/7th etc.) | ✅ | ❌ | ❌ Missing |
| Custom chords filter ("My Chords") | ✅ | ❌ | ❌ Missing |
| Chord count display | ✅ | ✅ | ✅ Parity |
| Chord grid with diagrams | ✅ | ✅ | ✅ Parity |
| Click chord → detail modal | ✅ | ❌ | ❌ Missing |
| Variation browser (prev/next/dots) | ✅ | ❌ | ❌ Missing |
| Add custom chord button | ✅ | ❌ | ❌ Missing |
| Interactive fretboard editor | ✅ | ❌ | ❌ Missing |
| Edit/Delete custom chords | ✅ | ❌ | ❌ Missing |

**Chord Library parity: 4/11 (36%)**

### 2.9 Settings Screen

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Theme (System/Light/Dark) | ✅ | ✅ | ✅ Parity |
| Default Instrument (Guitar/Ukulele) | ✅ | ✅ | ✅ Parity |
| Prefer Flat Notation toggle | ✅ | ✅ | ✅ Parity |
| Show Chord Diagrams toggle | ✅ | ✅ | ✅ Parity |
| Auto-Scroll Speed slider | ✅ | ✅ | ✅ Parity |
| Center Song toggle | ✅ | ✅ | ✅ Parity |
| Font Size control | ✅ | ✅ | ✅ Parity |
| Song View Style Presets | ✅ | ❌ | ❌ Missing |
| Save/Update/Rename/Delete presets | ✅ | ❌ | ❌ Missing |
| Font Family selector | ✅ | ❌ | ❌ Missing |
| Lyrics color picker | ✅ | ❌ | ❌ Missing |
| Chords color picker | ✅ | ❌ | ❌ Missing |
| Title font/color/uppercase | ✅ | ❌ | ❌ Missing |
| Details font size | ✅ | ❌ | ❌ Missing |
| Section font/color/bg/uppercase | ✅ | ❌ | ❌ Missing |
| Chorus border color | ✅ | ❌ | ❌ Missing |
| Chord Bar position (Top/Bottom/Right) | ✅ | ❌ | ❌ Missing |
| Inline Chord Diagrams toggle | ✅ | ❌ | ❌ Missing |
| Performance Mode metronome toggle | ✅ | ❌ | ❌ Missing |
| Performance Mode auto-scroll toggle | ✅ | ❌ | ❌ Missing |
| Performance Mode zoom slider | ✅ | ❌ | ❌ Missing |

**Settings parity: 7/21 (33%)**

### 2.10 Song Rendering

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Chord + lyric alignment (monospace) | ✅ | ✅ | ✅ Parity |
| Section headers (styled, uppercase) | ✅ | ✅ | ✅ Parity |
| Chorus left border | ✅ | ✅ | ✅ Parity |
| Comment blocks (colored background) | ✅ | ✅ | ✅ Parity |
| Empty line spacing | ✅ | ✅ | ✅ Parity |
| View mode filtering | ✅ | ✅ | ✅ Parity |
| Chord grid rendering (staff lines) | ✅ | ❌ | ❌ Missing (TODO) |
| Custom font family | ✅ | ❌ | ❌ Missing |
| Custom chord/lyric colors | ✅ | ❌ | ❌ Missing |
| Inline chord diagrams | ✅ | ❌ | ❌ Missing |
| Word-level wrapping (flexbox) | ✅ | ❌ | ❌ Missing (monospace only) |

**Rendering parity: 6/11 (55%)**

### 2.11 Navigation

| Feature | Desktop | Android | Status |
|---------|---------|---------|--------|
| Library nav link | ✅ | ✅ | ✅ Parity |
| Set Lists nav link | ✅ | ✅ | ✅ Parity |
| Chords nav link | ✅ | ✅ | ✅ Parity |
| Settings nav link | ✅ | ✅ | ✅ Parity |
| Import nav link | ✅ | ❌ | ❌ Missing (no tab, accessed via route) |
| Collapsible sidebar | ✅ | N/A | N/A (bottom nav) |
| Active route highlighting | ✅ | ✅ | ✅ Parity |

**Navigation parity: 5/6 applicable (83%)**

---

## 3. Missing Features Summary (Priority Order)

### HIGH PRIORITY (Core functionality gaps)

| # | Feature | Screen | Effort |
|---|---------|--------|--------|
| 1 | **Set List Player** (entire screen) | SetListPlayer | HIGH — full screen with navigation, transpose, auto-scroll, song rendering |
| 2 | ~~**Library sort/filter controls**~~ | ~~Library~~ | ~~✅ DONE~~ |
| 3 | **Chord grid rendering** | SongView/Renderer | MEDIUM — Canvas-based staff lines, bars, beats, repeat markers |
| 4 | **Auto-scroll speed control** | SongView | LOW — slider or input in overflow menu |
| 5 | **Capo range 7-11** | SongView | TRIVIAL — change `(0..6)` to `(0..11)` |

### MEDIUM PRIORITY (Feature completeness)

| # | Feature | Screen | Effort |
|---|---------|--------|--------|
| 6 | **Chord diagram bar** (top/bottom) | SongView | MEDIUM — horizontal LazyRow of ChordDiagramView |
| 7 | **Chord click → diagram modal** | SongView | MEDIUM — dialog with variation browser |
| 8 | **Inline chord diagrams** toggle | SongView | HIGH — render Canvas diagrams inline above chords |
| 9 | **Chord type filter** (major/minor/7th) | ChordLibrary | LOW — add type filter chips |
| 10 | **Chord detail modal** with variations | ChordLibrary | MEDIUM — dialog with prev/next navigation |
| 11 | **Set list name editing** | SetListDetail | LOW — editable title field |
| 12 | **Import "View" link** for saved songs | Import | LOW — navigate to song after import |
| 13 | **Performance mode** (fullscreen, hide toolbar) | SongView | MEDIUM — immersive mode with systemUiController |

### LOW PRIORITY (Polish and customization)

| # | Feature | Screen | Effort |
|---|---------|--------|--------|
| 14 | **Song View Style Presets** | Settings | HIGH — full preset management CRUD |
| 15 | **Font family selector** | Settings | LOW — dropdown with font list |
| 16 | **Color pickers** (lyrics, chords, title, section, chorus border) | Settings | MEDIUM — color picker UI |
| 17 | **Uppercase toggles** (title, sections) | Settings | LOW — boolean settings |
| 18 | **Chord bar position setting** | Settings | LOW — dropdown (top/bottom/right) |
| 19 | **Performance mode settings** (metronome, scroll, zoom) | Settings | LOW — toggles and slider |
| 20 | **Custom chord management** (add/edit/delete) | ChordLibrary | HIGH — interactive fretboard editor |
| 21 | **Metronome** (audio click + visual beat dots) | SongView | HIGH — SoundPool/AudioTrack for low-latency audio |
| 22 | **Pinch-to-zoom** | SongView | MEDIUM — gesture detector + font scale |
| 23 | **Word-level chord wrapping** | Renderer | HIGH — flex-like layout in Compose |
| 24 | **Import clear results** button | Import | TRIVIAL |
| 25 | **Import access from navigation** | Navigation | TRIVIAL — add to overflow menu or 5th tab |

---

## 4. Summary Statistics

| Metric | Value |
|--------|-------|
| Total desktop features (applicable to mobile) | ~130 |
| Features implemented on Android | ~93 |
| **Overall feature parity** | **~72%** |
| Screens at 100% parity | 2 (Song Editor, Library) |
| Screens at 0% parity | 1 (Set List Player) |
| High-priority missing features | 3 |
| Medium-priority missing features | 5 |
| Low-priority missing features | 12 |

---

## 5. Recommendations

### Phase 1 (Immediate — 1-2 days)
1. Fix capo range to 0-11
2. ~~Add library sort/filter controls~~ ✅ DONE
3. Implement Set List Player screen

### Phase 2 (Short-term — 3-5 days)
4. Add chord grid rendering (Canvas)
5. Add chord diagram bar
6. Add chord click → modal
7. Add auto-scroll speed control
8. Add performance mode

### Phase 3 (Medium-term — 1-2 weeks)
9. Inline chord diagrams
10. Chord library detail modal + variations
11. Custom chord management
12. Song view style presets
13. Metronome (native audio)

### Phase 4 (Long-term — polish)
14. Color pickers for lyrics/chords/sections
15. Font family selector
16. Pinch-to-zoom
17. Word-level chord wrapping (Compose equivalent of CSS flex-wrap)
18. Import improvements
