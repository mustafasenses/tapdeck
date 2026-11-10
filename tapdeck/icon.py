"""Tapdeck's icon, drawn in code so the repo holds no binary files."""

import math
import os
import struct
import zlib

from .config import CACHE_DIR

# (y, knob x) of the three sliders, as fractions of the tile.
TRACKS = [(0.33, 0.36), (0.5, 0.64), (0.67, 0.46)]


def _coverage(distance):
    """Anti-aliased coverage of a shape from a pixel's signed distance to it."""
    return max(0.0, min(1.0, 0.5 - distance))


def make_icon(size=180, mac=False):
    """Three slider knobs on a violet gradient, as an RGBA PNG.

    The phone rounds its home screen icons itself, so by default the tile
    fills the square. mac=True draws the rounded tile with the margin macOS
    app icons use (824 of 1024 px, 185 px corner radius).
    """
    inset = size * 100 / 1024 if mac else 0.0
    tile = size - 2 * inset
    radius = tile * 185 / 824 if mac else 0.0
    half = tile / 2
    center = inset + half
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter: none
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            alpha = 1.0
            if mac:
                qx = abs(x - center) - (half - radius)
                qy = abs(y - center) - (half - radius)
                outside = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius
                alpha = _coverage(outside)
                if alpha == 0.0:
                    row += b"\0\0\0\0"
                    continue
            u, v = (x - inset) / tile, (y - inset) / tile
            t = (u + v) / 2
            r, g, b = 79 + 68 * t, 70 - 19 * t, 229 + 5 * t
            for ty, kx in TRACKS:
                # the track: a capsule from u=0.22 to 0.78, white at 40%
                dx = max(0.22 - u, 0.0, u - 0.78)
                track = _coverage((math.hypot(dx, v - ty) - 0.022) * tile) * 0.4
                # the knob: a white circle
                knob = _coverage((math.hypot(u - kx, v - ty) - 0.068) * tile)
                for k in (track, knob):
                    if k:
                        r, g, b = r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k
            row += bytes((int(r), int(g), int(b), int(alpha * 255 + 0.5)))
        rows.append(bytes(row))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def icon_png():
    """The phone's home screen icon, cached after the first request."""
    path = os.path.join(CACHE_DIR, "icon.png")
    if not os.path.exists(path):
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(make_icon())
    with open(path, "rb") as f:
        return f.read()
