from cryptography.hazmat.primitives import hashes


class MD5Hash:
    digest_size = 16

    def __init__(self, data: bytes = b""):
        self._h = hashes.Hash(hashes.MD5())
        if data:
            self._h.update(data)

    def update(self, data: bytes) -> None:
        self._h.update(data)

    def digest(self) -> bytes:
        return self._h.copy().finalize()

    def hexdigest(self) -> str:
        return self.digest().hex()

    def copy(self) -> "MD5Hash":
        other = MD5Hash()
        other._h = self._h.copy()
        return other


def new(data: bytes = b"") -> MD5Hash:
    return MD5Hash(data)
