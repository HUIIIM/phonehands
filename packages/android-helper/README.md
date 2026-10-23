# phonehands-android-helper (APK)

<!-- SPDX-License-Identifier: BUSL-1.1 -->

Kotlin companion app for the Android device engine. Runs on the phone,
dials **out** to the agent relay, executes gestures via `AccessibilityService`,
streams the screen via `MediaProjection`.

## Build

Requires Android SDK 34 + AGP 8.x (Kotlin 1.9.24). **Not yet verified** —
this machine has no Android SDK; compilation moves to CI in Phase 2.

```bash
cd packages/android-helper
./gradlew :app:assembleDebug   # needs ANDROID_HOME / Android SDK
```

## What's inside

| File | Role |
|---|---|
| `AgentProtocol.kt` | JSON wire codec (mirrors `PROTOCOL.md`) |
| `TouchService.kt` | `AccessibilityService`: `dispatchGesture` tap/swipe; accessibility tree dump |
| `ScreenCapture.kt` | `MediaProjection` + `ImageReader` → 360px JPEG @ ~1fps |
| `AgentService.kt` | foreground service: WebSocket client, hello/auth, reconnect backoff, action dispatch |
| `MainActivity.kt` | 4-step setup UI (accessibility / screen capture / battery whitelist / start) |
| `RelayConfig.kt` | relay URL + token persistence (`SharedPreferences`) |

MVP scope: `tap`, `swipe`, `screenshot`, `launch`, `observe`.
No text input in MVP — auth screens are pause/resume (human completes them
on the phone; the APK never receives credentials).

## Permissions (why each one)

| Permission | Why |
|---|---|
| `BIND_ACCESSIBILITY_SERVICE` | tap/swipe via `dispatchGesture` |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | keep the screen stream alive (Android 14+) |
| `INTERNET` | WebSocket to the relay |
| `POST_NOTIFICATIONS` | foreground-service notification (Android 13+) |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | ask for the Doze whitelist |
| `WAKE_LOCK` | partial wake lock while streaming |

Full deploy guide (Chinese): `../../docs/android-deploy.md`.
Wire protocol: `PROTOCOL.md`.
