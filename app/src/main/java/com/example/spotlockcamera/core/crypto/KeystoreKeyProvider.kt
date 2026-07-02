package com.example.spotlockcamera.core.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey

class KeystoreKeyProvider : PrivateKeyProvider {
    private val keyStoreAlias = "spotlock_signing_key"

    init {
        ensureKeyExists()
    }

    override fun getPrivateKey(): PrivateKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return ks.getKey(keyStoreAlias, null) as PrivateKey
    }

    override fun getPublicKeyBytes(): ByteArray {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val cert = ks.getCertificate(keyStoreAlias) ?: throw IllegalStateException("Public key certificate not found in Keystore.")
        return cert.publicKey.encoded
    }

    private fun ensureKeyExists() {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(keyStoreAlias)) {
            val kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore"
            )
            kpg.initialize(
                KeyGenParameterSpec.Builder(
                    keyStoreAlias,
                    KeyProperties.PURPOSE_SIGN
                )
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
            )
            kpg.generateKeyPair()
        }
    }
}
