def pad(data_to_pad: bytes, block_size: int, style: str = "pkcs7") -> bytes:
    if style not in ("pkcs7", "pkcs5"):
        raise ValueError("only pkcs7/pkcs5 supported")
    padding_len = block_size - (len(data_to_pad) % block_size)
    return data_to_pad + bytes([padding_len]) * padding_len


def unpad(padded_data: bytes, block_size: int, style: str = "pkcs7") -> bytes:
    if style not in ("pkcs7", "pkcs5"):
        raise ValueError("only pkcs7/pkcs5 supported")
    if not padded_data or len(padded_data) % block_size:
        raise ValueError("invalid padding")
    padding_len = padded_data[-1]
    if padding_len < 1 or padding_len > block_size:
        raise ValueError("invalid padding")
    if padded_data[-padding_len:] != bytes([padding_len]) * padding_len:
        raise ValueError("invalid padding")
    return padded_data[:-padding_len]
