package com.songchords.app.data.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "setlists")
data class SetListEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String? = null,
    val date: Long? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(
    tableName = "setlist_entries",
    foreignKeys = [
        ForeignKey(
            entity = SetListEntity::class,
            parentColumns = ["id"],
            childColumns = ["setlist_id"],
            onDelete = ForeignKey.CASCADE,
        ),
        ForeignKey(
            entity = SongEntity::class,
            parentColumns = ["id"],
            childColumns = ["song_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("setlist_id"), Index("song_id")],
)
data class SetListEntryEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "setlist_id") val setlistId: String,
    @ColumnInfo(name = "song_id") val songId: String,
    val position: Int,
    val transpose: Int = 0,
    val capo: Int = 0,
    val notes: String? = null,
)
