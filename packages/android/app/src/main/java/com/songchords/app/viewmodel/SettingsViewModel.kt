package com.songchords.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.songchords.app.data.AccidentalMode
import com.songchords.app.data.AppSettings
import com.songchords.app.data.ChordBarPosition
import com.songchords.app.data.Instrument
import com.songchords.app.data.SettingsRepository
import com.songchords.app.data.ThemeMode
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val repo: SettingsRepository) : ViewModel() {

    val settings: StateFlow<AppSettings> = repo.settings.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = AppSettings(),
    )

    fun setTheme(mode: ThemeMode) = viewModelScope.launch { repo.setTheme(mode) }
    fun setInstrument(inst: Instrument) = viewModelScope.launch { repo.setInstrument(inst) }
    fun setPreferFlats(prefer: Boolean) = viewModelScope.launch { repo.setPreferFlats(prefer) }
    fun setScrollSpeed(speed: Int) = viewModelScope.launch { repo.setScrollSpeed(speed) }
    fun setFontSize(size: Int) = viewModelScope.launch { repo.setFontSize(size) }
    fun setSongCentered(centered: Boolean) = viewModelScope.launch { repo.setSongCentered(centered) }
    fun setShowChordDiagrams(show: Boolean) = viewModelScope.launch { repo.setShowChordDiagrams(show) }
    fun setInlineChordDiagrams(show: Boolean) = viewModelScope.launch { repo.setInlineChordDiagrams(show) }
    fun setChordBarPosition(position: ChordBarPosition) = viewModelScope.launch { repo.setChordBarPosition(position) }
    fun setPerfMetroEnabled(enabled: Boolean) = viewModelScope.launch { repo.setPerfMetroEnabled(enabled) }
    fun setPerfScrollEnabled(enabled: Boolean) = viewModelScope.launch { repo.setPerfScrollEnabled(enabled) }
    fun setPerfZoom(zoom: Float) = viewModelScope.launch { repo.setPerfZoom(zoom) }
    fun setAccidentalMode(mode: AccidentalMode) = viewModelScope.launch { repo.setAccidentalMode(mode) }
    fun setSongViewStylePreset(key: String) = viewModelScope.launch { repo.setSongViewStylePreset(key) }

    fun saveCustomPreset(name: String, baseStyle: com.songchords.app.data.SongViewStyle, mode: com.songchords.app.data.PresetMode) = viewModelScope.launch {
        val cur = settings.value.customPresets.toMutableMap()
        val key = "custom_${System.currentTimeMillis()}"
        cur[key] = com.songchords.app.data.CustomPreset(key = key, name = name, mode = mode, style = baseStyle.copy(preset = key))
        repo.setCustomPresets(cur)
        repo.setSongViewStylePreset(key)
    }

    fun updateCustomPreset(key: String, name: String, style: com.songchords.app.data.SongViewStyle, mode: com.songchords.app.data.PresetMode) = viewModelScope.launch {
        val cur = settings.value.customPresets.toMutableMap()
        cur[key] = com.songchords.app.data.CustomPreset(key = key, name = name, mode = mode, style = style.copy(preset = key))
        repo.setCustomPresets(cur)
    }

    fun deleteCustomPreset(key: String) = viewModelScope.launch {
        val cur = settings.value.customPresets.toMutableMap()
        cur.remove(key)
        repo.setCustomPresets(cur)
        if (settings.value.songViewStylePreset == key) repo.setSongViewStylePreset("default")
    }
}
