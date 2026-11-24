package com.nathandsanta.openpres.viewer

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** OpenPres's colours and a few views in its style (the app uses no extra libraries). */
object Ui {
    val BACKGROUND = Color.parseColor("#0F0E14")
    val CARD = Color.parseColor("#1B1A24")
    val BORDER = Color.parseColor("#2E2C3B")
    val TEXT = Color.parseColor("#ECEBF5")
    val MUTED = Color.parseColor("#A19FB3")
    val ACCENT = Color.parseColor("#8B72FF")
    val ERROR = Color.parseColor("#FF9AA6")

    fun Context.dp(value: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    fun rounded(context: Context, fill: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = context.dp(10).toFloat()
        if (stroke != null) setStroke(context.dp(1), stroke)
    }

    fun text(context: Context, value: CharSequence, size: Float = 15f, color: Int = TEXT, bold: Boolean = false): TextView = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    fun button(context: Context, label: CharSequence, primary: Boolean = false, onClick: () -> Unit): Button = Button(context).apply {
        text = label
        isAllCaps = false
        setTextColor(if (primary) Color.WHITE else TEXT)
        background = rounded(context, if (primary) ACCENT else CARD, if (primary) null else BORDER)
        setPadding(context.dp(16), 0, context.dp(16), 0)
        minHeight = context.dp(44)
        setOnClickListener { onClick() }
    }

    /** A tappable row: a name and a smaller line under it. */
    fun row(context: Context, title: CharSequence, detail: CharSequence, onClick: () -> Unit): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        background = rounded(context, CARD, BORDER)
        setPadding(context.dp(16), context.dp(12), context.dp(16), context.dp(12))
        isClickable = true
        isFocusable = true
        addView(text(context, title, 16f, TEXT, bold = true))
        addView(text(context, detail, 13f, MUTED))
        setOnClickListener { onClick() }
    }
}
