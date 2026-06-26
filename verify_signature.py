import sys
import hashlib
from datetime import datetime

# Public Key SPKI Hex (same as web/index.html)
PUBLIC_KEY_HEX = "3059301306072a8648ce3d020106082a8648ce3d030107034200045e2dacfdcad91537fc39893555ee32e4ca56516097bede5a00c1833370df6489a948c9adf3d91564d65469ed10302bb5085d155e6d7082cb83f4d3e43a54c24e"

def verify_jpeg(file_path):
    print(f"Reading file: {file_path}")
    with open(file_path, "rb") as f:
        data = f.read()

    # Find the APP15 marker (0xFFEF) followed by "SPOTLOCK" magic
    marker = b"\xff\xef"
    magic = b"SPOTLOCK"
    
    offset = 0
    found = False
    app15_offset = -1
    segment_len = -1
    
    while True:
        pos = data.find(marker, offset)
        if pos == -1:
            break
        # Verify it has enough length to check magic
        if pos + 12 <= len(data):
            # Check length field
            length = int.from_bytes(data[pos+2:pos+4], byteorder='big')
            # Check magic
            if data[pos+4:pos+12] == magic:
                found = True
                app15_offset = pos
                segment_len = length
                break
        offset = pos + 1

    if not found:
        print("[-] Error: No APP15 spotLock metadata segment found in this image.")
        return False

    print(f"[+] Found APP15 segment at offset: {app15_offset} (Length: {segment_len} bytes)")
    
    # Extract metadata components
    version_offset = app15_offset + 12
    version = data[version_offset]
    
    timestamp_offset = version_offset + 1
    timestamp_bytes = data[timestamp_offset:timestamp_offset+8]
    timestamp = int.from_bytes(timestamp_bytes, byteorder='big')
    
    # ECDSA signature is 64 bytes (R | S)
    embedded_sig_offset = timestamp_offset + 8
    embedded_sig = data[embedded_sig_offset:embedded_sig_offset+64]

    # Reconstruct original bytes (remove the APP15 segment completely)
    original_bytes = data[:app15_offset] + data[app15_offset + 2 + segment_len:]

    # Prepare signature payload
    timestamp_str = str(timestamp).encode('utf-8')
    combined = timestamp_str + original_bytes

    # Parse raw 64-byte signature to DER format for cryptography library
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives import serialization

    r = int.from_bytes(embedded_sig[:32], byteorder='big')
    s = int.from_bytes(embedded_sig[32:], byteorder='big')
    der_sig = encode_dss_signature(r, s)

    # Load public key
    try:
        public_key = serialization.load_der_public_key(bytes.fromhex(PUBLIC_KEY_HEX))
    except Exception as e:
        print(f"[-] Error loading public key: {e}")
        return False

    # Verify signature
    try:
        public_key.verify(der_sig, combined, ec.ECDSA(hashes.SHA256()))
        is_valid = True
    except Exception:
        is_valid = False

    dt_object = datetime.fromtimestamp(timestamp / 1000.0)

    print("-" * 50)
    print(f"Metadata Version:    {version}")
    print(f"Timestamp (UNIX):   {timestamp}")
    print(f"Timestamp (Local):  {dt_object.strftime('%Y-%m-%d %H:%M:%S.%f')}")
    print(f"Embedded Signature:  {embedded_sig.hex()[:32]}...")
    print("-" * 50)

    if is_valid:
        print("[SUCCESS] Signature is VALID. The photo's timestamp and image data are authentic and untampered.")
        return True
    else:
        print("[FAILURE] Signature is INVALID. The photo or timestamp has been modified!")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_signature.py <path_to_jpeg>")
        sys.exit(1)
    
    verify_jpeg(sys.argv[1])
