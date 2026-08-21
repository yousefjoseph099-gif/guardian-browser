pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Mozilla's Maven repo — this is where the prebuilt GeckoView
        // engine (the actual Firefox rendering engine) lives.
        maven { url = uri("https://maven.mozilla.org/maven2/") }
    }
}

rootProject.name = "GuardianBrowser"
include(":app")
