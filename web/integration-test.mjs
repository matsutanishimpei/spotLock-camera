import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifySpotLockPhoto, PUBLIC_KEYS } from './src/utils/crypto.js';

// Setup window.crypto mock for Node.js Web Crypto compatibility
import { webcrypto } from 'crypto';
globalThis.window = { crypto: webcrypto };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    console.log("Starting Web signature verification integration test...");

    const artifactDir = path.resolve(__dirname, '../app/build/integration-test-artifacts');
    const imagePath = path.resolve(artifactDir, 'test_signed_image.jpg');
    const pubKeyPath = path.resolve(artifactDir, 'web_test_public_key.hex');

    if (!fs.existsSync(imagePath) || !fs.existsSync(pubKeyPath)) {
        console.error("Test artifacts not found. Please run Android unit tests first.");
        process.exit(1);
    }

    const imageBytes = fs.readFileSync(imagePath);
    const pubKeyHex = fs.readFileSync(pubKeyPath, 'utf8').trim();

    console.log(`Loaded test image (${imageBytes.length} bytes)`);
    console.log(`Loaded test public key: ${pubKeyHex}`);

    // 1. Inject the test public key into PUBLIC_KEYS mapping (version 1)
    PUBLIC_KEYS[1] = pubKeyHex;

    // 2. Create the file mock with arrayBuffer method
    const fileMock = {
        arrayBuffer: async () => {
            // Correctly extract ArrayBuffer from Buffer
            return imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength);
        }
    };

    // 3. Verify
    try {
        const result = await verifySpotLockPhoto(fileMock);
        console.log("Verification result:", result);
        
        if (result.isValid && result.cryptoSupported) {
            console.log("SUCCESS: Signature verification passed successfully!");
            process.exit(0);
        } else {
            console.error("FAILURE: Signature verification failed.", result);
            process.exit(1);
        }
    } catch (error) {
        console.error("FAILURE: Error during signature verification:", error);
        process.exit(1);
    }
}

run();
