package com.songchords.app.parser

/**
 * ChordPro format parser — ported from the TypeScript shared package.
 *
 * Supports:
 * - Metadata directives: {title}, {artist}, {album}, {key}, {tempo}, {capo}, {time}, {copyright}, {ccli}
 * - Section directives: {verse}, {chorus}, {bridge}, etc. (with optional labels and end markers like {eoc})
 * - Inline chords: [G]Amazing [C]Grace
 * - Comments: # text OR {comment: text}
 * - Chord grids: {sog} ... {eog} with | D . . . | Bm . . G . | notation, repeat markers |: :|, x3 counts
 */
object ChordProParser {

    private val CHORD_ROOT_RE = Regex("^([A-G][#b]?)(.*)")
    private val DIRECTIVE_RE = Regex("^\\{(\\w[\\w-]*)(?::\\s*(.*))?\\}$")

    private val METADATA_DIRECTIVES = setOf(
        "title", "t", "artist", "a", "album", "key", "k",
        "tempo", "capo", "time", "copyright", "ccli",
    )

    private fun parseChordString(raw: String): Token.Chord {
        val chord = raw.trim()
        val slashIdx = chord.lastIndexOf('/')

        var mainPart = chord
        var bass: String? = null

        if (slashIdx > 0) {
            mainPart = chord.substring(0, slashIdx)
            bass = chord.substring(slashIdx + 1).trim()
        }

        val match = CHORD_ROOT_RE.find(mainPart)
        if (match == null) {
            return Token.Chord(chord = chord, root = chord, quality = "")
        }

        return Token.Chord(
            chord = chord,
            root = match.groupValues[1],
            quality = match.groupValues[2],
            bass = bass,
        )
    }

    private fun tokenizeInlineLine(line: String): List<Token> {
        val tokens = mutableListOf<Token>()
        var i = 0
        val lyricBuf = StringBuilder()

        while (i < line.length) {
            if (line[i] == '[') {
                val closeIdx = line.indexOf(']', i)
                if (closeIdx == -1) {
                    lyricBuf.append(line[i])
                    i++
                    continue
                }
                if (lyricBuf.isNotEmpty()) {
                    tokens.add(Token.Lyric(lyricBuf.toString()))
                    lyricBuf.clear()
                }
                val rawChord = line.substring(i + 1, closeIdx)
                tokens.add(parseChordString(rawChord))
                i = closeIdx + 1
            } else {
                lyricBuf.append(line[i])
                i++
            }
        }

        if (lyricBuf.isNotEmpty()) {
            tokens.add(Token.Lyric(lyricBuf.toString()))
        }

        return tokens
    }

    /**
     * Parse one row of a chord grid: `| D . . . | Bm . . G . |`
     */
    private fun parseGridRow(line: String): ChordGridRow? {
        val startRepeat = Regex("^\\s*\\|:").containsMatchIn(line)
        val endRepeat = line.contains(":|")
        val repeatCountMatch = Regex("\\|\\s*x(\\d+)\\s*$").find(line)
        val repeatCount = repeatCountMatch?.groupValues?.get(1)?.toIntOrNull()

        val normalized = line
            .replace(Regex("^\\s*\\|:"), "|")
            .replace(":|", "|")
            .replace(Regex("\\|\\s*x\\d+\\s*$"), "|")

        val cells = normalized.split("|").map { it.trim() }.filter { it.isNotEmpty() }
        val bars = mutableListOf<ChordGridBar>()

        for (cell in cells) {
            val parts = cell.split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (parts.isEmpty()) continue
            if (parts.none { Regex("^[A-G]").containsMatchIn(it) }) continue
            val beats = parts.map { p ->
                if (Regex("^[A-G]").containsMatchIn(p)) ChordGridBeat(chord = p)
                else ChordGridBeat()
            }
            bars.add(ChordGridBar(beats = beats))
        }

        if (bars.isEmpty()) return null
        return ChordGridRow(
            bars = bars,
            startRepeat = startRepeat,
            endRepeat = endRepeat,
            repeatCount = repeatCount,
        )
    }

    private fun directiveToMetadataKey(name: String, metadata: SongMetadata, value: String?) {
        when (name) {
            "title", "t" -> metadata.title = value
            "artist", "a" -> metadata.artist = value
            "album" -> metadata.album = value
            "key", "k" -> metadata.key = value
            "tempo" -> metadata.tempo = value?.toIntOrNull()
            "capo" -> metadata.capo = value?.toIntOrNull()
            "time" -> metadata.timeSig = value
            "copyright" -> metadata.copyright = value
            "ccli" -> metadata.ccli = value
        }
    }

    fun parseChordPro(rawContent: String): ParsedSong {
        val metadata = SongMetadata()
        val lines = mutableListOf<ParsedLine>()
        val rawLines = rawContent.split("\n")
        var gridRows: MutableList<ChordGridRow>? = null

        for (rawLine in rawLines) {
            val trimmed = rawLine.trim()

            // Empty line
            if (trimmed.isEmpty()) {
                if (gridRows == null) {
                    lines.add(ParsedLine(tokens = emptyList(), isEmpty = true))
                }
                continue
            }

            // Inside a chord grid block
            if (gridRows != null) {
                val closeMatch = DIRECTIVE_RE.find(trimmed)
                if (closeMatch != null && closeMatch.groupValues[1].lowercase() == "eog") {
                    val gridToken = Token.ChordGrid(rows = gridRows.toList())
                    lines.add(ParsedLine(tokens = listOf(gridToken), isChordGrid = true))
                    gridRows = null
                    continue
                }
                val row = parseGridRow(trimmed)
                if (row != null) gridRows.add(row)
                continue
            }

            // Comment line starting with #
            if (trimmed.startsWith("#")) {
                val commentToken = Token.Comment(text = trimmed.substring(1).trim())
                lines.add(ParsedLine(tokens = listOf(commentToken), isComment = true))
                continue
            }

            // Directive line
            val dirMatch = DIRECTIVE_RE.find(trimmed)
            if (dirMatch != null) {
                val name = dirMatch.groupValues[1].lowercase()
                val value = dirMatch.groupValues[2].takeIf { it.isNotEmpty() }?.trim()

                // Start of chord grid block
                if (name == "sog") {
                    gridRows = mutableListOf()
                    continue
                }

                // End-of-section directives
                val endSection = SectionType.fromEndDirective(name)
                if (endSection != null) {
                    lines.add(
                        ParsedLine(
                            tokens = emptyList(),
                            isDirective = true,
                            isSectionEnd = true,
                            sectionType = endSection,
                        )
                    )
                    continue
                }

                // Section-start directive
                // Special case: {c: text} with a value is the comment shorthand
                val sectionType = SectionType.fromDirective(name)
                if (sectionType != null && !(name == "c" && value != null)) {
                    val sectionToken = Token.Section(sectionType = sectionType, label = value)
                    lines.add(
                        ParsedLine(
                            tokens = listOf(sectionToken),
                            isDirective = true,
                            isSection = true,
                            sectionType = sectionType,
                            sectionLabel = value,
                        )
                    )
                    continue
                }

                // Comment directive
                if (name == "comment" || name == "c") {
                    val commentToken = Token.Comment(text = value ?: "")
                    lines.add(
                        ParsedLine(
                            tokens = listOf(commentToken),
                            isDirective = true,
                            isComment = true,
                        )
                    )
                    continue
                }

                // Metadata directive
                if (METADATA_DIRECTIVES.contains(name)) {
                    directiveToMetadataKey(name, metadata, value)
                }

                lines.add(
                    ParsedLine(
                        tokens = listOf(Token.Directive(name = name, value = value)),
                        isDirective = true,
                    )
                )
                continue
            }

            // Inline chord+lyric line
            val tokens = tokenizeInlineLine(rawLine)
            val hasChords = tokens.any { it is Token.Chord }
            lines.add(ParsedLine(tokens = tokens, hasChords = hasChords))
        }

        return ParsedSong(metadata = metadata, lines = lines, rawContent = rawContent)
    }

    /**
     * Plain-text parser: detects lines made only of chord names and pairs with next lyric line.
     */
    fun parsePlainText(rawContent: String): ParsedSong {
        val metadata = SongMetadata()
        val lines = mutableListOf<ParsedLine>()
        val rawLines = rawContent.split("\n")

        val plainChordRe = Regex("^([A-G][#b]?[a-z0-9/]*[\\s\\-]+)*[A-G][#b]?[a-z0-9/]*\\s*$")

        var i = 0
        while (i < rawLines.size) {
            val line = rawLines[i]
            val trimmed = line.trim()

            if (trimmed.isEmpty()) {
                lines.add(ParsedLine(tokens = emptyList(), isEmpty = true))
                i++
                continue
            }

            if (plainChordRe.containsMatchIn(trimmed)) {
                val nextLine = if (i + 1 < rawLines.size) rawLines[i + 1] else ""
                val chordNames = trimmed.split(Regex("[\\s\\-]+")).filter { it.isNotEmpty() }

                val tokens = mutableListOf<Token>()
                for (ch in chordNames) {
                    tokens.add(parseChordString(ch))
                    tokens.add(Token.Lyric(" "))
                }

                if (nextLine.trim().isNotEmpty() && !plainChordRe.containsMatchIn(nextLine.trim())) {
                    tokens.add(Token.Lyric(nextLine))
                    i++
                }

                lines.add(ParsedLine(tokens = tokens, hasChords = true))
            } else {
                lines.add(ParsedLine(tokens = listOf(Token.Lyric(line))))
            }

            i++
        }

        return ParsedSong(metadata = metadata, lines = lines, rawContent = rawContent)
    }
}
