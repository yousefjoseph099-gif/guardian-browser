HOW TO ADD THE REAL EXTENSION FILES
====================================

This folder needs to contain the *unpacked contents* of the
"Parental Whitelist Control" extension (manifest.json, its .js files,
icons, etc.) sitting directly inside this folder.

Steps:

1. Download the .xpi file directly from Mozilla (this is the real
   package file behind the "Download file" button on the add-on page):

   https://addons.mozilla.org/firefox/downloads/file/4724939/parental_whitelist_control-1.6.0.xpi

   (If that link ever goes stale, go to the add-on page and use its
   "Download file" link instead:
   https://addons.mozilla.org/en-US/firefox/addon/parental-whitelist-control/ )

2. An .xpi file IS a .zip file, just renamed. Rename the downloaded
   file's extension from .xpi to .zip, then extract/unzip it. Most
   phone/tablet file managers (Files by Google, ZArchiver, etc.) can
   do this directly.

3. Copy everything that comes out of that zip (manifest.json and
   whatever sits alongside it) directly into THIS folder
   (app/src/main/assets/extensions/parental_whitelist/), so that
   manifest.json ends up at:

     app/src/main/assets/extensions/parental_whitelist/manifest.json

4. Delete this placeholder .txt file once the real files are in place.

5. Commit and push. The GitHub Actions workflow will build an APK with
   the extension baked permanently into it (see MainActivity.kt for how
   it's loaded via installBuiltIn(), and the project README.md at the
   repo root for the full picture).

A NOTE ON WHETHER IT WILL WORK PERFECTLY:
This extension was built for desktop Firefox. GeckoView (the Android
engine) supports a large subset of the same WebExtension APIs the
extension uses (tabs, webNavigation, notifications, storage), but not
100% of desktop's UI surface — for example, its toolbar popup/icon may
not appear the way it does on desktop, since this app doesn't build a
full extension-toolbar UI. The blocking/whitelist logic itself (which
is what matters) uses webNavigation + tabs, which GeckoView does
support, so that's the part most likely to keep working. Build early,
install the debug APK, and actually test it against a few sites before
you invest more time refining the UI around it.
