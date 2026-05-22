import base64

def check_keys():
    # Public key from tauri.conf.json
    pubkey_b64 = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQyQjkxRUNFMEYyQjIwQkEKUldTNklDc1B6aDY1MHYrR0d4UWpXWTNtTU5kbjNIM0Y2eDlYS2J6b29qTVdmaW1GV3RCd1YySXAK"
    # Signature of 0.2.6 from updater.json
    sig_b64 = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTNklDc1B6aDY1MHVLZWZqUkdQdkE0Wk5RTGpxbnhUVmlRaUdENkdFeEtLalJRN3gxYmI0SE9GUmRCTXEvRDc1ZmlYVkEveTVZVUZNNnB3YTY5WGNqTXlITEZGSDVUYlFjPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzc5Mjk1Mzc4CWZpbGU6U3BvdERMIEdVSV8wLjIuNl94NjQtc2V0dXAuZXhlCit5RXBUeXk2cUJsL285TSsvY2Eza2p6NXpsRlhhUFNTNVlhakdPU2sydS9kRkEvNmthbkQwTzZaVHRWQ3E3c3lIWGtSc05oMlFFc3lLU0s5Yi8xeURnPT0K"

    # Decode public key
    pubkey_lines = base64.b64decode(pubkey_b64).decode('utf-8').strip().split('\n')
    pubkey_data = base64.b64decode(pubkey_lines[1])
    pub_key_id = pubkey_data[2:10]
    
    # Decode signature
    sig_lines = base64.b64decode(sig_b64).decode('utf-8').strip().split('\n')
    sig_data = base64.b64decode(sig_lines[1])
    sig_key_id = sig_data[2:10]

    print(f"Public Key ID (Hex): {pub_key_id.hex().upper()}")
    print(f"Signature Key ID (Hex): {sig_key_id.hex().upper()}")
    
    if pub_key_id == sig_key_id:
        print("SUCCESS: Key IDs match! The signature was signed with the private key corresponding to this public key.")
    else:
        print("FAILURE: Key IDs DO NOT MATCH! The signature in updater.json was signed with a different key than the public key in tauri.conf.json.")

if __name__ == "__main__":
    check_keys()
