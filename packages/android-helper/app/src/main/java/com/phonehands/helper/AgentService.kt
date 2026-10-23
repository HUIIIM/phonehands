// SPDX-License-Identifier: BUSL-1.1

package com.phonehands.helper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Foreground service: the phone's side of the relay.
 *
 * Direction is phone -> agent: the phone opens the WebSocket to the relay
 * URL itself, so the phone can sit behind NAT / on mobile data with no port
 * forwarding, no same-LAN requirement, no USB. That is the "true wireless"
 * Android unlocks (iOS cannot do this: no background daemon in the sandbox).
 *
 * Reconnect: exponential backoff (2s -> 60s cap), same device_id across
 * reconnects so the agent dedupes instead of double-counting the device.
 *
 * Auth: optional relay token in hello; the server rejects mismatched
 * tokens. The token is never logged (only its presence/absence is logged).
 *
 * The service owns ScreenCapture; MediaProjection consent (resultCode +
 * intent data) arrives from MainActivity and is held only in memory —
 * Android does not allow persisting it, so after process death or reboot
 * the user re-authorizes once. Documented honestly in docs/android-deploy.md.
 */
class AgentService : Service() {

    companion object {
        const val ACTION_START = "com.phonehands.helper.START"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_CONSENT_DATA = "consent_data"
        const val PREFS = "phonehands"
        const val KEY_RELAY_URL = "relay_url"
        const val KEY_TOKEN = "relay_token"
        const val KEY_DEVICE_ID = "device_id"
        const val DEFAULT_RELAY_URL = "ws://127.0.0.1:9011/phonehands-android"

        @Volatile
        var running = false
            private set
    }

    private val io = Executors.newSingleThreadExecutor()
    private var ws: WebSocket? = null
    private var screenCapture: ScreenCapture? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val frameSeq = AtomicLong(0)
    private var deviceId: String = ""
    private var relayUrl: String = DEFAULT_RELAY_URL
    private var authToken: String = ""
    @Volatile
    private var stopRequested = false

    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived socket
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        deviceId = prefs.getString(KEY_DEVICE_ID, null)
            ?: UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_DEVICE_ID, it).apply()
            }
        relayUrl = prefs.getString(KEY_RELAY_URL, DEFAULT_RELAY_URL) ?: DEFAULT_RELAY_URL
        authToken = prefs.getString(KEY_TOKEN, "") ?: ""
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_START) {
            startForegroundCompat()
            acquireWakeLock()
            stopRequested = false
            val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
            val consentData: Intent? =
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_CONSENT_DATA, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_CONSENT_DATA)
            io.execute {
                if (resultCode != -1 && consentData != null) startScreenCapture(resultCode, consentData)
                connectLoop()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopRequested = true
        runCatching { ws?.close(1000, "service destroyed") }
        runCatching { screenCapture?.stop() }
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        io.shutdownNow()
        running = false
        super.onDestroy()
    }

    // ------------------------------------------------------------------ wire

    private fun connectLoop() {
        var backoffMs = 2_000L
        while (!stopRequested) {
            val connected = connectOnce()
            if (stopRequested) return
            if (!connected) {
                try { Thread.sleep(backoffMs) } catch (_: InterruptedException) { return }
                backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            } else {
                backoffMs = 2_000L // reset after a successful session ends
            }
        }
    }

    private fun connectOnce(): Boolean {
        val done = java.util.concurrent.CountDownLatch(1)
        val ok = BooleanArray(1)
        val request = Request.Builder().url(relayUrl).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                sendHello(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(webSocket, text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                done.countDown()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                ok[0] = false
                done.countDown()
            }
        })
        // Consider the session "connected" once hello is acked; simplified:
        // treat socket open as success and let the loop re-enter on close.
        ok[0] = true
        done.await(24, TimeUnit.HOURS)
        return ok[0]
    }

    private fun sendHello(socket: WebSocket) {
        val metrics = currentDisplayMetrics()
        socket.send(
            AgentProtocol.hello(
                deviceId = deviceId,
                model = "${Build.MANUFACTURER} ${Build.MODEL}",
                width = metrics.first,
                height = metrics.second,
                densityDpi = resources.displayMetrics.densityDpi,
                authToken = authToken,
            )
        )
    }

    private fun handleMessage(socket: WebSocket, text: String) {
        val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (msg.optString("type")) {
            AgentProtocol.TYPE_PING -> socket.send(AgentProtocol.pong(msg.optString("id")))
            AgentProtocol.TYPE_ACTION -> {
                val id = msg.optString("id")
                val action = msg.optString("action")
                val params = msg.optJSONObject("params") ?: JSONObject()
                val started = System.currentTimeMillis()
                io.execute {
                    val (ok, error, data) = runAction(action, params)
                    socket.send(
                        AgentProtocol.ack(
                            id, ok, System.currentTimeMillis() - started, error, data
                        )
                    )
                }
            }
        }
    }

    private fun runAction(action: String, params: JSONObject): Triple<Boolean, String?, JSONObject?> {
        return try {
            when (action) {
                AgentProtocol.ACTION_TAP -> {
                    val ok = TouchService.tap(
                        params.getDouble("x").toFloat(),
                        params.getDouble("y").toFloat(),
                    )
                    Triple(ok, if (ok) null else "gesture failed or accessibility service not enabled", null)
                }
                AgentProtocol.ACTION_SWIPE -> {
                    val ok = TouchService.swipe(
                        params.getDouble("x1").toFloat(), params.getDouble("y1").toFloat(),
                        params.getDouble("x2").toFloat(), params.getDouble("y2").toFloat(),
                        params.optLong("duration_ms", 300),
                    )
                    Triple(ok, if (ok) null else "gesture failed or accessibility service not enabled", null)
                }
                AgentProtocol.ACTION_LAUNCH -> {
                    val pkg = params.optString("package")
                    if (pkg.isBlank()) return Triple(false, "missing package param", null)
                    val launchIntent = packageManager.getLaunchIntentForPackage(pkg)
                        ?: return Triple(false, "no launch intent for package", null)
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(launchIntent)
                    Triple(true, null, null)
                }
                AgentProtocol.ACTION_OBSERVE -> {
                    val tree = TouchService.dumpTree()
                    Triple(true, null, tree)
                }
                AgentProtocol.ACTION_SCREENSHOT -> {
                    val frame = screenCapture?.latestFrame
                        ?: return Triple(false, "screen capture not running (re-authorize screen capture)", null)
                    val data = JSONObject()
                        .put("jpeg_b64", frame.jpegBase64)
                        .put("width", frame.width)
                        .put("height", frame.height)
                        .put("frame_age_ms", System.currentTimeMillis() - frame.ts)
                    Triple(true, null, data)
                }
                else -> Triple(false, "unknown action: $action", null)
            }
        } catch (e: Exception) {
            Triple(false, "exception: ${e.javaClass.simpleName}", null)
        }
    }

    // -------------------------------------------------------------- capture

    private fun startScreenCapture(resultCode: Int, consentData: Intent) {
        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val metrics = currentDisplayMetrics()
        screenCapture = ScreenCapture(pm, resultCode, consentData) { b64, w, h ->
            val socket = ws ?: return@ScreenCapture
            socket.send(
                AgentProtocol.frame(
                    frameSeq.incrementAndGet(),
                    System.currentTimeMillis(), w, h, b64
                )
            )
        }
        screenCapture!!.start(metrics.first, metrics.second, resources.displayMetrics.densityDpi)
    }

    // ----------------------------------------------------------------- misc

    private fun currentDisplayMetrics(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "phonehands-agent"
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "phonehands agent", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification: Notification = if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, channelId)
                .setContentTitle("phonehands agent running")
                .setContentText("Phone is connected to your agent relay.")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("phonehands agent running")
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .build()
        }
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                1, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(1, notification)
        }
        running = true
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "phonehands:agent").apply {
            setReferenceCounted(false)
            acquire(12 * 60 * 60 * 1000L) // 12h; service restarts re-acquire
        }
    }
}

/** Convenience: how the relay URL is configured (env-driven on the agent side). */
fun relayUrlFromEnv(): String =
    System.getenv("PHONEHANDS_RELAY_URL") ?: AgentService.DEFAULT_RELAY_URL
