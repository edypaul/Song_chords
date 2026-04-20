package com.songchords.app.data

import androidx.compose.ui.graphics.Color

/**
 * Per-section style slice. Colors use null to mean "inherit theme default";
 * fontSize uses -1 (or non-positive) to mean "inherit the surrounding size".
 */
data class SectionStyle(
    val fontSize: Int = -1,
    val color: Color? = null,
    val background: Color? = null,
)

data class SongViewStyle(
    val preset: String,
    val fontFamily: FontFamilyChoice = FontFamilyChoice.MONOSPACE,
    val titleUppercase: Boolean = false,
    val sectionUppercase: Boolean = true,
    val lyrics: SectionStyle = SectionStyle(fontSize = 16),
    val chords: SectionStyle = SectionStyle(fontSize = 13),
    val title: SectionStyle = SectionStyle(fontSize = 24),
    val details: SectionStyle = SectionStyle(fontSize = 12),
    val section: SectionStyle = SectionStyle(fontSize = 10),
    val chorusBorderColor: Color? = null,
)

enum class FontFamilyChoice(val displayName: String) {
    MONOSPACE("Monospace"),
    SANS_SERIF("Sans Serif"),
    SERIF("Serif"),
}

data class BuiltInPreset(
    val key: String,
    val name: String,
    val mode: PresetMode,
    val style: SongViewStyle,
)

enum class PresetMode { LIGHT, DARK }

private fun hex(s: String): Color = Color(android.graphics.Color.parseColor(s))

/**
 * Built-in style presets — mirrors the desktop SONG_STYLE_PRESETS set.
 */
val SONG_STYLE_PRESETS: Map<String, BuiltInPreset> = linkedMapOf(
    "default" to BuiltInPreset(
        key = "default", name = "Default", mode = PresetMode.DARK,
        style = SongViewStyle(preset = "default"),
    ),
    "midnight" to BuiltInPreset(
        key = "midnight", name = "Midnight", mode = PresetMode.DARK,
        style = SongViewStyle(
            preset = "midnight",
            fontFamily = FontFamilyChoice.MONOSPACE,
            lyrics = SectionStyle(fontSize = 16, color = hex("#cbd5e1")),
            chords = SectionStyle(fontSize = 13, color = hex("#a5b4fc")),
            title = SectionStyle(fontSize = 24, color = hex("#f1f5f9"), background = hex("#1e293b")),
            details = SectionStyle(fontSize = 12, color = hex("#94a3b8")),
            section = SectionStyle(fontSize = 10, color = hex("#c7d2fe"), background = hex("#312e81")),
            chorusBorderColor = hex("#a5b4fc"),
        ),
    ),
    "neon" to BuiltInPreset(
        key = "neon", name = "Neon", mode = PresetMode.DARK,
        style = SongViewStyle(
            preset = "neon",
            fontFamily = FontFamilyChoice.MONOSPACE,
            lyrics = SectionStyle(fontSize = 16, color = hex("#e0f2fe")),
            chords = SectionStyle(fontSize = 14, color = hex("#22d3ee")),
            title = SectionStyle(fontSize = 26, color = hex("#a7f3d0")),
            details = SectionStyle(fontSize = 12, color = hex("#67e8f9")),
            section = SectionStyle(fontSize = 11, color = hex("#f0abfc")),
            chorusBorderColor = hex("#22d3ee"),
        ),
    ),
    "ember" to BuiltInPreset(
        key = "ember", name = "Ember", mode = PresetMode.DARK,
        style = SongViewStyle(
            preset = "ember",
            lyrics = SectionStyle(fontSize = 16, color = hex("#fde68a")),
            chords = SectionStyle(fontSize = 14, color = hex("#fb923c")),
            title = SectionStyle(fontSize = 24, color = hex("#fef3c7")),
            details = SectionStyle(fontSize = 12, color = hex("#fdba74")),
            section = SectionStyle(fontSize = 11, color = hex("#fca5a5"), background = hex("#7c2d12")),
            chorusBorderColor = hex("#fb923c"),
        ),
    ),
    "aurora" to BuiltInPreset(
        key = "aurora", name = "Aurora", mode = PresetMode.DARK,
        style = SongViewStyle(
            preset = "aurora",
            lyrics = SectionStyle(fontSize = 16, color = hex("#ddd6fe")),
            chords = SectionStyle(fontSize = 14, color = hex("#5eead4")),
            title = SectionStyle(fontSize = 26, color = hex("#e9d5ff")),
            details = SectionStyle(fontSize = 12, color = hex("#c4b5fd")),
            section = SectionStyle(fontSize = 11, color = hex("#a5f3fc")),
            chorusBorderColor = hex("#5eead4"),
        ),
    ),
    "slate" to BuiltInPreset(
        key = "slate", name = "Slate", mode = PresetMode.DARK,
        style = SongViewStyle(
            preset = "slate",
            fontFamily = FontFamilyChoice.SANS_SERIF,
            lyrics = SectionStyle(fontSize = 17, color = hex("#e2e8f0")),
            chords = SectionStyle(fontSize = 14, color = hex("#fbbf24")),
            title = SectionStyle(fontSize = 26, color = hex("#f8fafc")),
            details = SectionStyle(fontSize = 12, color = hex("#94a3b8")),
            section = SectionStyle(fontSize = 11, color = hex("#cbd5e1")),
            chorusBorderColor = hex("#fbbf24"),
        ),
    ),
    "classic" to BuiltInPreset(
        key = "classic", name = "Classic", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "classic",
            fontFamily = FontFamilyChoice.SERIF,
            lyrics = SectionStyle(fontSize = 16, color = hex("#1f2937")),
            chords = SectionStyle(fontSize = 14, color = hex("#b45309")),
            title = SectionStyle(fontSize = 26, color = hex("#111827")),
            details = SectionStyle(fontSize = 12, color = hex("#4b5563")),
            section = SectionStyle(fontSize = 11, color = hex("#78350f")),
            chorusBorderColor = hex("#b45309"),
        ),
    ),
    "warm" to BuiltInPreset(
        key = "warm", name = "Warm", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "warm",
            lyrics = SectionStyle(fontSize = 16, color = hex("#451a03")),
            chords = SectionStyle(fontSize = 14, color = hex("#c2410c")),
            title = SectionStyle(fontSize = 26, color = hex("#1c1917")),
            details = SectionStyle(fontSize = 12, color = hex("#78350f")),
            section = SectionStyle(fontSize = 11, color = hex("#9a3412"), background = hex("#fef3c7")),
            chorusBorderColor = hex("#c2410c"),
        ),
    ),
    "highContrast" to BuiltInPreset(
        key = "highContrast", name = "High Contrast", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "highContrast",
            lyrics = SectionStyle(fontSize = 17, color = hex("#000000")),
            chords = SectionStyle(fontSize = 15, color = hex("#0000ff")),
            title = SectionStyle(fontSize = 28, color = hex("#000000")),
            details = SectionStyle(fontSize = 13, color = hex("#111111")),
            section = SectionStyle(fontSize = 12, color = hex("#ffffff"), background = hex("#000000")),
            chorusBorderColor = hex("#0000ff"),
        ),
    ),
    "minimal" to BuiltInPreset(
        key = "minimal", name = "Minimal", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "minimal",
            fontFamily = FontFamilyChoice.SANS_SERIF,
            lyrics = SectionStyle(fontSize = 16, color = hex("#374151")),
            chords = SectionStyle(fontSize = 13, color = hex("#6b7280")),
            title = SectionStyle(fontSize = 22, color = hex("#111827")),
            details = SectionStyle(fontSize = 11, color = hex("#9ca3af")),
            section = SectionStyle(fontSize = 10, color = hex("#6b7280")),
            chorusBorderColor = hex("#9ca3af"),
        ),
    ),
    "ocean" to BuiltInPreset(
        key = "ocean", name = "Ocean", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "ocean",
            lyrics = SectionStyle(fontSize = 16, color = hex("#0c4a6e")),
            chords = SectionStyle(fontSize = 14, color = hex("#0ea5e9")),
            title = SectionStyle(fontSize = 26, color = hex("#082f49")),
            details = SectionStyle(fontSize = 12, color = hex("#0369a1")),
            section = SectionStyle(fontSize = 11, color = hex("#0369a1"), background = hex("#bae6fd")),
            chorusBorderColor = hex("#0ea5e9"),
        ),
    ),
    "paper" to BuiltInPreset(
        key = "paper", name = "Paper", mode = PresetMode.LIGHT,
        style = SongViewStyle(
            preset = "paper",
            fontFamily = FontFamilyChoice.SERIF,
            lyrics = SectionStyle(fontSize = 16, color = hex("#3f3f46")),
            chords = SectionStyle(fontSize = 14, color = hex("#a16207")),
            title = SectionStyle(fontSize = 26, color = hex("#18181b")),
            details = SectionStyle(fontSize = 12, color = hex("#52525b")),
            section = SectionStyle(fontSize = 11, color = hex("#713f12")),
            chorusBorderColor = hex("#a16207"),
        ),
    ),
)

val DEFAULT_SONG_VIEW_STYLE: SongViewStyle = SONG_STYLE_PRESETS["default"]!!.style
