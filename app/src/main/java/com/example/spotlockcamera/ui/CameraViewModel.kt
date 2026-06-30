package com.example.spotlockcamera.ui

import androidx.camera.core.ImageProxy
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.spotlockcamera.domain.usecase.CaptureAndSignUseCase
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CameraViewModel(
    private val captureAndSignUseCase: CaptureAndSignUseCase,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {

    private val _uiState = MutableStateFlow(CameraUiState())
    val uiState: StateFlow<CameraUiState> = _uiState.asStateFlow()

    /**
     * Captures, stamps, cryptographically signs, and saves the image asynchronously.
     * Uses Kotlin Coroutines for safe background threading and lifecycle control.
     */
    fun captureAndSign(imageProxy: ImageProxy) {
        _uiState.update { it.copy(isCapturing = true) }

        // viewModelScope ensures this coroutine automatically cancels if the screen/ViewModel is destroyed
        viewModelScope.launch {
            try {
                // Read image bytes on the background thread pool (injected ioDispatcher)
                val originalBytes = withContext(ioDispatcher) {
                    val buffer = imageProxy.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    bytes
                }
                // Close the image resource as soon as we copied the bytes
                imageProxy.close()

                val timestamp = System.currentTimeMillis()

                // Execute the UseCase on the IO dispatcher (database/file writes)
                val result = withContext(ioDispatcher) {
                    captureAndSignUseCase.execute(originalBytes, timestamp)
                }

                // Handle the outcome and update the flow (UI will automatically pick this up on Main thread)
                result.fold(
                    onSuccess = { filename ->
                        _uiState.update {
                            it.copy(
                                isCapturing = false,
                                toastMessage = "Saved & Signed: $filename"
                            )
                        }
                    },
                    onFailure = { e ->
                        _uiState.update {
                            it.copy(
                                isCapturing = false,
                                toastMessage = "Error: ${e.localizedMessage}"
                            )
                        }
                    }
                )
            } catch (e: Exception) {
                imageProxy.close()
                _uiState.update {
                    it.copy(
                        isCapturing = false,
                        toastMessage = "Error: ${e.localizedMessage}"
                    )
                }
            }
        }
    }

    /**
     * Clears the current toast message once it's been consumed/shown in the UI.
     */
    fun clearToastMessage() {
        _uiState.update { it.copy(toastMessage = null) }
    }
}
