#!/usr/bin/env python3
"""Convert the cub3D XPM assets to PNG.

Pillow's own XPM plugin rejects these files: they use 2-chars-per-pixel indices and
X11 colour names such as `gray12`, neither of which it supports.
"""

import re
import sys
from pathlib import Path

from PIL import Image, ImageColor

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "xpm"
DST = ROOT / "public" / "textures"

# Keys that can introduce a colour spec in an XPM colour-table entry.
CTX_KEYS = {"s", "m", "g", "g4", "c"}


def parse_color(spec: str) -> tuple[int, int, int, int] | None:
    spec = spec.strip()
    if spec.lower() == "none":
        return None
    if spec.startswith("#"):
        digits = spec[1:]
        # XPM allows 4 or 8 hex digits per channel; take the high byte of each.
        if len(digits) in (12, 24):
            per = len(digits) // 3
            return tuple(int(digits[i * per : i * per + 2], 16) for i in range(3)) + (255,)
        return ImageColor.getrgb(spec) + (255,)
    grey = re.fullmatch(r"(?:gray|grey)(\d+)", spec, re.I)
    if grey:
        v = round(int(grey.group(1)) * 255 / 100)
        return (v, v, v, 255)
    return ImageColor.getrgb(spec) + (255,)


def parse_entry(entry: str, cpp: int) -> tuple[str, tuple[int, int, int, int] | None]:
    """Split one colour-table line into its pixel key and its RGBA value."""
    key, rest = entry[:cpp], entry[cpp:]
    tokens = rest.split()
    colour = None
    i = 0
    while i < len(tokens):
        if tokens[i] in CTX_KEYS:
            context = tokens[i]
            i += 1
            words = []
            while i < len(tokens) and tokens[i] not in CTX_KEYS:
                words.append(tokens[i])
                i += 1
            if context == "c" and words:
                colour = parse_color(" ".join(words))
            continue
        i += 1
    return key, colour


def convert(path: Path) -> Image.Image:
    raw = path.read_text(encoding="latin-1")
    strings = re.findall(r'"((?:[^"\\]|\\.)*)"', raw)
    width, height, ncolors, cpp = (int(n) for n in strings[0].split()[:4])

    palette: dict[str, tuple[int, int, int, int]] = {}
    transparent = (0, 0, 0, 0)
    for entry in strings[1 : 1 + ncolors]:
        key, colour = parse_entry(entry, cpp)
        palette[key] = colour if colour is not None else transparent

    img = Image.new("RGBA", (width, height), transparent)
    pixels = img.load()
    assert pixels is not None
    for y, row in enumerate(strings[1 + ncolors : 1 + ncolors + height]):
        for x in range(width):
            chunk = row[x * cpp : x * cpp + cpp]
            # Rows are occasionally short in these files; leave the rest transparent.
            if len(chunk) < cpp:
                break
            pixels[x, y] = palette.get(chunk, transparent)
    return img


def main() -> int:
    if not SRC.is_dir():
        print(f"no source directory: {SRC}", file=sys.stderr)
        return 1
    DST.mkdir(parents=True, exist_ok=True)
    for path in sorted(SRC.glob("*.xpm")):
        img = convert(path)
        out = DST / f"{path.stem}.png"
        img.save(out, optimize=True)
        print(f"{path.name:16} {img.width}x{img.height}  ->  {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
