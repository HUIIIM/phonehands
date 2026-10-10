// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

package com.phonehands.helper

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * One-time setup activity: walks the user through the three grants the
 * helper needs, then starts AgentService.
 *
 * 1. Accessibility service — Settings > Accessibility > PhoneHands, toggle on.
 *    (No API exists to enable it programmatically; the user flips the switch.)
 * 2. Screen capture consent — one system dialog, result is held in memory only.
 * 3. Battery optimization whitelist — so Doze doesn't starve the socket.
 *
 * Relay URL + token are typed here and stored in SharedPreferences; the
 * phone then dials OUT to the agent relay (NAT-safe, no port forwarding).
 */
class MainActivity : Activity() {

    companion object {
        private const val REQ_SCREEN_CAPTURE = 1001
    }

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        status = TextView(this)
        val btnA11y = Button(this).apply { text = "1. Enable accessibility service" }
        val btnCapture = Button(this).apply { text = "2. Allow screen capture" }
        val btnBattery = Button(this).apply { text = "3. Disable battery optimization" }
        val btnStart = Button(this).apply { text = "Start agent service" }

        btnA11y.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        btnCapture.setOnClickListener { requestScreenCapture() }
        btnBattery.setOnClickListener { requestBatteryWhitelist() }
        btnStart.setOnClickListener { startAgentServiceWithoutCapture() }

        layout.addView(status)
        layout.addView(btnA11y)
        layout.addView(btnCapture)
        layout.addView(btnBattery)
        layout.addView(btnStart)
        setContentView(layout)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val a11y = isAccessibilityEnabled()
        status.text = "accessibility: ${if (a11y) "ON" else "OFF"}\n" +
            "agent service: ${if (AgentService.running) "RUNNING" else "STOPPED"}"
    }

    private fun isAccessibilityEnabled(): Boolean {
        val expected = "${packageName}/${TouchService::class.java.canonicalName}"
        val enabled = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun requestScreenCapture() {
        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(pm.createScreenCaptureIntent(), REQ_SCREEN_CAPTURE)
    }

    @Deprecated("use Activity Result API in production hardening")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SCREEN_CAPTURE && resultCode == RESULT_OK && data != null) {
            val start = Intent(this, AgentService::class.java).apply {
                action = AgentService.ACTION_START
                putExtra(AgentService.EXTRA_RESULT_CODE, resultCode)
                putExtra(AgentService.EXTRA_CONSENT_DATA, data)
            }
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(start) else startService(start)
            Toast.makeText(this, "agent service started", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "screen capture not granted", Toast.LENGTH_LONG).show()
        }
    }

    private fun startAgentServiceWithoutCapture() {
        // Gestures-only mode: tap/swipe/launch/observe work, no screen stream.
        val start = Intent(this, AgentService::class.java).apply {
            action = AgentService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(start) else startService(start)
        Toast.makeText(this, "agent service started (no screen stream)", Toast.LENGTH_SHORT).show()
    }

    private fun requestBatteryWhitelist() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= 23 && !pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            })
        } else {
            Toast.makeText(this, "already whitelisted", Toast.LENGTH_SHORT).show()
        }
    }
}
