package com.songchords.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

enum class ThemeMode { SYSTEM, LIGHT, DARK }
enum class Instrument { GUITAR, UKULELE }
enum class ChordBarPosition { TOP, BOTTOM, RIGHT }
enum class AccidentalMode { AUTO, FLATS, SHARPS }

data class AppSettings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val defaultInstrument: Instrument = Instrument.GUITAR,
    val preferFlats: Boolean = false,
    val scrollSpeed: Int = 40,
    val fontSize: Int = 16,
    val songCentered: Boolean = false,
    val showChordDiagrams: Boolean = true,
    val inlineChordDiagrams: Boolean = false,
    val chordBarPosition: ChordBarPosition = ChordBarPosition.TOP,
    val perfMetroEnabled: Boolean = true,
    val perfScrollEnabled: Boolean = true,
    val perfZoom: Float = 1f,
    val accidentalMode: AccidentalMode = AccidentalMode.AUTO,
    val songViewStylePreset: String = "default",
    val customPresets: Map<String, CustomPreset> = emptyMap(),
)

class SettingsRepository(private val context: Context) {

    private object Keys {
        val THEME = stringPreferencesKey("theme")
        val INSTRUMENT = stringPreferencesKey("instrument")
        val PREFER_FLATS = booleanPreferencesKey("prefer_flats")
        val SCROLL_SPEED = intPreferencesKey("scroll_speed")
        val FONT_SIZE = intPreferencesKey("font_size")
        val SONG_CENTERED = booleanPreferencesKey("song_centered")
        val SHOW_CHORD_DIAGRAMS = booleanPreferencesKey("show_chord_diagrams")
        val INLINE_CHORD_DIAGRAMS = booleanPreferencesKey("inline_chord_diagrams")
        val CHORD_BAR_POSITION = stringPreferencesKey("chord_bar_position")
        val PERF_METRO_ENABLED = booleanPreferencesKey("perf_metro_enabled")
        val PERF_SCROLL_ENABLED = booleanPreferencesKey("perf_scroll_enabled")
        val PERF_ZOOM = floatPreferencesKey("perf_zoom")
        val ACCIDENTAL_MODE = stringPreferencesKey("accidental_mode")
        val SONG_VIEW_STYLE_PRESET = stringPreferencesKey("song_view_style_preset")
        val CUSTOM_PRESETS = stringPreferencesKey("custom_presets")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { prefs ->
        AppSettings(
            theme = prefs[Keys.THEME]?.let { ThemeMode.valueOf(it) } ?: ThemeMode.SYSTEM,
            defaultInstrument = prefs[Keys.INSTRUMENT]?.let { Instrument.valueOf(it) } ?: Instrument.GUITAR,
            preferFlats = prefs[Keys.PREFER_FLATS] ?: false,
            scrollSpeed = prefs[Keys.SCROLL_SPEED] ?: 40,
            fontSize = prefs[Keys.FONT_SIZE] ?: 16,
            songCentered = prefs[Keys.SONG_CENTERED] ?: false,
            showChordDiagrams = prefs[Keys.SHOW_CHORD_DIAGRAMS] ?: true,
            inlineChordDiagrams = prefs[Keys.INLINE_CHORD_DIAGRAMS] ?: false,
            chordBarPosition = prefs[Keys.CHORD_BAR_POSITION]?.let { runCatching { ChordBarPosition.valueOf(it) }.getOrNull() } ?: ChordBarPosition.TOP,
            perfMetroEnabled = prefs[Keys.PERF_METRO_ENABLED] ?: true,
            perfScrollEnabled = prefs[Keys.PERF_SCROLL_ENABLED] ?: true,
            perfZoom = prefs[Keys.PERF_ZOOM] ?: 1f,
            accidentalMode = prefs[Keys.ACCIDENTAL_MODE]?.let { runCatching { AccidentalMode.valueOf(it) }.getOrNull() } ?: AccidentalMode.AUTO,
            songViewStylePreset = prefs[Keys.SONG_VIEW_STYLE_PRESET] ?: "default",
            customPresets = customPresetsFromJson(prefs[Keys.CUSTOM_PRESETS]),
        )
    }

    suspend fun setTheme(mode: ThemeMode) {
        context.dataStore.edit { it[Keys.THEME] = mode.name }
    }

    suspend fun setInstrument(instrument: Instrument) {
        context.dataStore.edit { it[Keys.INSTRUMENT] = instrument.name }
    }

    suspend fun setPreferFlats(prefer: Boolean) {
        context.dataStore.edit { it[Keys.PREFER_FLATS] = prefer }
    }

    suspend fun setScrollSpeed(speed: Int) {
        context.dataStore.edit { it[Keys.SCROLL_SPEED] = speed.coerceIn(5, 100) }
    }

    suspend fun setFontSize(size: Int) {
        context.dataStore.edit { it[Keys.FONT_SIZE] = size.coerceIn(10, 32) }
    }

    suspend fun setSongCentered(centered: Boolean) {
        context.dataStore.edit { it[Keys.SONG_CENTERED] = centered }
    }

    suspend fun setShowChordDiagrams(show: Boolean) {
        context.dataStore.edit { it[Keys.SHOW_CHORD_DIAGRAMS] = show }
    }

    suspend fun setInlineChordDiagrams(show: Boolean) {
        context.dataStore.edit { it[Keys.INLINE_CHORD_DIAGRAMS] = show }
    }

    suspend fun setChordBarPosition(position: ChordBarPosition) {
        context.dataStore.edit { it[Keys.CHORD_BAR_POSITION] = position.name }
    }

    suspend fun setPerfMetroEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.PERF_METRO_ENABLED] = enabled }
    }

    suspend fun setPerfScrollEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.PERF_SCROLL_ENABLED] = enabled }
    }

    suspend fun setPerfZoom(zoom: Float) {
        context.dataStore.edit { it[Keys.PERF_ZOOM] = zoom.coerceIn(0.5f, 2.5f) }
    }

    suspend fun setAccidentalMode(mode: AccidentalMode) {
        context.dataStore.edit { it[Keys.ACCIDENTAL_MODE] = mode.name }
    }

    suspend fun setSongViewStylePreset(key: String) {
        context.dataStore.edit { it[Keys.SONG_VIEW_STYLE_PRESET] = key }
    }

    suspend fun setCustomPresets(map: Map<String, CustomPreset>) {
        context.dataStore.edit { it[Keys.CUSTOM_PRESETS] = customPresetsToJson(map) }
    }
}
