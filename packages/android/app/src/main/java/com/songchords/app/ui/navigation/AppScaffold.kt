package com.songchords.app.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import com.songchords.app.ui.editor.SongEditorScreen
import com.songchords.app.ui.setlist.SetListDetailScreen
import com.songchords.app.ui.chords.ChordLibraryScreen
import com.songchords.app.ui.`import`.ImportScreen
import com.songchords.app.ui.setlist.SetListsScreen
import com.songchords.app.ui.library.LibraryScreen
import com.songchords.app.ui.settings.SettingsScreen
import com.songchords.app.ui.song.SongViewScreen
import com.songchords.app.viewmodel.*

@Composable
fun AppScaffold(factory: AppViewModelFactory) {
    val navController = rememberNavController()
    val currentRoute by navController.currentBackStackEntryAsState()
    val currentDestination = currentRoute?.destination?.route

    // Only show bottom bar for main tabs
    val tabRoutes = bottomNavItems.map { it.screen.route }
    val showBottomBar = currentDestination in tabRoutes

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    bottomNavItems.forEach { item ->
                        NavigationBarItem(
                            selected = currentDestination == item.screen.route,
                            onClick = {
                                navController.navigate(item.screen.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                        )
                    }
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Library.route,
            modifier = Modifier.padding(padding),
        ) {
            // === Bottom Nav Tabs ===
            composable(Screen.Library.route) {
                val vm: LibraryViewModel = viewModel(factory = factory)
                LibraryScreen(
                    viewModel = vm,
                    onSongClick = { id -> navController.navigate(Screen.SongView.createRoute(id)) },
                    onAddSongClick = { navController.navigate(Screen.NewSong.route) },
                )
            }

            composable(Screen.SetLists.route) {
                val vm: SetListsViewModel = viewModel(factory = factory)
                SetListsScreen(
                    viewModel = vm,
                    onSetListClick = { id -> navController.navigate(Screen.SetListDetail.createRoute(id)) },
                )
            }

            composable(Screen.Chords.route) {
                ChordLibraryScreen()
            }

            composable(Screen.Settings.route) {
                val vm: SettingsViewModel = viewModel(factory = factory)
                SettingsScreen(viewModel = vm)
            }

            // === Detail Screens ===
            composable(Screen.SongView.route) { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id") ?: return@composable
                val vm: SongViewModel = viewModel(factory = factory)
                val settingsVm: SettingsViewModel = viewModel(factory = factory)
                SongViewScreen(
                    songId = id,
                    viewModel = vm,
                    settingsViewModel = settingsVm,
                    onBack = { navController.popBackStack() },
                    onEditClick = { songId -> navController.navigate(Screen.SongEditor.createRoute(songId)) },
                )
            }

            composable(Screen.NewSong.route) {
                val vm: SongEditorViewModel = viewModel(factory = factory)
                SongEditorScreen(
                    songId = "__new__",
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onSaved = { savedId ->
                        navController.popBackStack()
                        navController.navigate(Screen.SongView.createRoute(savedId))
                    },
                    onDeleted = {
                        navController.popBackStack(Screen.Library.route, inclusive = false)
                    },
                )
            }

            composable(Screen.SongEditor.route) { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id") ?: return@composable
                val vm: SongEditorViewModel = viewModel(factory = factory)
                SongEditorScreen(
                    songId = id,
                    viewModel = vm,
                    onBack = { navController.popBackStack() },
                    onSaved = { savedId ->
                        navController.popBackStack()
                        navController.navigate(Screen.SongView.createRoute(savedId))
                    },
                    onDeleted = {
                        // Navigate to Library, clearing everything above it from the backstack
                        navController.navigate(Screen.Library.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                inclusive = false
                            }
                            launchSingleTop = true
                        }
                    },
                )
            }

            composable(Screen.SetListDetail.route) { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id") ?: return@composable
                val vm: SetListDetailViewModel = viewModel(factory = factory)
                SetListDetailScreen(
                    setlistId = id,
                    viewModel = vm,
                    onSongClick = { songId -> navController.navigate(Screen.SongView.createRoute(songId)) },
                    onPlayClick = { navController.navigate(Screen.SetListPlayer.createRoute(id)) },
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Screen.SetListPlayer.route) { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id") ?: return@composable
                // TODO: SetListPlayerScreen
                PlaceholderScreen("Playing: $id")
            }

            composable(Screen.Import.route) {
                val app = (androidx.compose.ui.platform.LocalContext.current.applicationContext as com.songchords.app.SongChordsApp)
                ImportScreen(songRepo = app.songRepository)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaceholderScreen(title: String) {
    Scaffold(
        topBar = { TopAppBar(title = { Text(title) }) },
    ) { innerPadding ->
        Text(
            text = "Coming soon",
            modifier = Modifier.padding(innerPadding).padding(all = 24.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
