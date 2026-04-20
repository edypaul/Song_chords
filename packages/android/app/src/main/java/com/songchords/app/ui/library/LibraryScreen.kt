package com.songchords.app.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.data.entities.SongEntity
import com.songchords.app.transpose.Transposer
import com.songchords.app.ui.theme.ChordColor
import com.songchords.app.viewmodel.LibraryViewModel
import com.songchords.app.viewmodel.SortDirection
import com.songchords.app.viewmodel.SortField

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    viewModel: LibraryViewModel,
    onSongClick: (String) -> Unit,
    onAddSongClick: () -> Unit,
) {
    val songs by viewModel.songs.collectAsStateWithLifecycle()
    val filters by viewModel.filters.collectAsStateWithLifecycle()
    var showFilters by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Library") },
                actions = {
                    Text(
                        "${songs.size} songs",
                        modifier = Modifier.padding(end = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddSongClick) {
                Icon(Icons.Default.Add, contentDescription = "Add song")
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Search bar + filter toggle
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = filters.search,
                    onValueChange = viewModel::setSearch,
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Search songs, artists...") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    trailingIcon = {
                        if (filters.search.isNotEmpty()) {
                            IconButton(onClick = { viewModel.setSearch("") }) {
                                Icon(Icons.Default.Clear, contentDescription = "Clear")
                            }
                        }
                    },
                    singleLine = true,
                )
                Spacer(modifier = Modifier.width(8.dp))
                FilledIconToggleButton(
                    checked = showFilters,
                    onCheckedChange = { showFilters = it },
                ) {
                    Icon(
                        Icons.Default.FilterList,
                        contentDescription = "Filters",
                    )
                }
            }

            // Filter & Sort panel (expandable)
            AnimatedVisibility(visible = showFilters) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // Key filter
                    Text(
                        "KEY",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        FilterChip(
                            selected = filters.filterKey == null,
                            onClick = { viewModel.setFilterKey(null) },
                            label = { Text("All") },
                        )
                        Transposer.SHARPS.forEach { key ->
                            FilterChip(
                                selected = filters.filterKey == key,
                                onClick = {
                                    viewModel.setFilterKey(
                                        if (filters.filterKey == key) null else key
                                    )
                                },
                                label = { Text(key) },
                            )
                        }
                    }

                    // Sort controls
                    Text(
                        "SORT BY",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        listOf(
                            SortField.TITLE to "Title",
                            SortField.ARTIST to "Artist",
                            SortField.KEY to "Key",
                            SortField.UPDATED_AT to "Recent",
                        ).forEach { (field, label) ->
                            FilterChip(
                                selected = filters.sortField == field,
                                onClick = { viewModel.setSortField(field) },
                                label = { Text(label) },
                            )
                        }
                        Spacer(modifier = Modifier.width(4.dp))
                        FilledIconToggleButton(
                            checked = filters.sortDirection == SortDirection.DESC,
                            onCheckedChange = { viewModel.toggleSortDirection() },
                            modifier = Modifier.size(36.dp),
                        ) {
                            Icon(
                                if (filters.sortDirection == SortDirection.ASC)
                                    Icons.Default.ArrowUpward
                                else
                                    Icons.Default.ArrowDownward,
                                contentDescription = "Sort direction",
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))
                }
            }

            // Song list
            if (songs.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = when {
                            filters.search.isNotBlank() -> "No songs match your search"
                            filters.filterKey != null -> "No songs in key ${filters.filterKey}"
                            else -> "No songs yet\nTap + to add your first song"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(songs, key = { it.id }) { song ->
                        SongListItem(song = song, onClick = { onSongClick(song.id) })
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun SongListItem(song: SongEntity, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = song.title,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
            )
            if (!song.artist.isNullOrBlank()) {
                Text(
                    text = song.artist,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        if (!song.key.isNullOrBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    text = song.key,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    color = ChordColor,
                )
            }
        }
        if (song.tempo != null) {
            Text(
                text = "${song.tempo}",
                modifier = Modifier.padding(start = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
