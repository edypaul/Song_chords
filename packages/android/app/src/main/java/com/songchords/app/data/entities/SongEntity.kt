package com.songchords.app.data.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "songs")
data class SongEntity(
    @PrimaryKey val id: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val key: String? = null,
    val tempo: Int? = null,
    @ColumnInfo(name = "time_sig") val timeSig: String? = null,
    val capo: Int = 0,
    val genre: String? = null,
    val duration: String? = null,
    val notes: String? = null,
    val content: String,
    @ColumnInfo(name = "content_format") val contentFormat: String = "chordpro",
    /** JSON-encoded list of tag strings */
    val tags: String = "[]",
    /** JSON-encoded SongPreferences */
    val preferences: String = "{}",
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
)
