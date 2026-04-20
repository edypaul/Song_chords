package com.songchords.app.parser

// ---------------------------------------------------------------------------
// Parser token types — mirror the TypeScript shared package
// ---------------------------------------------------------------------------

enum class SectionType {
    VERSE, CHORUS, BRIDGE, PRE_CHORUS, INTRO, OUTRO, TAG, INTERLUDE;

    companion object {
        fun fromDirective(name: String): SectionType? = when (name) {
            "verse", "v", "sov" -> VERSE
            "chorus", "c", "soc" -> CHORUS
            "bridge" -> BRIDGE
            "pre-chorus", "prechorus" -> PRE_CHORUS
            "intro" -> INTRO
            "outro" -> OUTRO
            "tag" -> TAG
            "interlude" -> INTERLUDE
            else -> null
        }

        fun fromEndDirective(name: String): SectionType? = when (name) {
            "eoc", "end_of_chorus" -> CHORUS
            "eov", "end_of_verse" -> VERSE
            "end_of_bridge" -> BRIDGE
            else -> null
        }
    }
}

sealed class Token {
    data class Chord(
        val chord: String,
        val root: String,
        val quality: String,
        val bass: String? = null,
    ) : Token()

    data class Lyric(val text: String) : Token()

    data class Directive(val name: String, val value: String? = null) : Token()

    data class Section(val sectionType: SectionType, val label: String? = null) : Token()

    data class Comment(val text: String) : Token()

    data class ChordGrid(val rows: List<ChordGridRow>) : Token()
}

data class ChordGridBeat(val chord: String? = null)

data class ChordGridBar(val beats: List<ChordGridBeat>)

data class ChordGridRow(
    val bars: List<ChordGridBar>,
    val startRepeat: Boolean = false,
    val endRepeat: Boolean = false,
    val repeatCount: Int? = null,
)

data class ParsedLine(
    val tokens: List<Token>,
    val hasChords: Boolean = false,
    val isDirective: Boolean = false,
    val isSection: Boolean = false,
    val isComment: Boolean = false,
    val isEmpty: Boolean = false,
    val isChordGrid: Boolean = false,
    val isSectionEnd: Boolean = false,
    val sectionType: SectionType? = null,
    val sectionLabel: String? = null,
)

data class SongMetadata(
    var title: String? = null,
    var artist: String? = null,
    var album: String? = null,
    var key: String? = null,
    var tempo: Int? = null,
    var capo: Int? = null,
    var timeSig: String? = null,
    var copyright: String? = null,
    var ccli: String? = null,
)

data class ParsedSong(
    val metadata: SongMetadata,
    val lines: List<ParsedLine>,
    val rawContent: String,
)
