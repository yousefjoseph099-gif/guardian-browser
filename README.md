# Guardian Browser — starter project

A minimal Android browser built on **GeckoView** (Mozilla's actual Firefox
rendering engine, published as a ready-to-use library) with the
"Parental Whitelist Control" extension baked permanently into the app.
No Android Studio, no Android SDK on your own device — GitHub Actions
builds the APK for you.

## Why this approach (and not a full Firefox rebuild)

Building Firefox for Android from Mozilla's actual source
(`mozilla-central`) means compiling the whole Gecko engine from C++ —
tens of gigabytes of source, specialized build tooling, and hours of
compute on Mozilla's own infrastructure. It is not realistic to do on
GitHub Actions' free runners for a personal project, and that's very
likely what's eaten your last 13 hours.

The fix: Mozilla separately publishes **GeckoView** — the same engine,
precompiled — as a normal library on their Maven repository
(`maven.mozilla.org`). You depend on it the same way you'd depend on
any Android library. No compiling Gecko yourself, ever.

## Why the extension is genuinely permanent

The add-on's own installation page talks about a `policies.json` file
under `Program Files` / `/Applications` / `/usr/lib` — that's a
**desktop-only** Firefox mechanism and doesn't exist on Android, so
ignore it entirely.

Instead: GeckoView has a real API,
`WebExtensionController.installBuiltIn()`, which loads a WebExtension
straight out of the APK's own `assets/` folder — not through an
Add-ons manager UI. `MainActivity.kt` calls this on startup. Because
this app is one you're building yourself, there is simply **no button
anywhere in it** that removes or disables an extension. That's the
actual mechanism that makes it unremovable — not a policy file, but
the fact that you control 100% of the UI and never gave it an exit.
The only way around it is uninstalling the whole app (or rooting the
device and editing the APK directly).

## What you still need to do

1. **Get the real extension files** — see
   `app/src/main/assets/extensions/parental_whitelist/README_PUT_XPI_CONTENTS_HERE.txt`
   for exact steps (download the `.xpi`, rename to `.zip`, extract,
   drop the contents in that folder). I can't fetch and repackage a
   third party's extension code on your behalf, but it's a two-minute
   job on the tablet with any zip-capable file manager. The add-on is
   MPL-2.0 licensed, so bundling it into your own personal-use app is
   fine license-wise.

2. **Check the GeckoView version** at the top of `app/build.gradle.kts`
   against <https://maven.mozilla.org/?prefix=maven2/org/mozilla/geckoview/geckoview-beta/>
   and update it if a newer one exists — this library updates roughly
   every 4 weeks.

## Getting this onto GitHub from a tablet (no desktop needed)

1. On github.com, create a new **empty** repository (no README, no
   .gitignore — you already have those here).
2. Go to `https://github.dev/YOUR_USERNAME/YOUR_REPO` — this opens a
   full VS Code editor in your tablet's browser, working directly
   against your repo.
3. Drag-and-drop this whole unzipped folder's contents into the
   github.dev file explorer (or create each file/folder and paste
   contents — github.dev supports both).
4. Use the Source Control tab (left sidebar) to commit and push
   directly from the browser. No git command line needed.
5. Go to your repo's **Actions** tab on github.com — the "Build APK"
   workflow should already be running (it triggers on every push to
   `main`), or press "Run workflow" to trigger it manually.
6. When it finishes (a few minutes), open the completed run and
   download the `guardian-browser-debug-apk` artifact from the
   **Artifacts** section at the bottom — it's a `.zip` containing your
   `.apk`.
7. On your Android tablet: extract that zip, tap the `.apk`, allow
   "install unknown apps" for your browser/files app when prompted,
   and install it.

## Testing checklist once it's installed

- Does the app open and load a page at all? (confirms GeckoView itself
  is working)
- Open Logcat (via `adb logcat` from any computer, or a Logcat-reader
  app on the tablet) and search for `GuardianBrowser` — you should see
  either "Parental control extension installed: ..." or a failure
  message telling you exactly why not.
- Try visiting a site that should be blocked and one that should be
  whitelisted, to confirm the extension's actual logic is running
  under GeckoView, not just installed.

## Making it look "Firefox-beautiful" without using Firefox's name/logo

`colors.xml` and `themes.xml` currently use a warm orange + purple
palette in that general spirit. You can't use the word "Firefox" or
the fox logo itself (Mozilla trademark), but the rounded-tab,
warm-gradient *look* is yours to riff on freely — swap colors, icon,
and `ic_launcher.xml` to taste.

## Going further (once the basic build works)

- **Release signing**: right now the workflow builds a debug APK
  (auto-signed, fine for sideloading on your own device). If you want
  updates to install cleanly over time rather than needing
  uninstall/reinstall, you'll eventually want a release keystore
  stored as a GitHub Actions secret — ask me when you get there, it's
  a fairly short addition to the workflow.
- **Address bar auto-updating with the current URL** and a proper tab
  UI are deliberately left out of this starter to keep the first build
  as likely as possible to compile cleanly on the first try. Once this
  base version builds and installs, I'm happy to help layer those on.
