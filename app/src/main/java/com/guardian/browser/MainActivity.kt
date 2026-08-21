package com.guardian.browser

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageButton
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var addressBar: EditText
    private lateinit var session: GeckoSession
    private lateinit var runtime: GeckoRuntime

    // -----------------------------------------------------------------
    // This is the path, INSIDE THE APK ITSELF, where the parental-control
    // extension's unpacked files live (see assets/extensions/parental_whitelist/
    // and its README). Because it's loaded here via installBuiltIn() rather
    // than through a normal Add-ons manager UI, there is nowhere in this app
    // for a user to remove or disable it. That's the whole mechanism that
    // makes it permanent — there's simply no "uninstall extension" button
    // anywhere in the app for anyone to press.
    // -----------------------------------------------------------------
    private val parentalExtensionPath =
        "resource://android/assets/extensions/parental_whitelist/"

    private val defaultStartUrl = "https://start.mozilla.org"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

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

        runtime = GeckoRuntime.create(this)
        session = GeckoSession()
        session.open(runtime)
        geckoView.setSession(session)

        installParentalControlExtension()

        goButton.setOnClickListener { loadFromAddressBar() }
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
                    Log.i("GuardianBrowser", "Parental control extension installed: ${extension?.id}")
                },
                { error: Throwable ->
                    // If this fires, the most common cause is that
                    // assets/extensions/parental_whitelist/ is still just the
                    // placeholder file and doesn't contain the real
                    // extension (manifest.json etc.) yet. See that folder's
                    // README for what to put there.
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
            else -> "https://duckduckgo.com/html/?q=" +
                java.net.URLEncoder.encode(input, "UTF-8")
        }

        session.loadUri(input)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        session.goBack()
    }
}
