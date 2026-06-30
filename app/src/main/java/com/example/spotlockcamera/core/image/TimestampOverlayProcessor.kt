package com.example.spotlockcamera.core.image

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class TimestampOverlayProcessor : ImageProcessor {
    override fun process(originalBytes: ByteArray, timestamp: Long, rotationDegrees: Int): ByteArray {
        try {
            // Guardrail: Protect against empty bytes
            if (originalBytes.isEmpty()) return originalBytes

            val bitmap = BitmapFactory.decodeByteArray(originalBytes, 0, originalBytes.size) ?: return originalBytes
            
            // Rotate the bitmap if rotationDegrees is non-zero, ensuring the result is mutable
            val mutableBitmap = if (rotationDegrees != 0) {
                val matrix = android.graphics.Matrix().apply { postRotate(rotationDegrees.toFloat()) }
                val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                bitmap.recycle()
                val mutable = rotated.copy(Bitmap.Config.ARGB_8888, true)
                rotated.recycle()
                mutable
            } else {
                val mutable = bitmap.copy(Bitmap.Config.ARGB_8888, true)
                bitmap.recycle()
                mutable
            }

            val canvas = Canvas(mutableBitmap)
            
            // Setup Paint for retro orange timestamp text
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(255, 140, 0) // Classic film stamp orange
                textSize = mutableBitmap.width / 22f // Scale text size (approx 4.5% of width)
                style = Paint.Style.FILL
                isFakeBoldText = true
                // slight drop shadow for contrast
                setShadowLayer(3f, 2f, 2f, android.graphics.Color.BLACK)
            }

            // Fixed US locale to avoid regional calendar discrepancies (e.g. Buddhist calendar in Thai locales)
            val sdf = SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.US)
            val text = sdf.format(Date(timestamp))

            val bounds = Rect()
            paint.getTextBounds(text, 0, text.length, bounds)

            // Margin from bottom-right corner (approx 4% of dimensions)
            val marginX = mutableBitmap.width * 0.04f
            val marginY = mutableBitmap.height * 0.04f

            val x = mutableBitmap.width - bounds.width() - marginX
            val y = mutableBitmap.height - marginY

            // Draw shadow/background container for maximum readability
            val bgPaint = Paint().apply {
                color = android.graphics.Color.BLACK
                alpha = 90 // semi-transparent black
            }
            val padding = paint.textSize * 0.15f
            canvas.drawRect(
                x - padding,
                y - bounds.height() - padding,
                x + bounds.width() + padding,
                y + padding,
                bgPaint
            )

            canvas.drawText(text, x, y, paint)

            val stream = ByteArrayOutputStream()
            mutableBitmap.compress(Bitmap.CompressFormat.JPEG, 92, stream)
            val stampedBytes = stream.toByteArray()
            mutableBitmap.recycle()
            return stampedBytes
        } catch (oom: OutOfMemoryError) {
            // Guardrail: Fallback to original image in case of memory exhaustion
            Log.e("TimestampOverlayProc", "Out of memory while creating timestamp overlay, falling back to original", oom)
            System.gc()
            return originalBytes
        } catch (e: Exception) {
            // Guardrail: Fallback to original image if processing fails (e.g. invalid JPEG bytes)
            Log.e("TimestampOverlayProc", "Failed to draw timestamp overlay, falling back to original", e)
            return originalBytes
        }
    }
}
