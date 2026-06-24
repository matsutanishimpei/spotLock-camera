package com.example.spotlockcamera

import java.io.ByteArrayOutputStream
import java.security.MessageDigest

object JpegSignatureEditor {

    // Simple obfuscated secret key: "SpotLockSecretKey" represented as bytes
    private val OBFUSCATED_SECRET_KEY = byteArrayOf(
        0x53, 0x70, 0x6f, 0x74, 0x4c, 0x6f, 0x63, 0x6b, // SpotLock
        0x53, 0x65, 0x63, 0x72, 0x65, 0x74, 0x4b, 0x65, 0x79  // SecretKey
    )

    fun getSecretKey(): String {
        return String(OBFUSCATED_SECRET_KEY, Charsets.UTF_8)
    }

    /**
     * Signs the original JPEG bytes and inserts the custom APP15 segment.
     */
    fun signAndEmbed(originalBytes: ByteArray, timestamp: Long): ByteArray {
        // Calculate signature: SHA-256(SecretKey + TimestampString + OriginalBytes)
        val timestampStr = timestamp.toString()
        val md = MessageDigest.getInstance("SHA-256")
        md.update(OBFUSCATED_SECRET_KEY)
        md.update(timestampStr.toByteArray(Charsets.UTF_8))
        md.update(originalBytes)
        val signature = md.digest()

        // Create APP15 payload
        // Format: [8 bytes "SPOTLOCK"] + [1 byte version] + [8 bytes timestamp] + [32 bytes signature]
        val payloadStream = ByteArrayOutputStream()
        
        // 8 bytes Magic
        payloadStream.write("SPOTLOCK".toByteArray(Charsets.US_ASCII))
        // 1 byte Version
        payloadStream.write(0x01)
        // 8 bytes Timestamp (Long, Big Endian)
        for (i in 7 downTo 0) {
            payloadStream.write(((timestamp shr (i * 8)) and 0xFF).toInt())
        }
        // 32 bytes Signature
        payloadStream.write(signature)

        val payload = payloadStream.toByteArray()
        val segmentLength = payload.size + 2 // include the 2 bytes of length field itself

        val app15Header = byteArrayOf(
            0xFF.toByte(), 0xEF.toByte(), // APP15 Marker
            ((segmentLength shr 8) and 0xFF).toByte(),
            (segmentLength and 0xFF).toByte()
        )

        // Find the index to insert our APP15 marker.
        // We want to insert after APP0/APP1 if they exist.
        val insertIndex = findInsertionIndex(originalBytes)

        val outputStream = ByteArrayOutputStream()
        outputStream.write(originalBytes, 0, insertIndex)
        outputStream.write(app15Header)
        outputStream.write(payload)
        outputStream.write(originalBytes, insertIndex, originalBytes.size - insertIndex)

        return outputStream.toByteArray()
    }

    /**
     * Find insertion index for custom segment.
     * We want to insert after the first segment (typically APP0/APP1) to ensure SOI and APP0 remain first.
     */
    private fun findInsertionIndex(bytes: ByteArray): Int {
        if (bytes.size < 4 || bytes[0] != 0xFF.toByte() || bytes[1] != 0xD8.toByte()) {
            return 2 // fallback to right after SOI
        }

        var offset = 2
        // Read first marker
        if (offset + 4 <= bytes.size && bytes[offset] == 0xFF.toByte()) {
            val marker = bytes[offset + 1].toInt() and 0xFF
            // If it is an APP marker (0xE0 - 0xEF) or COM (0xFE), read its length and skip it
            if (marker in 0xE0..0xEF || marker == 0xFE || marker == 0xDB || marker == 0xC0 || marker == 0xC4) {
                val len = ((bytes[offset + 2].toInt() and 0xFF) shl 8) or (bytes[offset + 3].toInt() and 0xFF)
                val nextOffset = offset + 2 + len
                if (nextOffset <= bytes.size) {
                    return nextOffset
                }
            }
        }
        return 2 // fallback
    }
}
