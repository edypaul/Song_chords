package com.songchords.app.transpose

import com.songchords.app.parser.ChordGridRow
import com.songchords.app.parser.ChordGridBar
import com.songchords.app.parser.ChordGridBeat
import com.songchords.app.parser.ParsedLine
import com.songchords.app.parser.ParsedSong
import com.songchords.app.parser.Token

/**
 * Chord transposition — ported from the TypeScript shared package.
 */
object Transposer {

    val SHARPS = listOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    val FLATS = listOf("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")

    val FLAT_KEYS = setOf(
        "F", "Bb", "Eb", "Ab", "Db", "Gb",
        "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm",
    )

    val SHARP_KEYS = setOf(
        "G", "D", "A", "E", "B", "F#", "C#",
        "Em", "Bm", "F#m", "C#m", "G#m", "D#m",
    )

    private val CHORD_ROOT_RE = Regex("^([A-G][#b]?)(.*)")

    private fun noteIndex(note: String): Int {
        val si = SHARPS.indexOf(note)
        if (si != -1) return si
        return FLATS.indexOf(note)
    }

    fun transposeNote(note: String, semitones: Int, preferFlats: Boolean): String {
        val idx = noteIndex(note)
        if (idx == -1) return note
        val newIdx = ((idx + semitones) % 12 + 12) % 12
        return if (preferFlats) FLATS[newIdx] else SHARPS[newIdx]
    }

    fun transposeChord(chord: String, semitones: Int, preferFlats: Boolean): String {
        // Note: no early return on semitones == 0 — re-spell each chord so the
        // accidentals match `preferFlats` (e.g. Bb vs A#) even at rest.
        val slashIdx = chord.lastIndexOf('/')
        var main = chord
        var bass: String? = null

        if (slashIdx > 0) {
            main = chord.substring(0, slashIdx)
            bass = chord.substring(slashIdx + 1).trim()
        }

        val match = CHORD_ROOT_RE.find(main) ?: return chord
        val root = match.groupValues[1]
        val quality = match.groupValues[2]
        val newRoot = transposeNote(root, semitones, preferFlats)
        val newBass = bass?.let { transposeNote(it, semitones, preferFlats) }

        return if (newBass != null) "$newRoot$quality/$newBass" else "$newRoot$quality"
    }

    fun transposeKey(key: String, semitones: Int): String {
        if (key.isEmpty() || semitones == 0) return key

        val isMinor = key.endsWith("m") && key.length > 1
        val root = if (isMinor) key.dropLast(1) else key
        val idx = noteIndex(root)
        if (idx == -1) return key

        val newIdx = ((idx + semitones) % 12 + 12) % 12
        val suffix = if (isMinor) "m" else ""
        val sharpKey = "${SHARPS[newIdx]}$suffix"
        val flatKey = "${FLATS[newIdx]}$suffix"

        // Circle-of-fifths spelling:
        // 1. Flat spelling recognised as flat-side key → use it.
        // 2. Sharp spelling recognised as sharp-side key → use it.
        // 3. Otherwise (naturals: C/D/E/G/A/B/Am/Dm/Em/Gm/Am/Bm) → sharp spelling.
        return when {
            FLAT_KEYS.contains(flatKey) -> flatKey
            SHARP_KEYS.contains(sharpKey) -> sharpKey
            else -> sharpKey
        }
    }

    /**
     * Resolve flats-vs-sharps for a given key using the circle of fifths.
     * Unknown / ambiguous keys (C, Am) fall back to the caller's preference.
     */
    fun resolveFlatsForKey(key: String?, fallback: Boolean): Boolean {
        if (key.isNullOrEmpty()) return fallback
        if (FLAT_KEYS.contains(key)) return true
        if (SHARP_KEYS.contains(key)) return false
        return fallback
    }

    /**
     * Per-line flats/sharps decision based on section-level key detection.
     * Drop a `{key: X}` directive inside a section to override that section's
     * spelling preference — useful for modulations.
     */
    fun computeSectionFlats(parsedSong: ParsedSong, semitones: Int, fallback: Boolean): BooleanArray {
        val n = parsedSong.lines.size
        val result = BooleanArray(n) { fallback }
        if (n == 0) return result

        data class Range(var start: Int, var end: Int, var explicitKey: String? = null)
        val ranges = mutableListOf<Range>()
        var cur: Range? = null
        fun close(endIdx: Int) {
            cur?.let { it.end = endIdx; ranges.add(it); cur = null }
        }

        parsedSong.lines.forEachIndexed { i, line ->
            when {
                line.isSection -> {
                    close(i - 1)
                    cur = Range(i, i)
                }
                line.isSectionEnd -> close(i)
                else -> {
                    for (token in line.tokens) {
                        if (token is Token.Directive && (token.name == "key" || token.name == "k") && token.value != null) {
                            cur?.explicitKey = token.value
                        }
                    }
                }
            }
        }
        close(n - 1)

        for (r in ranges) {
            val key = r.explicitKey ?: continue
            val transposed = transposeKey(key, semitones)
            val useFlats = when {
                FLAT_KEYS.contains(transposed) -> true
                SHARP_KEYS.contains(transposed) -> false
                else -> fallback
            }
            for (i in r.start..r.end.coerceAtMost(n - 1)) result[i] = useFlats
        }
        return result
    }

    fun transposeSong(
        parsedSong: ParsedSong,
        semitones: Int,
        preferFlats: Boolean? = null,
        flatsResolver: ((Int) -> Boolean)? = null,
    ): ParsedSong {
        // No early return on semitones == 0 — always re-spell chords so
        // accidentals match the key.
        val songDefault = preferFlats
            ?: parsedSong.metadata.key?.let { FLAT_KEYS.contains(it) }
            ?: false

        val newLines = parsedSong.lines.mapIndexed { lineIdx, line ->
            val useFlats = flatsResolver?.invoke(lineIdx) ?: songDefault
            val newTokens = line.tokens.map { token ->
                when (token) {
                    is Token.Chord -> {
                        val newChord = transposeChord(token.chord, semitones, useFlats)
                        val slashIdx = newChord.lastIndexOf('/')
                        val main = if (slashIdx > 0) newChord.substring(0, slashIdx) else newChord
                        val bass = if (slashIdx > 0) newChord.substring(slashIdx + 1) else null
                        val match = CHORD_ROOT_RE.find(main)
                        Token.Chord(
                            chord = newChord,
                            root = match?.groupValues?.get(1) ?: newChord,
                            quality = match?.groupValues?.get(2) ?: "",
                            bass = bass,
                        )
                    }
                    is Token.ChordGrid -> {
                        val newRows = token.rows.map { row ->
                            row.copy(
                                bars = row.bars.map { bar ->
                                    bar.copy(
                                        beats = bar.beats.map { beat ->
                                            if (beat.chord != null)
                                                ChordGridBeat(chord = transposeChord(beat.chord, semitones, useFlats))
                                            else
                                                ChordGridBeat()
                                        }
                                    )
                                }
                            )
                        }
                        Token.ChordGrid(rows = newRows)
                    }
                    else -> token
                }
            }
            line.copy(tokens = newTokens)
        }

        val newKey = parsedSong.metadata.key?.let { transposeKey(it, semitones) }
        val newMetadata = parsedSong.metadata.copy(key = newKey)

        return parsedSong.copy(metadata = newMetadata, lines = newLines)
    }

    fun getSoundingKey(playingKey: String, capo: Int): String = transposeKey(playingKey, capo)
    fun getPlayingKey(soundingKey: String, capo: Int): String = transposeKey(soundingKey, -capo)
}
