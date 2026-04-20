package com.songchords.app.ui.`import`

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.songchords.app.data.SongCreateInput
import com.songchords.app.data.SongRepository
import com.songchords.app.parser.ChordProParser
import com.songchords.app.ui.theme.DangerColor
import com.songchords.app.ui.theme.SuccessColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader

data class ImportResult(
    val filename: String,
    val success: Boolean,
    val message: String? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(songRepo: SongRepository) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var results by remember { mutableStateOf<List<ImportResult>>(emptyList()) }
    var importing by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        importing = true
        scope.launch {
            val newResults = mutableListOf<ImportResult>()
            for (uri in uris) {
                try {
                    val content = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(uri)?.use { stream ->
                            BufferedReader(InputStreamReader(stream)).readText()
                        } ?: throw Exception("Could not read file")
                    }

                    val filename = uri.lastPathSegment ?: "unknown"
                    val isChordPro = filename.endsWith(".cho") || filename.endsWith(".chordpro") ||
                            filename.endsWith(".chopro") || filename.endsWith(".crd")

                    val parsed = if (isChordPro) ChordProParser.parseChordPro(content)
                    else ChordProParser.parsePlainText(content)

                    val input = SongCreateInput(
                        title = parsed.metadata.title ?: filename.substringBeforeLast('.'),
                        artist = parsed.metadata.artist,
                        key = parsed.metadata.key,
                        tempo = parsed.metadata.tempo,
                        timeSig = parsed.metadata.timeSig,
                        capo = parsed.metadata.capo ?: 0,
                        content = content,
                        contentFormat = if (isChordPro) "chordpro" else "plaintext",
                    )
                    songRepo.create(input)
                    newResults.add(ImportResult(filename, true))
                } catch (e: Exception) {
                    newResults.add(ImportResult(
                        uri.lastPathSegment ?: "unknown",
                        false,
                        e.message,
                    ))
                }
            }
            results = newResults + results
            importing = false
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Import Songs") }) }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Drop zone
            Surface(
                modifier = Modifier.fillMaxWidth().height(200.dp),
                shape = MaterialTheme.shapes.large,
                tonalElevation = 1.dp,
            ) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Default.Upload,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Tap to browse files", fontWeight = FontWeight.SemiBold)
                    Text(
                        "ChordPro (.cho, .chordpro) or plain text (.txt)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = { launcher.launch(arrayOf("*/*")) },
                        enabled = !importing,
                    ) {
                        Text(if (importing) "Importing..." else "Browse Files")
                    }
                }
            }

            // Results
            if (results.isNotEmpty()) {
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    "Import Results",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.Start),
                )
                Spacer(modifier = Modifier.height(8.dp))
                LazyColumn {
                    items(results) { result ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                if (result.success) Icons.Default.CheckCircle else Icons.Default.Error,
                                contentDescription = null,
                                tint = if (result.success) SuccessColor else DangerColor,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(result.filename, fontWeight = FontWeight.Medium, maxLines = 1)
                                if (result.message != null) {
                                    Text(
                                        result.message,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = DangerColor,
                                    )
                                }
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}
