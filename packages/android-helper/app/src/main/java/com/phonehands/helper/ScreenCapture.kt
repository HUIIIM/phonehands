// SPDX-License-Identifier: BUSL-1.1

package com.phonehands.helper

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicLong

/**
 * Screen streaming via MediaProjection + ImageReader.
 *
 * One capture path serves both the continuous frame stream and the
 * "screenshot" action: the stream pushes ~1 fps downscaled JPEG frames;
 * screenshot replies with the most recent frame plus its age. This keeps
 * the phone side to a single code path (less to keep alive, less battery).
 *
 * Honest limitations (documented in docs/android-deploy.md):
 *  - The MediaProjection consent token dies with the process and on reboot;
 *    the user must re-authorize screen capture after every restart. There is
 *    no legitimate way to persist it.
 *  - Doze/battery optimization can starve the foreground service; the deploy
 *    doc walks through the battery whitelist.
 */
class ScreenCapture(
    private val projectionManager: MediaProjectionManager,
    private val resultCode: Int,
    private val consentData: android.content.Intent,
    private val onFrame: (jpegBase64: String, width: Int, height: Int) -> Unit,
) {
    companion object {
        /** Downscale target: keep frames small enough for 1 fps over a relay. */
        private const val STREAM_WIDTH = 360
        private const val JPEG_QUALITY = 55
        /** ~1 fps: fast enough for observe-loops, cheap enough for battery. */
        private const val FRAME_INTERVAL_MS = 1_000L
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var running = false
    private val seq = AtomicLong(0)
    private var lastEmit = 0L

    /** The most recent frame, for the "screenshot" action. */
    @Volatile
    var latestFrame: LatestFrame? = null
        private set

    data class LatestFrame(
        val jpegBase64: String,
        val width: Int,
        val height: Int,
        val ts: Long,
    )

    fun start(displayWidth: Int, displayHeight: Int, densityDpi: Int) {
        if (running) return
        running = true
        mediaProjection = projectionManager.getMediaProjection(resultCode, consentData)
        val scale = STREAM_WIDTH.toFloat() / displayWidth
        val w = STREAM_WIDTH
        val h = (displayHeight * scale).toInt().coerceAtLeast(1)
        imageReader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        imageReader!!.setOnImageAvailableListener({ reader ->
            val image = runCatching { reader.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
            try {
                val now = System.currentTimeMillis()
                if (now - lastEmit < FRAME_INTERVAL_MS) return@setOnImageAvailableListener
                lastEmit = now
                val plane = image.planes[0]
                val buffer = plane.buffer
                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * w
                // Copy with row padding, then crop to the real width.
                val bitmap = Bitmap.createBitmap(
                    w + rowPadding / pixelStride, h, Bitmap.Config.ARGB_8888
                )
                bitmap.copyPixelsFromBuffer(buffer)
                val cropped = Bitmap.createBitmap(bitmap, 0, 0, w, h)
                bitmap.recycle()
                val b64 = bitmapToJpegBase64(cropped)
                cropped.recycle()
                latestFrame = LatestFrame(b64, w, h, now)
                onFrame(b64, w, h)
                seq.incrementAndGet()
            } finally {
                image.close()
            }
        }, null)
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "phonehands-screen",
            w, h, densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, null
        )
    }

    fun stop() {
        running = false
        runCatching { virtualDisplay?.release() }
        runCatching { imageReader?.close() }
        runCatching { mediaProjection?.stop() }
        virtualDisplay = null
        imageReader = null
        mediaProjection = null
    }

    private fun bitmapToJpegBase64(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
