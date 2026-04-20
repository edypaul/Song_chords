package com.songchords.app.ui.chords

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.songchords.app.data.chords.ChordDefinition
import com.songchords.app.data.chords.getChordsByInstrument
import com.songchords.app.transpose.Transposer
import com.songchords.app.ui.components.ChordDiagramView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChordLibraryScreen() {
    var isGuitar by remember { mutableStateOf(true) }
    var rootFilter by remember { mutableStateOf<String?>(null) }

    val allChords = remember(isGuitar) { getChordsByInstrument(isGuitar) }
    val filtered = remember(allChords, rootFilter) {
        if (rootFilter == null) allChords
        else allChords.filter { chord ->
            val root = Regex("^[A-G][#b]?").find(chord.name)?.value
            root == rootFilter
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Chords") },
                actions = {
                    Text(
                        "${filtered.size} chords",
                        modifier = Modifier.padding(end = 16.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Instrument toggle
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = isGuitar,
                    onClick = { isGuitar = true },
                    label = { Text("Guitar") },
                )
                FilterChip(
                    selected = !isGuitar,
                    onClick = { isGuitar = false },
                    label = { Text("Ukulele") },
                )
            }

            // Root note filter
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                FilterChip(
                    selected = rootFilter == null,
                    onClick = { rootFilter = null },
                    label = { Text("All") },
                )
                Transposer.SHARPS.forEach { note ->
                    FilterChip(
                        selected = rootFilter == note,
                        onClick = { rootFilter = if (rootFilter == note) null else note },
                        label = { Text(note) },
                    )
                }
            }

            // Chord grid
            if (filtered.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("No chords match filters", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(filtered, key = { "${it.name}-${it.baseFret}-${it.frets.joinToString(",")}" }) { chord ->
                        ChordCard(chord = chord)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChordCard(chord: ChordDefinition) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ChordDiagramView(
                chord = chord,
                width = 90.dp,
                showName = true,
            )
        }
    }
}
