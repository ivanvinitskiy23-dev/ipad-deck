from cryptography.hazmat.primitives import hashes


class SHA256Hash:
    digest_size = 32

    def __init__(self, data: bytes = b""):
        self._h = hashes.Hash(hashes.SHA256())
        if data:
            self._h.update(data)

    def update(self, data: bytes) -> None:
        self._h.update(data)

    def digest(self) -> bytes:
        return self._h.copy().finalize()

    def hexdigest(self) -> str:
        return self.digest().hex()

    def copy(self) -> "SHA256Hash":
        other = SHA256Hash()
        other._h = self._h.copy()
        return other


def new(data: bytes = b"") -> SHA256Hash:
    return SHA256Hash(data)
