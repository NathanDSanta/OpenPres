package com.nathandsanta.openpres.viewer

/** Server addresses as people type them: "192.168.1.20", "studio-pc:8787", "http://…". */
object Addresses {
    const val DEFAULT_PORT = 8787

    /** The server's base address ("http://192.168.1.20:8787"), or null if it isn't one. */
    fun normalize(typed: String): String? {
        var text = typed.trim().trimEnd('/')
        if (text.isEmpty()) return null
        if (!text.startsWith("http://") && !text.startsWith("https://")) text = "http://$text"
        val scheme = text.substringBefore("://")
        val rest = text.substringAfter("://").substringBefore('/')
        if (rest.isEmpty() || rest.any { it.isWhitespace() }) return null
        val hasPort = if (rest.startsWith("[")) rest.contains("]:") else rest.contains(':')
        val host = if (hasPort) rest.substringBeforeLast(':') else rest
        val port = if (hasPort) rest.substringAfterLast(':').toIntOrNull() ?: return null else DEFAULT_PORT
        if (host.isEmpty() || port !in 1..65535) return null
        return "$scheme://$host:$port"
    }

    /** A found server's address, IPv6 in brackets. */
    fun of(host: String, port: Int): String {
        val h = if (host.contains(':')) "[${host.replace("%", "%25")}]" else host
        return "http://$h:$port"
    }
}
