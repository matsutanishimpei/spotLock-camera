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
        val uri = try {
            retryIO {
                resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                    ?: throw IOException("Failed to create MediaStore entry (insert failed)")
            }
        } catch (e: Exception) {
            Log.e("MediaStoreImageStorage", "Failed to create MediaStore entry after multiple retries", e)
            return Result.failure(e)
        }

        return try {
            retryIO {
                resolver.openOutputStream(uri)?.use { outputStream ->
                    outputStream.write(imageBytes)
                } ?: throw IOException("Failed to open MediaStore output stream")
            }

            Result.success(filename)
        } catch (e: Exception) {
            // Clean up the orphaned MediaStore entry created by the successful insert
            try {
                resolver.delete(uri, null, null)
            } catch (cleanupErr: Exception) {
                Log.w("MediaStoreImageStorage", "Failed to clean up orphaned MediaStore entry", cleanupErr)
            }
            Log.e("MediaStoreImageStorage", "Failed to write bytes to MediaStore after multiple retries", e)
            Result.failure(e)
        }
    }
}
