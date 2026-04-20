package com.songchords.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.songchords.app.data.SetListRepository
import com.songchords.app.data.SettingsRepository
import com.songchords.app.data.SongRepository

class AppViewModelFactory(
    private val songRepo: SongRepository,
    private val setListRepo: SetListRepository,
    private val settingsRepo: SettingsRepository,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(LibraryViewModel::class.java) ->
                LibraryViewModel(songRepo) as T
            modelClass.isAssignableFrom(SongViewModel::class.java) ->
                SongViewModel(songRepo) as T
            modelClass.isAssignableFrom(SettingsViewModel::class.java) ->
                SettingsViewModel(settingsRepo) as T
            modelClass.isAssignableFrom(SongEditorViewModel::class.java) ->
                SongEditorViewModel(songRepo) as T
            modelClass.isAssignableFrom(SetListsViewModel::class.java) ->
                SetListsViewModel(setListRepo) as T
            modelClass.isAssignableFrom(SetListDetailViewModel::class.java) ->
                SetListDetailViewModel(setListRepo, songRepo) as T
            else -> throw IllegalArgumentException("Unknown ViewModel class: $modelClass")
        }
    }
}
