package com.nathandsanta.openpres.viewer

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper

/** An OpenPres server on the network. */
data class FoundServer(val name: String, val address: String, val version: String)

/**
 * Finds OpenPres servers on the network: they announce themselves as "_openpres._tcp" (the
 * desktop manager finds them the same way). Calls `onChange` on the main thread.
 */
class Discovery(context: Context, private val onChange: (List<FoundServer>) -> Unit) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager?
    private var lock: WifiManager.MulticastLock? = null
    private val main = Handler(Looper.getMainLooper())
    private val found = linkedMapOf<String, FoundServer>()
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var running = false

    private val listener = object : NsdManager.DiscoveryListener {
        override fun onServiceFound(info: NsdServiceInfo) {
            main.post {
                pending.add(info)
                resolveNext()
            }
        }

        override fun onServiceLost(info: NsdServiceInfo) {
            main.post {
                found.remove(info.serviceName)
                publish()
            }
        }

        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    }

    fun start() {
        if (running) return
        running = true
        // Wi-Fi drops multicast packets (the announcements) unless asked not to.
        lock = wifi?.createMulticastLock("openpres-discovery")?.apply {
            setReferenceCounted(false)
            acquire()
        }
        nsd.discoverServices(SERVICE, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    fun stop() {
        if (!running) return
        running = false
        try {
            nsd.stopServiceDiscovery(listener)
        } catch (_: IllegalArgumentException) {
            // It hadn't started.
        }
        lock?.release()
        lock = null
    }

    private fun resolveNext() {
        if (resolving || !running) return
        val info = pending.removeFirstOrNull() ?: return
        resolving = true
        @Suppress("DEPRECATION")
        nsd.resolveService(
            info,
            object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    main.post {
                        resolving = false
                        resolveNext()
                    }
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    main.post {
                        @Suppress("DEPRECATION")
                        val host = serviceInfo.host?.hostAddress
                        if (host != null) {
                            val text = { key: String -> serviceInfo.attributes[key]?.toString(Charsets.UTF_8).orEmpty() }
                            found[serviceInfo.serviceName] = FoundServer(
                                name = text("name").ifEmpty { serviceInfo.serviceName },
                                address = Addresses.of(host, serviceInfo.port),
                                version = text("version"),
                            )
                            publish()
                        }
                        resolving = false
                        resolveNext()
                    }
                }
            },
        )
    }

    private fun publish() = onChange(found.values.toList())

    companion object {
        const val SERVICE = "_openpres._tcp"
    }
}
