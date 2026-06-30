package com.example.spotlockcamera.core.storage

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import com.example.spotlockcamera.core.utils.RetryUtils.retryIO
import java.io.IOException

class MediaStoreImageStorage(private val context: Context) : ImageStorage {
    override suspend fun save(imageBytes: ByteArray, timestamp: Long): Result<String> {
        // Guardrail: Protect against saving empty/corrupted data
        if (imageBytes.isEmpty()) {
            return Result.failure(IllegalArgumentException("Cannot save an empty image byte array"))
        }

        val filename = "spotlock_${timestamp}.jpg"
        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/spotLock-camera")
            }
        }

        val resolver = context.contentResolver

        // Execute IO operations with coroutine-based exponential backoff retries
        return try {
            val uri = retryIO {
                resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                    ?: throw IOException("Failed to create MediaStore entry (insert failed)")
            }

            retryIO {
                resolver.openOutputStream(uri)?.use { outputStream ->
                    outputStream.write(imageBytes)
                } ?: throw IOException("Failed to open MediaStore output stream")
            }

            Result.success(filename)
        } catch (e: Exception) {
            Log.e("MediaStoreImageStorage", "Failed to write bytes to MediaStore after multiple retries", e)
            Result.failure(e)
        }
    }
}
