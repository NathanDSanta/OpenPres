package com.nathandsanta.openpres.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpdatesTest {
    private val release = """
        {"tag_name": "v0.9.0", "assets": [
          {"name": "OpenPres-0.9.0-Windows-x64-Setup.exe", "browser_download_url": "https://x/setup.exe"},
          {"name": "OpenPres-0.9.0-Android.apk", "browser_download_url": "https://x/OpenPres-0.9.0-Android.apk"}
        ]}
    """.trimIndent()

    @Test
    fun aNewerReleaseOffersItsApk() {
        assertEquals(Updates.Release("0.9.0", "https://x/OpenPres-0.9.0-Android.apk"), Updates.newer(release, "0.8.2"))
    }

    @Test
    fun theSameOrAnOlderOneDoesnt() {
        assertNull(Updates.newer(release, "0.9.0"))
        assertNull(Updates.newer(release, "1.0.0"))
        assertNull(Updates.newer("""{"tag_name": "v0.9.0", "assets": []}""", "0.8.0"))
    }
}
