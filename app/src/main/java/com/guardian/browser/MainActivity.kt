package com.guardian.browser

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var addressBar: EditText
    private lateinit var tabStrip: LinearLayout
    private lateinit var actionButton: Button
    private lateinit var session: GeckoSession
    private lateinit var runtime: GeckoRuntime
    private lateinit var prefs: SharedPreferences

    private var installedExtension: WebExtension? = null
    private var browserAction: WebExtension.Action? = null

    private data class BrowserTab(val session: GeckoSession, var title: String = "New Tab")
    private val tabs = mutableListOf<BrowserTab>()
    private var currentTabIndex = -1

    private val parentalExtensionPath =
        "resource://android/assets/extensions/parental_whitelist/"

    private val defaultStartUrl = "https://start.mozilla.org"

    private val searchEngines = linkedMapOf(
        "DuckDuckGo" to "https://duckduckgo.com/html/?q=%s",
        "Google" to "https://www.google.com/search?q=%s",
        "Bing" to "https://www.bing.com/search?q=%s",
        "Startpage" to "https://www.startpage.com/sp/search?query=%s"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences("guardian_prefs", Context.MODE_PRIVATE)

        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                1001
            )
        }

        geckoView = findViewById(R.id.geckoview)
        addressBar = findViewById(R.id.address_bar)
        tabStrip = findViewById(R.id.tab_strip)
        actionButton = findViewById(R.id.action_button)
        val goButton: ImageButton = findViewById(R.id.go_button)
        val settingsButton: Button = findViewById(R.id.settings_button)
        val backButton: Button = findViewById(R.id.back_button)
        val forwardButton: Button = findViewById(R.id.forward_button)
        val homeButton: Button = findViewById(R.id.home_button)

        runtime = GeckoRuntime.create(this)

        installParentalControlExtension()

        goButton.setOnClickListener { loadFromAddressBar() }
        settingsButton.setOnClickListener { showSettingsDialog() }
        backButton.setOnClickListener { session.goBack() }
        forwardButton.setOnClickListener { session.goForward() }
        homeButton.setOnClickListener { session.loadUri(defaultStartUrl) }
        actionButton.setOnClickListener { browserAction?.click() }

        addressBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                loadFromAddressBar()
                true
            } else {
                false
            }
        }

        openNewTab(defaultStartUrl)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    // ---------------------------------------------------------------
    // Tabs
    // ---------------------------------------------------------------

    private fun openNewTab(url: String = defaultStartUrl) {
        val newSession = GeckoSession()
        newSession.open(runtime)
        newSession.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onTitleChange(session: GeckoSession, title: String?) {
                tabs.find { it.session == session }?.let {
                    it.title = if (title.isNullOrBlank()) "New Tab" else title
                    runOnUiThread { refreshTabStrip() }
                }
            }
        }
        tabs.add(BrowserTab(newSession))
        switchToTab(tabs.size - 1)
        newSession.loadUri(url)
    }

    private fun switchToTab(index: Int) {
        if (index !in tabs.indices) return
        currentTabIndex = index
        session = tabs[index].session
        geckoView.setSession(session)
        refreshTabStrip()
    }

    private fun closeTab(index: Int) {
        if (index !in tabs.indices) return
        val closed = tabs.removeAt(index)
        closed.session.close()
        if (tabs.isEmpty()) {
            openNewTab()
            return
        }
        switchToTab(if (index >= tabs.size) tabs.size - 1 else index)
    }

    private fun refreshTabStrip() {
        tabStrip.removeAllViews()
        tabs.forEachIndexed { index, tab ->
            val tabButton = Button(this).apply {
                text = if (tab.title.length > 12) tab.title.take(12) + "…" else tab.title
                minWidth = 0
                minHeight = 0
                setPadding(dp(12), dp(6), dp(12), dp(6))
                setTextColor(Color.WHITE)
                val color = if (index == currentTabIndex) R.color.accent else R.color.toolbar_background
                background = ColorDrawable(ContextCompat.getColor(this@MainActivity, color))
                setOnClickListener { switchToTab(index) }
                setOnLongClickListener { closeTab(index); true }
            }
            tabStrip.addView(tabButton)
        }
        val newTabButton = Button(this).apply {
            text = "+"
            minWidth = 0
            minHeight = 0
            setPadding(dp(16), dp(6), dp(16), dp(6))
            setTextColor(Color.WHITE)
            background = ColorDrawable(ContextCompat.getColor(this@MainActivity, R.color.toolbar_background_dark))
            setOnClickListener { openNewTab() }
        }
        tabStrip.addView(newTabButton)
    }

    // ---------------------------------------------------------------
    // Extension: install + its own toolbar icon/popup ("browser action")
    // ---------------------------------------------------------------

    private fun installParentalControlExtension() {
        runtime.webExtensionController
            .installBuiltIn(parentalExtensionPath)
            .accept(
                { extension: WebExtension? ->
                    installedExtension = extension
                    extension?.setActionDelegate(object : WebExtension.ActionDelegate {
                        override fun onBrowserAction(
                            extension: WebExtension,
                            session: GeckoSession?,
                            action: WebExtension.Action
                        ) {
                            browserAction = action
                            val isEnabled = action.enabled ?: true
                            runOnUiThread {
                                actionButton.visibility = if (isEnabled) View.VISIBLE else View.GONE
                            }
                        }

                        override fun onOpenPopup(
                            extension: WebExtension,
                            action: WebExtension.Action
                        ): GeckoResult<GeckoSession> = showActionPopup()

                        override fun onTogglePopup(
                            extension: WebExtension,
                            action: WebExtension.Action
                        ): GeckoResult<GeckoSession> = showActionPopup()
                    })
                    Log.i("GuardianBrowser", "Parental control extension installed: ${extension?.id}")
                },
                { error: Throwable? ->
                    Log.e("GuardianBrowser", "Failed to install parental control extension", error)
                }
            )
    }

    private fun showActionPopup(): GeckoResult<GeckoSession> {
        val popupSession = GeckoSession()
        popupSession.open(runtime)

        runOnUiThread {
            val popupView = GeckoView(this)
            popupView.setSession(popupSession)
            val dialog = AlertDialog.Builder(this)
                .setView(popupView)
                .setOnDismissListener { popupSession.close() }
                .create()
            dialog.show()
            dialog.window?.setLayout(
                (resources.displayMetrics.widthPixels * 0.9).toInt(),
                (resources.displayMetrics.heightPixels * 0.6).toInt()
            )
        }

        return GeckoResult.fromValue(popupSession)
    }

    // ---------------------------------------------------------------
    // Address bar
    // ---------------------------------------------------------------

    private fun loadFromAddressBar() {
        var input = addressBar.text.toString().trim()
        if (input.isEmpty()) return

        input = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            input.contains(".") && !input.contains(" ") -> "https://$input"
            else -> {
                val engineLabel = prefs.getString(KEY_SEARCH_ENGINE, DEFAULT_ENGINE) ?: DEFAULT_ENGINE
                val template = searchEngines[engineLabel] ?: searchEngines.getValue(DEFAULT_ENGINE)
                template.replace("%s", java.net.URLEncoder.encode(input, "UTF-8"))
            }
        }

        session.loadUri(input)
    }

    // ---------------------------------------------------------------
    // Settings — search engine only. No way to disable the extension,
    // by design: this app is a locked-down browser.
    // ---------------------------------------------------------------

    private fun showSettingsDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(16), dp(24), dp(8))
        }

        container.addView(TextView(this).apply {
            text = "Search engine"
            textSize = 16f
        })

        val currentEngine = prefs.getString(KEY_SEARCH_ENGINE, DEFAULT_ENGINE) ?: DEFAULT_ENGINE
        val radioGroup = RadioGroup(this).apply { orientation = LinearLayout.VERTICAL }
        searchEngines.keys.forEach { label ->
            radioGroup.addView(RadioButton(this@MainActivity).apply {
                text = label
                id = View.generateViewId()
                isChecked = label == currentEngine
            })
        }
        container.addView(radioGroup)

        container.addView(TextView(this).apply {
            text = "Parental control extension"
            textSize = 16f
            setPadding(0, dp(20), 0, dp(4))
        })

        val ext = installedExtension
        val statusText = TextView(this).apply {
            text = if (ext == null) {
                "Not installed yet — see the README's setup step."
            } else {
                val enabled = ext.metaData?.enabled ?: true
                "${ext.metaData?.name ?: "Extension"} — ${if (enabled) "Enabled" else "Disabled"} (cannot be disabled from this app)"
            }
        }
        container.addView(statusText)

        val optionsButton = Button(this).apply {
            text = "Open extension settings"
            isEnabled = !ext?.metaData?.optionsPageUrl.isNullOrEmpty()
            setOnClickListener {
                val url = installedExtension?.metaData?.optionsPageUrl
                if (!url.isNullOrEmpty()) session.loadUri(url)
            }
        }
        container.addView(optionsButton)

        AlertDialog.Builder(this)
            .setTitle("Settings")
            .setView(container)
            .setPositiveButton("Done") { _, _ ->
                val checkedId = radioGroup.checkedRadioButtonId
                val selectedLabel = radioGroup.findViewById<RadioButton>(checkedId)?.text?.toString()
                if (selectedLabel != null) {
                    prefs.edit().putString(KEY_SEARCH_ENGINE, selectedLabel).apply()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        session.goBack()
    }

    companion object {
        private const val KEY_SEARCH_ENGINE = "search_engine"
        private const val DEFAULT_ENGINE = "DuckDuckGo"
    }
}
