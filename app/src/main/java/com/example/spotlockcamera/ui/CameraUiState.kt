package com.example.spotlockcamera.ui

/**
 * UI State representation for the Camera Screen.
 */
data class CameraUiState(
    val isCapturing: Boolean = false,
    val toastMessage: String? = null
)
