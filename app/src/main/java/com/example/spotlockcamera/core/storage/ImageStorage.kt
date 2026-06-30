package com.example.spotlockcamera.core.storage

interface ImageStorage {
    /**
     * Saves the image bytes and associates them with the given timestamp.
     * Declared as suspend to support non-blocking IO and coroutine-based retries.
     *
     * @param imageBytes The processed and signed image bytes.
     * @param timestamp The creation timestamp.
     * @return A Result containing the identifier or file name of the saved image on success, or an exception on failure.
     */
    suspend fun save(imageBytes: ByteArray, timestamp: Long): Result<String>
}
