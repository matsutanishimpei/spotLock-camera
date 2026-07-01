// Configuration: Version mapping to EC P-256 SPKI Public Keys (Hex format)
// In production, this is loaded from VITE_SPOTLOCK_PUBLIC_KEYS environment variable.
let keys = {};
try {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : null;
    const rawKeys = env ? env.VITE_SPOTLOCK_PUBLIC_KEYS : null;
    if (rawKeys) {
        keys = JSON.parse(rawKeys);
    } else {
        // Default local key mapping for development
        keys = {
            1: "3059301306072a8648ce3d020106082a8648ce3d03010703420004427776dd8f0e6d5c6f9b6f675261a27468be0df79e1099985c6a93843555643caabf8aac144411353e9c45d8ec3ee32e813167118c2a682cca434b329bdb5644"
        };
    }
} catch (e) {
    console.error("Failed to parse public keys environment variable:", e);
    keys = {
        1: "3059301306072a8648ce3d020106082a8648ce3d03010703420004427776dd8f0e6d5c6f9b6f675261a27468be0df79e1099985c6a93843555643caabf8aac144411353e9c45d8ec3ee32e813167118c2a682cca434b329bdb5644"
    };
}
export const PUBLIC_KEYS = keys;

/**
 * Verifies a SpotLock JPEG photo file's metadata and cryptographic signature.
 * 
 * @param {File} file The JPEG photo file to verify
 * @returns {Promise<{
 *   version: number,
 *   timestamp: number,
 *   embeddedSigBytes: Uint8Array,
 *   originalBytes: Uint8Array,
 *   isValid: boolean,
 *   cryptoSupported: boolean
 * }>} Verification results
 */
export async function verifySpotLockPhoto(file) {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    let app15Offset = -1;
    let segmentLen = -1;

    for (let i = 0; i <= data.length - 12; i++) {
        if (data[i] === 0xFF && data[i+1] === 0xEF) {
            const length = (data[i+2] << 8) | data[i+3];
            const magic = "SPOTLOCK";
            let magicMatch = true;
            for (let m = 0; m < 8; m++) {
                if (data[i+4+m] !== magic.charCodeAt(m)) {
                    magicMatch = false;
                    break;
                }
            }
            if (magicMatch && i + 2 + length <= data.length) {
                app15Offset = i;
                segmentLen = length;
                break;
            }
        }
    }

    if (app15Offset === -1) {
        throw new Error("この画像には SpotLock の認証情報メタデータ（APP15領域）が含まれていません。");
    }

    const version = data[app15Offset + 12];
    
    let timestamp = 0n;
    for (let j = 0; j < 8; j++) {
        timestamp = (timestamp << 8n) | BigInt(data[app15Offset + 13 + j]);
    }
    timestamp = Number(timestamp); 

    const embeddedSigBytes = data.slice(app15Offset + 21, app15Offset + 85);

    const originalBytes = new Uint8Array(data.length - (2 + segmentLen));
    originalBytes.set(data.subarray(0, app15Offset), 0);
    originalBytes.set(data.subarray(app15Offset + 2 + segmentLen), app15Offset);

    const pubKeyHex = PUBLIC_KEYS[version];
    if (!pubKeyHex) {
        throw new Error(`バージョン v${version} の公開鍵がウェブサイトに登録されていません。`);
    }

    const timestampStrBytes = new TextEncoder().encode(timestamp.toString());
    const combined = new Uint8Array(timestampStrBytes.length + originalBytes.length);
    combined.set(timestampStrBytes, 0);
    combined.set(originalBytes, timestampStrBytes.length);

    let isValid = false;
    let cryptoSupported = true;
    if (window.crypto && window.crypto.subtle) {
        try {
            const pubKeyBuffer = hexToBytes(pubKeyHex);
            const publicKey = await window.crypto.subtle.importKey(
                "spki",
                pubKeyBuffer,
                {
                    name: "ECDSA",
                    namedCurve: "P-256"
                },
                true,
                ["verify"]
            );

            isValid = await window.crypto.subtle.verify(
                {
                    name: "ECDSA",
                    hash: { name: "SHA-256" }
                },
                publicKey,
                embeddedSigBytes,
                combined
            );
        } catch (cryptoErr) {
            console.error("Crypto verification error", cryptoErr);
            isValid = false;
        }
    } else {
        cryptoSupported = false;
    }

    return {
        version,
        timestamp,
        embeddedSigBytes,
        originalBytes,
        isValid,
        cryptoSupported
    };
}

// Helper: convert Uint8Array to hex string
export function toHexString(byteArray) {
    return Array.from(byteArray, byte => {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

// Helper: convert hex string to array buffer
export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
}

// Helper: format relative time
export function getRelativeTimeString(ms) {
    const diff = Date.now() - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}日前`;
    if (hours > 0) return `${hours}時間前`;
    if (minutes > 0) return `${minutes}分前`;
    return 'たった今';
}
