package com.songchords.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.data.ThemeMode
import com.songchords.app.ui.navigation.AppScaffold
import com.songchords.app.ui.theme.SongChordsTheme
import com.songchords.app.viewmodel.AppViewModelFactory
import kotlinx.coroutines.flow.map

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as SongChordsApp
        val factory = AppViewModelFactory(
            songRepo = app.songRepository,
            setListRepo = app.setListRepository,
            settingsRepo = app.settingsRepository,
        )

        setContent {
            // Observe theme setting reactively
            val themeMode by app.settingsRepository.settings
                .map { it.theme }
                .collectAsStateWithLifecycle(initialValue = ThemeMode.SYSTEM)

            val isDark = when (themeMode) {
                ThemeMode.DARK -> true
                ThemeMode.LIGHT -> false
                ThemeMode.SYSTEM -> isSystemInDarkTheme()
            }

            SongChordsTheme(darkTheme = isDark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppScaffold(factory = factory)
                }
            }
        }
    }
}
