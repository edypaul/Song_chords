package com.songchords.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Desktop-matching color scheme
// Light: bg #F8FAFC, surface #FFFFFF, elevated #F1F5F9, text #0F172A, muted #94A3B8
// Dark:  bg #0F172A, surface #1E293B, elevated #334155, text #F1F5F9, muted #64748B
// Accent: #6366F1 (light) / #818CF8 (dark)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF818CF8),           // accent dark
    onPrimary = Color.White,
    secondary = Color(0xFF94A3B8),          // muted dark text
    background = Color(0xFF0F172A),         // bg dark
    surface = Color(0xFF1E293B),            // surface dark
    surfaceVariant = Color(0xFF334155),      // elevated dark
    onBackground = Color(0xFFF1F5F9),       // text primary dark
    onSurface = Color(0xFFF1F5F9),          // text primary dark
    onSurfaceVariant = Color(0xFF64748B),   // text muted dark
    outline = Color(0xFF334155),             // border dark
    error = Color(0xFFEF4444),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF6366F1),            // accent light
    onPrimary = Color.White,
    secondary = Color(0xFF64748B),           // muted light
    background = Color(0xFFF8FAFC),          // bg light
    surface = Color(0xFFFFFFFF),             // surface light
    surfaceVariant = Color(0xFFF1F5F9),      // elevated light
    onBackground = Color(0xFF0F172A),        // text primary light
    onSurface = Color(0xFF0F172A),           // text primary light
    onSurfaceVariant = Color(0xFF94A3B8),    // text muted light
    outline = Color(0xFFE2E8F0),             // border light
    error = Color(0xFFEF4444),
)

/** Chord color — same as accent, stable across themes. */
val ChordColor @Composable get() = MaterialTheme.colorScheme.primary

/** Danger / destructive action color. */
val DangerColor = Color(0xFFEF4444)

/** Success color. */
val SuccessColor = Color(0xFF22C55E)

@Composable
fun SongChordsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
