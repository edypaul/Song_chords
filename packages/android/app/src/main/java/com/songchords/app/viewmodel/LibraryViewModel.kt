package com.songchords.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.songchords.app.data.SongCreateInput
import com.songchords.app.data.SongRepository
import com.songchords.app.data.entities.SongEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class SortField { TITLE, ARTIST, KEY, UPDATED_AT }
enum class SortDirection { ASC, DESC }

data class LibraryFilters(
    val search: String = "",
    val filterKey: String? = null,
    val sortField: SortField = SortField.TITLE,
    val sortDirection: SortDirection = SortDirection.ASC,
)

class LibraryViewModel(private val repo: SongRepository) : ViewModel() {

    private val _filters = MutableStateFlow(LibraryFilters())
    val filters: StateFlow<LibraryFilters> = _filters.asStateFlow()

    val songs: StateFlow<List<SongEntity>> = combine(
        repo.observeAll(),
        _filters,
    ) { allSongs, f ->
        var list = allSongs
        if (f.search.isNotBlank()) {
            val q = f.search.lowercase()
            list = list.filter {
                it.title.lowercase().contains(q) || (it.artist?.lowercase()?.contains(q) ?: false)
            }
        }
        if (f.filterKey != null) {
            list = list.filter { it.key == f.filterKey }
        }
        list = when (f.sortField) {
            SortField.TITLE -> list.sortedBy { it.title.lowercase() }
            SortField.ARTIST -> list.sortedBy { (it.artist ?: "").lowercase() }
            SortField.KEY -> list.sortedBy { it.key ?: "" }
            SortField.UPDATED_AT -> list.sortedBy { it.updatedAt }
        }
        if (f.sortDirection == SortDirection.DESC) list = list.reversed()
        list
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    fun setSearch(q: String) { _filters.value = _filters.value.copy(search = q) }
    fun setFilterKey(k: String?) { _filters.value = _filters.value.copy(filterKey = k) }
    fun setSortField(f: SortField) { _filters.value = _filters.value.copy(sortField = f) }
    fun toggleSortDirection() {
        _filters.value = _filters.value.copy(
            sortDirection = if (_filters.value.sortDirection == SortDirection.ASC) SortDirection.DESC else SortDirection.ASC
        )
    }

    fun addSong(input: SongCreateInput) {
        viewModelScope.launch { repo.create(input) }
    }

    fun deleteSong(id: String) {
        viewModelScope.launch { repo.delete(id) }
    }
}
