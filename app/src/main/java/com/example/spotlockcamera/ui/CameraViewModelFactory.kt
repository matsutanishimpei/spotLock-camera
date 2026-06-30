package com.example.spotlockcamera.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.example.spotlockcamera.core.image.TimestampOverlayProcessor
import com.example.spotlockcamera.core.crypto.SpotLockImageSigner
import com.example.spotlockcamera.core.crypto.BuildConfigPrivateKeyProvider
import com.example.spotlockcamera.core.storage.MediaStoreImageStorage
import com.example.spotlockcamera.domain.usecase.CaptureAndSignUseCase

class CameraViewModelFactory(
    private val context: Context
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(CameraViewModel::class.java)) {
            val keyProvider = BuildConfigPrivateKeyProvider()
            val signer = SpotLockImageSigner(keyProvider)
            val processor = TimestampOverlayProcessor()
            val storage = MediaStoreImageStorage(context.applicationContext)
            val useCase = CaptureAndSignUseCase(processor, signer, storage)

            return CameraViewModel(useCase) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
