#!/usr/bin/env python3
"""Slice the CC0 enemy sprite sheet into a frame atlas.

The sheet (hindring_paletted.png by Nmn, CC0, from OpenGameArt) is hand-laid: the
rows separate cleanly but neighbouring sprites in a row sometimes touch, so there is
no uniform grid to cut on. Rows are found first, then sprites are split inside each
row, and every frame keeps its own tight bounding box.

Each frame is anchored bottom-centre, which is what a billboard wants: the feet stay
on the floor and the sprite stays centred as its width changes between poses.
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "assets" / "sprites" / "hindring_paletted.png"
OUT_PNG = ROOT / "public" / "textures" / "enemy.png"
OUT_JSON = ROOT / "src" / "game" / "enemyFrames.json"

KEY = (0, 255, 255)
# Below this a "sprite" is a stray speck rather than a frame.
MIN_WIDTH = 8
MIN_HEIGHT = 8


def bands(flags: list[bool]) -> list[tuple[int, int]]:
    """Inclusive (start, end) runs of True."""
    out: list[tuple[int, int]] = []
    start = None
    for i, on in enumerate(flags):
        if on and start is None:
            start = i
        elif not on and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(flags) - 1))
    return out


def main() -> int:
    sheet = Image.open(SHEET).convert("RGB")
    width, height = sheet.size
    pixels = sheet.load()

    rgba = Image.new("RGBA", (width, height))
    target = rgba.load()
    for y in range(height):
        for x in range(width):
            colour = pixels[x, y]
            target[x, y] = (0, 0, 0, 0) if colour == KEY else (*colour, 255)

    row_bands = bands([any(pixels[x, y] != KEY for x in range(width)) for y in range(height)])

    rows: list[list[dict[str, int]]] = []
    for top, bottom in row_bands:
        occupied = [any(pixels[x, y] != KEY for y in range(top, bottom + 1)) for x in range(width)]
        frames: list[dict[str, int]] = []
        for left, right in bands(occupied):
            ys = [
                y
                for y in range(top, bottom + 1)
                if any(pixels[x, y] != KEY for x in range(left, right + 1))
            ]
            frame = {
                "x": left,
                "y": ys[0],
                "w": right - left + 1,
                "h": ys[-1] - ys[0] + 1,
            }
            if frame["w"] >= MIN_WIDTH and frame["h"] >= MIN_HEIGHT:
                frames.append(frame)
        rows.append(frames)

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(OUT_PNG, optimize=True)
    OUT_JSON.write_text(
        json.dumps({"image": "./textures/enemy.png", "rows": rows}, indent=2) + "\n"
    )

    print(f"{SHEET.name} -> {OUT_PNG.relative_to(ROOT)} ({width}x{height})")
    for i, frames in enumerate(rows):
        sizes = " ".join(f'{f["w"]}x{f["h"]}' for f in frames)
        print(f"  row {i}: {len(frames)} frames  {sizes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
