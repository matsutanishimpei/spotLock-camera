package com.example.spotlockcamera

import org.junit.Test
import org.junit.Assert.*
import java.security.MessageDigest

class ExampleUnitTest {

    @Test
    fun addition_isCorrect() {
        assertEquals(4, 2 + 2)
    }

    @Test
    fun testJpegSignatureEmbedding() {
        // Mock a simple JPEG SOI + APP0 segment + some dummy image payload
        val mockJpeg = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(), // SOI
            0xFF.toByte(), 0xE0.toByte(), // APP0
            0x00.toByte(), 0x07.toByte(), // Length = 7
            0x4a.toByte(), 0x46.toByte(), 0x49.toByte(), 0x46.toByte(), 0x00.toByte(), // "JFIF\0"
            0x11.toByte(), 0x22.toByte(), 0x33.toByte() // Dummy body bytes
        )

        val timestamp = 1719163200000L // mock timestamp

        // Execute embedding
        val signedBytes = JpegSignatureEditor.signAndEmbed(mockJpeg, timestamp)

        // Verify result size: original (14) + APP15 header (4) + payload (49) = 67 bytes
        assertEquals(67, signedBytes.size)

        // Verify SOI is preserved
        assertEquals(0xFF.toByte(), signedBytes[0])
        assertEquals(0xD8.toByte(), signedBytes[1])

        // Verify APP0 is preserved
        assertEquals(0xFF.toByte(), signedBytes[2])
        assertEquals(0xE0.toByte(), signedBytes[3])

        // Find APP15 marker (0xFFEF) starting from offset 11 (after SOI + APP0)
        var app15Index = -1
        for (i in 0 until signedBytes.size - 1) {
            if (signedBytes[i] == 0xFF.toByte() && signedBytes[i + 1] == 0xEF.toByte()) {
                app15Index = i
                break
            }
        }

        assertTrue("APP15 marker not found", app15Index != -1)
        assertEquals("APP15 should be inserted after the first segment (offset 11)", 11, app15Index)

        // Verify segment length
        val length = ((signedBytes[app15Index + 2].toInt() and 0xFF) shl 8) or (signedBytes[app15Index + 3].toInt() and 0xFF)
        assertEquals(51, length)

        // Verify magic string "SPOTLOCK"
        val magic = String(signedBytes.copyOfRange(app15Index + 4, app15Index + 12), Charsets.US_ASCII)
        assertEquals("SPOTLOCK", magic)

        // Verify Version
        assertEquals(0x01.toByte(), signedBytes[app15Index + 12])

        // Verify Timestamp
        var extractedTimestamp = 0L
        for (i in 0..7) {
            extractedTimestamp = (extractedTimestamp shl 8) or (signedBytes[app15Index + 13 + i].toLong() and 0xFF)
        }
        assertEquals(timestamp, extractedTimestamp)

        // Verify SHA-256 signature
        val embeddedSignature = signedBytes.copyOfRange(app15Index + 21, app15Index + 53)

        // Reconstruct original bytes from signed bytes
        val reconstructedOriginal = signedBytes.copyOfRange(0, app15Index) + signedBytes.copyOfRange(app15Index + 2 + length, signedBytes.size)
        assertArrayEquals(mockJpeg, reconstructedOriginal)

        // Compute local signature
        val md = MessageDigest.getInstance("SHA-256")
        md.update(JpegSignatureEditor.getSecretKey().toByteArray(Charsets.UTF_8))
        md.update(timestamp.toString().toByteArray(Charsets.UTF_8))
        md.update(mockJpeg)
        val computedSignature = md.digest()

        assertArrayEquals(computedSignature, embeddedSignature)
    }
}