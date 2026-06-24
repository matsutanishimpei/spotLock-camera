import sys
import hashlib
from datetime import datetime

# The same secret key obfuscated in the Kotlin code
SECRET_KEY = b"SpotLockSecretKey"

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
    
    embedded_sig_offset = timestamp_offset + 8
    embedded_sig = data[embedded_sig_offset:embedded_sig_offset+32]

    # Reconstruct original bytes (remove the APP15 segment completely)
    original_bytes = data[:app15_offset] + data[app15_offset + 2 + segment_len:]

    # Recalculate signature
    timestamp_str = str(timestamp).encode('utf-8')
    hasher = hashlib.sha256()
    hasher.update(SECRET_KEY)
    hasher.update(timestamp_str)
    hasher.update(original_bytes)
    calculated_sig = hasher.digest()

    dt_object = datetime.fromtimestamp(timestamp / 1000.0)

    print("-" * 50)
    print(f"Metadata Version:    {version}")
    print(f"Timestamp (UNIX):   {timestamp}")
    print(f"Timestamp (Local):  {dt_object.strftime('%Y-%m-%d %H:%M:%S.%f')}")
    print(f"Embedded Signature:  {embedded_sig.hex()}")
    print(f"Calculated Signature:{calculated_sig.hex()}")
    print("-" * 50)

    if embedded_sig == calculated_sig:
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
