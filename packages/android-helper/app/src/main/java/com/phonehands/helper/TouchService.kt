// SPDX-License-Identifier: BUSL-1.1

package com.phonehands.helper

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Accessibility-based gesture executor.
 *
 * MVP scope: tap + swipe via dispatchGesture. No text input in MVP
 * (type_text arrives in Phase 2); the service deliberately exposes no
 * credential-touching path — authentication screens are pause/resume,
 * the human completes them on the phone (same iron rule as iPhone Use).
 *
 * Lifecycle: enabled by the user in Settings > Accessibility. AgentService
 * holds a static reference; gestures run only while the phone is connected
 * to the agent relay.
 */
class TouchService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: TouchService? = null
            private set

        /** Tap at absolute screen pixels. Returns true if the gesture completed. */
        fun tap(x: Float, y: Float): Boolean {
            val svc = instance ?: return false
            val path = Path().apply { moveTo(x, y) }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
                .build()
            return svc.dispatchSync(gesture, 5_000)
        }

        /** Swipe from (x1,y1) to (x2,y2) over durationMs. */
        fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean {
            val svc = instance ?: return false
            val path = Path().apply {
                moveTo(x1, y1)
                lineTo(x2, y2)
            }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
                .build()
            return svc.dispatchSync(gesture, 10_000)
        }

        /** Dump the active window tree, capped at MAX_NODES. */
        fun dumpTree(): JSONObject {
            val svc = instance
            val nodes = JSONArray()
            var truncated = false
            if (svc != null) {
                val roots = mutableListOf<AccessibilityNodeInfo?>()
                roots.add(svc.rootInActiveWindow)
                val visited = mutableListOf<AccessibilityNodeInfo>()
                try {
                    while (roots.isNotEmpty() && visited.size < MAX_NODES) {
                        val node = roots.removeAt(0) ?: continue
                        visited.add(node)
                        nodes.put(nodeToJson(node))
                        for (i in 0 until node.childCount) {
                            node.getChild(i)?.let { roots.add(it) }
                        }
                    }
                    truncated = roots.isNotEmpty()
                } finally {
                    visited.forEach { runCatching { it.recycle() } }
                }
            }
            return JSONObject()
                .put("nodes", nodes)
                .put("truncated", truncated)
        }

        private const val MAX_NODES = 500

        private fun nodeToJson(node: AccessibilityNodeInfo): JSONObject {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            return JSONObject()
                .put("class", node.className?.toString() ?: "")
                .put("text", node.text?.toString() ?: "")
                .put("content_desc", node.contentDescription?.toString() ?: "")
                .put("bounds", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom)))
                .put("clickable", node.isClickable)
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* not needed for MVP */ }
    override fun onInterrupt() { /* not needed for MVP */ }

    /** dispatchGesture is callback-based; block until done or timeout. */
    private fun dispatchSync(gesture: GestureDescription, timeoutMs: Long): Boolean {
        val latch = CountDownLatch(1)
        val result = BooleanArray(1)
        mainHandler.post {
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    result[0] = true
                    latch.countDown()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    result[0] = false
                    latch.countDown()
                }
            }, null)
        }
        return latch.await(timeoutMs, TimeUnit.MILLISECONDS) && result[0]
    }
}
