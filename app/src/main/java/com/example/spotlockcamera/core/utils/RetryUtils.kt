package com.example.spotlockcamera.core.utils

import kotlinx.coroutines.delay
import java.io.IOException

object RetryUtils {
    /**
     * Retries a suspendable block of code (typically IO-related) multiple times
     * with an exponential backoff delay.
     *
     * @param times Max number of attempts.
     * @param initialDelay Initial delay in milliseconds.
     * @param factor Multiplying factor for next delay.
     * @param block The suspendable block of code to run.
     * @return Result of the block.
     */
    suspend fun <T> retryIO(
        times: Int = 3,
        initialDelay: Long = 100,
        factor: Double = 2.0,
        block: suspend () -> T
    ): T {
        var currentDelay = initialDelay
        repeat(times - 1) {
            try {
                return block()
            } catch (e: IOException) {
                delay(currentDelay)
                currentDelay = (currentDelay * factor).toLong()
            }
        }
        return block() // Last attempt
    }
}
