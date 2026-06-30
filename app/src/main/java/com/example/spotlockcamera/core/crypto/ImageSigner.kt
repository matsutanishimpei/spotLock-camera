package com.example.spotlockcamera.core.crypto

interface ImageSigner {
    /**
     * Signs the image bytes and embeds custom metadata segment (e.g. APP15).
     *
     * @param imageBytes The raw image bytes.
     * @param timestamp The time in milliseconds.
     * @return The signed image bytes containing embedded metadata.
     */
    fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray
}
