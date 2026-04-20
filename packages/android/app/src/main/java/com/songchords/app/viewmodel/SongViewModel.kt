package com.songchords.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.songchords.app.data.AccidentalMode
import com.songchords.app.data.SongRepository
import com.songchords.app.data.entities.SongEntity
import com.songchords.app.parser.ChordProParser
import com.songchords.app.parser.ParsedSong
import com.songchords.app.transpose.Transposer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class ViewMode { CHORDS, LYRICS_ONLY, CHORDS_ONLY }

data class SongViewState(
    val song: SongEntity? = null,
    val parsedSong: ParsedSong? = null,
    val displayedSong: ParsedSong? = null,
    val transposeSteps: Int = 0,
    val capo: Int = 0,
    val fontSize: Int = 16,
    val viewMode: ViewMode = ViewMode.CHORDS,
    val preferFlats: Boolean = false,
    val accidentalMode: AccidentalMode = AccidentalMode.AUTO,
    val loading: Boolean = true,
)

const val TRANSPOSE_MIN = -11
const val TRANSPOSE_MAX = 11

class SongViewModel(private val repo: SongRepository) : ViewModel() {

    private val _state = MutableStateFlow(SongViewState())
    val state: StateFlow<SongViewState> = _state.asStateFlow()

    fun loadSong(id: String) {
        viewModelScope.launch {
            // Step 1: fetch song entity from DB (IO thread) and show it immediately
            val song = repo.getById(id) ?: run {
                _state.value = _state.value.copy(loading = false)
                return@launch
            }

            // Show the song metadata instantly (title, artist in toolbar)
            _state.value = _state.value.copy(song = song)

            // Step 2: parse on IO thread — never blocks the UI
            val parsedRaw = withContext(Dispatchers.Default) {
                if (song.contentFormat == "chordpro")
                    ChordProParser.parseChordPro(song.content)
                else
                    ChordProParser.parsePlainText(song.content)
            }

            // Overlay the song entity's key onto parsed metadata when the
            // content doesn't declare `{key: X}` — the transposer's circle-of-
            // fifths resolver needs an authoritative key.
            val parsed = if (parsedRaw.metadata.key.isNullOrBlank() && !song.key.isNullOrBlank()) {
                parsedRaw.copy(metadata = parsedRaw.metadata.copy(key = song.key))
            } else parsedRaw

            val capo = song.capo
            val preferFlats = Transposer.resolveFlatsForKey(
                parsed.metadata.key?.let { Transposer.transposeKey(it, -capo) },
                false,
            )
            // Preserve the user's currently-selected accidentals mode (which
            // may have been set before the song finished loading).
            val mode = _state.value.accidentalMode
            val displayed = recompute(parsed, 0, capo, preferFlats, mode)

            _state.value = _state.value.copy(
                song = song,
                parsedSong = parsed,
                displayedSong = displayed,
                transposeSteps = 0,
                capo = capo,
                preferFlats = preferFlats,
                loading = false,
            )
        }
    }

    private fun recompute(parsed: ParsedSong, steps: Int, capo: Int, flats: Boolean, mode: AccidentalMode = AccidentalMode.AUTO): ParsedSong {
        val shapeSteps = steps - capo
        // Global accidentals override: Flats/Sharps force a uniform spelling;
        // only Auto consults the circle of fifths + section {key:} directives.
        if (mode == AccidentalMode.FLATS) return Transposer.transposeSong(parsed, shapeSteps, true)
        if (mode == AccidentalMode.SHARPS) return Transposer.transposeSong(parsed, shapeSteps, false)

        val playingKey = parsed.metadata.key?.let { Transposer.transposeKey(it, shapeSteps) }
        val songDefault = Transposer.resolveFlatsForKey(playingKey, flats)
        val perLine = Transposer.computeSectionFlats(parsed, shapeSteps, songDefault)
        return Transposer.transposeSong(
            parsed,
            shapeSteps,
            songDefault,
            flatsResolver = { i -> if (i in perLine.indices) perLine[i] else songDefault },
        )
    }

    fun setAccidentalMode(mode: AccidentalMode) {
        val s = _state.value
        if (s.accidentalMode == mode) return
        // Update the state unconditionally — even before a song is loaded —
        // so loadSong later picks up the user's preference.
        val parsed = s.parsedSong
        _state.value = s.copy(
            accidentalMode = mode,
            displayedSong = parsed?.let { recompute(it, s.transposeSteps, s.capo, s.preferFlats, mode) } ?: s.displayedSong,
        )
    }

    fun transposeUp() {
        val s = _state.value
        if (s.parsedSong == null || s.transposeSteps >= TRANSPOSE_MAX) return
        val newSteps = s.transposeSteps + 1
        _state.value = s.copy(
            transposeSteps = newSteps,
            displayedSong = recompute(s.parsedSong, newSteps, s.capo, s.preferFlats, s.accidentalMode),
        )
    }

    fun transposeDown() {
        val s = _state.value
        if (s.parsedSong == null || s.transposeSteps <= TRANSPOSE_MIN) return
        val newSteps = s.transposeSteps - 1
        _state.value = s.copy(
            transposeSteps = newSteps,
            displayedSong = recompute(s.parsedSong, newSteps, s.capo, s.preferFlats, s.accidentalMode),
        )
    }

    fun resetTranspose() {
        val s = _state.value
        if (s.parsedSong == null) return
        _state.value = s.copy(
            transposeSteps = 0,
            displayedSong = recompute(s.parsedSong, 0, s.capo, s.preferFlats, s.accidentalMode),
        )
    }

    fun setCapo(capo: Int) {
        val s = _state.value
        if (s.parsedSong == null) return
        _state.value = s.copy(
            capo = capo,
            displayedSong = recompute(s.parsedSong, s.transposeSteps, capo, s.preferFlats, s.accidentalMode),
        )
    }

    fun setFontSize(size: Int) {
        _state.value = _state.value.copy(fontSize = size.coerceIn(10, 32))
    }

    fun setViewMode(mode: ViewMode) {
        _state.value = _state.value.copy(viewMode = mode)
    }
}
