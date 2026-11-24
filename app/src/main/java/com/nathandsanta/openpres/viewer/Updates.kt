package com.nathandsanta.openpres.viewer

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL

/**
 * Looks for a newer app when it opens: every OpenPres release on GitHub has the APK attached.
 * If there is one, the screen in front offers to download it (opening the file installs it).
 * A build by hand (version 0.1.0) doesn't look.
 */
object Updates {
    private const val LATEST = "https://api.github.com/repos/NathanDSanta/OpenPres/releases/latest"
    private const val TEST_BUILD = "0.1.0"

    data class Release(val version: String, val url: String)

    private var started = false
    private var found: Release? = null
    private var offered = false
    private var front: WeakReference<Activity>? = null

    /** Once per run of the app. */
    fun start() {
        if (started || BuildConfig.VERSION_NAME == TEST_BUILD) return
        started = true
        Thread {
            val release = runCatching { newer(fetch(), BuildConfig.VERSION_NAME) }.getOrNull()
            Handler(Looper.getMainLooper()).post {
                found = release
                front?.get()?.let { offer(it) }
            }
        }.start()
    }

    fun resumed(activity: Activity) {
        front = WeakReference(activity)
        offer(activity)
    }

    fun paused(activity: Activity) {
        if (front?.get() === activity) front = null
    }

    /** The newest release's APK, if it's newer than `current`. */
    fun newer(json: String, current: String): Release? {
        val release = JSONObject(json)
        val version = release.optString("tag_name").removePrefix("v")
        if (!Versions.isNewer(version, current)) return null
        val assets = release.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            if (asset.optString("name").endsWith("-Android.apk")) return Release(version, asset.optString("browser_download_url"))
        }
        return null
    }

    private fun fetch(): String {
        val connection = URL(LATEST).openConnection() as HttpURLConnection
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        connection.setRequestProperty("User-Agent", "openpres-android")
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        try {
            if (connection.responseCode != 200) throw IllegalStateException("GitHub answered ${connection.responseCode}")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun offer(activity: Activity) {
        val release = found ?: return
        if (offered || activity.isFinishing) return
        offered = true
        AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_title, release.version))
            .setMessage(activity.getString(R.string.update_message, BuildConfig.VERSION_NAME))
            .setPositiveButton(R.string.download) { _, _ -> activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(release.url))) }
            .setNegativeButton(R.string.later, null)
            .show()
    }
}
