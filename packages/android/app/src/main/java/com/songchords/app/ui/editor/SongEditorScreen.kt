package com.songchords.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.songchords.app.transpose.Transposer
import com.songchords.app.ui.theme.DangerColor
import com.songchords.app.viewmodel.SongEditorViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SongEditorScreen(
    songId: String,
    viewModel: SongEditorViewModel,
    onBack: () -> Unit,
    onSaved: (String) -> Unit = {},
    onDeleted: () -> Unit = onBack,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(songId) { viewModel.loadSong(songId) }

    // Navigate after save → song view
    LaunchedEffect(state.savedId) {
        val id = state.savedId
        if (id != null) onSaved(id)
    }
    // Navigate after delete → library
    LaunchedEffect(state.deleted) {
        if (state.deleted) onDeleted()
    }

    val isNew = songId == "__new__"
    val tabs = listOf("Details", "Song")
    var showDeleteDialog by remember { mutableStateOf(false) }
    val canSave = state.title.isNotBlank() && !state.saving
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(if (isNew) "New Song" else "Edit Song") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (!isNew) {
                        IconButton(onClick = { showDeleteDialog = true }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = DangerColor)
                        }
                    }
                    // Save button — styled differently based on readiness
                    Button(
                        onClick = {
                            if (state.title.isBlank()) {
                                scope.launch {
                                    snackbarHostState.showSnackbar(
                                        message = "Title is required",
                                        duration = SnackbarDuration.Short,
                                    )
                                }
                                // Switch to Details tab so user sees the title field
                                viewModel.setTab(0)
                            } else {
                                viewModel.save()
                            }
                        },
                        modifier = Modifier.padding(end = 8.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (canSave) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = if (canSave) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Icon(
                            Icons.Default.Save,
                            contentDescription = "Save",
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (state.saving) "Saving..." else "Save",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                        )
                    }
                },
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Tab row
            TabRow(selectedTabIndex = state.tab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = state.tab == index,
                        onClick = { viewModel.setTab(index) },
                        text = { Text(title) },
                    )
                }
            }

            if (state.tab == 0) {
                // Details tab
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    OutlinedTextField(
                        value = state.title,
                        onValueChange = viewModel::setTitle,
                        label = { Text("Title *") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        isError = state.title.isBlank() && state.saving,
                        supportingText = if (state.title.isBlank()) {
                            { Text("Required", color = DangerColor) }
                        } else null,
                    )
                    OutlinedTextField(
                        value = state.artist,
                        onValueChange = viewModel::setArtist,
                        label = { Text("Artist") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )

                    // Key selector chips
                    Text("Key", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        val keys = listOf("") + Transposer.SHARPS
                        keys.forEach { k ->
                            FilterChip(
                                selected = state.key == k,
                                onClick = { viewModel.setKey(k) },
                                label = { Text(k.ifEmpty { "None" }) },
                            )
                        }
                    }

                    OutlinedTextField(
                        value = state.tempo,
                        onValueChange = viewModel::setTempo,
                        label = { Text("Tempo (BPM)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )

                    // Time Signature chips
                    Text("Time Signature", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("4/4", "3/4", "6/8", "2/4", "5/4", "7/8", "12/8").forEach { ts ->
                            FilterChip(
                                selected = state.timeSig == ts,
                                onClick = { viewModel.setTimeSig(ts) },
                                label = { Text(ts) },
                            )
                        }
                    }

                    // Capo chips
                    Text("Capo", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        (0..11).forEach { c ->
                            FilterChip(
                                selected = state.capo == c,
                                onClick = { viewModel.setCapo(c) },
                                label = { Text(if (c == 0) "None" else "$c") },
                            )
                        }
                    }

                    OutlinedTextField(
                        value = state.genre,
                        onValueChange = viewModel::setGenre,
                        label = { Text("Genre") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )

                    // Genre quick-select
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        listOf("Pop", "Rock", "Country", "Worship", "Gospel", "R&B", "Jazz", "Blues", "Folk", "Latin", "Alternative", "Christian").forEach { g ->
                            FilterChip(
                                selected = state.genre == g,
                                onClick = { viewModel.setGenre(if (state.genre == g) "" else g) },
                                label = { Text(g) },
                            )
                        }
                    }

                    OutlinedTextField(
                        value = state.duration,
                        onValueChange = viewModel::setDuration,
                        label = { Text("Duration (m:ss)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )

                    // Format
                    Text("Format", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(
                            selected = state.contentFormat == "chordpro",
                            onClick = { viewModel.setContentFormat("chordpro") },
                            label = { Text("ChordPro") },
                        )
                        FilterChip(
                            selected = state.contentFormat == "plaintext",
                            onClick = { viewModel.setContentFormat("plaintext") },
                            label = { Text("Plain Text") },
                        )
                    }

                    OutlinedTextField(
                        value = state.notes,
                        onValueChange = viewModel::setNotes,
                        label = { Text("Notes") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                    )
                }
            } else {
                // Song tab — ChordPro content editor
                OutlinedTextField(
                    value = state.content,
                    onValueChange = viewModel::setContent,
                    modifier = Modifier.fillMaxSize().padding(8.dp),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                    placeholder = { Text("{c: Verse 1}\n[G]Amazing [C]grace...") },
                )
            }
        }
    }

    // Delete confirmation dialog
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Delete Song") },
            text = { Text("Delete \"${state.title}\"? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDialog = false
                        viewModel.delete()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = DangerColor),
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun LocalTextStyle() = MaterialTheme.typography.bodyMedium
