package com.songchords.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.songchords.app.parser.ChordGridBar
import com.songchords.app.parser.ChordGridRow
import com.songchords.app.ui.theme.ChordColor
import kotlin.math.floor
import kotlin.math.max

// Layout constants (in dp)
private const val ROW_H_DP = 28f
private const val TOP_PAD_DP = 4f
private const val BOT_PAD_DP = 4f
private const val LEFT_PAD_DP = 4f
private const val MIN_BAR_W_DP = 70f
private const val CHORD_FONT_SP = 14f
private const val CHORD_CHAR_W_DP = 8.4f
private const val BEAT_DOT_R_DP = 3.5f
private const val REPEAT_DOT_R_DP = 2.5f
private const val PLAIN_INSET_DP = 10f
private const val START_REPEAT_INSET_DP = 20f
private const val END_REPEAT_INSET_DP = 18f

private data class ChordHit(val rect: Rect, val chord: String)

private fun isSimpleGrid(rows: List<ChordGridRow>): Boolean = rows.all { row ->
    row.bars.all { bar ->
        bar.beats.count { it.chord != null } == 1 && bar.beats.firstOrNull()?.chord != null
    }
}

private fun computeBarWDp(rows: List<ChordGridRow>, simple: Boolean): Float {
    val chordLengths = rows.flatMap { r -> r.bars.flatMap { b -> b.beats.mapNotNull { it.chord?.length } } }
    val maxChordW = (chordLengths.maxOrNull() ?: 0) * CHORD_CHAR_W_DP
    val outerInset = START_REPEAT_INSET_DP + END_REPEAT_INSET_DP
    if (simple) return max(MIN_BAR_W_DP, maxChordW + outerInset)
    val maxBeats = rows.flatMap { it.bars }.maxOfOrNull { it.beats.size } ?: 1
    val minSlotW = max(maxChordW + 10f, 20f)
    return max(MIN_BAR_W_DP, maxBeats * minSlotW + outerInset)
}

@Composable
fun ChordGridView(
    rows: List<ChordGridRow>,
    modifier: Modifier = Modifier,
    chordColor: Color = ChordColor,
    onChordClick: ((String) -> Unit)? = null,
) {
    if (rows.isEmpty()) return
    val simple = isSimpleGrid(rows)
    val barWDp = computeBarWDp(rows, simple)
    val lineColor = MaterialTheme.colorScheme.onSurface
    val mutedColor = MaterialTheme.colorScheme.onSurfaceVariant

    BoxWithConstraints(modifier = modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        val containerW = maxWidth.value
        val barsPerLine = max(1, floor(((containerW - LEFT_PAD_DP) / barWDp).toDouble()).toInt())

        Column {
            rows.forEach { row ->
                val chunks = row.bars.chunked(barsPerLine)
                chunks.forEachIndexed { ci, bars ->
                    val isFirst = ci == 0
                    val isLast = ci == chunks.size - 1
                    StaffRow(
                        bars = bars,
                        barWDp = barWDp,
                        startRepeat = isFirst && row.startRepeat,
                        endRepeat = isLast && row.endRepeat,
                        repeatCount = if (isLast) row.repeatCount else null,
                        simple = simple,
                        chordColor = chordColor,
                        lineColor = lineColor,
                        mutedColor = mutedColor,
                        onChordClick = onChordClick,
                    )
                }
            }
        }
    }
}

/** Compute hit regions and beat centers in pixels for a given StaffRow. */
private fun computeHits(
    bars: List<ChordGridBar>,
    barWPx: Float,
    leftPadPx: Float,
    startRepeat: Boolean,
    endRepeat: Boolean,
    simple: Boolean,
    startInsetPx: Float,
    endInsetPx: Float,
    plainInsetPx: Float,
    rowTopPx: Float,
    rowBottomPx: Float,
): List<ChordHit> {
    val hits = mutableListOf<ChordHit>()
    val n = bars.size
    bars.forEachIndexed { bi, bar ->
        val barLeft = leftPadPx + bi * barWPx
        val isLast = bi == n - 1
        val leftInset = if (bi == 0) (if (startRepeat) startInsetPx else plainInsetPx) else 0f
        val rightInset = if (isLast) (if (endRepeat) endInsetPx else plainInsetPx) else 0f
        val contentLeft = barLeft + leftInset
        val contentW = barWPx - leftInset - rightInset

        if (simple) {
            val chord = bar.beats.firstOrNull()?.chord ?: return@forEachIndexed
            hits.add(ChordHit(Rect(barLeft, rowTopPx, barLeft + barWPx, rowBottomPx), chord))
        } else {
            val numBeats = bar.beats.size.coerceAtLeast(1)
            val slotW = contentW / numBeats
            bar.beats.forEachIndexed { si, beat ->
                val chord = beat.chord ?: return@forEachIndexed
                val left = contentLeft + slotW * si
                hits.add(ChordHit(Rect(left, rowTopPx, left + slotW, rowBottomPx), chord))
            }
        }
    }
    return hits
}

@Composable
private fun StaffRow(
    bars: List<ChordGridBar>,
    barWDp: Float,
    startRepeat: Boolean,
    endRepeat: Boolean,
    repeatCount: Int?,
    simple: Boolean,
    chordColor: Color,
    lineColor: Color,
    mutedColor: Color,
    onChordClick: ((String) -> Unit)?,
) {
    val n = bars.size
    val totalHDp = TOP_PAD_DP + ROW_H_DP + BOT_PAD_DP
    val textMeasurer = rememberTextMeasurer()
    val chordStyle = TextStyle(fontSize = CHORD_FONT_SP.sp, fontWeight = FontWeight.Bold, color = chordColor)
    val repeatStyle = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold, color = mutedColor)

    val density = LocalDensity.current.density
    fun dpToPx(v: Float): Float = v * density
    val barWPx = dpToPx(barWDp)
    val leftPadPx = dpToPx(LEFT_PAD_DP)
    val rowTopPx = dpToPx(TOP_PAD_DP)
    val rowBottomPx = dpToPx(TOP_PAD_DP + ROW_H_DP)

    val hits = computeHits(
        bars = bars,
        barWPx = barWPx,
        leftPadPx = leftPadPx,
        startRepeat = startRepeat,
        endRepeat = endRepeat,
        simple = simple,
        startInsetPx = dpToPx(START_REPEAT_INSET_DP),
        endInsetPx = dpToPx(END_REPEAT_INSET_DP),
        plainInsetPx = dpToPx(PLAIN_INSET_DP),
        rowTopPx = rowTopPx,
        rowBottomPx = rowBottomPx,
    )

    val tapModifier = if (onChordClick != null) {
        Modifier.pointerInput(hits) {
            detectTapGestures { pos ->
                hits.firstOrNull { it.rect.contains(pos) }?.let { onChordClick(it.chord) }
            }
        }
    } else Modifier

    Canvas(
        modifier = Modifier
            .padding(bottom = 6.dp)
            .height(totalHDp.dp)
            .fillMaxWidth()
            .then(tapModifier),
    ) {
        fun dp(v: Float): Float = v * this.density
        val strokeNormal = dp(1f)
        val strokeBold = dp(3f)

        val barY1 = dp(TOP_PAD_DP)
        val barY2 = dp(TOP_PAD_DP + ROW_H_DP)
        val chordY = dp(TOP_PAD_DP + ROW_H_DP * 0.72f)
        val beatDotY = dp(TOP_PAD_DP + ROW_H_DP * 0.5f)
        val dotY1 = dp(TOP_PAD_DP + ROW_H_DP * 0.33f)
        val dotY2 = dp(TOP_PAD_DP + ROW_H_DP * 0.67f)
        val barW = dp(barWDp)
        val openX = dp(LEFT_PAD_DP)

        // Opening barline
        if (startRepeat) {
            drawLine(lineColor.copy(alpha = 0.85f), Offset(openX, barY1), Offset(openX, barY2), strokeWidth = strokeBold)
            drawLine(lineColor.copy(alpha = 0.75f), Offset(openX + dp(6f), barY1), Offset(openX + dp(6f), barY2), strokeWidth = strokeNormal)
            drawCircle(lineColor.copy(alpha = 0.8f), radius = dp(REPEAT_DOT_R_DP), center = Offset(openX + dp(13f), dotY1))
            drawCircle(lineColor.copy(alpha = 0.8f), radius = dp(REPEAT_DOT_R_DP), center = Offset(openX + dp(13f), dotY2))
        } else {
            drawLine(lineColor.copy(alpha = 0.75f), Offset(openX, barY1), Offset(openX, barY2), strokeWidth = strokeNormal)
        }

        bars.forEachIndexed { bi, bar ->
            val barLeft = dp(LEFT_PAD_DP) + bi * barW
            val isLast = bi == n - 1
            val rightX = barLeft + barW
            val leftInset = if (bi == 0) (if (startRepeat) dp(START_REPEAT_INSET_DP) else dp(PLAIN_INSET_DP)) else 0f
            val rightInset = if (isLast) (if (endRepeat) dp(END_REPEAT_INSET_DP) else dp(PLAIN_INSET_DP)) else 0f
            val contentLeft = barLeft + leftInset
            val contentW = barW - leftInset - rightInset
            val numBeats = bar.beats.size
            val slotW = if (numBeats > 0) contentW / numBeats else contentW
            val xs = FloatArray(numBeats) { i -> contentLeft + slotW * i + slotW / 2 }

            if (simple) {
                val chord = bar.beats.firstOrNull()?.chord
                if (chord != null) {
                    drawChordText(textMeasurer, chord, chordStyle, contentLeft + contentW / 2f, chordY)
                }
            } else {
                bar.beats.forEachIndexed { si, beat ->
                    val cx = xs[si]
                    val chord = beat.chord
                    if (chord != null) {
                        drawChordText(textMeasurer, chord, chordStyle, cx, chordY)
                    } else {
                        drawCircle(chordColor.copy(alpha = 0.3f), radius = dp(BEAT_DOT_R_DP), center = Offset(cx, beatDotY))
                    }
                }
            }

            if (isLast && endRepeat) {
                drawCircle(lineColor.copy(alpha = 0.8f), radius = dp(REPEAT_DOT_R_DP), center = Offset(rightX - dp(10f), dotY1))
                drawCircle(lineColor.copy(alpha = 0.8f), radius = dp(REPEAT_DOT_R_DP), center = Offset(rightX - dp(10f), dotY2))
                drawLine(lineColor.copy(alpha = 0.75f), Offset(rightX - dp(3f), barY1), Offset(rightX - dp(3f), barY2), strokeWidth = strokeNormal)
                drawLine(lineColor.copy(alpha = 0.75f), Offset(rightX + dp(3f), barY1), Offset(rightX + dp(3f), barY2), strokeWidth = strokeNormal)
                if (repeatCount != null) {
                    drawRepeatCount(textMeasurer, repeatCount, repeatStyle, rightX + dp(10f), chordY)
                }
            } else {
                drawLine(lineColor.copy(alpha = 0.75f), Offset(rightX, barY1), Offset(rightX, barY2), strokeWidth = strokeNormal)
                if (isLast && repeatCount != null) {
                    drawRepeatCount(textMeasurer, repeatCount, repeatStyle, rightX + dp(6f), chordY)
                }
            }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawChordText(
    textMeasurer: androidx.compose.ui.text.TextMeasurer,
    text: String,
    style: TextStyle,
    centerX: Float,
    baselineY: Float,
) {
    val layout = textMeasurer.measure(text = androidx.compose.ui.text.AnnotatedString(text), style = style)
    val x = centerX - layout.size.width / 2f
    val y = baselineY - layout.firstBaseline
    drawText(layout, topLeft = Offset(x, y))
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawRepeatCount(
    textMeasurer: androidx.compose.ui.text.TextMeasurer,
    count: Int,
    style: TextStyle,
    leftX: Float,
    baselineY: Float,
) {
    val layout = textMeasurer.measure(text = androidx.compose.ui.text.AnnotatedString("\u00D7$count"), style = style)
    val y = baselineY - layout.firstBaseline
    drawText(layout, topLeft = Offset(leftX, y))
}
