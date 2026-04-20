package com.songchords.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.songchords.app.data.chords.ChordDefinition
import com.songchords.app.ui.theme.ChordColor

/**
 * Canvas-based chord diagram composable.
 * Renders a fretboard with string lines, fret lines, finger dots, and a chord name label.
 *
 * Unlike SVG: this is a single Canvas draw call — zero child Views, instant render.
 */
@Composable
fun ChordDiagramView(
    chord: ChordDefinition,
    width: Dp = 100.dp,
    showName: Boolean = true,
    chordColor: Color = ChordColor,
    lineColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    nameColor: Color? = null,
) {
    val resolvedNameColor = nameColor ?: lineColor
    val numFrets = 5
    val textMeasurer = rememberTextMeasurer()

    Canvas(
        modifier = Modifier.size(
            width = width,
            height = width * 1.3f,
        )
    ) {
        val w = size.width
        val h = size.height
        val padTop = if (showName) w * 0.3f else w * 0.15f
        val padLeft = w * 0.12f
        val padRight = if (chord.baseFret > 1) w * 0.2f else w * 0.12f
        val padBottom = w * 0.08f

        val strings = chord.strings
        val gridW = w - padLeft - padRight
        val gridH = h - padTop - padBottom
        val cellW = gridW / (strings - 1)
        val cellH = gridH / numFrets
        val dotR = cellW * 0.32f

        // Chord name
        if (showName) {
            val nameResult = textMeasurer.measure(
                text = chord.name,
                style = TextStyle(fontSize = (w * 0.12f).toSp(), fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
            )
            drawText(
                textLayoutResult = nameResult,
                topLeft = Offset((w - nameResult.size.width) / 2f, w * 0.04f),
                color = resolvedNameColor,
            )
        }

        // Nut or base fret label
        if (chord.baseFret == 1) {
            drawRect(
                color = lineColor,
                topLeft = Offset(padLeft - 1, padTop - 3),
                size = Size(gridW + 2, 4f),
                alpha = 0.7f,
            )
        } else {
            val fretResult = textMeasurer.measure(
                text = "${chord.baseFret}",
                style = TextStyle(fontSize = (w * 0.1f).toSp(), fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
            )
            drawText(
                textLayoutResult = fretResult,
                topLeft = Offset(padLeft + gridW + 4, padTop + cellH * 0.3f),
                color = lineColor,
                alpha = 0.9f,
            )
        }

        // Fret lines
        for (i in 0..numFrets) {
            val y = padTop + i * cellH
            drawLine(lineColor, Offset(padLeft, y), Offset(padLeft + gridW, y), strokeWidth = 0.5f, alpha = 0.4f)
        }

        // String lines
        for (i in 0 until strings) {
            val x = padLeft + i * cellW
            drawLine(lineColor, Offset(x, padTop), Offset(x, padTop + gridH), strokeWidth = 0.5f, alpha = 0.5f)
        }

        // Dots
        chord.frets.forEachIndexed { si, fret ->
            val x = padLeft + si * cellW
            when {
                fret == -1 -> {
                    // X mark (muted)
                    val sz = dotR * 0.8f
                    val cy = padTop - dotR * 2f
                    drawLine(lineColor, Offset(x - sz, cy - sz), Offset(x + sz, cy + sz), strokeWidth = 1.5f, alpha = 0.6f)
                    drawLine(lineColor, Offset(x + sz, cy - sz), Offset(x - sz, cy + sz), strokeWidth = 1.5f, alpha = 0.6f)
                }
                fret == 0 -> {
                    // Open string
                    drawCircle(lineColor, radius = dotR * 0.7f, center = Offset(x, padTop - dotR * 2f), style = Stroke(width = 1.5f), alpha = 0.6f)
                }
                else -> {
                    // Fretted dot
                    val fretIdx = fret - chord.baseFret
                    if (fretIdx in 0 until numFrets) {
                        val cy = padTop + fretIdx * cellH + cellH / 2
                        drawCircle(chordColor, radius = dotR, center = Offset(x, cy))
                    }
                }
            }
        }
    }
}

private fun Float.toSp() = this.sp
