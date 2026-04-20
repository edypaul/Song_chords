package com.songchords.app.ui.setlist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.ui.theme.ChordColor
import com.songchords.app.ui.theme.DangerColor
import com.songchords.app.viewmodel.SetListDetailViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetListDetailScreen(
    setlistId: String,
    viewModel: SetListDetailViewModel,
    onSongClick: (String) -> Unit,
    onPlayClick: () -> Unit,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val allSongs by viewModel.allSongs.collectAsStateWithLifecycle()
    var showAddDialog by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

    LaunchedEffect(setlistId) { viewModel.load(setlistId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.setList?.name ?: "", maxLines = 1)
                        Text(
                            "${state.entries.size} songs",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showAddDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "Add Song")
                    }
                    if (state.entries.isNotEmpty()) {
                        IconButton(onClick = onPlayClick) {
                            Icon(Icons.Default.PlayArrow, contentDescription = "Perform")
                        }
                    }
                },
            )
        }
    ) { padding ->
        if (state.entries.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text("No songs yet\nTap + to add songs", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                itemsIndexed(state.entries, key = { _, pair -> pair.first.id }) { index, (entry, song) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Reorder buttons
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            IconButton(
                                onClick = { viewModel.moveUp(index) },
                                enabled = index > 0,
                                modifier = Modifier.size(28.dp),
                            ) {
                                Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Move up", modifier = Modifier.size(18.dp))
                            }
                            IconButton(
                                onClick = { viewModel.moveDown(index) },
                                enabled = index < state.entries.size - 1,
                                modifier = Modifier.size(28.dp),
                            ) {
                                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Move down", modifier = Modifier.size(18.dp))
                            }
                        }

                        // Song number
                        Text(
                            text = "${index + 1}",
                            modifier = Modifier.width(24.dp),
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        // Song info
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clickable { onSongClick(song.id) }
                                .padding(horizontal = 8.dp),
                        ) {
                            Text(text = song.title, fontWeight = FontWeight.Medium, maxLines = 1)
                            if (!song.artist.isNullOrBlank()) {
                                Text(
                                    text = song.artist,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }

                        // Key badge
                        if (!song.key.isNullOrBlank()) {
                            Text(
                                text = song.key,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = ChordColor,
                            )
                        }

                        // Delete
                        IconButton(onClick = { viewModel.removeEntry(entry.id) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Remove", tint = DangerColor, modifier = Modifier.size(18.dp))
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    // Add song dialog
    if (showAddDialog) {
        val filteredSongs = allSongs.filter {
            searchQuery.isBlank() || it.title.contains(searchQuery, ignoreCase = true)
                    || (it.artist?.contains(searchQuery, ignoreCase = true) ?: false)
        }

        AlertDialog(
            onDismissRequest = { showAddDialog = false; searchQuery = "" },
            title = { Text("Add Song") },
            text = {
                Column {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        placeholder = { Text("Search songs...") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    LazyColumn(modifier = Modifier.heightIn(max = 300.dp)) {
                        items(filteredSongs.size) { idx ->
                            val song = filteredSongs[idx]
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        viewModel.addSong(setlistId, song.id)
                                        showAddDialog = false
                                        searchQuery = ""
                                    }
                                    .padding(vertical = 10.dp, horizontal = 4.dp),
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(song.title, fontWeight = FontWeight.Medium)
                                    if (!song.artist.isNullOrBlank()) {
                                        Text(
                                            song.artist,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAddDialog = false; searchQuery = "" }) {
                    Text("Close")
                }
            },
        )
    }
}
