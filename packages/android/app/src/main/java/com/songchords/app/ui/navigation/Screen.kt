package com.songchords.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(val route: String) {
    // Bottom nav tabs
    data object Library : Screen("library")
    data object SetLists : Screen("setlists")
    data object Chords : Screen("chords")
    data object Settings : Screen("settings")

    // Detail screens
    data object SongView : Screen("song/{id}") {
        fun createRoute(id: String) = "song/$id"
    }
    data object SongEditor : Screen("editor/{id}") {
        fun createRoute(id: String) = "editor/$id"
    }
    data object NewSong : Screen("new-song")
    data object SetListDetail : Screen("setlist/{id}") {
        fun createRoute(id: String) = "setlist/$id"
    }
    data object SetListPlayer : Screen("setlist/{id}/play") {
        fun createRoute(id: String) = "setlist/$id/play"
    }
    data object Import : Screen("import")
}

data class BottomNavItem(
    val screen: Screen,
    val label: String,
    val icon: ImageVector,
)

val bottomNavItems = listOf(
    BottomNavItem(Screen.Library, "Library", Icons.Default.LibraryMusic),
    BottomNavItem(Screen.SetLists, "Set Lists", Icons.Default.QueueMusic),
    BottomNavItem(Screen.Chords, "Chords", Icons.Default.MusicNote),
    BottomNavItem(Screen.Settings, "Settings", Icons.Default.Settings),
)
