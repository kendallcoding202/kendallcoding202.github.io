#!/usr/bin/env python3
"""Turns the originals in art/raw/ into the web-sized assets under web/assets/.

Only art made for this game is in art/raw/ (the people). The monsters, rooms,
icons and font were painted for Pawst Lives and are copied from it already
processed. Sprites are trimmed to their painted area and shrunk, exactly as
Pawst Lives does it, so old and new sit at the same scale.

Run from the project root:  python3 tools/process-art.py
Originals arrive as PNG; they are then archived as lossless WebP, which is
what stays in the repository.
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art", "raw")
OUT = os.path.join(ROOT, "web", "assets")

# Longest side in pixels after trimming. Drawn at up to ~2x on retina phones.
SIZES = {"human": 300, "mob": 240, "boss": 440, "icon": 128}


def kind_of(name):
    if name.startswith(("sitter_", "cast_")):
        return "human"
    if name.startswith("boss_"):
        return "boss"
    if name.startswith(("ic_", "el_")):
        return "icon"
    return "mob"


def trimmed(im):
    """Crops to the painted area, ignoring the faint alpha haze the model leaves."""
    im = im.convert("RGBA")
    alpha = im.getchannel("A").point(lambda a: 0 if a < 24 else a)
    im.putalpha(alpha)
    box = alpha.getbbox()
    return im.crop(box) if box else im


def fit(im, longest):
    scale = longest / max(im.size)
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)


def main():
    for sub in ("sprites", "icons"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    count = 0
    total = 0
    for fname in sorted(os.listdir(RAW)):
        if not fname.endswith((".png", ".webp")):
            continue
        name = os.path.splitext(fname)[0]
        kind = kind_of(name)
        im = Image.open(os.path.join(RAW, fname))
        im.load()
        if kind == "icon":
            art = trimmed(im)
            side = max(art.size)
            square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            square.alpha_composite(art, ((side - art.width) // 2, (side - art.height) // 2))
            dest = os.path.join(OUT, "icons", name + ".webp")
            square.resize((SIZES["icon"], SIZES["icon"]), Image.LANCZOS).save(dest, "WEBP", quality=90, method=6)
        else:
            dest = os.path.join(OUT, "sprites", name + ".webp")
            fit(trimmed(im), SIZES[kind]).save(dest, "WEBP", quality=88, method=6)
        count += 1
        total += os.path.getsize(dest)
        if fname.endswith(".png"):
            im.convert("RGBA").save(os.path.join(RAW, name + ".webp"), "WEBP", lossless=True, method=6)
            os.remove(os.path.join(RAW, fname))
    print(f"processed {count} originals; their web assets total {total / 1024:.0f} KB")


if __name__ == "__main__":
    sys.exit(main())
