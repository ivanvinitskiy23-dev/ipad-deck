#!/usr/bin/env python3
"""Generate pixel-art cinema GIFs for iPad Deck idle scenes (Pillow)."""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "static" / "art"
W, H = 240, 135
FRAMES = 12
DURATION_MS = 120


def _save(frames: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=DURATION_MS,
        loop=0,
        optimize=False,
    )
    print(f"wrote {path.name} ({path.stat().st_size} bytes, {len(frames)} frames)")


def _px(draw: ImageDraw.ImageDraw, x: int, y: int, c: tuple[int, int, int]) -> None:
    if 0 <= x < W and 0 <= y < H:
        draw.point((x, y), fill=c)


def build_tokyo_rain(seed: int = 7) -> list[Image.Image]:
    rng = random.Random(seed)
    buildings = []
    x = 0
    while x < W:
        bw = rng.randint(14, 28)
        bh = rng.randint(40, 110)
        buildings.append((x, H - bh, bw, bh, rng.randint(8, 22)))
        x += bw + rng.randint(2, 8)
    neon = [
        (rng.randint(0, W - 20), rng.randint(20, 70), rng.choice([(255, 40, 120), (40, 220, 255), (180, 80, 255)]))
        for _ in range(10)
    ]
    frames = []
    for f in range(FRAMES):
        im = Image.new("RGB", (W, H), (8, 6, 18))
        d = ImageDraw.Draw(im)
        # sky gradient
        for y in range(H // 2):
            c = 8 + y // 4
            d.line([(0, y), (W, y)], fill=(c, 6, 18 + y // 3))
        for bx, by, bw, bh, shade in buildings:
            d.rectangle([bx, by, bx + bw - 1, H - 18], fill=(shade, shade + 2, shade + 10))
            for wy in range(by + 4, H - 22, 6):
                for wx in range(bx + 2, bx + bw - 2, 5):
                    if (wx + wy + f) % 7 == 0:
                        d.rectangle([wx, wy, wx + 2, wy + 2], fill=(255, 210, 120))
        for nx, ny, col in neon:
            d.rectangle([nx, ny, nx + 16, ny + 3], fill=col)
            d.rectangle([nx, ny + 4, nx + 16, ny + 5], fill=(col[0] // 3, col[1] // 3, col[2] // 3))
        # street / puddle reflection
        d.rectangle([0, H - 18, W, H], fill=(12, 10, 24))
        for px in range(0, W, 3):
            d.point((px, H - 10 + ((px + f) % 3)), fill=(40, 30, 70))
        # rain streaks
        for i in range(70):
            rx = (rng.randint(0, W) + f * 7 + i * 13) % W
            ry = (rng.randint(0, H) + f * 11 + i * 9) % H
            d.line([(rx, ry), (rx - 2, ry + 6)], fill=(140, 160, 200))
        frames.append(im)
    return frames


def build_night_highway(seed: int = 11) -> list[Image.Image]:
    rng = random.Random(seed)
    stars = [(rng.randint(0, W - 1), rng.randint(0, 50)) for _ in range(40)]
    frames = []
    for f in range(FRAMES):
        im = Image.new("RGB", (W, H), (6, 2, 18))
        d = ImageDraw.Draw(im)
        for y in range(70):
            d.line([(0, y), (W, y)], fill=(10 + y // 8, 2, 28 + y // 5))
        for sx, sy in stars:
            if (sx + sy + f) % 5 != 0:
                d.point((sx, sy), fill=(220, 220, 255))
        # mountains
        pts = [(0, 75)]
        for x in range(0, W + 1, 20):
            pts.append((x, 55 + int(12 * math.sin(x / 18.0 + f / 20.0))))
        pts += [(W, 75), (0, 75)]
        d.polygon(pts, fill=(20, 8, 40))
        # perspective grid
        horizon = 72
        for i in range(1, 10):
            y = horizon + int((H - horizon) * (i / 10.0) ** 1.4)
            d.line([(0, y), (W, y)], fill=(180, 40, 160))
        cx = W // 2
        for i in range(-8, 9):
            x0 = cx + i * 8
            d.line([(x0, horizon), (cx + i * 40, H)], fill=(120, 30, 140))
        # road
        d.polygon([(cx - 18, horizon), (cx + 18, horizon), (W, H), (0, H)], fill=(18, 12, 28))
        # moving dashes
        for i in range(6):
            t = ((f + i * 2) % FRAMES) / float(FRAMES)
            y = int(horizon + (H - horizon - 8) * t)
            half = int(2 + 16 * t)
            d.rectangle([cx - 1, y, cx + 1, y + 4], fill=(255, 220, 80))
            d.line([(cx - half, y + 2), (cx + half, y + 2)], fill=(60, 40, 80))
        # car silhouette + taillights
        cy = H - 28
        d.polygon([(cx - 22, cy), (cx + 22, cy), (cx + 16, cy + 14), (cx - 16, cy + 14)], fill=(10, 8, 16))
        d.rectangle([cx - 18, cy + 6, cx - 12, cy + 10], fill=(255, 40, 60))
        d.rectangle([cx + 12, cy + 6, cx + 18, cy + 10], fill=(255, 40, 60))
        frames.append(im)
    return frames


def build_server_room(seed: int = 3) -> list[Image.Image]:
    rng = random.Random(seed)
    frames = []
    for f in range(FRAMES):
        im = Image.new("RGB", (W, H), (4, 8, 10))
        d = ImageDraw.Draw(im)
        # floor grid
        for x in range(0, W, 12):
            d.line([(x, 90), (x + 40, H)], fill=(10, 30, 28))
        d.rectangle([0, 90, W, H], fill=(6, 12, 14))
        # racks
        for r in range(6):
            rx = 12 + r * 38
            d.rectangle([rx, 18, rx + 28, 95], fill=(14, 22, 26))
            d.rectangle([rx + 1, 20, rx + 27, 93], fill=(8, 14, 18))
            for row in range(10):
                y = 24 + row * 7
                for led in range(4):
                    lx = rx + 4 + led * 6
                    on = ((f + r + row + led) % 5) < 3
                    col = (40, 255, 160) if on else (20, 40, 35)
                    d.rectangle([lx, y, lx + 3, y + 2], fill=col)
                # traffic bar
                bar = (f * 3 + r * 5 + row * 2) % 18
                d.rectangle([rx + 4, y + 3, rx + 4 + bar, y + 4], fill=(0, 180, 220))
        # terminal glow
        d.rectangle([70, 100, 170, 128], fill=(10, 28, 24))
        d.rectangle([74, 104, 166, 124], fill=(6, 40, 30))
        for i in range(5):
            y = 108 + i * 3
            wlen = 20 + ((f + i * 7) % 40)
            d.line([(78, y), (78 + wlen, y)], fill=(80, 255, 160))
        frames.append(im)
    return frames


def build_cafe_fallback(seed: int = 5) -> list[Image.Image]:
    """Simple warm cafe if cafe-yum.gif is missing."""
    rng = random.Random(seed)
    frames = []
    for f in range(FRAMES):
        im = Image.new("RGB", (W, H), (28, 18, 14))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, W, 70], fill=(40, 28, 22))
        d.rectangle([20, 20, 90, 60], fill=(70, 90, 120))
        d.rectangle([150, 18, 220, 58], fill=(60, 80, 110))
        # hanging lights
        for lx in (40, 80, 160, 200):
            d.line([(lx, 0), (lx, 18)], fill=(30, 20, 15))
            glow = 180 + (f % 3) * 10
            d.ellipse([lx - 6, 16, lx + 6, 28], fill=(glow, 160, 60))
        # counter
        d.rectangle([0, 78, W, H], fill=(50, 32, 22))
        d.rectangle([30, 70, 210, 78], fill=(90, 60, 40))
        # steam
        for i in range(3):
            sx = 100 + i * 14
            sy = 55 - ((f + i * 2) % 8)
            d.point((sx, sy), fill=(200, 190, 180))
            d.point((sx + 1, sy - 2), fill=(180, 170, 160))
        # cups
        d.ellipse([110, 72, 128, 82], fill=(220, 210, 200))
        d.ellipse([140, 72, 158, 82], fill=(220, 210, 200))
        frames.append(im)
    return frames


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cafe = OUT / "cafe-yum.gif"
    if not cafe.exists() or cafe.stat().st_size < 1000:
        _save(build_cafe_fallback(), cafe)
    else:
        print(f"keep {cafe.name} ({cafe.stat().st_size} bytes)")
    _save(build_tokyo_rain(), OUT / "tokyo-rain.gif")
    _save(build_night_highway(), OUT / "night-highway.gif")
    _save(build_server_room(), OUT / "server-room.gif")


if __name__ == "__main__":
    main()
