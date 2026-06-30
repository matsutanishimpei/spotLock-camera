package com.example.spotlockcamera.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey

class SpotLockImageSignerTest {

    // Helper to generate a valid EC P-256 Private Key dynamically for testing
    private fun generateTestPrivateKey(): PrivateKey {
        val keyPairGenerator = KeyPairGenerator.getInstance("EC")
        keyPairGenerator.initialize(256)
        return keyPairGenerator.generateKeyPair().private
    }

    @Test
    fun signAndEmbed_validKey_correctlyConstructsApp15MetadataSegment() {
        // Given
        val testPrivateKey = generateTestPrivateKey()
        val keyProvider = object : PrivateKeyProvider {
            override fun getPrivateKey(): PrivateKey = testPrivateKey
        }
        val signer = SpotLockImageSigner(keyProvider)
        
        // Dummy JPEG: Start with SOI marker (0xFFD8) + some bytes
        val dummyOriginalJpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0x11, 0x22, 0x33, 0x44)
        val timestamp = 1719736800000L // 2026-06-30 approx

        // When
        val result = signer.signAndEmbed(dummyOriginalJpeg, timestamp)

        // Then
        assertNotNull(result)
        // APP15 size segment: [8 bytes MAGIC] + [1 byte ver] + [8 bytes timestamp] + [64 bytes sig] = 81 bytes
        // Header size: 4 bytes (FF EF + 2 bytes length)
        // Result size should be: original size (6) + segment size (81) + header size (4) = 91 bytes
        assertEquals(91, result.size)

        // Verify insertion location: should insert after the SOI (offset 2)
        // Check APP15 Marker (FF EF) is inserted at offset 2
        assertEquals(0xFF.toByte(), result[2])
        assertEquals(0xEF.toByte(), result[3])

        // Verify segment length field (83 bytes = 81 payload + 2 length field itself)
        // 83 is 0x0053
        assertEquals(0x00.toByte(), result[4])
        assertEquals(0x53.toByte(), result[5])

        // Verify MAGIC "SPOTLOCK" (offsets 6 to 13)
        val magicBytes = result.sliceArray(6..13)
        assertEquals("SPOTLOCK", String(magicBytes, Charsets.US_ASCII))

        // Verify Version byte (offset 14)
        assertEquals(0x01.toByte(), result[14])

        // Verify Timestamp (8 bytes, offsets 15 to 22)
        var parsedTimestamp = 0L
        for (i in 15..22) {
            parsedTimestamp = (parsedTimestamp shl 8) or (result[i].toLong() and 0xFF)
        }
        assertEquals(timestamp, parsedTimestamp)

        // Verify Signature portion exists (64 bytes, offsets 23 to 86)
        val signaturePortion = result.sliceArray(23..86)
        assertEquals(64, signaturePortion.size)

        // Verify remaining original bytes are appended back correctly (offsets 87 to 90)
        assertEquals(0x11.toByte(), result[87])
        assertEquals(0x22.toByte(), result[88])
        assertEquals(0x33.toByte(), result[89])
        assertEquals(0x44.toByte(), result[90])
    }

    @Test
    fun signAndEmbed_failingKeyProvider_throwsIllegalArgumentException() {
        // Given
        val failingProvider = object : PrivateKeyProvider {
            override fun getPrivateKey(): PrivateKey {
                throw RuntimeException("KeyStore corrupted")
            }
        }
        val signer = SpotLockImageSigner(failingProvider)
        val dummyData = byteArrayOf(1, 2, 3)

        // When
        try {
            signer.signAndEmbed(dummyData, 123456789L)
            fail("Should throw IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Then
            assertTrue(e.message?.contains("署名用の秘密鍵のインポートに失敗しました") == true)
            assertEquals("KeyStore corrupted", e.cause?.message)
        }
    }
}
