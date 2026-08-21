plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------
// GeckoView version pin.
//
// GeckoView ships on the same ~4-week train as Firefox itself, so this
// version string goes stale. Before your first build, check the current
// one here (look for the newest "geckoview-beta" entry):
//   https://maven.mozilla.org/?prefix=maven2/org/mozilla/geckoview/geckoview-beta/
// and paste it in below. The value below was current as of Oct 2025 —
// it will very likely need bumping.
// ---------------------------------------------------------------------
val geckoviewVersion = "145.0.20251017090617"

android {
    namespace = "com.guardian.browser"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.guardian.browser"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    // Mozilla's prebuilt Gecko rendering engine — the same engine Firefox uses.
    implementation("org.mozilla.geckoview:geckoview-beta:$geckoviewVersion")
}
configurations.all {
    resolutionStrategy {
        force("androidx.core:core:1.13.1")
        force("androidx.core:core-ktx:1.13.1")
    }
}
