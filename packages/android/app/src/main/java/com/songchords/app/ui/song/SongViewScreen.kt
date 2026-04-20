package com.songchords.app.ui.song

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.audio.Metronome
import com.songchords.app.data.Instrument
import com.songchords.app.data.chords.ChordDefinition
import com.songchords.app.data.chords.GUITAR_CHORDS
import com.songchords.app.data.chords.UKULELE_CHORDS
import com.songchords.app.parser.ParsedSong
import com.songchords.app.parser.Token
import com.songchords.app.transpose.Transposer
import com.songchords.app.ui.components.ChordDiagramView
import com.songchords.app.ui.theme.ChordColor
import com.songchords.app.viewmodel.SettingsViewModel
import com.songchords.app.viewmodel.SongViewModel
import com.songchords.app.viewmodel.SongViewState
import com.songchords.app.viewmodel.ViewMode
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

private fun extractUniqueChords(song: ParsedSong): List<String> {
    val seen = linkedSetOf<String>()
    for (line in song.lines) {
        for (token in line.tokens) {
            if (token is Token.Chord) seen.add(token.chord)
        }
    }
    return seen.toList()
}

/** Parse "m:ss" or "mm:ss" → total seconds. Returns null on empty/invalid. */
private fun parseDurationSeconds(raw: String?): Int? {
    if (raw.isNullOrBlank()) return null
    val parts = raw.trim().split(":")
    if (parts.size != 2) return null
    val m = parts[0].toIntOrNull() ?: return null
    val s = parts[1].toIntOrNull() ?: return null
    if (m < 0 || s < 0 || s >= 60) return null
    val total = m * 60 + s
    return if (total > 0) total else null
}

private fun findChord(name: String, guitar: Boolean): ChordDefinition? {
    val list = if (guitar) GUITAR_CHORDS else UKULELE_CHORDS
    return list.firstOrNull { it.name == name }
        ?: list.firstOrNull { it.name == name.replace("#", "").replace("b", "") }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SongViewScreen(
    songId: String,
    viewModel: SongViewModel,
    settingsViewModel: SettingsViewModel,
    onBack: () -> Unit,
    onEditClick: (String) -> Unit = {},
) {
    LaunchedEffect(songId) { viewModel.loadSong(songId) }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val settings by settingsViewModel.settings.collectAsStateWithLifecycle()
    LaunchedEffect(settings.accidentalMode) { viewModel.setAccidentalMode(settings.accidentalMode) }
    val lazyListState = androidx.compose.foundation.lazy.rememberLazyListState()
    val performanceListState = androidx.compose.foundation.lazy.rememberLazyListState()
    var menuExpanded by remember { mutableStateOf(false) }
    var autoScrollActive by remember { mutableStateOf(false) }
    var autoScrollSpeed by remember { mutableFloatStateOf(40f) }
    var performanceMode by remember { mutableStateOf(false) }
    var chordBarVisible by remember { mutableStateOf(false) }
    var selectedChord by remember { mutableStateOf<String?>(null) }
    val onChordClickStable = remember { { chord: String -> selectedChord = chord } }

    // Metronome state
    val appContext = LocalContext.current.applicationContext
    val metronome = remember { Metronome(appContext) }
    DisposableEffect(metronome) {
        onDispose { metronome.release() }
    }
    var metronomeActive by remember { mutableStateOf(false) }
    var metronomeBeat by remember { mutableIntStateOf(0) }
    val tempo = state.song?.tempo
    // Auto-start/stop metronome and auto-scroll when entering/exiting perf mode
    LaunchedEffect(performanceMode) {
        if (performanceMode) {
            if (settings.perfScrollEnabled) autoScrollActive = true
            if (settings.perfMetroEnabled && (tempo ?: 0) > 0) metronomeActive = true
        } else {
            autoScrollActive = false
            metronomeActive = false
        }
    }
    val beatsPerBar = remember(state.song?.timeSig) {
        state.song?.timeSig?.substringBefore("/")?.toIntOrNull()?.coerceIn(1, 16) ?: 4
    }

    // Run the scheduler on Dispatchers.Default so it doesn't compete with the
    // UI dispatcher (which handles scroll/layout). Audio calls are cheap but
    // keeping them off the main thread prevents any scroll jank.
    LaunchedEffect(metronomeActive, tempo, beatsPerBar) {
        if (!metronomeActive || tempo == null || tempo <= 0) return@LaunchedEffect
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            val periodNanos = 60_000_000_000L / tempo
            var nextTick = System.nanoTime()
            var beat = 0
            metronomeBeat = 0
            while (isActive) {
                metronome.playClick(downbeat = beat == 0)
                metronomeBeat = beat
                beat = (beat + 1) % beatsPerBar
                nextTick += periodNanos
                // Sleep until the next scheduled tick. Drift-free because
                // nextTick is computed from the start time, not cumulative.
                var sleep = nextTick - System.nanoTime()
                while (sleep > 0 && isActive) {
                    // For short sleeps use parkNanos (tighter than delay);
                    // for long ones yield via delay so we stay cancellable.
                    if (sleep < 2_000_000L) { // < 2 ms
                        java.util.concurrent.locks.LockSupport.parkNanos(sleep)
                        break
                    } else {
                        kotlinx.coroutines.delay(minOf(sleep / 1_000_000L, 20L))
                        sleep = nextTick - System.nanoTime()
                    }
                }
            }
        }
    }

    val context = LocalContext.current

    fun setImmersive(on: Boolean) {
        val activity = context as? Activity ?: return
        val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        if (on) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    BackHandler(enabled = performanceMode) {
        performanceMode = false
        setImmersive(false)
    }

    val durationSec = remember(state.song?.duration) { parseDurationSeconds(state.song?.duration) }

    // Auto-scroll — per-frame scroll inside a scroll{} mutator. Sync'd with the
    // display via withFrameNanos; no tween animator, no item-remeasure fighting.
    LaunchedEffect(autoScrollActive, autoScrollSpeed, performanceMode, durationSec) {
        if (!autoScrollActive) return@LaunchedEffect

        val activeListState = if (performanceMode) performanceListState else lazyListState
        while (isActive && activeListState.layoutInfo.visibleItemsInfo.isEmpty()) {
            withFrameNanos { }
        }

        val pxPerSec: Float = if (durationSec != null) {
            val info = activeListState.layoutInfo
            val visible = info.visibleItemsInfo
            val avg = if (visible.isNotEmpty()) visible.sumOf { it.size }.toFloat() / visible.size else 100f
            val totalPx = (avg * info.totalItemsCount).coerceAtLeast(1f)
            totalPx / durationSec
        } else {
            autoScrollSpeed
        }

        if (pxPerSec <= 0f) return@LaunchedEffect

        // Loop so that if the user drags (which cancels our Default-priority
        // scroll via the mutator mutex), we resume auto-scrolling from the
        // new position once the drag ends.
        var reachedEnd = false
        while (isActive && !reachedEnd) {
            try {
                activeListState.scroll(androidx.compose.foundation.MutatePriority.Default) {
                    var last = withFrameNanos { it }
                    while (currentCoroutineContext().isActive) {
                        val now = withFrameNanos { it }
                        val dt = ((now - last).coerceAtLeast(0L)) / 1_000_000_000f
                        last = now
                        val delta = pxPerSec * dt
                        val consumed = scrollBy(delta)
                        if (consumed == 0f && delta > 0f) { reachedEnd = true; return@scroll }
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // Outer scope cancelled — rethrow; otherwise the inner scroll
                // was just preempted by a user gesture, so loop and resume.
                if (!isActive) throw e
            }
            if (!reachedEnd) {
                // Small yield so we don't spin while the user is mid-drag.
                kotlinx.coroutines.delay(16)
            }
        }
        if (reachedEnd) autoScrollActive = false
    }

    // === Performance Mode ===
    if (performanceMode && state.displayedSong != null) {
        val perfSongStyle = com.songchords.app.data.SONG_STYLE_PRESETS[settings.songViewStylePreset]?.style
            ?: settings.customPresets[settings.songViewStylePreset]?.style
            ?: com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE
        PerformanceModeContent(
            state = state,
            listState = performanceListState,
            autoScrollActive = autoScrollActive,
            inlineDiagrams = settings.inlineChordDiagrams,
            instrument = settings.defaultInstrument,
            perfZoom = settings.perfZoom,
            songCentered = settings.songCentered,
            songStyle = perfSongStyle,
            metronomeActive = metronomeActive,
            tempo = tempo,
            beatsPerBar = beatsPerBar,
            metronomeBeatProvider = { metronomeBeat },
            onToggleMetronome = { metronomeActive = !metronomeActive },
            onChordClick = onChordClickStable,
            onToggleScroll = { autoScrollActive = !autoScrollActive },
            onTransposeUp = { viewModel.transposeUp() },
            onTransposeDown = { viewModel.transposeDown() },
            onExit = { performanceMode = false; setImmersive(false) },
        )
        return
    }

    // === Normal Mode ===
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.song?.title ?: "", style = MaterialTheme.typography.titleMedium, maxLines = 1)
                        state.song?.artist?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {},
            )
        }
    ) { padding ->
        // Primary (Main) tab — things you reach for mid-performance.
        val mainTab: @Composable () -> Unit = {
                            // Transpose
                            Text("Transpose", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                IconButton(
                                    onClick = { viewModel.transposeDown() },
                                    modifier = Modifier.size(40.dp),
                                    enabled = state.transposeSteps > -11,
                                ) {
                                    Icon(Icons.Default.KeyboardArrowDown, "Down", modifier = Modifier.size(22.dp))
                                }
                                Box(
                                    modifier = Modifier.width(36.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = if (state.transposeSteps > 0) "+${state.transposeSteps}" else "${state.transposeSteps}",
                                        color = if (state.transposeSteps != 0) ChordColor else MaterialTheme.colorScheme.onSurface,
                                        fontWeight = FontWeight.Bold,
                                        fontFamily = FontFamily.Monospace,
                                    )
                                }
                                IconButton(
                                    onClick = { viewModel.transposeUp() },
                                    modifier = Modifier.size(40.dp),
                                    enabled = state.transposeSteps < 11,
                                ) {
                                    Icon(Icons.Default.KeyboardArrowUp, "Up", modifier = Modifier.size(22.dp))
                                }
                                TextButton(
                                    onClick = { viewModel.resetTranspose() },
                                    enabled = state.transposeSteps != 0,
                                ) {
                                    Text(
                                        "Reset",
                                        color = if (state.transposeSteps != 0) ChordColor else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
                                        fontSize = 13.sp,
                                    )
                                }
                            }
                            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                            // Capo 0-11
                            Text("Capo", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
                            Row(modifier = Modifier.padding(horizontal = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                (0..11).forEach { c ->
                                    FilterChip(selected = state.capo == c, onClick = { viewModel.setCapo(c) }, label = { Text(if (c == 0) "Off" else "$c") }, modifier = Modifier.height(32.dp))
                                }
                            }
                            if (state.capo > 0) {
                                TextButton(
                                    onClick = { viewModel.setCapo(0) },
                                    modifier = Modifier.padding(horizontal = 8.dp),
                                ) { Text("Reset Capo", color = ChordColor, fontSize = 13.sp) }
                            }
                            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                            // Chord bar visibility (disabled if lyrics-only or inline diagrams is on)
                            val lyricsOnlyModeM = state.viewMode == ViewMode.LYRICS_ONLY
                            val chordBarEnabledM = !lyricsOnlyModeM && !settings.inlineChordDiagrams
                            val chordBarOnM = chordBarVisible && chordBarEnabledM
                            DropdownMenuItem(
                                text = { Text(if (chordBarOnM) "Hide Chord Bar" else "Show Chord Bar") },
                                onClick = { chordBarVisible = !chordBarVisible; menuExpanded = false },
                                enabled = chordBarEnabledM,
                                leadingIcon = { Icon(Icons.Default.MusicNote, null, tint = if (chordBarOnM) ChordColor else MaterialTheme.colorScheme.onSurface) },
                            )
                            // Lyrics only
                            DropdownMenuItem(
                                text = { Text(if (state.viewMode == ViewMode.LYRICS_ONLY) "Show Chords" else "Lyrics Only") },
                                onClick = {
                                    viewModel.setViewMode(if (state.viewMode == ViewMode.LYRICS_ONLY) ViewMode.CHORDS else ViewMode.LYRICS_ONLY)
                                    menuExpanded = false
                                },
                                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Subject, null, tint = if (state.viewMode == ViewMode.LYRICS_ONLY) ChordColor else MaterialTheme.colorScheme.onSurface) },
                            )
                            // Inline chord diagrams (disabled in lyrics-only mode or when chord bar is on)
                            val inlineEnabledM = !lyricsOnlyModeM && !chordBarVisible
                            val inlineActiveM = settings.inlineChordDiagrams && inlineEnabledM
                            DropdownMenuItem(
                                text = { Text(if (inlineActiveM) "Hide Inline Diagrams" else "Show Inline Diagrams") },
                                onClick = { settingsViewModel.setInlineChordDiagrams(!settings.inlineChordDiagrams); menuExpanded = false },
                                enabled = inlineEnabledM,
                                leadingIcon = { Icon(Icons.Default.GridOn, null, tint = if (inlineActiveM) ChordColor else MaterialTheme.colorScheme.onSurface) },
                            )
        }

        // Secondary (More) tab — customization that rarely changes mid-song.
        val moreTab: @Composable () -> Unit = {
                            // Scroll speed (duration-driven if song has m:ss)
                            val scrollLabel = if (durationSec != null) {
                                "Scroll Speed: from song duration"
                            } else "Scroll Speed: ${autoScrollSpeed.toInt()}"
                            Text(scrollLabel, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
                            Slider(
                                value = autoScrollSpeed,
                                onValueChange = { autoScrollSpeed = it },
                                valueRange = 5f..100f,
                                enabled = durationSec == null,
                                modifier = Modifier.padding(horizontal = 16.dp).width(200.dp),
                            )
                            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                            // Font size
                            Text("Font Size: ${state.fontSize}", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
                            Row(modifier = Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                TextButton(onClick = { viewModel.setFontSize(state.fontSize - 1) }, modifier = Modifier.widthIn(min = 44.dp)) { Text("A-", fontSize = 14.sp) }
                                TextButton(onClick = { viewModel.setFontSize(state.fontSize + 1) }, modifier = Modifier.widthIn(min = 44.dp)) { Text("A+", fontSize = 14.sp) }
                            }
                            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                            // Song style preset with Dark / Light / Custom filter
                            Text("Song Style", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
                            var styleFilter by remember { mutableStateOf(StyleFilter.DARK) }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceEvenly,
                            ) {
                                StyleFilter.entries.forEach { f ->
                                    FilterChip(
                                        selected = styleFilter == f,
                                        onClick = { styleFilter = f },
                                        label = { Text(f.label, fontSize = 12.sp) },
                                        modifier = Modifier.height(28.dp),
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(
                                modifier = Modifier
                                    .padding(horizontal = 12.dp, vertical = 6.dp)
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                when (styleFilter) {
                                    StyleFilter.DARK -> com.songchords.app.data.SONG_STYLE_PRESETS.values
                                        .filter { it.mode == com.songchords.app.data.PresetMode.DARK }
                                        .forEach { p ->
                                            FilterChip(
                                                selected = settings.songViewStylePreset == p.key,
                                                onClick = { settingsViewModel.setSongViewStylePreset(p.key) },
                                                label = { Text(p.name, fontSize = 12.sp) },
                                                modifier = Modifier.height(32.dp),
                                            )
                                        }
                                    StyleFilter.LIGHT -> com.songchords.app.data.SONG_STYLE_PRESETS.values
                                        .filter { it.mode == com.songchords.app.data.PresetMode.LIGHT }
                                        .forEach { p ->
                                            FilterChip(
                                                selected = settings.songViewStylePreset == p.key,
                                                onClick = { settingsViewModel.setSongViewStylePreset(p.key) },
                                                label = { Text(p.name, fontSize = 12.sp) },
                                                modifier = Modifier.height(32.dp),
                                            )
                                        }
                                    StyleFilter.CUSTOM -> {
                                        if (settings.customPresets.isEmpty()) {
                                            Text(
                                                "No custom presets yet",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.padding(horizontal = 8.dp),
                                            )
                                        } else {
                                            settings.customPresets.values.forEach { p ->
                                                FilterChip(
                                                    selected = settings.songViewStylePreset == p.key,
                                                    onClick = { settingsViewModel.setSongViewStylePreset(p.key) },
                                                    label = { Text(p.name, fontSize = 12.sp) },
                                                    leadingIcon = { Icon(Icons.Default.Star, null, modifier = Modifier.size(12.dp), tint = ChordColor) },
                                                    modifier = Modifier.height(32.dp),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
        }

        val dropdownContent: @Composable () -> Unit = {
            var tab by remember { mutableIntStateOf(0) }
            Column(modifier = Modifier.width(300.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = tab == 0,
                        onClick = { tab = 0 },
                        label = { Text("Main") },
                        modifier = Modifier.weight(1f),
                    )
                    FilterChip(
                        selected = tab == 1,
                        onClick = { tab = 1 },
                        label = { Text("More") },
                        modifier = Modifier.weight(1f),
                    )
                }
                HorizontalDivider()
                Column(modifier = Modifier.padding(top = 4.dp)) {
                    if (tab == 0) mainTab() else moreTab()
                }
            }
        }

        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Controls bar
            Surface(tonalElevation = 1.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceAround,
                ) {
                    val canScroll by remember { derivedStateOf { lazyListState.canScrollForward } }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = { autoScrollActive = !autoScrollActive },
                            enabled = canScroll || autoScrollActive,
                        ) {
                            Icon(
                                if (autoScrollActive) Icons.Default.Pause else Icons.Default.PlayArrow,
                                "Scroll",
                                tint = when {
                                    !canScroll && !autoScrollActive -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                                    autoScrollActive -> ChordColor
                                    else -> MaterialTheme.colorScheme.onSurface
                                },
                            )
                        }
                        state.song?.duration?.takeIf { it.isNotBlank() }?.let { dur ->
                            Text(
                                text = dur,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 2.dp, end = 4.dp),
                            )
                        }
                    }
                    if (tempo != null && tempo > 0) {
                        MetronomeButton(
                            tempo = tempo,
                            beatsPerBar = beatsPerBar,
                            currentBeatProvider = { metronomeBeat },
                            active = metronomeActive,
                            onToggle = { metronomeActive = !metronomeActive },
                        )
                    }
                    IconButton(onClick = { onEditClick(songId) }, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Default.Edit, contentDescription = "Edit", modifier = Modifier.size(20.dp))
                    }
                    IconButton(onClick = { performanceMode = true; setImmersive(true) }, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Default.Fullscreen, contentDescription = "Perform", modifier = Modifier.size(20.dp))
                    }
                    Box {
                        IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(40.dp)) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More", modifier = Modifier.size(20.dp))
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            dropdownContent()
                        }
                    }
                }
            }
            HorizontalDivider()

            // Song content — LazyColumn for virtualization (only visible lines compose)
            val displayedSong = state.displayedSong
            val song = state.song
            val barPos = settings.chordBarPosition
            val showBar = chordBarVisible
                && !settings.inlineChordDiagrams
                && displayedSong != null
                && state.viewMode != ViewMode.LYRICS_ONLY
            val effectiveInline = settings.inlineChordDiagrams
                && !chordBarVisible
                && state.viewMode != ViewMode.LYRICS_ONLY

            val songStyle = com.songchords.app.data.SONG_STYLE_PRESETS[settings.songViewStylePreset]?.style
                ?: settings.customPresets[settings.songViewStylePreset]?.style
                ?: com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE
            val borderColor = songStyle.chorusBorderColor ?: MaterialTheme.colorScheme.primary
            val songContent: @Composable () -> Unit = {
                if (song == null && !state.loading) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) { Text("Song not found") }
                } else {
                    LazyColumn(
                        state = lazyListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                    ) {
                        if (song != null) {
                            item(key = "header") {
                                val family = songStyle.fontFamily.toComposeFontFamily()
                                val ts = songStyle.title
                                val ds = songStyle.details
                                val titleText = if (songStyle.titleUppercase) song.title.uppercase() else song.title
                                Text(
                                    titleText,
                                    fontSize = if (ts.fontSize > 0) ts.fontSize.sp else MaterialTheme.typography.headlineSmall.fontSize,
                                    color = ts.color ?: MaterialTheme.colorScheme.onSurface,
                                    fontFamily = family,
                                    fontWeight = FontWeight.Bold,
                                )
                                if (!song.artist.isNullOrBlank()) {
                                    Text(
                                        song.artist,
                                        fontSize = if (ds.fontSize > 0) ds.fontSize.sp else MaterialTheme.typography.titleSmall.fontSize,
                                        color = ds.color ?: MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontFamily = family,
                                        modifier = Modifier.padding(top = 2.dp),
                                    )
                                }
                                Row(Modifier.padding(top = 8.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    song.key?.let { MetaTag("Key", Transposer.transposeKey(it, state.transposeSteps), ds, family) }
                                    if (state.capo > 0) MetaTag("Capo", "${state.capo}", ds, family)
                                    song.tempo?.let { MetaTag("Tempo", "$it BPM", ds, family) }
                                    song.timeSig?.let { MetaTag("Time", it, ds, family) }
                                }
                            }
                        }
                        if (displayedSong != null) {
                            val groups = groupLines(displayedSong.lines)
                            groups.forEachIndexed { gi, group ->
                                if (group.bordered) {
                                    item(key = "g$gi") {
                                        Row(modifier = Modifier.height(IntrinsicSize.Min).padding(vertical = 4.dp)) {
                                            Box(
                                                modifier = Modifier
                                                    .width(3.dp)
                                                    .fillMaxHeight()
                                                    .background(borderColor),
                                            )
                                            Column(modifier = Modifier.padding(start = 14.dp)) {
                                                group.lines.forEach { line ->
                                                    RenderLine(
                                                        line = line,
                                                        fontSize = state.fontSize,
                                                        viewMode = state.viewMode,
                                                        inlineDiagrams = effectiveInline,
                                                        instrument = settings.defaultInstrument,
                                                        onChordClick = onChordClickStable,
                                                        songStyle = songStyle,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    items(
                                        count = group.lines.size,
                                        key = { li -> "g$gi-$li" },
                                    ) { li ->
                                        RenderLine(
                                            line = group.lines[li],
                                            fontSize = state.fontSize,
                                            viewMode = state.viewMode,
                                            inlineDiagrams = effectiveInline,
                                            instrument = settings.defaultInstrument,
                                            onChordClick = onChordClickStable,
                                            songStyle = songStyle,
                                        )
                                    }
                                }
                            }
                        } else if (state.loading) {
                            item(key = "loading") {
                                Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), Alignment.Center) {
                                    CircularProgressIndicator()
                                }
                            }
                        }
                    }
                }
            }

            when {
                showBar && barPos == com.songchords.app.data.ChordBarPosition.TOP -> {
                    ChordDiagramBar(song = displayedSong!!, instrument = settings.defaultInstrument, orientation = BarOrientation.HORIZONTAL, onChordClick = onChordClickStable, songStyle = songStyle)
                    Box(Modifier.weight(1f, fill = true)) { songContent() }
                }
                showBar && barPos == com.songchords.app.data.ChordBarPosition.BOTTOM -> {
                    Box(Modifier.weight(1f, fill = true)) { songContent() }
                    ChordDiagramBar(song = displayedSong!!, instrument = settings.defaultInstrument, orientation = BarOrientation.HORIZONTAL, onChordClick = onChordClickStable, songStyle = songStyle)
                }
                showBar && barPos == com.songchords.app.data.ChordBarPosition.RIGHT -> {
                    Row(Modifier.weight(1f, fill = true).fillMaxWidth()) {
                        Box(Modifier.weight(1f, fill = true).fillMaxHeight()) { songContent() }
                        ChordDiagramBar(song = displayedSong!!, instrument = settings.defaultInstrument, orientation = BarOrientation.VERTICAL, onChordClick = onChordClickStable, songStyle = songStyle)
                    }
                }
                else -> Box(Modifier.weight(1f, fill = true)) { songContent() }
            }
        }
    }

    // Chord modal
    if (selectedChord != null) {
        val dialogStyle = com.songchords.app.data.SONG_STYLE_PRESETS[settings.songViewStylePreset]?.style
            ?: settings.customPresets[settings.songViewStylePreset]?.style
            ?: com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE
        ChordDetailDialog(chordName = selectedChord!!, instrument = settings.defaultInstrument, onDismiss = { selectedChord = null }, songStyle = dialogStyle)
    }
}

// ---------------------------------------------------------------------------
// Chord Diagram Bar
// ---------------------------------------------------------------------------

private enum class BarOrientation { HORIZONTAL, VERTICAL }

@Composable
private fun ChordDiagramBar(
    song: ParsedSong,
    instrument: Instrument,
    orientation: BarOrientation,
    onChordClick: (String) -> Unit,
    songStyle: com.songchords.app.data.SongViewStyle = com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE,
) {
    val chords = remember(song) { extractUniqueChords(song) }
    if (chords.isEmpty()) return
    val strings = if (instrument == Instrument.GUITAR) 6 else 4
    val isGuitar = instrument == Instrument.GUITAR
    val lineColor = songStyle.lyrics.color ?: MaterialTheme.colorScheme.onSurfaceVariant
    val chordColor = songStyle.chords.color ?: ChordColor

    val diagrams: @Composable (String) -> Unit = { name ->
        val def = findChord(name, isGuitar) ?: ChordDefinition(
            name = name,
            frets = List(strings) { -1 },
            baseFret = 1,
            strings = strings,
        )
        Column(Modifier.clickable { onChordClick(name) }, horizontalAlignment = Alignment.CenterHorizontally) {
            // Chord name uses the lyrics color (matches desktop ChordDiagramBar
            // behaviour where nameColor defaults to lineColor).
            ChordDiagramView(
                chord = def, width = 70.dp, showName = true,
                chordColor = chordColor, lineColor = lineColor, nameColor = lineColor,
            )
        }
    }

    if (orientation == BarOrientation.VERTICAL) {
        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxHeight().width(96.dp)) {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(chords) { name -> diagrams(name) }
            }
        }
        return
    }

    Surface(tonalElevation = 1.dp) {
        LazyRow(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(chords) { name -> diagrams(name) }
        }
    }
    HorizontalDivider()
}

// ---------------------------------------------------------------------------
// Chord Detail Dialog
// ---------------------------------------------------------------------------

private data class ChordVariation(val label: String, val def: ChordDefinition, val found: Boolean)

private fun buildChordVariations(chordName: String, instrument: Instrument): List<ChordVariation> {
    val list = if (instrument == Instrument.GUITAR) GUITAR_CHORDS else UKULELE_CHORDS
    val strings = if (instrument == Instrument.GUITAR) 6 else 4

    // Exact-name voicings first, then simplified-name fallbacks as extra variations.
    val exact = list.filter { it.name == chordName }
    val simplifiedName = chordName.replace("#", "").replace("b", "")
    val simplified = if (simplifiedName != chordName) {
        list.filter { it.name == simplifiedName }
    } else emptyList()

    val variations = mutableListOf<ChordVariation>()
    exact.forEachIndexed { i, def ->
        val label = if (exact.size == 1) chordName else "${chordName} · ${i + 1}"
        variations.add(ChordVariation(label, def, true))
    }
    simplified.forEach { def -> variations.add(ChordVariation("${def.name} (similar)", def, true)) }

    if (variations.isEmpty()) {
        variations.add(ChordVariation(chordName, ChordDefinition(chordName, List(strings) { -1 }, 1, strings), false))
    }
    return variations
}

@Composable
private fun ChordDetailDialog(
    chordName: String,
    instrument: Instrument,
    onDismiss: () -> Unit,
    songStyle: com.songchords.app.data.SongViewStyle = com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE,
) {
    val variations = remember(chordName, instrument) { buildChordVariations(chordName, instrument) }
    val pagerState = rememberPagerState(pageCount = { variations.size })
    val diagramWidth = if (instrument == Instrument.GUITAR) 160.dp else 130.dp
    val lineColor = songStyle.lyrics.color ?: MaterialTheme.colorScheme.onSurfaceVariant
    val chordColor = songStyle.chords.color ?: ChordColor

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(chordName, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, color = chordColor) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxWidth().height(280.dp),
                ) { page ->
                    val v = variations[page]
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(v.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(8.dp))
                        ChordDiagramView(
                            chord = v.def,
                            width = diagramWidth,
                            showName = false,
                            chordColor = chordColor,
                            lineColor = lineColor,
                            nameColor = chordColor,
                        )
                        if (!v.found) {
                            Spacer(Modifier.height(8.dp))
                            Text("No diagram available", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (variations.size > 1) {
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        variations.indices.forEach { i ->
                            val selected = pagerState.currentPage == i
                            Box(
                                modifier = Modifier
                                    .size(if (selected) 10.dp else 8.dp)
                                    .background(
                                        if (selected) chordColor else lineColor.copy(alpha = 0.3f),
                                        CircleShape,
                                    )
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

// ---------------------------------------------------------------------------
// Performance Mode
// ---------------------------------------------------------------------------

@Composable
private fun PerformanceModeContent(
    state: SongViewState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    autoScrollActive: Boolean,
    inlineDiagrams: Boolean,
    instrument: Instrument,
    perfZoom: Float,
    songCentered: Boolean,
    songStyle: com.songchords.app.data.SongViewStyle,
    metronomeActive: Boolean,
    tempo: Int?,
    beatsPerBar: Int,
    metronomeBeatProvider: () -> Int,
    onToggleMetronome: () -> Unit,
    onChordClick: (String) -> Unit,
    onToggleScroll: () -> Unit,
    onTransposeUp: () -> Unit,
    onTransposeDown: () -> Unit,
    onExit: () -> Unit,
) {
    val displayedSong = state.displayedSong ?: return
    val showInline = inlineDiagrams && state.viewMode != ViewMode.LYRICS_ONLY
    val perfFontSize = ((state.fontSize + 2) * perfZoom).toInt().coerceIn(8, 64)
    val borderColor = songStyle.chorusBorderColor ?: MaterialTheme.colorScheme.primary
    val contentAlign = if (songCentered) Alignment.CenterHorizontally else Alignment.Start
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        ) {
            item(key = "__perf_header__") {
                val family = songStyle.fontFamily.toComposeFontFamily()
                val ts = songStyle.title
                val ds = songStyle.details
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = contentAlign,
                ) {
                    val rawTitle = state.song?.title ?: ""
                    val titleText = if (songStyle.titleUppercase) rawTitle.uppercase() else rawTitle
                    Text(
                        titleText,
                        fontSize = if (ts.fontSize > 0) ts.fontSize.sp else MaterialTheme.typography.headlineMedium.fontSize,
                        color = ts.color ?: MaterialTheme.colorScheme.onSurface,
                        fontFamily = family,
                        fontWeight = FontWeight.Bold,
                    )
                    state.song?.artist?.let {
                        Text(
                            it,
                            fontSize = if (ds.fontSize > 0) ds.fontSize.sp else MaterialTheme.typography.titleMedium.fontSize,
                            color = ds.color ?: MaterialTheme.colorScheme.onSurfaceVariant,
                            fontFamily = family,
                        )
                    }
                    Row(Modifier.padding(top = 8.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        state.song?.key?.let { MetaTag("Key", Transposer.transposeKey(it, state.transposeSteps), ds, family) }
                        if (state.capo > 0) MetaTag("Capo", "${state.capo}", ds, family)
                        state.song?.tempo?.let { MetaTag("Tempo", "$it BPM", ds, family) }
                    }
                }
            }
            val groups = groupLines(displayedSong.lines)
            groups.forEachIndexed { gi, group ->
                if (group.bordered) {
                    item(key = "perf-g$gi") {
                        Row(modifier = Modifier.height(IntrinsicSize.Min).padding(vertical = 4.dp)) {
                            Box(
                                modifier = Modifier
                                    .width(3.dp)
                                    .fillMaxHeight()
                                    .background(borderColor),
                            )
                            Column(modifier = Modifier.padding(start = 14.dp)) {
                                group.lines.forEach { line ->
                                    RenderLine(
                                        line = line,
                                        fontSize = perfFontSize,
                                        viewMode = state.viewMode,
                                        inlineDiagrams = showInline,
                                        instrument = instrument,
                                        onChordClick = onChordClick,
                                        songStyle = songStyle,
                                    )
                                }
                            }
                        }
                    }
                } else {
                    items(count = group.lines.size, key = { li -> "perf-g$gi-$li" }) { li ->
                        RenderLine(
                            line = group.lines[li],
                            fontSize = perfFontSize,
                            viewMode = state.viewMode,
                            inlineDiagrams = showInline,
                            instrument = instrument,
                            onChordClick = onChordClick,
                            songStyle = songStyle,
                        )
                    }
                }
            }
        }

        // Floating controls
        Row(
            Modifier.align(Alignment.TopEnd).padding(12.dp)
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f), MaterialTheme.shapes.medium)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onTransposeDown, Modifier.size(32.dp), enabled = state.transposeSteps > -11) { Icon(Icons.Default.KeyboardArrowDown, "Down", Modifier.size(18.dp)) }
            Text(if (state.transposeSteps > 0) "+${state.transposeSteps}" else "${state.transposeSteps}", color = if (state.transposeSteps != 0) ChordColor else MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            IconButton(onClick = onTransposeUp, Modifier.size(32.dp), enabled = state.transposeSteps < 11) { Icon(Icons.Default.KeyboardArrowUp, "Up", Modifier.size(18.dp)) }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onToggleScroll, Modifier.size(32.dp)) { Icon(if (autoScrollActive) Icons.Default.Pause else Icons.Default.PlayArrow, "Scroll", Modifier.size(18.dp), tint = if (autoScrollActive) ChordColor else MaterialTheme.colorScheme.onSurface) }
            if (tempo != null && tempo > 0) {
                Spacer(Modifier.width(6.dp))
                MetronomeButton(
                    tempo = tempo,
                    beatsPerBar = beatsPerBar,
                    currentBeatProvider = metronomeBeatProvider,
                    active = metronomeActive,
                    onToggle = onToggleMetronome,
                )
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onExit, Modifier.size(32.dp)) { Icon(Icons.Default.Close, "Exit", Modifier.size(18.dp)) }
        }
    }
}

// ---------------------------------------------------------------------------
// Meta Tag
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MetronomeButton(
    tempo: Int,
    beatsPerBar: Int,
    currentBeatProvider: () -> Int,
    active: Boolean,
    onToggle: () -> Unit,
) {
    Surface(
        onClick = onToggle,
        shape = MaterialTheme.shapes.small,
        color = if (active) ChordColor.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.padding(end = 4.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                Icons.Default.Timer,
                contentDescription = "Metronome",
                modifier = Modifier.size(14.dp),
                tint = if (active) ChordColor else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "$tempo",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = if (active) ChordColor else MaterialTheme.colorScheme.onSurface,
            )
            if (active) {
                // Deferred read: only this Row recomposes per beat, not the
                // entire SongViewScreen (which would invalidate LazyColumn).
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    val currentBeat = currentBeatProvider()
                    repeat(beatsPerBar) { i ->
                        val isCurrent = i == currentBeat
                        val isDownbeat = i == 0
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(
                                    color = when {
                                        !isCurrent -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                        isDownbeat -> MaterialTheme.colorScheme.primary
                                        else -> ChordColor
                                    },
                                    shape = CircleShape,
                                ),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetaTag(
    label: String,
    value: String,
    details: com.songchords.app.data.SectionStyle = com.songchords.app.data.SectionStyle(),
    fontFamily: androidx.compose.ui.text.font.FontFamily? = null,
) {
    val size = if (details.fontSize > 0) details.fontSize.sp else MaterialTheme.typography.bodySmall.fontSize
    val color = details.color ?: MaterialTheme.colorScheme.onSurfaceVariant
    Row {
        Text("$label: ", fontWeight = FontWeight.Bold, fontSize = size, color = color, fontFamily = fontFamily)
        Text(value, fontSize = size, color = color, fontFamily = fontFamily)
    }
}

private enum class StyleFilter(val label: String) {
    DARK("Dark"),
    LIGHT("Light"),
    CUSTOM("Custom"),
}
