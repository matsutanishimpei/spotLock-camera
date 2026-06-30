package com.example.spotlockcamera.core.image

interface ImageProcessor {
    /**
     * Processes the image bytes (e.g., drawing visual timestamp overlay).
     *
     * @param originalBytes The raw image bytes.
     * @param timestamp The time in milliseconds to burn on the image.
     * @param rotationDegrees The degrees to rotate the image (0, 90, 180, 270).
     * @return The processed image bytes.
     */
    fun process(originalBytes: ByteArray, timestamp: Long, rotationDegrees: Int = 0): ByteArray
}
