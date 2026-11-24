package com.nathandsanta.openpres.viewer

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

/** The OpenPres viewer: the app's first screen. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(
            TextView(this).apply {
                setText(R.string.soon)
                gravity = Gravity.CENTER
                textSize = 18f
            },
        )
    }
}
