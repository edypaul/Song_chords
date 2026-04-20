package com.songchords.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * Low-latency click-track generator backed by SoundPool.
 *
 * SoundPool plays pre-decoded short samples with a single non-blocking
 * native call — no allocation per tick, no stop()/drain stalls, far lower
 * and more consistent jitter than AudioTrack for repeated short clicks.
 *
 * Click samples are synthesized once, written to the app cache as WAV
 * files, and loaded into SoundPool at construction.
 */
class Metronome(context: Context) {
    private val pool: SoundPool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()

    private val downbeatId: Int
    private val regularId: Int

    @Volatile private var downbeatReady = false
    @Volatile private var regularReady = false

    init {
        pool.setOnLoadCompleteListener { _, sampleId, _ ->
            if (sampleId == downbeatId) downbeatReady = true
            if (sampleId == regularId) regularReady = true
        }
        val dbFile = writeClickWav(context, "metro_downbeat.wav", freq = 1000.0, amp = 0.55)
        val rgFile = writeClickWav(context, "metro_regular.wav", freq = 700.0, amp = 0.40)
        downbeatId = pool.load(dbFile.absolutePath, 1)
        regularId = pool.load(rgFile.absolutePath, 1)
    }

    fun playClick(downbeat: Boolean) {
        val id = if (downbeat) downbeatId else regularId
        val ready = if (downbeat) downbeatReady else regularReady
        if (!ready) return
        // SoundPool.play is a fast, non-blocking native call.
        pool.play(id, 1f, 1f, /* priority = */ 1, /* loop = */ 0, /* rate = */ 1f)
    }

    fun release() {
        runCatching { pool.release() }
    }

    private fun writeClickWav(
        context: Context,
        name: String,
        freq: Double,
        amp: Double,
        durationMs: Int = 50,
        sampleRate: Int = 44100,
    ): File {
        val file = File(context.cacheDir, name)
        val samples = synthClick(freq, amp, durationMs, sampleRate)
        FileOutputStream(file).use { fos ->
            DataOutputStream(fos).use { out ->
                val byteRate = sampleRate * 2
                val dataSize = samples.size * 2
                // RIFF header
                out.writeBytes("RIFF")
                out.writeIntLE(36 + dataSize)
                out.writeBytes("WAVE")
                // fmt chunk (PCM, mono, 16-bit)
                out.writeBytes("fmt ")
                out.writeIntLE(16)
                out.writeShortLE(1)
                out.writeShortLE(1)
                out.writeIntLE(sampleRate)
                out.writeIntLE(byteRate)
                out.writeShortLE(2)
                out.writeShortLE(16)
                // data chunk
                out.writeBytes("data")
                out.writeIntLE(dataSize)
                for (s in samples) out.writeShortLE(s.toInt())
            }
        }
        return file
    }

    private fun synthClick(freq: Double, amp: Double, durationMs: Int, sampleRate: Int): ShortArray {
        val n = sampleRate * durationMs / 1000
        val buf = ShortArray(n)
        val twoPiF = 2.0 * PI * freq / sampleRate
        val decayTau = durationMs / 1000.0 / 4.0
        for (i in 0 until n) {
            val t = i.toDouble() / sampleRate
            val env = exp(-t / decayTau) * amp
            val sample = (sin(twoPiF * i) * env * Short.MAX_VALUE).toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            buf[i] = sample.toShort()
        }
        return buf
    }

    private fun DataOutputStream.writeIntLE(v: Int) {
        write(v and 0xFF)
        write((v ushr 8) and 0xFF)
        write((v ushr 16) and 0xFF)
        write((v ushr 24) and 0xFF)
    }
    private fun DataOutputStream.writeShortLE(v: Int) {
        write(v and 0xFF)
        write((v ushr 8) and 0xFF)
    }
}
