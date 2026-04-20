package com.songchords.app

import android.app.Application
import com.songchords.app.data.AppDatabase
import com.songchords.app.data.SetListRepository
import com.songchords.app.data.SettingsRepository
import com.songchords.app.data.SongRepository

class SongChordsApp : Application() {

    val database: AppDatabase by lazy { AppDatabase.get(this) }
    val songRepository: SongRepository by lazy { SongRepository(database.songDao()) }
    val setListRepository: SetListRepository by lazy { SetListRepository(database.setListDao()) }
    val settingsRepository: SettingsRepository by lazy { SettingsRepository(this) }
}
