package com.example.spotlockcamera.domain.usecase

import com.example.spotlockcamera.core.image.ImageProcessor
import com.example.spotlockcamera.core.crypto.ImageSigner
import com.example.spotlockcamera.core.storage.ImageStorage
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class CaptureAndSignUseCaseTest {

    // --- Fake Implementations for Testing ---

    private class FakeImageProcessor(val processResultBytes: ByteArray) : ImageProcessor {
        var capturedBytes: ByteArray? = null
        var capturedTimestamp: Long? = null

        override fun process(originalBytes: ByteArray, timestamp: Long): ByteArray {
            capturedBytes = originalBytes
            capturedTimestamp = timestamp
            return processResultBytes
        }
    }

    private class FakeImageSigner(val signedResultBytes: ByteArray) : ImageSigner {
        var capturedBytes: ByteArray? = null
        var capturedTimestamp: Long? = null

        override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray {
            capturedBytes = imageBytes
            capturedTimestamp = timestamp
            return signedResultBytes
        }
    }

    private class FakeImageStorage(var failOnSave: Boolean = false) : ImageStorage {
        var savedBytes: ByteArray? = null
        var savedTimestamp: Long? = null

        override suspend fun save(imageBytes: ByteArray, timestamp: Long): Result<String> {
            if (failOnSave) {
                return Result.failure(IOException("Disk Full"))
            }
            savedBytes = imageBytes
            savedTimestamp = timestamp
            return Result.success("spotlock_${timestamp}.jpg")
        }
    }

    // --- Unit Tests ---

    @Test
    fun execute_success_runsProcessorSignerAndStorageInSequence() = runTest {
        // Given
        val originalData = byteArrayOf(1, 2, 3)
        val processedData = byteArrayOf(4, 5, 6)
        val signedData = byteArrayOf(7, 8, 9)
        val timestamp = 123456789L

        val fakeProcessor = FakeImageProcessor(processedData)
        val fakeSigner = FakeImageSigner(signedData)
        val fakeStorage = FakeImageStorage()

        val useCase = CaptureAndSignUseCase(fakeProcessor, fakeSigner, fakeStorage)

        // When
        val result = useCase.execute(originalData, timestamp)

        // Then
        assertTrue(result.isSuccess)
        assertEquals("spotlock_123456789.jpg", result.getOrNull())

        // Verify sequential calls and data flow
        assertEquals(originalData, fakeProcessor.capturedBytes)
        assertEquals(timestamp, fakeProcessor.capturedTimestamp)

        assertEquals(processedData, fakeSigner.capturedBytes)
        assertEquals(timestamp, fakeSigner.capturedTimestamp)

        assertEquals(signedData, fakeStorage.savedBytes)
        assertEquals(timestamp, fakeStorage.savedTimestamp)
    }

    @Test
    fun execute_storageFailure_returnsFailureResult() = runTest {
        // Given
        val originalData = byteArrayOf(1, 2, 3)
        val timestamp = 123456789L

        val fakeProcessor = FakeImageProcessor(byteArrayOf(4))
        val fakeSigner = FakeImageSigner(byteArrayOf(5))
        val fakeStorage = FakeImageStorage(failOnSave = true) // trigger failure

        val useCase = CaptureAndSignUseCase(fakeProcessor, fakeSigner, fakeStorage)

        // When
        val result = useCase.execute(originalData, timestamp)

        // Then
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IOException)
        assertEquals("Disk Full", result.exceptionOrNull()?.message)
    }

    @Test
    fun execute_signerFailure_returnsFailureResult() = runTest {
        // Given
        val originalData = byteArrayOf(1, 2, 3)
        val timestamp = 123456789L

        val fakeProcessor = FakeImageProcessor(byteArrayOf(4))
        val failingSigner = object : ImageSigner {
            override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray {
                throw IllegalArgumentException("Key error")
            }
        }
        val fakeStorage = FakeImageStorage()

        val useCase = CaptureAndSignUseCase(fakeProcessor, failingSigner, fakeStorage)

        // When
        val result = useCase.execute(originalData, timestamp)

        // Then
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
        assertEquals("Key error", result.exceptionOrNull()?.message)
    }
}
