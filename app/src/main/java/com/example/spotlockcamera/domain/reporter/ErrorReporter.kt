package com.example.spotlockcamera.domain.reporter

/**
 * Interface to track and report non-fatal errors or system exceptions.
 * Abstracts error reporting SDKs (like Firebase Crashlytics) from the core domain logic.
 */
interface ErrorReporter {
    /**
     * Reports an error/exception to the tracking console.
     *
     * @param throwable The exception or throwable to report.
     * @param message An optional context message to log along with the exception.
     */
    fun report(throwable: Throwable, message: String? = null)
}
