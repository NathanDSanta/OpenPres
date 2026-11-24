package com.nathandsanta.openpres.viewer

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.nathandsanta.openpres.viewer.Ui.dp

/**
 * The first screen: the OpenPres servers on the network, or a typed address. The server used
 * last opens by itself.
 */
class MainActivity : Activity() {
    private lateinit var discovery: Discovery
    private lateinit var list: LinearLayout
    private lateinit var empty: TextView
    private lateinit var error: TextView
    private val prefs by lazy { getSharedPreferences("openpres", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Opening the app opens the server used last; Back from it comes here to choose another.
        Updates.start()
        val last = prefs.getString(LAST_SERVER, null)
        if (last != null && savedInstanceState == null) open(last, remember = false)

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(32), dp(24), dp(24))
        }
        content.addView(Ui.text(this, getString(R.string.app_name), 26f, bold = true))
        content.addView(
            Ui.text(this, getString(R.string.choose_server), 15f, Ui.MUTED).apply { setPadding(0, dp(4), 0, dp(20)) },
        )
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(list)
        empty = Ui.text(this, getString(R.string.looking), 14f, Ui.MUTED).apply { setPadding(0, dp(8), 0, dp(8)) }
        content.addView(empty)

        val address = EditText(this).apply {
            hint = getString(R.string.address_hint)
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(context, Ui.CARD, Ui.BORDER)
            setPadding(dp(14), 0, dp(14), 0)
            minHeight = dp(48)
            isSingleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setText(prefs.getString(LAST_SERVER, "")?.removePrefix("http://"))
        }
        val connect = { connectTo(address.text.toString()) }
        address.setOnEditorActionListener { _, action, event ->
            val enter = action == EditorInfo.IME_ACTION_GO || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (enter) connect()
            enter
        }
        val typed = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(20), 0, 0)
            addView(address, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(
                Ui.button(context, getString(R.string.connect), primary = true) { connect() },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) },
            )
        }
        content.addView(typed)
        error = Ui.text(this, "", 14f, Ui.ERROR).apply { setPadding(0, dp(8), 0, 0) }
        content.addView(error)
        content.addView(Ui.text(this, getString(R.string.viewers_note), 13f, Ui.MUTED).apply { setPadding(0, dp(24), 0, 0) })

        setContentView(ScrollView(this).apply {
            setBackgroundColor(Ui.BACKGROUND)
            isFillViewport = true
            addView(content)
        })
        discovery = Discovery(this) { show(it) }
    }

    override fun onResume() {
        super.onResume()
        discovery.start()
        Updates.resumed(this)
    }

    override fun onPause() {
        discovery.stop()
        Updates.paused(this)
        super.onPause()
    }

    private fun show(servers: List<FoundServer>) {
        list.removeAllViews()
        empty.visibility = if (servers.isEmpty()) View.VISIBLE else View.GONE
        for (s in servers) {
            val detail = listOf(s.address.removePrefix("http://"), s.version.takeIf { it.isNotEmpty() }?.let { "OpenPres $it" }).filterNotNull().joinToString(" · ")
            list.addView(
                Ui.row(this, s.name, detail) { open(s.address) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) },
            )
        }
    }

    private fun connectTo(typed: String) {
        val address = Addresses.normalize(typed)
        if (address == null) {
            error.text = getString(R.string.not_an_address)
            return
        }
        error.text = ""
        open(address)
    }

    private fun open(address: String, remember: Boolean = true) {
        if (remember) prefs.edit().putString(LAST_SERVER, address).apply()
        startActivity(Intent(this, ViewerActivity::class.java).putExtra(ViewerActivity.EXTRA_ADDRESS, address))
    }

    companion object {
        const val LAST_SERVER = "lastServer"
    }
}
