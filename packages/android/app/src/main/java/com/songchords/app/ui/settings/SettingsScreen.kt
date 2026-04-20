package com.songchords.app.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.data.AccidentalMode
import com.songchords.app.data.ChordBarPosition
import com.songchords.app.data.Instrument
import com.songchords.app.data.PresetMode
import com.songchords.app.data.SONG_STYLE_PRESETS
import com.songchords.app.data.ThemeMode
import com.songchords.app.viewmodel.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Settings") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            // Appearance
            SettingsSection("Appearance") {
                SettingsChipRow(
                    label = "Theme",
                    options = ThemeMode.entries.map { it.name.lowercase().replaceFirstChar { c -> c.uppercase() } },
                    selected = settings.theme.ordinal,
                    onSelect = { viewModel.setTheme(ThemeMode.entries[it]) },
                )
            }

            // Music
            SettingsSection("Music") {
                SettingsChipRow(
                    label = "Default Instrument",
                    options = listOf("Guitar", "Ukulele"),
                    selected = settings.defaultInstrument.ordinal,
                    onSelect = { viewModel.setInstrument(Instrument.entries[it]) },
                )
                SettingsToggle(
                    label = "Show Chord Diagrams",
                    checked = settings.showChordDiagrams,
                    onCheckedChange = viewModel::setShowChordDiagrams,
                )
                SettingsToggle(
                    label = "Inline Chord Diagrams",
                    subtitle = "Render chord diagrams above lyrics instead of chord names",
                    checked = settings.inlineChordDiagrams,
                    onCheckedChange = viewModel::setInlineChordDiagrams,
                )
                SettingsChipRow(
                    label = "Chord Bar Position",
                    options = listOf("Top", "Bottom", "Right"),
                    selected = settings.chordBarPosition.ordinal,
                    onSelect = { viewModel.setChordBarPosition(ChordBarPosition.entries[it]) },
                )
                SettingsChipRow(
                    label = "Accidentals",
                    options = listOf("Auto", "Flats", "Sharps"),
                    selected = settings.accidentalMode.ordinal,
                    onSelect = { viewModel.setAccidentalMode(AccidentalMode.entries[it]) },
                )
            }

            // Performance Mode
            SettingsSection("Performance Mode") {
                SettingsToggle(
                    label = "Auto-start Metronome",
                    subtitle = "Start metronome when entering performance mode",
                    checked = settings.perfMetroEnabled,
                    onCheckedChange = viewModel::setPerfMetroEnabled,
                )
                SettingsToggle(
                    label = "Auto-start Scroll",
                    subtitle = "Start auto-scroll when entering performance mode",
                    checked = settings.perfScrollEnabled,
                    onCheckedChange = viewModel::setPerfScrollEnabled,
                )
                SettingsSlider(
                    label = "Performance Zoom (%)",
                    value = settings.perfZoom * 100f,
                    range = 50f..250f,
                    onValueChange = { viewModel.setPerfZoom(it / 100f) },
                )
            }

            // Song View — style presets
            SettingsSection("Song View") {
                val builtIns = SONG_STYLE_PRESETS.values.toList()
                SongStylePresetPicker(
                    label = "Style Preset",
                    selected = settings.songViewStylePreset,
                    presets = builtIns,
                    onSelect = { viewModel.setSongViewStylePreset(it) },
                )

                // Custom presets (user-created) + CRUD controls
                val customs = settings.customPresets.values.toList()
                if (customs.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "My Presets",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    var editing: com.songchords.app.data.CustomPreset? by remember { mutableStateOf(null) }
                    customs.forEach { p ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            FilterChip(
                                selected = settings.songViewStylePreset == p.key,
                                onClick = { viewModel.setSongViewStylePreset(p.key) },
                                label = { Text(p.name) },
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = { editing = p }) { Text("Edit") }
                        }
                    }
                    editing?.let { cur ->
                        PresetEditorDialog(
                            initialName = cur.name,
                            initialMode = cur.mode,
                            initialStyle = cur.style,
                            onDismiss = { editing = null },
                            onSave = { n, m, s ->
                                viewModel.updateCustomPreset(cur.key, n, s, m)
                                editing = null
                            },
                            onDelete = {
                                viewModel.deleteCustomPreset(cur.key)
                                editing = null
                            },
                        )
                    }
                }

                // "New Preset" — forked from the currently-selected style.
                var creating by remember { mutableStateOf(false) }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { creating = true }) { Text("+ New Preset (from current style)") }
                if (creating) {
                    val baseStyle = settings.customPresets[settings.songViewStylePreset]?.style
                        ?: SONG_STYLE_PRESETS[settings.songViewStylePreset]?.style
                        ?: SONG_STYLE_PRESETS["default"]!!.style
                    val baseMode = settings.customPresets[settings.songViewStylePreset]?.mode
                        ?: SONG_STYLE_PRESETS[settings.songViewStylePreset]?.mode
                        ?: com.songchords.app.data.PresetMode.DARK
                    PresetEditorDialog(
                        initialName = "My Preset",
                        initialMode = baseMode,
                        initialStyle = baseStyle,
                        onDismiss = { creating = false },
                        onSave = { n, m, s ->
                            viewModel.saveCustomPreset(n, s, m)
                            creating = false
                        },
                    )
                }
            }

            // Auto-Scroll
            SettingsSection("Auto-Scroll") {
                SettingsSlider(
                    label = "Scroll Speed",
                    value = settings.scrollSpeed.toFloat(),
                    range = 5f..100f,
                    onValueChange = { viewModel.setScrollSpeed(it.toInt()) },
                )
            }

            // Song Layout
            SettingsSection("Song Layout") {
                SettingsToggle(
                    label = "Center Song",
                    subtitle = "Center song content on screen",
                    checked = settings.songCentered,
                    onCheckedChange = viewModel::setSongCentered,
                )
                SettingsSlider(
                    label = "Font Size",
                    value = settings.fontSize.toFloat(),
                    range = 10f..32f,
                    onValueChange = { viewModel.setFontSize(it.toInt()) },
                )
            }
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column {
        Text(
            text = title.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Surface(
            shape = MaterialTheme.shapes.medium,
            tonalElevation = 1.dp,
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                content()
            }
        }
    }
}

@Composable
private fun SettingsToggle(
    label: String,
    subtitle: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun SettingsChipRow(
    label: String,
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    Column {
        Text(text = label, style = MaterialTheme.typography.bodyLarge)
        Spacer(modifier = Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEachIndexed { index, option ->
                FilterChip(
                    selected = selected == index,
                    onClick = { onSelect(index) },
                    label = { Text(option) },
                )
            }
        }
    }
}

@Composable
private fun SettingsSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit,
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(text = label, style = MaterialTheme.typography.bodyLarge)
            Text(
                text = "${value.toInt()}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = range,
        )
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun SongStylePresetPicker(
    label: String,
    selected: String,
    presets: List<com.songchords.app.data.BuiltInPreset>,
    onSelect: (String) -> Unit,
) {
    Column {
        Text(text = label, style = MaterialTheme.typography.bodyLarge)
        Spacer(modifier = Modifier.height(8.dp))
        // Dark group
        Text(
            "Dark",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        androidx.compose.foundation.layout.FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            presets.filter { it.mode == PresetMode.DARK }.forEach { p ->
                FilterChip(
                    selected = selected == p.key,
                    onClick = { onSelect(p.key) },
                    label = { Text(p.name) },
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "Light",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        androidx.compose.foundation.layout.FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            presets.filter { it.mode == PresetMode.LIGHT }.forEach { p ->
                FilterChip(
                    selected = selected == p.key,
                    onClick = { onSelect(p.key) },
                    label = { Text(p.name) },
                )
            }
        }
    }
}
