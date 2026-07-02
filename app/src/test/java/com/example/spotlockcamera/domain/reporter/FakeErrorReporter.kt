package com.example.spotlockcamera.domain.reporter

/**
 * Fake implementation of ErrorReporter to use in unit tests.
 * Captures the last reported error for assertion.
 */
class FakeErrorReporter : ErrorReporter {
    var lastReportedError: Throwable? = null
    var lastReportedMessage: String? = null

    override fun report(throwable: Throwable, message: String?) {
        lastReportedError = throwable
        lastReportedMessage = message
    }

    fun clear() {
        lastReportedError = null
        lastReportedMessage = null
    }
}
