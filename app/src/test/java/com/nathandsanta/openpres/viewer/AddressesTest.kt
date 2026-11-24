package com.nathandsanta.openpres.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AddressesTest {
    @Test
    fun typedAddressesGetTheDefaultPort() {
        assertEquals("http://192.168.1.20:8787", Addresses.normalize(" 192.168.1.20 "))
        assertEquals("http://studio-pc:9000", Addresses.normalize("studio-pc:9000/"))
        assertEquals("https://openpres.example:8787", Addresses.normalize("https://openpres.example"))
        assertEquals("http://[fe80::1]:8787", Addresses.normalize("[fe80::1]"))
        assertNull(Addresses.normalize(""))
        assertNull(Addresses.normalize("studio pc"))
        assertNull(Addresses.normalize("studio-pc:99999"))
    }

    @Test
    fun foundServersInBrackets() {
        assertEquals("http://192.168.1.20:8787", Addresses.of("192.168.1.20", 8787))
        assertEquals("http://[fe80::1%25wlan0]:8787", Addresses.of("fe80::1%wlan0", 8787))
    }
}
