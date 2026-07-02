package com.example.spotlockcamera.infrastructure.reporter

import com.example.spotlockcamera.domain.reporter.ErrorReporter
import com.google.firebase.Firebase
import com.google.firebase.crashlytics.crashlytics

/**
 * Concrete implementation of ErrorReporter utilizing Firebase Crashlytics SDK.
 * Reports issues as non-fatal exceptions in the Firebase Console.
 */
class FirebaseErrorReporter : ErrorReporter {
    override fun report(throwable: Throwable, message: String?) {
        message?.let {
            Firebase.crashlytics.log(it)
        }
        Firebase.crashlytics.recordException(throwable)
    }
}
