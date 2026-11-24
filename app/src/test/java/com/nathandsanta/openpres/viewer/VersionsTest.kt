package com.nathandsanta.openpres.viewer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionsTest {
    @Test
    fun comparesByTheThreeNumbers() {
        assertTrue(Versions.isNewer("v0.8.0", "0.7.9"))
        assertTrue(Versions.isNewer("0.10.0", "0.9.3"))
        assertFalse(Versions.isNewer("0.7.0", "0.7.0"))
        assertFalse(Versions.isNewer("0.6.9", "0.7.0"))
        assertFalse(Versions.isNewer("nightly", "0.7.0"))
    }
}
