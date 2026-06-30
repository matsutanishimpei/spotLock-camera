package com.example.spotlockcamera.core.crypto

import java.io.ByteArrayOutputStream
import java.security.Signature

class SpotLockImageSigner(private val keyProvider: PrivateKeyProvider) : ImageSigner {

    override fun signAndEmbed(imageBytes: ByteArray, timestamp: Long): ByteArray {
        // Guardrail: Validate the private key before passing to crypto signature initializer
        val privateKey = try {
            keyProvider.getPrivateKey()
        } catch (e: Exception) {
            throw IllegalArgumentException("署名用の秘密鍵のインポートに失敗しました。鍵が設定されていないか、形式が不正です。", e)
        }

        val timestampStr = timestamp.toString()
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(timestampStr.toByteArray(Charsets.UTF_8))
        signer.update(imageBytes)
        val derSignature = signer.sign()
        val signature = derToRaw(derSignature)

        // Create APP15 payload
        val payloadStream = ByteArrayOutputStream()
        
        // 8 bytes Magic
        payloadStream.write("SPOTLOCK".toByteArray(Charsets.US_ASCII))
        // 1 byte Version
        payloadStream.write(0x01)
        // 8 bytes Timestamp (Long, Big Endian)
        for (i in 7 downTo 0) {
            payloadStream.write(((timestamp shr (i * 8)) and 0xFF).toInt())
        }
        // 64 bytes Signature
        payloadStream.write(signature)

        val payload = payloadStream.toByteArray()
        val segmentLength = payload.size + 2

        val app15Header = byteArrayOf(
            0xFF.toByte(), 0xEF.toByte(), // APP15 Marker
            ((segmentLength shr 8) and 0xFF).toByte(),
            (segmentLength and 0xFF).toByte()
        )

        val insertIndex = findInsertionIndex(imageBytes)

        val outputStream = ByteArrayOutputStream()
        outputStream.write(imageBytes, 0, insertIndex)
        outputStream.write(app15Header)
        outputStream.write(payload)
        outputStream.write(imageBytes, insertIndex, imageBytes.size - insertIndex)

        return outputStream.toByteArray()
    }

    private fun derToRaw(der: ByteArray): ByteArray {
        val raw = ByteArray(64)
        var offset = 0
        if (der[offset++] != 0x30.toByte()) throw IllegalArgumentException("Invalid DER signature structure")
        val totalLen = der[offset++].toInt() and 0xFF
        
        if (der[offset++] != 0x02.toByte()) throw IllegalArgumentException("Invalid DER signature R marker")
        val rLen = der[offset++].toInt() and 0xFF
        val rBytes = der.sliceArray(offset until offset + rLen)
        offset += rLen
        
        if (der[offset++] != 0x02.toByte()) throw IllegalArgumentException("Invalid DER signature S marker")
        val sLen = der[offset++].toInt() and 0xFF
        val sBytes = der.sliceArray(offset until offset + sLen)
        
        val rStart = if (rLen > 32) rLen - 32 else 0
        val rLength = if (rLen > 32) 32 else rLen
        System.arraycopy(rBytes, rStart, raw, 32 - rLength, rLength)
        
        val sStart = if (sLen > 32) sLen - 32 else 0
        val sLength = if (sLen > 32) 32 else sLen
        System.arraycopy(sBytes, sStart, raw, 64 - sLength, sLength)
        
        return raw
    }

    private fun findInsertionIndex(bytes: ByteArray): Int {
        if (bytes.size < 4 || bytes[0] != 0xFF.toByte() || bytes[1] != 0xD8.toByte()) {
            return 2
        }

        var offset = 2
        if (offset + 4 <= bytes.size && bytes[offset] == 0xFF.toByte()) {
            val marker = bytes[offset + 1].toInt() and 0xFF
            if (marker in 0xE0..0xEF || marker == 0xFE || marker == 0xDB || marker == 0xC0 || marker == 0xC4) {
                val len = ((bytes[offset + 2].toInt() and 0xFF) shl 8) or (bytes[offset + 3].toInt() and 0xFF)
                val nextOffset = offset + 2 + len
                if (nextOffset <= bytes.size) {
                    return nextOffset
                }
            }
        }
        return 2
    }
}
