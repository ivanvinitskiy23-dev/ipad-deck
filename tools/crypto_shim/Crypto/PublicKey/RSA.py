# Minimal stub — enough for streamlink.utils.crypto import.
# Twitch/Kick URL resolve does not need RSA.

class RsaKey:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError("RSA not implemented in crypto shim")


def generate(bits: int, randfunc=None, e: int = 65537):
    raise NotImplementedError("RSA.generate not implemented in crypto shim")


def construct(tup):
    raise NotImplementedError("RSA.construct not implemented in crypto shim")


def import_key(extern_key, passphrase=None):
    raise NotImplementedError("RSA.import_key not implemented in crypto shim")
