from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MODE_ECB = 1
MODE_CBC = 2
MODE_CFB = 3
MODE_OFB = 5
MODE_CTR = 6
MODE_OPENPGP = 7
MODE_CCM = 8
MODE_EAX = 9
MODE_SIV = 10
MODE_GCM = 11
MODE_OCB = 12

block_size = 16
key_size = (16, 24, 32)


class _AESCipher:
    def __init__(self, key: bytes, mode: int, iv: bytes | None = None):
        algo = algorithms.AES(key)
        if mode == MODE_ECB:
            self._cipher = Cipher(algo, modes.ECB())
        elif mode == MODE_CBC:
            if iv is None:
                raise ValueError("IV required for CBC")
            self._cipher = Cipher(algo, modes.CBC(iv))
        elif mode == MODE_CTR:
            if iv is None:
                raise ValueError("nonce/IV required for CTR")
            self._cipher = Cipher(algo, modes.CTR(iv))
        else:
            raise ValueError(f"AES mode {mode} not supported by shim")
        self.block_size = block_size

    def encrypt(self, plaintext: bytes) -> bytes:
        enc = self._cipher.encryptor()
        return enc.update(plaintext) + enc.finalize()

    def decrypt(self, ciphertext: bytes) -> bytes:
        dec = self._cipher.decryptor()
        return dec.update(ciphertext) + dec.finalize()


def new(key: bytes, mode: int = MODE_ECB, IV: bytes | None = None, iv: bytes | None = None, **kwargs):
    nonce = IV if IV is not None else iv
    if nonce is None:
        nonce = kwargs.get("nonce")
    return _AESCipher(key, mode, nonce)
