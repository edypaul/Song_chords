package com.songchords.app.data

import com.songchords.app.data.dao.SetListDao
import com.songchords.app.data.entities.SetListEntity
import com.songchords.app.data.entities.SetListEntryEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class SetListRepository(private val dao: SetListDao) {

    fun observeAll(): Flow<List<SetListEntity>> = dao.observeAll()

    suspend fun getById(id: String): SetListEntity? = dao.getById(id)

    suspend fun create(name: String, description: String? = null): SetListEntity {
        val now = System.currentTimeMillis()
        val entity = SetListEntity(
            id = UUID.randomUUID().toString(),
            name = name,
            description = description,
            createdAt = now,
            updatedAt = now,
        )
        dao.insert(entity)
        return entity
    }

    suspend fun update(setlist: SetListEntity) {
        dao.update(setlist.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun delete(id: String) {
        dao.deleteById(id)
    }

    fun observeEntries(setlistId: String): Flow<List<SetListEntryEntity>> =
        dao.observeEntries(setlistId)

    suspend fun addEntry(setlistId: String, songId: String, position: Int): SetListEntryEntity {
        val entry = SetListEntryEntity(
            id = UUID.randomUUID().toString(),
            setlistId = setlistId,
            songId = songId,
            position = position,
        )
        dao.insertEntry(entry)
        return entry
    }

    suspend fun removeEntry(entryId: String) {
        dao.deleteEntryById(entryId)
    }

    suspend fun reorder(orderedIds: List<String>) {
        orderedIds.forEachIndexed { index, id ->
            dao.updateEntryPosition(id, index)
        }
    }
}
