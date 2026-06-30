package com.example.spotlockcamera.core.crypto

import java.security.PrivateKey

interface PrivateKeyProvider {
    /**
     * Retrieves the EC Private Key used for signing SpotLock metadata.
     *
     * @return The EC PrivateKey instance.
     */
    fun getPrivateKey(): PrivateKey
}
