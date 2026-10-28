# Minimal stub for streamlink.utils.crypto import.


class PKCS115_Cipher:
    def __init__(self, key):
        self._key = key

    def encrypt(self, message: bytes) -> bytes:
        raise NotImplementedError("PKCS1_v1_5 not implemented in crypto shim")

    def decrypt(self, ciphertext: bytes, sentinel=None) -> bytes:
        raise NotImplementedError("PKCS1_v1_5 not implemented in crypto shim")


def new(key):
    return PKCS115_Cipher(key)
