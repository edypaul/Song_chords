package com.songchords.app.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.songchords.app.data.SongCreateInput
import com.songchords.app.data.SongRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class EditorState(
    val id: String? = null,
    val title: String = "",
    val artist: String = "",
    val key: String = "",
    val tempo: String = "",
    val timeSig: String = "4/4",
    val capo: Int = 0,
    val genre: String = "",
    val duration: String = "",
    val notes: String = "",
    val content: String = "{c: Verse 1}\n[G]Amazing [C]grace\n",
    val contentFormat: String = "chordpro",
    val tab: Int = 0, // 0=Details, 1=Song
    val saving: Boolean = false,
    val savedId: String? = null, // Non-null after successful save — the ID of the saved song
    val deleted: Boolean = false,
)

class SongEditorViewModel(private val repo: SongRepository) : ViewModel() {

    private val _state = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = _state.asStateFlow()

    fun loadSong(id: String) {
        if (id == "__new__") return // Sentinel for "create new song"
        viewModelScope.launch {
            try {
                val song = repo.getById(id) ?: return@launch
                _state.value = EditorState(
                    id = song.id,
                    title = song.title,
                    artist = song.artist ?: "",
                    key = song.key ?: "",
                    tempo = song.tempo?.toString() ?: "",
                    timeSig = song.timeSig ?: "4/4",
                    capo = song.capo,
                    genre = song.genre ?: "",
                    duration = song.duration ?: "",
                    notes = song.notes ?: "",
                    content = song.content,
                    contentFormat = song.contentFormat,
                )
            } catch (e: Exception) {
                Log.e("SongEditor", "Failed to load song", e)
            }
        }
    }

    fun setTitle(v: String) { _state.value = _state.value.copy(title = v) }
    fun setArtist(v: String) { _state.value = _state.value.copy(artist = v) }
    fun setKey(v: String) { _state.value = _state.value.copy(key = v) }
    fun setTempo(v: String) { _state.value = _state.value.copy(tempo = v) }
    fun setTimeSig(v: String) { _state.value = _state.value.copy(timeSig = v) }
    fun setCapo(v: Int) { _state.value = _state.value.copy(capo = v) }
    fun setGenre(v: String) { _state.value = _state.value.copy(genre = v) }
    fun setDuration(v: String) { _state.value = _state.value.copy(duration = v) }
    fun setNotes(v: String) { _state.value = _state.value.copy(notes = v) }
    fun setContent(v: String) { _state.value = _state.value.copy(content = v) }
    fun setContentFormat(v: String) { _state.value = _state.value.copy(contentFormat = v) }
    fun setTab(v: Int) { _state.value = _state.value.copy(tab = v) }

    fun save() {
        val s = _state.value
        if (s.title.isBlank()) return
        _state.value = s.copy(saving = true)

        viewModelScope.launch {
            try {
                val input = SongCreateInput(
                    title = s.title.trim(),
                    artist = s.artist.trim().ifEmpty { null },
                    key = s.key.ifEmpty { null },
                    tempo = s.tempo.toIntOrNull(),
                    timeSig = s.timeSig.ifEmpty { null },
                    capo = s.capo,
                    genre = s.genre.trim().ifEmpty { null },
                    duration = s.duration.trim().ifEmpty { null },
                    notes = s.notes.trim().ifEmpty { null },
                    content = s.content,
                    contentFormat = s.contentFormat,
                )

                val resultId: String
                if (s.id != null) {
                    repo.update(s.id) {
                        copy(
                            title = input.title,
                            artist = input.artist,
                            key = input.key,
                            tempo = input.tempo,
                            timeSig = input.timeSig,
                            capo = input.capo,
                            genre = input.genre,
                            duration = input.duration,
                            notes = input.notes,
                            content = input.content,
                            contentFormat = input.contentFormat,
                        )
                    }
                    resultId = s.id
                } else {
                    val created = repo.create(input)
                    resultId = created.id
                }
                Log.d("SongEditor", "Song saved successfully: ${input.title} ($resultId)")
                _state.value = _state.value.copy(saving = false, savedId = resultId)
            } catch (e: Exception) {
                Log.e("SongEditor", "Save failed", e)
                _state.value = _state.value.copy(saving = false)
            }
        }
    }

    fun delete() {
        val id = _state.value.id ?: return
        viewModelScope.launch {
            try {
                repo.delete(id)
                _state.value = _state.value.copy(deleted = true)
            } catch (e: Exception) {
                Log.e("SongEditor", "Delete failed", e)
            }
        }
    }
}
