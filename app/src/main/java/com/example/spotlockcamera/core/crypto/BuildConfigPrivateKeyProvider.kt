package com.example.spotlockcamera.core.crypto

import android.util.Base64
import com.example.spotlockcamera.BuildConfig
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.spec.PKCS8EncodedKeySpec

class BuildConfigPrivateKeyProvider : PrivateKeyProvider {
    override fun getPrivateKey(): PrivateKey {
        val keyBytes = Base64.decode(BuildConfig.SPOTLOCK_PRIVATE_KEY, Base64.DEFAULT)
        val spec = PKCS8EncodedKeySpec(keyBytes)
        val kf = KeyFactory.getInstance("EC")
        return kf.generatePrivate(spec)
    }
}
