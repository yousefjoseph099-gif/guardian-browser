package com.guardian.browser

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
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
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebExtensionController

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var addressBar: EditText
    private lateinit var session: GeckoSession
    private lateinit var runtime: GeckoRuntime
    private lateinit var prefs: SharedPreferences

    // Kept once the extension finishes installing, so the settings dialog
    // can enable/disable it and jump to its own options page.
    private var installedExtension: WebExtension? = null

    private val parentalExtensionPath =
        "resource://android/assets/extensions/parental_whitelist/"

    private val defaultStartUrl = "https://start.mozilla.org"

    // Label shown to the user -> query template ("%s" gets replaced with the
    // URL-encoded search text).
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
        val goButton: ImageButton = findViewById(R.id.go_button)
        val settingsButton: Button = findViewById(R.id.settings_button)

        runtime = GeckoRuntime.create(this)
        session = GeckoSession()
        session.open(runtime)
        geckoView.setSession(session)

        installParentalControlExtension()

        goButton.setOnClickListener { loadFromAddressBar() }
        settingsButton.setOnClickListener { showSettingsDialog() }
        addressBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                loadFromAddressBar()
                true
            } else {
                false
            }
        }

        session.loadUri(defaultStartUrl)
    }

    private fun installParentalControlExtension() {
        runtime.webExtensionController
            .installBuiltIn(parentalExtensionPath)
            .accept(
                { extension: WebExtension? ->
                    installedExtension = extension
                    Log.i("GuardianBrowser", "Parental control extension installed: ${extension?.id}")
                },
                { error: Throwable? ->
                    Log.e("GuardianBrowser", "Failed to install parental control extension", error)
                }
            )
    }

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

    private fun showSettingsDialog() {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(16), dp(24), dp(8))
        }

        // --- Search engine picker ---
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

        // --- Extension controls ---
        container.addView(TextView(this).apply {
            text = "Parental control extension"
            textSize = 16f
            setPadding(0, dp(20), 0, dp(4))
        })

        val statusText = TextView(this)
        val toggleButton = Button(this)
        val optionsButton = Button(this).apply { text = "Open extension settings" }

        fun refreshExtensionUi() {
            val ext = installedExtension
            if (ext == null) {
                statusText.text = "Not installed yet — see the README's setup step."
                toggleButton.isEnabled = false
                optionsButton.isEnabled = false
            } else {
                val enabled = ext.metaData?.enabled ?: true
                statusText.text = "${ext.metaData?.name ?: "Extension"} — ${if (enabled) "Enabled" else "Disabled"}"
                toggleButton.text = if (enabled) "Disable" else "Enable"
                toggleButton.isEnabled = true
                optionsButton.isEnabled = !ext.metaData?.optionsPageUrl.isNullOrEmpty()
            }
        }
        refreshExtensionUi()

        toggleButton.setOnClickListener {
            val ext = installedExtension ?: return@setOnClickListener
            val enabled = ext.metaData?.enabled ?: true
            val action = if (enabled) {
                runtime.webExtensionController.disable(ext, WebExtensionController.EnableSource.USER)
            } else {
                runtime.webExtensionController.enable(ext, WebExtensionController.EnableSource.USER)
            }
            action.accept(
                { updated: WebExtension? ->
                    installedExtension = updated
                    runOnUiThread { refreshExtensionUi() }
                },
                { error: Throwable? ->
                    Log.e("GuardianBrowser", "Failed to toggle extension", error)
                }
            )
        }

        optionsButton.setOnClickListener {
            val url = installedExtension?.metaData?.optionsPageUrl
            if (!url.isNullOrEmpty()) {
                session.loadUri(url)
            }
        }

        container.addView(statusText)
        container.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
            addView(toggleButton)
            addView(optionsButton)
        })

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
