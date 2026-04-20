package com.songchords.app.data.chords

data class ChordDefinition(
    val name: String,
    val frets: List<Int>,  // -1 = muted (x), 0 = open
    val baseFret: Int = 1,
    val strings: Int = 6,
)

/**
 * Common guitar chord voicings — at least two variations per chord.
 * Typically an open/standard voicing followed by a barre or alternate voicing.
 */
val GUITAR_CHORDS: List<ChordDefinition> = listOf(
    // Major
    ChordDefinition("C", listOf(-1, 3, 2, 0, 1, 0)),
    ChordDefinition("C", listOf(-1, 3, 5, 5, 5, 3), baseFret = 3), // A-shape barre at 3
    ChordDefinition("D", listOf(-1, -1, 0, 2, 3, 2)),
    ChordDefinition("D", listOf(-1, 5, 7, 7, 7, 5), baseFret = 5), // A-shape barre at 5
    ChordDefinition("E", listOf(0, 2, 2, 1, 0, 0)),
    ChordDefinition("E", listOf(-1, 7, 9, 9, 9, 7), baseFret = 7), // A-shape barre at 7
    ChordDefinition("F", listOf(1, 1, 2, 3, 3, 1)),
    ChordDefinition("F", listOf(-1, -1, 3, 2, 1, 1)), // small F
    ChordDefinition("G", listOf(3, 2, 0, 0, 0, 3)),
    ChordDefinition("G", listOf(3, 5, 5, 4, 3, 3), baseFret = 3), // E-shape barre at 3
    ChordDefinition("A", listOf(-1, 0, 2, 2, 2, 0)),
    ChordDefinition("A", listOf(5, 7, 7, 6, 5, 5), baseFret = 5), // E-shape barre at 5
    ChordDefinition("B", listOf(-1, 2, 4, 4, 4, 2), baseFret = 2),
    ChordDefinition("B", listOf(7, 9, 9, 8, 7, 7), baseFret = 7), // E-shape barre at 7

    // Minor
    ChordDefinition("Am", listOf(-1, 0, 2, 2, 1, 0)),
    ChordDefinition("Am", listOf(5, 7, 7, 5, 5, 5), baseFret = 5), // E-shape minor barre at 5
    ChordDefinition("Bm", listOf(-1, 2, 4, 4, 3, 2), baseFret = 2),
    ChordDefinition("Bm", listOf(7, 9, 9, 7, 7, 7), baseFret = 7),
    ChordDefinition("Cm", listOf(-1, 3, 5, 5, 4, 3), baseFret = 3),
    ChordDefinition("Cm", listOf(8, 10, 10, 8, 8, 8), baseFret = 8),
    ChordDefinition("Dm", listOf(-1, -1, 0, 2, 3, 1)),
    ChordDefinition("Dm", listOf(-1, 5, 7, 7, 6, 5), baseFret = 5),
    ChordDefinition("Em", listOf(0, 2, 2, 0, 0, 0)),
    ChordDefinition("Em", listOf(-1, 7, 9, 9, 8, 7), baseFret = 7),
    ChordDefinition("Fm", listOf(1, 1, 3, 3, 2, 1)),
    ChordDefinition("Fm", listOf(-1, 8, 10, 10, 9, 8), baseFret = 8),
    ChordDefinition("Gm", listOf(3, 5, 5, 3, 3, 3), baseFret = 3),
    ChordDefinition("Gm", listOf(-1, 10, 12, 12, 11, 10), baseFret = 10),

    // 7th
    ChordDefinition("A7", listOf(-1, 0, 2, 0, 2, 0)),
    ChordDefinition("A7", listOf(5, 7, 5, 6, 5, 5), baseFret = 5),
    ChordDefinition("B7", listOf(-1, 2, 1, 2, 0, 2)),
    ChordDefinition("B7", listOf(7, 9, 7, 8, 7, 7), baseFret = 7),
    ChordDefinition("C7", listOf(-1, 3, 2, 3, 1, 0)),
    ChordDefinition("C7", listOf(-1, 3, 5, 3, 5, 3), baseFret = 3),
    ChordDefinition("D7", listOf(-1, -1, 0, 2, 1, 2)),
    ChordDefinition("D7", listOf(-1, 5, 7, 5, 7, 5), baseFret = 5),
    ChordDefinition("E7", listOf(0, 2, 0, 1, 0, 0)),
    ChordDefinition("E7", listOf(0, 2, 2, 1, 3, 0)),
    ChordDefinition("G7", listOf(3, 2, 0, 0, 0, 1)),
    ChordDefinition("G7", listOf(3, 5, 3, 4, 3, 3), baseFret = 3),

    // Minor 7th
    ChordDefinition("Am7", listOf(-1, 0, 2, 0, 1, 0)),
    ChordDefinition("Am7", listOf(5, 7, 5, 5, 5, 5), baseFret = 5),
    ChordDefinition("Dm7", listOf(-1, -1, 0, 2, 1, 1)),
    ChordDefinition("Dm7", listOf(-1, 5, 7, 5, 6, 5), baseFret = 5),
    ChordDefinition("Em7", listOf(0, 2, 0, 0, 0, 0)),
    ChordDefinition("Em7", listOf(-1, 7, 9, 7, 8, 7), baseFret = 7),

    // Sus
    ChordDefinition("Dsus4", listOf(-1, -1, 0, 2, 3, 3)),
    ChordDefinition("Dsus4", listOf(-1, 5, 7, 7, 8, 5), baseFret = 5),
    ChordDefinition("Asus4", listOf(-1, 0, 2, 2, 3, 0)),
    ChordDefinition("Asus4", listOf(5, 7, 7, 7, 5, 5), baseFret = 5),
    ChordDefinition("Asus2", listOf(-1, 0, 2, 2, 0, 0)),
    ChordDefinition("Asus2", listOf(-1, -1, 7, 9, 10, 7), baseFret = 7),

    // Sharps/Flats common
    ChordDefinition("F#m", listOf(2, 4, 4, 2, 2, 2), baseFret = 2),
    ChordDefinition("F#m", listOf(-1, 9, 11, 11, 10, 9), baseFret = 9),
    ChordDefinition("C#m", listOf(-1, 4, 6, 6, 5, 4), baseFret = 4),
    ChordDefinition("C#m", listOf(9, 11, 11, 9, 9, 9), baseFret = 9),
    ChordDefinition("Bb", listOf(-1, 1, 3, 3, 3, 1)),
    ChordDefinition("Bb", listOf(6, 8, 8, 7, 6, 6), baseFret = 6),
    ChordDefinition("Eb", listOf(-1, -1, 1, 3, 4, 3)),
    ChordDefinition("Eb", listOf(-1, 6, 8, 8, 8, 6), baseFret = 6),
    ChordDefinition("Ab", listOf(4, 6, 6, 5, 4, 4), baseFret = 4),
    ChordDefinition("Ab", listOf(-1, -1, 6, 5, 4, 4)),
)

val UKULELE_CHORDS: List<ChordDefinition> = listOf(
    ChordDefinition("C", listOf(0, 0, 0, 3), strings = 4),
    ChordDefinition("C", listOf(5, 4, 3, 3), baseFret = 3, strings = 4),
    ChordDefinition("D", listOf(2, 2, 2, 0), strings = 4),
    ChordDefinition("D", listOf(2, 2, 2, 5), baseFret = 2, strings = 4),
    ChordDefinition("E", listOf(1, 4, 0, 2), strings = 4),
    ChordDefinition("E", listOf(4, 4, 4, 2), baseFret = 2, strings = 4),
    ChordDefinition("F", listOf(2, 0, 1, 0), strings = 4),
    ChordDefinition("F", listOf(5, 5, 5, 3), baseFret = 3, strings = 4),
    ChordDefinition("G", listOf(0, 2, 3, 2), strings = 4),
    ChordDefinition("G", listOf(4, 2, 3, 2), baseFret = 2, strings = 4),
    ChordDefinition("A", listOf(2, 1, 0, 0), strings = 4),
    ChordDefinition("A", listOf(6, 4, 5, 4), baseFret = 4, strings = 4),
    ChordDefinition("Am", listOf(2, 0, 0, 0), strings = 4),
    ChordDefinition("Am", listOf(5, 4, 5, 4), baseFret = 4, strings = 4),
    ChordDefinition("Em", listOf(0, 4, 3, 2), strings = 4),
    ChordDefinition("Em", listOf(7, 7, 7, 5), baseFret = 5, strings = 4),
    ChordDefinition("Dm", listOf(2, 2, 1, 0), strings = 4),
    ChordDefinition("Dm", listOf(5, 5, 5, 5), baseFret = 5, strings = 4),
)

fun getChordsByInstrument(guitar: Boolean): List<ChordDefinition> =
    if (guitar) GUITAR_CHORDS else UKULELE_CHORDS
