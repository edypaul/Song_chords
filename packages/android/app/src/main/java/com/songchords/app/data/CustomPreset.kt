package com.songchords.app.data

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import org.json.JSONObject

data class CustomPreset(
    val key: String,
    val name: String,
    val mode: PresetMode,
    val style: SongViewStyle,
)

// ─── JSON helpers ──────────────────────────────────────────────────────────

private fun Color.toHex(): String = "#%08X".format(this.toArgb())
private fun parseColor(hex: String?): Color? = hex?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }

private fun SectionStyle.toJson(): JSONObject = JSONObject().apply {
    put("fontSize", fontSize)
    color?.let { put("color", it.toHex()) }
    background?.let { put("background", it.toHex()) }
}

private fun JSONObject.optHex(name: String): String? =
    optString(name).takeIf { it.isNotEmpty() }

private fun JSONObject.toSectionStyle(): SectionStyle = SectionStyle(
    fontSize = optInt("fontSize", -1),
    color = parseColor(optHex("color")),
    background = parseColor(optHex("background")),
)

private fun SongViewStyle.toJson(): JSONObject = JSONObject().apply {
    put("preset", preset)
    put("fontFamily", fontFamily.name)
    put("titleUppercase", titleUppercase)
    put("sectionUppercase", sectionUppercase)
    put("lyrics", lyrics.toJson())
    put("chords", chords.toJson())
    put("title", title.toJson())
    put("details", details.toJson())
    put("section", section.toJson())
    chorusBorderColor?.let { put("chorusBorderColor", it.toHex()) }
}

private fun JSONObject.toSongViewStyle(): SongViewStyle = SongViewStyle(
    preset = optString("preset", "custom"),
    fontFamily = runCatching { FontFamilyChoice.valueOf(optString("fontFamily", "MONOSPACE")) }.getOrDefault(FontFamilyChoice.MONOSPACE),
    titleUppercase = optBoolean("titleUppercase", false),
    sectionUppercase = optBoolean("sectionUppercase", true),
    lyrics = optJSONObject("lyrics")?.toSectionStyle() ?: SectionStyle(),
    chords = optJSONObject("chords")?.toSectionStyle() ?: SectionStyle(),
    title = optJSONObject("title")?.toSectionStyle() ?: SectionStyle(),
    details = optJSONObject("details")?.toSectionStyle() ?: SectionStyle(),
    section = optJSONObject("section")?.toSectionStyle() ?: SectionStyle(),
    chorusBorderColor = parseColor(optHex("chorusBorderColor")),
)

fun customPresetsToJson(map: Map<String, CustomPreset>): String {
    val root = JSONObject()
    for ((k, p) in map) {
        root.put(k, JSONObject().apply {
            put("name", p.name)
            put("mode", p.mode.name)
            put("style", p.style.toJson())
        })
    }
    return root.toString()
}

fun customPresetsFromJson(json: String?): Map<String, CustomPreset> {
    if (json.isNullOrBlank()) return emptyMap()
    val root = runCatching { JSONObject(json) }.getOrNull() ?: return emptyMap()
    val result = linkedMapOf<String, CustomPreset>()
    val keys = root.keys()
    while (keys.hasNext()) {
        val k = keys.next()
        val obj = root.optJSONObject(k) ?: continue
        val mode = runCatching { PresetMode.valueOf(obj.optString("mode", "DARK")) }.getOrDefault(PresetMode.DARK)
        val style = obj.optJSONObject("style")?.toSongViewStyle() ?: continue
        result[k] = CustomPreset(
            key = k,
            name = obj.optString("name", "Custom"),
            mode = mode,
            style = style,
        )
    }
    return result
}
