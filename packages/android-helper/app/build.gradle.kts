// SPDX-License-Identifier: BUSL-1.1
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.phonehands.helper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.phonehands.helper"
        minSdk = 26          // dispatchGesture takeScreenshot needs 26+; observe everywhere
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // WebSocket client (phone dials OUT to the relay; no server socket on device)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
