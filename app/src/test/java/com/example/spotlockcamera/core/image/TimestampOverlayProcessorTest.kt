package com.example.spotlockcamera.core.image

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class TimestampOverlayProcessorTest {

    @Test
    fun process_emptyBytes_returnsEmptyBytesWithoutCrashing() {
        val processor = TimestampOverlayProcessor()
        val original = ByteArray(0)
        
        val result = processor.process(original, 123456789L)
        
        assertEquals(0, result.size)
        assertArrayEquals(original, result)
    }

    @Test
    fun process_invalidJpegBytes_fallsBackAndReturnsOriginalBytes() {
        val processor = TimestampOverlayProcessor()
        val original = "INVALID JPEG DATA".toByteArray()
        
        val result = processor.process(original, 123456789L)
        
        assertArrayEquals(original, result)
    }
}
