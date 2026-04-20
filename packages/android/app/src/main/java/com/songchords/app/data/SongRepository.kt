package com.songchords.app.data

import com.songchords.app.data.dao.SongDao
import com.songchords.app.data.entities.SongEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

data class SongCreateInput(
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val key: String? = null,
    val tempo: Int? = null,
    val timeSig: String? = null,
    val capo: Int = 0,
    val genre: String? = null,
    val duration: String? = null,
    val notes: String? = null,
    val content: String,
    val contentFormat: String = "chordpro",
)

class SongRepository(private val dao: SongDao) {

    fun observeAll(): Flow<List<SongEntity>> = dao.observeAll()

    suspend fun getById(id: String): SongEntity? = dao.getById(id)

    fun observeById(id: String): Flow<SongEntity?> = dao.observeById(id)

    suspend fun create(input: SongCreateInput): SongEntity {
        val now = System.currentTimeMillis()
        val entity = SongEntity(
            id = UUID.randomUUID().toString(),
            title = input.title,
            artist = input.artist,
            album = input.album,
            key = input.key,
            tempo = input.tempo,
            timeSig = input.timeSig,
            capo = input.capo,
            genre = input.genre,
            duration = input.duration,
            notes = input.notes,
            content = input.content,
            contentFormat = input.contentFormat,
            createdAt = now,
            updatedAt = now,
        )
        dao.insert(entity)
        return entity
    }

    suspend fun update(id: String, patch: SongEntity.() -> SongEntity): SongEntity? {
        val existing = dao.getById(id) ?: return null
        val updated = existing.patch().copy(updatedAt = System.currentTimeMillis())
        dao.update(updated)
        return updated
    }

    suspend fun saveUpdated(song: SongEntity) {
        dao.update(song.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun delete(id: String) {
        dao.deleteById(id)
    }
}
