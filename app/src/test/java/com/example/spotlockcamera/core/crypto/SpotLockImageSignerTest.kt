package com.example.spotlockcamera.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey

class SpotLockImageSignerTest {

    // Helper to generate a valid EC P-256 KeyPair dynamically for testing
    private fun generateTestKeyPair(): java.security.KeyPair {
        val keyPairGenerator = KeyPairGenerator.getInstance("EC")
        keyPairGenerator.initialize(256)
        return keyPairGenerator.generateKeyPair()
    }

    @Test
    fun signAndEmbed_validKey_correctlyConstructsApp15MetadataSegment() {
        // Given
        val testKeyPair = generateTestKeyPair()
        val keyProvider = object : PrivateKeyProvider {
            override fun getPrivateKey(): PrivateKey = testKeyPair.private
            override fun getPublicKeyBytes(): ByteArray = testKeyPair.public.encoded
        }
        val signer = SpotLockImageSigner(keyProvider)
        
        // Dummy JPEG: Start with SOI marker (0xFFD8) + some bytes
        val dummyOriginalJpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0x11, 0x22, 0x33, 0x44)
        val timestamp = 1719736800000L // 2026-06-30 approx

        // When
        val result = signer.signAndEmbed(dummyOriginalJpeg, timestamp)

        // Then
        assertNotNull(result)
        // APP15 size payload:
        // [8 Magic] + [1 Ver] + [8 Timestamp] + [2 KeyLen] + [91 PubKey] + [64 Sig] = 174 bytes
        // Header size: 4 bytes (FF EF + 2 bytes length)
        // Result size: original (6) + segment size (174) + header (4) = 184 bytes
        assertEquals(184, result.size)

        // Verify insertion location: should insert after the SOI (offset 2)
        // Check APP15 Marker (FF EF) is inserted at offset 2
        assertEquals(0xFF.toByte(), result[2])
        assertEquals(0xEF.toByte(), result[3])

        // Verify segment length field (176 bytes = 174 payload + 2 length field itself)
        // 176 is 0x00B0
        assertEquals(0x00.toByte(), result[4])
        assertEquals(0xB0.toByte(), result[5])

        // Verify MAGIC "SPOTLOCK" (offsets 6 to 13)
        val magicBytes = result.sliceArray(6..13)
        assertEquals("SPOTLOCK", String(magicBytes, Charsets.US_ASCII))

        // Verify Version byte (offset 14)
        assertEquals(0x02.toByte(), result[14])

        // Verify Timestamp (8 bytes, offsets 15 to 22)
        var parsedTimestamp = 0L
        for (i in 15..22) {
            parsedTimestamp = (parsedTimestamp shl 8) or (result[i].toLong() and 0xFF)
        }
        assertEquals(timestamp, parsedTimestamp)

        // Verify Public Key Length (2 bytes, offsets 23 to 24)
        val parsedKeyLen = ((result[23].toInt() and 0xFF) shl 8) or (result[24].toInt() and 0xFF)
        assertEquals(91, parsedKeyLen)

        // Verify Public Key bytes (offsets 25 to 115)
        val parsedPubKey = result.sliceArray(25..115)
        assertTrue(keyProvider.getPublicKeyBytes().contentEquals(parsedPubKey))

        // Verify Signature portion exists (64 bytes, offsets 116 to 179)
        val signaturePortion = result.sliceArray(116..179)
        assertEquals(64, signaturePortion.size)

        // Verify remaining original bytes are appended back correctly (offsets 180 to 183)
        assertEquals(0x11.toByte(), result[180])
        assertEquals(0x22.toByte(), result[181])
        assertEquals(0x33.toByte(), result[182])
        assertEquals(0x44.toByte(), result[183])
    }

    @Test
    fun signAndEmbed_failingKeyProvider_throwsIllegalArgumentException() {
        // Given
        val failingProvider = object : PrivateKeyProvider {
            override fun getPrivateKey(): PrivateKey {
                throw RuntimeException("KeyStore corrupted")
            }
            override fun getPublicKeyBytes(): ByteArray {
                return byteArrayOf()
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

    @Test
    fun generateIntegrationTestArtifacts() {
        val keyPair = generateTestKeyPair()
        
        val keyProvider = object : PrivateKeyProvider {
            override fun getPrivateKey(): PrivateKey = keyPair.private
            override fun getPublicKeyBytes(): ByteArray = keyPair.public.encoded
        }
        val signer = SpotLockImageSigner(keyProvider)
        
        val dummyOriginalJpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0x11, 0x22, 0x33, 0x44)
        val timestamp = 1719736800000L
        
        val signedBytes = signer.signAndEmbed(dummyOriginalJpeg, timestamp)
        
        val outputDir = java.io.File("build/integration-test-artifacts").apply { mkdirs() }
        
        // Save the signed photo
        java.io.File(outputDir, "test_signed_image.jpg").writeBytes(signedBytes)
        
        // Save the public key in SPKI DER format as Hex
        val pubDer = keyPair.public.encoded
        val pubHex = pubDer.joinToString("") { "%02x".format(it) }
        java.io.File(outputDir, "web_test_public_key.hex").writeText(pubHex)
        
        assertTrue(java.io.File(outputDir, "test_signed_image.jpg").exists())
        assertTrue(java.io.File(outputDir, "web_test_public_key.hex").exists())
    }
}
