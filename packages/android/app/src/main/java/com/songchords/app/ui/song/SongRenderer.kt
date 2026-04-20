package com.songchords.app.ui.song

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.songchords.app.data.Instrument
import com.songchords.app.data.chords.ChordDefinition
import com.songchords.app.data.chords.GUITAR_CHORDS
import com.songchords.app.data.chords.UKULELE_CHORDS
import com.songchords.app.parser.ParsedLine
import com.songchords.app.parser.ParsedSong
import com.songchords.app.parser.SectionType
import com.songchords.app.parser.Token
import com.songchords.app.ui.components.ChordDiagramView
import com.songchords.app.ui.components.ChordGridView
import com.songchords.app.data.FontFamilyChoice
import com.songchords.app.data.SongViewStyle
import com.songchords.app.data.DEFAULT_SONG_VIEW_STYLE
import com.songchords.app.ui.theme.ChordColor
import com.songchords.app.viewmodel.ViewMode
import androidx.compose.ui.text.font.FontFamily as ComposeFontFamily

// ---------------------------------------------------------------------------
// Song Renderer
// ---------------------------------------------------------------------------

internal fun FontFamilyChoice.toComposeFontFamily(): ComposeFontFamily = when (this) {
    FontFamilyChoice.MONOSPACE -> ComposeFontFamily.Monospace
    FontFamilyChoice.SANS_SERIF -> ComposeFontFamily.SansSerif
    FontFamilyChoice.SERIF -> ComposeFontFamily.Serif
}

@Composable
fun SongRenderer(
    song: ParsedSong,
    fontSize: Int,
    viewMode: ViewMode,
    modifier: Modifier = Modifier,
    inlineDiagrams: Boolean = false,
    instrument: Instrument = Instrument.GUITAR,
    onChordClick: ((String) -> Unit)? = null,
    songStyle: SongViewStyle = DEFAULT_SONG_VIEW_STYLE,
) {
    val groups = remember(song) { groupLines(song.lines) }
    val showInline = inlineDiagrams && viewMode != ViewMode.LYRICS_ONLY

    Column(modifier = modifier) {
        groups.forEach { group ->
            if (group.bordered) {
                // Left border: use the preset's chorus border color, else theme primary.
                val borderColor = songStyle.chorusBorderColor ?: MaterialTheme.colorScheme.primary
                Row(modifier = Modifier.padding(start = 2.dp, top = 4.dp, bottom = 4.dp).height(IntrinsicSize.Min)) {
                    Box(
                        modifier = Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .background(borderColor),
                    )
                    Column(modifier = Modifier.padding(start = 14.dp)) {
                        group.lines.forEach { line ->
                            RenderLine(line = line, fontSize = fontSize, viewMode = viewMode, inlineDiagrams = showInline, instrument = instrument, onChordClick = onChordClick, songStyle = songStyle)
                        }
                    }
                }
            } else {
                group.lines.forEach { line ->
                    RenderLine(line = line, fontSize = fontSize, viewMode = viewMode, inlineDiagrams = showInline, instrument = instrument, onChordClick = onChordClick, songStyle = songStyle)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Line grouping (chorus borders)
// ---------------------------------------------------------------------------

internal data class LineGroup(val bordered: Boolean, val lines: List<ParsedLine>)

internal fun groupLines(lines: List<ParsedLine>): List<LineGroup> {
    val groups = mutableListOf<LineGroup>()
    var current = mutableListOf<ParsedLine>()
    var inBordered = false

    for (line in lines) {
        if (line.isSection) {
            if (current.isNotEmpty()) groups.add(LineGroup(inBordered, current.toList()))
            current = mutableListOf(line)
            inBordered = line.sectionType == SectionType.CHORUS
        } else if (line.isSectionEnd && inBordered) {
            groups.add(LineGroup(true, current.toList()))
            current = mutableListOf()
            inBordered = false
        } else {
            current.add(line)
        }
    }
    if (current.isNotEmpty()) groups.add(LineGroup(inBordered, current.toList()))
    return groups
}

// ---------------------------------------------------------------------------
// Single line renderer
// ---------------------------------------------------------------------------

@Composable
fun RenderLine(
    line: ParsedLine,
    fontSize: Int,
    viewMode: ViewMode,
    inlineDiagrams: Boolean = false,
    instrument: Instrument = Instrument.GUITAR,
    onChordClick: ((String) -> Unit)? = null,
    songStyle: SongViewStyle = DEFAULT_SONG_VIEW_STYLE,
) {
    if (line.isChordGrid) {
        if (viewMode == ViewMode.LYRICS_ONLY) return
        val grid = line.tokens.firstOrNull() as? Token.ChordGrid ?: return
        ChordGridView(
            rows = grid.rows,
            onChordClick = onChordClick,
            chordColor = songStyle.chords.color ?: ChordColor,
        )
        return
    }
    if (line.isEmpty) {
        Spacer(modifier = Modifier.height((fontSize * 0.6).dp))
        return
    }
    val family = songStyle.fontFamily.toComposeFontFamily()
    if (line.isSection) {
        val label = (line.tokens.firstOrNull() as? Token.Section)?.label
        if (label != null) {
            val ss = songStyle.section
            val display = if (songStyle.sectionUppercase) label.uppercase() else label
            val sectionBg = ss.background
            val modBase = Modifier.padding(top = (fontSize * 0.5).dp, bottom = 2.dp)
            val mod = if (sectionBg != null) modBase.background(sectionBg, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp) else modBase
            Text(
                text = display,
                color = ss.color ?: MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
                fontFamily = family,
                fontSize = if (ss.fontSize > 0) ss.fontSize.sp else (fontSize * 0.7).sp,
                modifier = mod,
            )
        }
        return
    }
    if (line.isComment) {
        val text = (line.tokens.firstOrNull() as? Token.Comment)?.text ?: ""
        Text(
            text = text,
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontFamily = family,
            fontSize = (fontSize * 0.78).sp,
            modifier = Modifier
                .padding(top = 6.dp, bottom = 3.dp)
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(4.dp))
                .padding(horizontal = 8.dp, vertical = 2.dp),
        )
        return
    }
    if (line.isDirective) return

    if (line.hasChords && viewMode != ViewMode.LYRICS_ONLY) {
        ChordLyricLine(line = line, fontSize = fontSize, inlineDiagrams = inlineDiagrams, instrument = instrument, onChordClick = onChordClick, songStyle = songStyle)
        return
    }

    if (viewMode == ViewMode.CHORDS_ONLY && !line.hasChords) return

    val text = line.tokens.joinToString("") {
        when (it) {
            is Token.Lyric -> it.text
            else -> ""
        }
    }
    if (text.isBlank() && viewMode != ViewMode.CHORDS) return
    val lyricStyle = songStyle.lyrics
    Text(
        text = text.ifBlank { " " },
        fontSize = if (lyricStyle.fontSize > 0) lyricStyle.fontSize.sp else fontSize.sp,
        color = lyricStyle.color ?: MaterialTheme.colorScheme.onSurface,
        fontFamily = family,
    )
}

// ---------------------------------------------------------------------------
// Chord + Lyric line — flex-column approach matching desktop
//
// Each chunk is a vertical Column (chord on top, lyric on bottom).
// Chunks are grouped into word-level Row containers (nowrap) so mid-word
// chord markers don't split words.
// The outer container uses FlowRow to wrap at word boundaries.
// ---------------------------------------------------------------------------

private data class Chunk(val chord: String?, val lyric: String)

private fun buildChunks(line: ParsedLine): List<Chunk> {
    val chunks = mutableListOf<Chunk>()
    var currentChord: String? = null
    var currentLyric = StringBuilder()

    for (token in line.tokens) {
        when (token) {
            is Token.Chord -> {
                if (currentChord != null || currentLyric.isNotEmpty()) {
                    chunks.add(Chunk(currentChord, currentLyric.toString()))
                    currentLyric = StringBuilder()
                }
                currentChord = token.chord
            }
            is Token.Lyric -> currentLyric.append(token.text)
            else -> {}
        }
    }
    chunks.add(Chunk(currentChord, currentLyric.toString()))
    return chunks.filter { it.chord != null || it.lyric.isNotBlank() }
}

/**
 * Pad chunks so every chord column has at least some lyric width.
 * Mid-word chords get em-dash padding; between-word chords get a space.
 */
private fun padChunks(chunks: List<Chunk>): List<Chunk> {
    return chunks.mapIndexed { i, chunk ->
        if (chunk.chord == null) return@mapIndexed chunk

        val next = chunks.getOrNull(i + 1)
        val midWord = chunk.lyric.isNotEmpty()
                && !chunk.lyric.endsWith(' ')
                && next != null
                && next.lyric.isNotEmpty()
                && !next.lyric.startsWith(' ')

        if (midWord) {
            val minLen = chunk.chord.length + 1
            if (chunk.lyric.length >= minLen) chunk
            else chunk.copy(lyric = chunk.lyric + "\u2014".repeat(minLen - chunk.lyric.length))
        } else {
            if (chunk.lyric.isEmpty()) chunk.copy(lyric = " ")
            else chunk
        }
    }
}

/**
 * Split chunks at word boundaries so wrapping can break between words.
 */
private fun splitChunksByWords(chunks: List<Chunk>): List<Chunk> {
    val result = mutableListOf<Chunk>()
    for (chunk in chunks) {
        val parts = Regex("\\S+\\s*|\\s+").findAll(chunk.lyric).map { it.value }.toList()
        if (parts.size <= 1) {
            result.add(chunk)
            continue
        }
        result.add(Chunk(chunk.chord, parts[0]))
        for (j in 1 until parts.size) {
            result.add(Chunk(null, parts[j]))
        }
    }
    return result
}

/**
 * Group chunks into word-level units. A group ends when the chunk's lyric
 * ends with whitespace, is empty, or is the last chunk.
 * Merges trailing chord-only groups into the last real-text group.
 */
private fun groupByWords(chunks: List<Chunk>): List<List<Chunk>> {
    val groups = mutableListOf<MutableList<Chunk>>()
    var current = mutableListOf<Chunk>()
    for (i in chunks.indices) {
        current.add(chunks[i])
        val lyric = chunks[i].lyric
        if (lyric.isEmpty() || lyric.endsWith(' ') || lyric.endsWith('\t') || i == chunks.size - 1) {
            groups.add(current)
            current = mutableListOf()
        }
    }
    if (current.isNotEmpty()) groups.add(current)

    // Merge trailing chord-only groups
    if (groups.size > 1) {
        var lastTextIdx = groups.size - 1
        while (lastTextIdx >= 0 && groups[lastTextIdx].none { it.lyric.isNotBlank() }) {
            lastTextIdx--
        }
        if (lastTextIdx in 0 until groups.size - 1) {
            for (j in lastTextIdx + 1 until groups.size) {
                groups[lastTextIdx].addAll(groups[j])
            }
            while (groups.size > lastTextIdx + 1) groups.removeAt(groups.size - 1)
        }
    }

    return groups
}

private fun lookupChord(name: String, instrument: Instrument): ChordDefinition? {
    val list = if (instrument == Instrument.GUITAR) GUITAR_CHORDS else UKULELE_CHORDS
    return list.firstOrNull { it.name == name }
        ?: list.firstOrNull { it.name == name.replace("#", "").replace("b", "") }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChordLyricLine(
    line: ParsedLine,
    fontSize: Int,
    inlineDiagrams: Boolean = false,
    instrument: Instrument = Instrument.GUITAR,
    onChordClick: ((String) -> Unit)? = null,
    songStyle: SongViewStyle = DEFAULT_SONG_VIEW_STYLE,
) {
    val wordGroups = remember(line) {
        val raw = buildChunks(line)
        val padded = padChunks(raw)
        groupByWords(splitChunksByWords(padded))
    }

    // Pre-compute diagrams for each unique chord once (matches desktop diagramMap).
    // Missing chords fall back to a blank fretboard with the chord name, so the
    // diagram row stays visually uniform.
    val diagramMap = remember(line, inlineDiagrams, instrument) {
        if (!inlineDiagrams) null else {
            val strings = if (instrument == Instrument.GUITAR) 6 else 4
            val map = mutableMapOf<String, ChordDefinition>()
            for (group in wordGroups) for (chunk in group) {
                val c = chunk.chord ?: continue
                if (!map.containsKey(c)) {
                    map[c] = lookupChord(c, instrument) ?: ChordDefinition(
                        name = c,
                        frets = List(strings) { -1 },
                        baseFret = 1,
                        strings = strings,
                    )
                }
            }
            map
        }
    }

    // Row-height is driven by the preset's chord size (or fontSize*0.85 when
    // the preset doesn't override chords). Both the chord Text and the
    // no-chord placeholder use this same value so the chord row stays at a
    // consistent height regardless of the user's lyric fontSize.
    val cs = songStyle.chords
    val ls = songStyle.lyrics
    val lineChordSize = if (cs.fontSize > 0) cs.fontSize.toFloat() else (fontSize * 0.85f)
    val lineLyricSize = if (ls.fontSize > 0) ls.fontSize.toFloat() else fontSize.toFloat()
    val diagramWidth = 70.dp
    val diagramHeight = diagramWidth * 1.3f // matches ChordDiagramView aspect

    // FlowRow wraps at word boundaries — same as CSS flex-wrap
    FlowRow(
        modifier = Modifier.padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.Start,
        verticalArrangement = Arrangement.Bottom,
    ) {
        wordGroups.forEach { group ->
            // Each word group is a nowrap Row (mid-word chords stay together)
            Row(verticalAlignment = Alignment.Bottom) {
                group.forEach { chunk ->
                    // Each chunk is a Column: chord on top, lyric on bottom.
                    // When inlineDiagrams is on, every chord-row cell is exactly
                    // diagramHeight tall so diagrams always sit above the lyric
                    // baseline — never drop onto the lyric line when the chunk
                    // has no (or only whitespace) lyric below.
                    Column {
                        val chordName = chunk.chord
                        if (inlineDiagrams) {
                            val def = chordName?.let { diagramMap?.get(it) }
                            val chordModifier = if (chordName != null && onChordClick != null) {
                                Modifier.height(diagramHeight).clickable { onChordClick(chordName) }
                            } else {
                                Modifier.height(diagramHeight)
                            }
                            val inlineLineColor = songStyle.lyrics.color
                                ?: MaterialTheme.colorScheme.onSurfaceVariant
                            val inlineChordColor = songStyle.chords.color ?: ChordColor
                            Box(modifier = chordModifier, contentAlignment = Alignment.BottomStart) {
                                if (def != null) {
                                    ChordDiagramView(
                                        chord = def,
                                        width = diagramWidth,
                                        showName = true,
                                        chordColor = inlineChordColor,
                                        lineColor = inlineLineColor,
                                        nameColor = inlineChordColor,
                                    )
                                }
                            }
                        } else {
                            if (chordName != null) {
                                val textMod = if (onChordClick != null) {
                                    Modifier.padding(end = 2.dp).clickable { onChordClick(chordName) }
                                } else {
                                    Modifier.padding(end = 2.dp)
                                }
                                val chordStyleFont = songStyle.fontFamily.toComposeFontFamily()
                                Text(
                                    text = chordName,
                                    color = cs.color ?: ChordColor,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = lineChordSize.sp,
                                    fontFamily = chordStyleFont,
                                    lineHeight = (lineChordSize * 1.4f).sp,
                                    maxLines = 1,
                                    modifier = textMod,
                                )
                            } else {
                                // Zero-width invisible chord placeholder using the
                                // same lineChordSize so the chord row matches.
                                Text(
                                    text = " ",
                                    fontSize = lineChordSize.sp,
                                    lineHeight = (lineChordSize * 1.4f).sp,
                                    maxLines = 1,
                                )
                            }
                        }
                        Text(
                            text = chunk.lyric,
                            fontSize = lineLyricSize.sp,
                            color = ls.color ?: MaterialTheme.colorScheme.onSurface,
                            fontFamily = songStyle.fontFamily.toComposeFontFamily(),
                            lineHeight = (lineLyricSize * 1.4f).sp,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}
