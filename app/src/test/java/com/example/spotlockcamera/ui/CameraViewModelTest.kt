package com.example.spotlockcamera.ui

import androidx.camera.core.ImageProxy
import com.example.spotlockcamera.core.image.ImageProcessor
import com.example.spotlockcamera.core.crypto.ImageSigner
import com.example.spotlockcamera.core.storage.ImageStorage
import com.example.spotlockcamera.domain.usecase.CaptureAndSignUseCase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.lang.reflect.Proxy

@OptIn(ExperimentalCoroutinesApi::class)
class CameraViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // --- Fake Components ---

    private class FakeImageStorage(var fail: Boolean = false) : ImageStorage {
        override suspend fun save(imageBytes: ByteArray, timestamp: Long): Result<String> {
            return if (fail) {
                Result.failure(IOException("Storage Full"))
            } else {
                Result.success("stamped_test.jpg")
            }
        }
    }

    private fun createFakeImageProxy(
        bytes: ByteArray,
        rotationDegrees: Int = 0,
        onClose: () -> Unit = {}
    ): ImageProxy {
        val plane = object : ImageProxy.PlaneProxy {
            override fun getBuffer(): java.nio.ByteBuffer = java.nio.ByteBuffer.wrap(bytes)
            override fun getRowStride(): Int = 0
            override fun getPixelStride(): Int = 0
        }

        val imageInfo = Proxy.newProxyInstance(
            androidx.camera.core.ImageInfo::class.java.classLoader,
            arrayOf(androidx.camera.core.ImageInfo::class.java)
        ) { _, method, _ ->
            when (method.name) {
                "getRotationDegrees" -> rotationDegrees
                else -> 0
            }
        } as androidx.camera.core.ImageInfo

        return Proxy.newProxyInstance(
            ImageProxy::class.java.classLoader,
            arrayOf(ImageProxy::class.java)
        ) { _, method, _ ->
            when (method.name) {
                "getPlanes" -> arrayOf(plane)
                "getImageInfo" -> imageInfo
                "close" -> {
                    onClose()
                    null
                }
                else -> null
            }
        } as ImageProxy
    }

    // --- Unit Tests ---

    @Test
    fun captureAndSign_success_savesImageAndSetsToastMessage() = runTest {
        // Given
        val processor = object : ImageProcessor {
            override fun process(originalBytes: ByteArray, timestamp: Long, rotationDegrees: Int): ByteArray = originalBytes
        }
        val signer = object : ImageSigner {
            override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray = imageBytes
        }
        val storage = FakeImageStorage()
        val useCase = CaptureAndSignUseCase(processor, signer, storage)
        // Inject testDispatcher as ioDispatcher for synchronous execution in tests
        val viewModel = CameraViewModel(useCase, testDispatcher)

        var isClosed = false
        val imageProxy = createFakeImageProxy(byteArrayOf(1, 2, 3), rotationDegrees = 90, onClose = {
            isClosed = true
        })

        // When
        viewModel.captureAndSign(imageProxy)

        // Then
        assertTrue(isClosed)
        assertFalse(viewModel.uiState.value.isCapturing)
        assertEquals("Saved & Signed: stamped_test.jpg", viewModel.uiState.value.toastMessage)
    }

    @Test
    fun captureAndSign_failure_closesImageProxyAndSetsErrorToast() = runTest {
        // Given
        val processor = object : ImageProcessor {
            override fun process(originalBytes: ByteArray, timestamp: Long, rotationDegrees: Int): ByteArray = originalBytes
        }
        val signer = object : ImageSigner {
            override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray = imageBytes
        }
        val failingStorage = FakeImageStorage(fail = true)
        val useCase = CaptureAndSignUseCase(processor, signer, failingStorage)
        val viewModel = CameraViewModel(useCase, testDispatcher)

        var isClosed = false
        val imageProxy = createFakeImageProxy(byteArrayOf(1, 2, 3), rotationDegrees = 90, onClose = {
            isClosed = true
        })

        // When
        viewModel.captureAndSign(imageProxy)

        // Then
        assertTrue(isClosed)
        assertFalse(viewModel.uiState.value.isCapturing)
        assertEquals("Error: Storage Full", viewModel.uiState.value.toastMessage)
    }

    @Test
    fun clearToastMessage_resetsToastToNull() = runTest {
        // Given
        val useCase = CaptureAndSignUseCase(
            object : ImageProcessor { override fun process(originalBytes: ByteArray, timestamp: Long, rotationDegrees: Int) = originalBytes },
            object : ImageSigner { override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long) = imageBytes },
            FakeImageStorage()
        )
        val viewModel = CameraViewModel(useCase, testDispatcher)
        val imageProxy = createFakeImageProxy(byteArrayOf(1))
        viewModel.captureAndSign(imageProxy)

        // Precondition
        assertEquals("Saved & Signed: stamped_test.jpg", viewModel.uiState.value.toastMessage)

        // When
        viewModel.clearToastMessage()

        // Then
        assertNull(viewModel.uiState.value.toastMessage)
    }
}
