package com.example.spotlockcamera

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Composable
fun CameraScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val imageCapture = remember { ImageCapture.Builder().build() }

    var isCapturing by remember { mutableStateOf(false) }

    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    var previewView: PreviewView? by remember { mutableStateOf(null) }

    LaunchedEffect(cameraProviderFuture) {
        val cameraProvider = cameraProviderFuture.get()
        val preview = Preview.Builder().build()
        val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

        try {
            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageCapture
            )
            previewView?.let {
                preview.setSurfaceProvider(it.surfaceProvider)
            }
        } catch (e: Exception) {
            Log.e("CameraScreen", "Use case binding failed", e)
        }
    }

    Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PreviewView(ctx).also {
                    previewView = it
                    // Connect preview once PreviewView is ready
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build()
                        val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                cameraSelector,
                                preview,
                                imageCapture
                            )
                            preview.setSurfaceProvider(it.surfaceProvider)
                        } catch (e: Exception) {
                            Log.e("CameraScreen", "Binding failed in PreviewView factory", e)
                        }
                    }, ContextCompat.getMainExecutor(ctx))
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Title indicator
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 48.dp)
                .background(Color.Black.copy(alpha = 0.6f), shape = CircleShape)
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                text = "spotLock-camera | GPS-free Verification",
                color = Color.White
            )
        }

        // Shutter Button
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 32.dp)
                .size(80.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.4f))
                .border(4.dp, Color.White, CircleShape)
                .clickable(enabled = !isCapturing) {
                    isCapturing = true
                    captureAndSignImage(context, imageCapture, cameraExecutor) {
                        isCapturing = false
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            if (isCapturing) {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(40.dp))
            } else {
                Box(
                    modifier = Modifier
                        .size(60.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                )
            }
        }
    }
}

private fun captureAndSignImage(
    context: Context,
    imageCapture: ImageCapture,
    executor: ExecutorService,
    onComplete: () -> Unit
) {
    imageCapture.takePicture(
        ContextCompat.getMainExecutor(context),
        object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                executor.execute {
                    try {
                        val buffer = image.planes[0].buffer
                        val originalBytes = ByteArray(buffer.remaining())
                        buffer.get(originalBytes)
                        image.close()

                        val timestamp = System.currentTimeMillis()
                        // 1. Generate signature and embed APP15 metadata
                        val signedBytes = JpegSignatureEditor.signAndEmbed(originalBytes, timestamp)

                        // 2. Save signed JPEG to MediaStore
                        saveToMediaStore(context, signedBytes, timestamp)
                    } catch (e: Exception) {
                        Log.e("CameraScreen", "Error signing/saving image", e)
                        ContextCompat.getMainExecutor(context).execute {
                            Toast.makeText(context, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        }
                    } finally {
                        ContextCompat.getMainExecutor(context).execute {
                            onComplete()
                        }
                    }
                }
            }

            override fun onError(exception: androidx.camera.core.ImageCaptureException) {
                Log.e("CameraScreen", "Capture failed", exception)
                Toast.makeText(context, "Capture failed: ${exception.localizedMessage}", Toast.LENGTH_LONG).show()
                onComplete()
            }
        }
    )
}

private fun saveToMediaStore(context: Context, bytes: ByteArray, timestamp: Long) {
    val filename = "spotlock_${timestamp}.jpg"
    val contentValues = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/spotLock-camera")
        }
    }

    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)

    if (uri != null) {
        try {
            resolver.openOutputStream(uri)?.use { outputStream ->
                outputStream.write(bytes)
            }
            ContextCompat.getMainExecutor(context).execute {
                Toast.makeText(context, "Saved & Signed: $filename", Toast.LENGTH_SHORT).show()
            }
        } catch (e: IOException) {
            Log.e("CameraScreen", "Failed to write bytes to URI", e)
            ContextCompat.getMainExecutor(context).execute {
                Toast.makeText(context, "Failed to save file", Toast.LENGTH_LONG).show()
            }
        }
    } else {
        Log.e("CameraScreen", "Failed to insert media row")
        ContextCompat.getMainExecutor(context).execute {
            Toast.makeText(context, "Failed to create MediaStore entry", Toast.LENGTH_LONG).show()
        }
    }
}
