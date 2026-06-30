package com.example.spotlockcamera.domain.usecase

import com.example.spotlockcamera.core.image.ImageProcessor
import com.example.spotlockcamera.core.crypto.ImageSigner
import com.example.spotlockcamera.core.storage.ImageStorage

class CaptureAndSignUseCase(
    private val processor: ImageProcessor,
    private val signer: ImageSigner,
    private val storage: ImageStorage
) {
    /**
     * Executes the main business logic flow. Declared as suspend since storage.save is suspendable.
     *
     * @param originalBytes The raw captured image bytes.
     * @param timestamp Milliseconds representation of the capture time.
     * @return Result wrapping the filename/path on success or exception on failure.
     */
    suspend fun execute(originalBytes: ByteArray, timestamp: Long): Result<String> {
        return try {
            val processedBytes = processor.process(originalBytes, timestamp)
            val signedBytes = signer.signAndEmbed(processedBytes, timestamp)
            storage.save(signedBytes, timestamp)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
