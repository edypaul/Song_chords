package com.songchords.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.songchords.app.data.dao.SetListDao
import com.songchords.app.data.dao.SongDao
import com.songchords.app.data.entities.SetListEntity
import com.songchords.app.data.entities.SetListEntryEntity
import com.songchords.app.data.entities.SongEntity

@Database(
    entities = [SongEntity::class, SetListEntity::class, SetListEntryEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun songDao(): SongDao
    abstract fun setListDao(): SetListDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun get(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "song_chords.db",
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
