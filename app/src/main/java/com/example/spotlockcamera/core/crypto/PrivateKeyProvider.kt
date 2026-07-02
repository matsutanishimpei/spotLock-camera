package com.example.spotlockcamera.core.crypto

import java.security.PrivateKey

interface PrivateKeyProvider {
    /**
     * Retrieves the EC Private Key used for signing SpotLock metadata.
     *
     * @return The EC PrivateKey instance.
     */
    fun getPrivateKey(): PrivateKey

    /**
     * Retrieves the public key encoded bytes in X.509 SPKI format.
     *
     * @return The byte array of the public key.
     */
    fun getPublicKeyBytes(): ByteArray
}
