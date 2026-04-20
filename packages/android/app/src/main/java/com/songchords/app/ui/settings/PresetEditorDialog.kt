package com.songchords.app.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import com.songchords.app.data.FontFamilyChoice
import com.songchords.app.data.PresetMode
import com.songchords.app.data.SectionStyle
import com.songchords.app.data.SongViewStyle

/**
 * Full create/edit dialog for a custom song-view style preset.
 *
 * Covers the same fields the desktop `SongViewStyleSection` exposes — font
 * family, uppercase toggles, per-section font size + color + background, and
 * the chorus border color. Colors are edited as hex strings (#RRGGBB); an
 * empty string clears the field (falls back to theme defaults).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PresetEditorDialog(
    initialName: String,
    initialMode: PresetMode,
    initialStyle: SongViewStyle,
    onDismiss: () -> Unit,
    onSave: (name: String, mode: PresetMode, style: SongViewStyle) -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var name by remember { mutableStateOf(initialName) }
    var mode by remember { mutableStateOf(initialMode) }
    var family by remember { mutableStateOf(initialStyle.fontFamily) }
    var titleUpper by remember { mutableStateOf(initialStyle.titleUppercase) }
    var sectionUpper by remember { mutableStateOf(initialStyle.sectionUppercase) }

    var lyrics by remember { mutableStateOf(initialStyle.lyrics) }
    var chords by remember { mutableStateOf(initialStyle.chords) }
    var titleS by remember { mutableStateOf(initialStyle.title) }
    var details by remember { mutableStateOf(initialStyle.details) }
    var sectionS by remember { mutableStateOf(initialStyle.section) }
    var borderColor by remember { mutableStateOf(initialStyle.chorusBorderColor) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (onDelete != null) "Edit Preset" else "New Preset") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                // Mode
                Text("Mode", style = MaterialTheme.typography.labelSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = mode == PresetMode.DARK, onClick = { mode = PresetMode.DARK }, label = { Text("Dark") })
                    FilterChip(selected = mode == PresetMode.LIGHT, onClick = { mode = PresetMode.LIGHT }, label = { Text("Light") })
                }

                // Font family
                Text("Font Family", style = MaterialTheme.typography.labelSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FontFamilyChoice.entries.forEach { f ->
                        FilterChip(selected = family == f, onClick = { family = f }, label = { Text(f.displayName) })
                    }
                }

                // Uppercase toggles
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Title UPPERCASE", Modifier.weight(1f))
                    Switch(checked = titleUpper, onCheckedChange = { titleUpper = it })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Section UPPERCASE", Modifier.weight(1f))
                    Switch(checked = sectionUpper, onCheckedChange = { sectionUpper = it })
                }

                SectionStyleRow("Lyrics", lyrics, showBackground = false) { lyrics = it }
                SectionStyleRow("Chords", chords, showBackground = false) { chords = it }
                SectionStyleRow("Title", titleS, showBackground = true) { titleS = it }
                SectionStyleRow("Details", details, showBackground = false, colorOnly = false) { details = it }
                SectionStyleRow("Section", sectionS, showBackground = true) { sectionS = it }

                ColorPickerField(
                    label = "Chorus Border Color",
                    value = borderColor,
                    onChange = { borderColor = it },
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val style = SongViewStyle(
                    preset = initialStyle.preset,
                    fontFamily = family,
                    titleUppercase = titleUpper,
                    sectionUppercase = sectionUpper,
                    lyrics = lyrics,
                    chords = chords,
                    title = titleS,
                    details = details,
                    section = sectionS,
                    chorusBorderColor = borderColor,
                )
                onSave(name.trim().ifEmpty { "Untitled" }, mode, style)
            }) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (onDelete != null) {
                    TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SectionStyleRow(
    label: String,
    value: SectionStyle,
    showBackground: Boolean,
    colorOnly: Boolean = true,
    onChange: (SectionStyle) -> Unit,
) {
    var size by remember(value) { mutableStateOf(value.fontSize.coerceAtLeast(8).toString()) }

    Column {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = size,
                onValueChange = { new ->
                    size = new
                    val parsed = new.toIntOrNull()?.coerceIn(8, 72) ?: value.fontSize
                    onChange(value.copy(fontSize = parsed))
                },
                label = { Text("Size") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.width(84.dp),
            )
            if (colorOnly) {
                ColorPickerField(
                    label = "Color",
                    value = value.color,
                    onChange = { onChange(value.copy(color = it)) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (showBackground) {
            Spacer(Modifier.height(6.dp))
            ColorPickerField(
                label = "Background",
                value = value.background,
                onChange = { onChange(value.copy(background = it)) },
            )
        }
    }
}
