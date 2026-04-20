package com.songchords.app.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.songchords.app.data.entities.SetListEntity
import com.songchords.app.data.entities.SetListEntryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SetListDao {
    @Query("SELECT * FROM setlists ORDER BY updated_at DESC")
    fun observeAll(): Flow<List<SetListEntity>>

    @Query("SELECT * FROM setlists WHERE id = :id")
    suspend fun getById(id: String): SetListEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(setlist: SetListEntity)

    @Update
    suspend fun update(setlist: SetListEntity)

    @Delete
    suspend fun delete(setlist: SetListEntity)

    @Query("DELETE FROM setlists WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT * FROM setlist_entries WHERE setlist_id = :setlistId ORDER BY position ASC")
    fun observeEntries(setlistId: String): Flow<List<SetListEntryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEntry(entry: SetListEntryEntity)

    @Delete
    suspend fun deleteEntry(entry: SetListEntryEntity)

    @Query("DELETE FROM setlist_entries WHERE id = :id")
    suspend fun deleteEntryById(id: String)

    @Query("UPDATE setlist_entries SET position = :position WHERE id = :id")
    suspend fun updateEntryPosition(id: String, position: Int)
}
