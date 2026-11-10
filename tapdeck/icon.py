"""The home screen icon, generated so the repo holds no binary files."""

import os
import struct
import zlib

from .config import CACHE_DIR


def make_icon(size=180, ss=3):
    """Three slider knobs on a violet gradient, as an RGB PNG."""
    rows = []
    n = size * ss
    tracks = [(0.33, 0.36), (0.5, 0.64), (0.67, 0.46)]  # (y, knob x)
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) / n
                    y = (py * ss + sy + 0.5) / n
                    t = (x + y) / 2
                    r, g, b = 79 + (147 - 79) * t, 70 + (51 - 70) * t, 229 + (234 - 229) * t
                    for ty, kx in tracks:
                        if 0.22 <= x <= 0.78 and abs(y - ty) < 0.022:
                            r, g, b = r + (255 - r) * 0.4, g + (255 - g) * 0.4, b + (255 - b) * 0.4
                        if (x - kx) ** 2 + (y - ty) ** 2 < 0.068 ** 2:
                            r, g, b = 255, 255, 255
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
            row += bytes(int(c / (ss * ss)) for c in acc)
        rows.append(bytes(row))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def icon_png():
    path = os.path.join(CACHE_DIR, "icon.png")
    if not os.path.exists(path):
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(make_icon())
    with open(path, "rb") as f:
        return f.read()
