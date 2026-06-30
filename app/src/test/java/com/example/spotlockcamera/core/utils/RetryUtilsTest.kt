package com.example.spotlockcamera.core.utils

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class RetryUtilsTest {

    @Test
    fun retryIO_successFirstTry_executesOnceAndReturns() = runTest {
        var callCount = 0
        val result = RetryUtils.retryIO(times = 3, initialDelay = 1) {
            callCount++
            "Success"
        }

        assertEquals("Success", result)
        assertEquals(1, callCount)
    }

    @Test
    fun retryIO_failsThenSucceeds_retriesAndReturns() = runTest {
        var callCount = 0
        val result = RetryUtils.retryIO(times = 3, initialDelay = 1) {
            callCount++
            if (callCount < 3) {
                throw IOException("Temporary network error")
            }
            "Recovered"
        }

        assertEquals("Recovered", result)
        assertEquals(3, callCount) // Fails twice, succeeds on 3rd
    }

    @Test
    fun retryIO_failsExhaustingRetries_throwsFinalException() = runTest {
        var callCount = 0
        try {
            RetryUtils.retryIO(times = 3, initialDelay = 1) {
                callCount++
                throw IOException("Permanent failure")
            }
            fail("Should have failed")
        } catch (e: IOException) {
            assertEquals("Permanent failure", e.message)
            assertEquals(3, callCount) // Exhausts all 3 attempts
        }
    }
}
