import base64
import sys

try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("[-] Error: 'cryptography' library is not installed.")
    print("Please install it using: pip install cryptography")
    sys.exit(1)

def generate_key_pair():
    # Generate private key on P-256 curve (SECP256R1)
    private_key = ec.generate_private_key(ec.SECP256R1())
    
    # Serialize private key to PKCS#8 DER format, then encode in base64
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    private_b64 = base64.b64encode(private_der).decode('utf-8')
    
    # Serialize public key to SubjectPublicKeyInfo (SPKI) DER format, then encode in hex
    public_key = private_key.public_key()
    public_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    public_hex = public_der.hex()
    
    print("-" * 60)
    print("ECDSA P-256 Key Pair Generated Successfully!")
    print("-" * 60)
    print("\n[Android App: local.properties]")
    print(f"spotlock.privateKey={private_b64}")
    print("\n[Verifier Web Page: web/index.html]")
    print(f"const PUBLIC_KEY_HEX = \"{public_hex}\";")
    print("-" * 60)

if __name__ == "__main__":
    generate_key_pair()
