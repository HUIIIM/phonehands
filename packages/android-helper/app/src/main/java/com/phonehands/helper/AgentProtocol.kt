// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

package com.phonehands.helper

import org.json.JSONArray
import org.json.JSONObject

/**
 * JSON wire protocol for the Android device engine (MVP).
 *
 * Agent -> phone (downlink):
 *   { "type": "action", "id": "<uuid>", "action": "tap|swipe|screenshot|launch|observe",
 *     "params": { ... } }
 *   { "type": "ping", "id": "<uuid>" }
 *
 * Phone -> agent (uplink):
 *   { "type": "hello", "device_id": "...", "platform": "android",
 *     "model": "...", "width": 1080, "height": 2400, "density_dpi": 420,
 *     "capabilities": ["tap","swipe","screenshot","launch","observe"],
 *     "token": "<relay auth token or empty>" }
 *   { "type": "ack", "id": "<action id>", "ok": true|false, "latency_ms": 42,
 *     "error": "<message or null>", "data": { ... } | null }
 *   { "type": "frame", "seq": 12, "ts": 16968..., "width": 360, "height": 780,
 *     "format": "jpeg", "jpeg_b64": "<base64 jpeg>" }
 *   { "type": "pong", "id": "<ping id>" }
 *
 * Action params:
 *   tap        { "x": 540, "y": 1200 }               (absolute px)
 *   swipe      { "x1":..,"y1":..,"x2":..,"y2":.., "duration_ms": 300 }
 *   screenshot { }                                    (returns latest frame)
 *   launch     { "package": "com.example.app" }
 *   observe    { }                                    (returns accessibility tree)
 *
 * Ack data:
 *   tap/swipe/launch  -> null
 *   screenshot        -> { "jpeg_b64": "...", "width": 360, "height": 780, "frame_age_ms": 123 }
 *   observe           -> { "nodes": [ { "class": "...", "text": "...",
 *                          "content_desc": "...", "bounds": [l,t,r,b], "clickable": true }, ... ],
 *                          "truncated": false }
 *
 * The "screenshot" action returns the most recent streamed frame rather than
 * triggering a new capture; frame_age_ms lets the agent decide freshness.
 * This is documented in PROTOCOL.md and is intentional: one capture path
 * (MediaProjection) instead of two.
 */
object AgentProtocol {
    const val TYPE_ACTION = "action"
    const val TYPE_HELLO = "hello"
    const val TYPE_ACK = "ack"
    const val TYPE_FRAME = "frame"
    const val TYPE_PING = "ping"
    const val TYPE_PONG = "pong"

    const val ACTION_TAP = "tap"
    const val ACTION_SWIPE = "swipe"
    const val ACTION_SCREENSHOT = "screenshot"
    const val ACTION_LAUNCH = "launch"
    const val ACTION_OBSERVE = "observe"

    val MVP_CAPABILITIES = listOf(
        ACTION_TAP, ACTION_SWIPE, ACTION_SCREENSHOT, ACTION_LAUNCH, ACTION_OBSERVE
    )

    fun hello(
        deviceId: String, model: String, width: Int, height: Int, densityDpi: Int,
        authToken: String,
    ): String = JSONObject()
        .put("type", TYPE_HELLO)
        .put("device_id", deviceId)
        .put("platform", "android")
        .put("model", model)
        .put("width", width)
        .put("height", height)
        .put("density_dpi", densityDpi)
        .put("capabilities", JSONArray(MVP_CAPABILITIES))
        .put("token", authToken)
        .toString()

    fun ack(id: String, ok: Boolean, latencyMs: Long, error: String?, data: JSONObject?): String =
        JSONObject()
            .put("type", TYPE_ACK)
            .put("id", id)
            .put("ok", ok)
            .put("latency_ms", latencyMs)
            .put("error", error ?: JSONObject.NULL)
            .put("data", data ?: JSONObject.NULL)
            .toString()

    fun frame(seq: Long, ts: Long, width: Int, height: Int, jpegBase64: String): String =
        JSONObject()
            .put("type", TYPE_FRAME)
            .put("seq", seq)
            .put("ts", ts)
            .put("width", width)
            .put("height", height)
            .put("format", "jpeg")
            .put("jpeg_b64", jpegBase64)
            .toString()

    fun pong(id: String): String = JSONObject()
        .put("type", TYPE_PONG)
        .put("id", id)
        .toString()
}
