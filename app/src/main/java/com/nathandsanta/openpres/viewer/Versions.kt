package com.nathandsanta.openpres.viewer

/** OpenPres versions ("0.8.0", "v0.8.0"): compared by their three numbers. */
object Versions {
    private fun parts(version: String): List<Int>? {
        val m = Regex("""^v?(\d+)\.(\d+)\.(\d+)""").find(version.trim()) ?: return null
        return m.groupValues.drop(1).map { it.toInt() }
    }

    /** Whether `version` is newer than `than` (unknown versions never are). */
    fun isNewer(version: String, than: String): Boolean {
        val a = parts(version) ?: return false
        val b = parts(than) ?: return false
        for (i in 0 until 3) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }
}
