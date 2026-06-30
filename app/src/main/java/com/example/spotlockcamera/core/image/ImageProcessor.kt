package com.example.spotlockcamera.core.image

interface ImageProcessor {
    /**
     * Processes the image bytes (e.g., drawing visual timestamp overlay).
     *
     * @param originalBytes The raw image bytes.
     * @param timestamp The time in milliseconds to burn on the image.
     * @return The processed image bytes.
     */
    fun process(originalBytes: ByteArray, timestamp: Long): ByteArray
}
