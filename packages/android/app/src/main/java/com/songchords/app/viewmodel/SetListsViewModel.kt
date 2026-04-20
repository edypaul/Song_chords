package com.songchords.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.songchords.app.data.SetListRepository
import com.songchords.app.data.SongRepository
import com.songchords.app.data.entities.SetListEntity
import com.songchords.app.data.entities.SetListEntryEntity
import com.songchords.app.data.entities.SongEntity
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class SetListsViewModel(
    private val setListRepo: SetListRepository,
) : ViewModel() {

    val setLists: StateFlow<List<SetListEntity>> = setListRepo.observeAll().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    fun create(name: String) {
        viewModelScope.launch { setListRepo.create(name) }
    }

    fun delete(id: String) {
        viewModelScope.launch { setListRepo.delete(id) }
    }
}

data class DetailState(
    val setList: SetListEntity? = null,
    val entries: List<Pair<SetListEntryEntity, SongEntity>> = emptyList(),
)

class SetListDetailViewModel(
    private val setListRepo: SetListRepository,
    private val songRepo: SongRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(DetailState())
    val state: StateFlow<DetailState> = _state.asStateFlow()

    private val _allSongs = MutableStateFlow<List<SongEntity>>(emptyList())
    val allSongs: StateFlow<List<SongEntity>> = _allSongs.asStateFlow()

    fun load(id: String) {
        viewModelScope.launch {
            val setList = setListRepo.getById(id)
            _state.value = _state.value.copy(setList = setList)

            // Observe entries and join with songs
            setListRepo.observeEntries(id).collect { entries ->
                val withSongs = entries.mapNotNull { entry ->
                    val song = songRepo.getById(entry.songId)
                    if (song != null) entry to song else null
                }
                _state.value = _state.value.copy(entries = withSongs)
            }
        }
        viewModelScope.launch {
            songRepo.observeAll().collect { _allSongs.value = it }
        }
    }

    fun addSong(setlistId: String, songId: String) {
        val position = _state.value.entries.size
        viewModelScope.launch { setListRepo.addEntry(setlistId, songId, position) }
    }

    fun removeEntry(entryId: String) {
        viewModelScope.launch { setListRepo.removeEntry(entryId) }
    }

    fun moveUp(index: Int) {
        if (index <= 0) return
        reorder(index, index - 1)
    }

    fun moveDown(index: Int) {
        if (index >= _state.value.entries.size - 1) return
        reorder(index, index + 1)
    }

    private fun reorder(from: Int, to: Int) {
        val entries = _state.value.entries.toMutableList()
        val item = entries.removeAt(from)
        entries.add(to, item)
        val orderedIds = entries.map { it.first.id }
        viewModelScope.launch { setListRepo.reorder(orderedIds) }
    }
}
