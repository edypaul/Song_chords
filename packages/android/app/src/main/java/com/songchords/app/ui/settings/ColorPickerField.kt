package com.songchords.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp

/**
 * Compact color picker form field.
 *
 * Shows a small swatch next to a read-only hex field. Tapping the swatch (or
 * Edit button) opens a dialog with Red/Green/Blue sliders, a live preview,
 * and a free-form hex input. `allowNone = true` exposes a "Clear" action so
 * the caller can persist null (→ "inherit theme default").
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ColorPickerField(
    label: String,
    value: Color?,
    onChange: (Color?) -> Unit,
    modifier: Modifier = Modifier,
    allowNone: Boolean = true,
) {
    var showDialog by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(2.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(value ?: Color.Transparent, CircleShape)
                    .border(1.dp, MaterialTheme.colorScheme.onSurfaceVariant, CircleShape)
                    .clickable { showDialog = true },
                contentAlignment = Alignment.Center,
            ) {
                if (value == null) {
                    Icon(Icons.Default.Close, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                }
            }
            Text(
                text = value?.let { "#%06X".format(it.toArgb() and 0xFFFFFF) } ?: "(inherit)",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { showDialog = true }) { Text("Edit") }
        }
    }

    if (showDialog) {
        ColorPickerDialog(
            initial = value ?: Color(0xFFFFFFFF),
            allowNone = allowNone,
            onDismiss = { showDialog = false },
            onConfirm = {
                onChange(it)
                showDialog = false
            },
        )
    }
}

@Composable
private fun ColorPickerDialog(
    initial: Color,
    allowNone: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (Color?) -> Unit,
) {
    var r by remember { mutableFloatStateOf((initial.toArgb() shr 16 and 0xFF).toFloat()) }
    var g by remember { mutableFloatStateOf((initial.toArgb() shr 8 and 0xFF).toFloat()) }
    var b by remember { mutableFloatStateOf((initial.toArgb() and 0xFF).toFloat()) }
    var hex by remember { mutableStateOf("#%02X%02X%02X".format(r.toInt(), g.toInt(), b.toInt())) }
    val preview = Color(r.toInt(), g.toInt(), b.toInt())

    fun updateFromHex(input: String) {
        val cleaned = input.trim().let { if (it.startsWith("#")) it else "#$it" }
        val parsed = runCatching { Color(android.graphics.Color.parseColor(cleaned)) }.getOrNull() ?: return
        val argb = parsed.toArgb()
        r = (argb shr 16 and 0xFF).toFloat()
        g = (argb shr 8 and 0xFF).toFloat()
        b = (argb and 0xFF).toFloat()
    }

    // Keep the hex text in sync when sliders move.
    LaunchedEffect(r, g, b) {
        hex = "#%02X%02X%02X".format(r.toInt(), g.toInt(), b.toInt())
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pick Color") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                // Preview swatch
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(60.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(preview, RoundedCornerShape(6.dp))
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp)),
                )
                SliderRow("R", r, Color.Red) { r = it }
                SliderRow("G", g, Color.Green) { g = it }
                SliderRow("B", b, Color.Blue) { b = it }
                OutlinedTextField(
                    value = hex,
                    onValueChange = { hex = it; updateFromHex(it) },
                    label = { Text("Hex") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(preview) }) { Text("OK") } },
        dismissButton = {
            Row {
                if (allowNone) {
                    TextButton(onClick = { onConfirm(null) }) { Text("Clear") }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

@Composable
private fun SliderRow(label: String, value: Float, tint: Color, onChange: (Float) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.width(20.dp), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = value,
            onValueChange = onChange,
            valueRange = 0f..255f,
            colors = SliderDefaults.colors(thumbColor = tint, activeTrackColor = tint),
            modifier = Modifier.weight(1f),
        )
        Text(
            "${value.toInt()}",
            modifier = Modifier.width(36.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

