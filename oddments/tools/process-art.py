#!/usr/bin/env python3
"""Turns the originals in art/raw/ into the web-sized assets under web/assets/.

Only art made for this game is in art/raw/ (the people, and the world: one
sheet of buildings and things, and one ground texture). The monsters, rooms,
icons and font were painted for Pawst Lives and are copied from it already
processed. Sprites are trimmed to their painted area and shrunk, exactly as
Pawst Lives does it, so old and new sit at the same scale.

Run from the project root:  python3 tools/process-art.py
Originals arrive as PNG; they are then archived as lossless WebP, which is
what stays in the repository.
"""
import os
import sys

import numpy as np
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


# The world sheet, row by row: what each of its twelve sprites is, and its longest side on the web.
SHEET = [
    ("b_home", 380), ("b_garden", 360), ("b_alley", 360), ("b_pantry", 360),
    ("b_wash", 360), ("b_stacks", 360), ("b_rooftops", 400), ("b_attic", 400),
    ("b_dark", 360), ("p_tree", 300), ("p_lamp", 280), ("p_bush", 220),
]
SHEET_ROWS, SHEET_COLS = 3, 4


def bands(filled, want):
    """The `want` longest stretches of a row (or column) profile that have paint in them."""
    runs = []
    start = None
    for i, on in enumerate(list(filled) + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i))
            start = None
    # Join stretches a few pixels apart (a bubble drifting off a roof belongs to its building).
    joined = []
    for run in runs:
        if joined and run[0] - joined[-1][1] < 10:
            joined[-1] = (joined[-1][0], run[1])
        else:
            joined.append(run)
    joined = sorted(sorted(joined, key=lambda r: r[0] - r[1])[:want])
    if len(joined) != want:
        raise SystemExit(f"expected {want} sprites in a line of the sheet, found {len(joined)}")
    return joined


def cut_sheet(im):
    """Cuts the sheet into its sprites, reading rows then columns by where the paint is."""
    im = im.convert("RGBA")
    solid = np.asarray(im.getchannel("A")) > 40
    pieces = []
    for top, bottom in bands(solid.any(axis=1), SHEET_ROWS):
        for left, right in bands(solid[top:bottom].any(axis=0), SHEET_COLS):
            pieces.append(im.crop((left, top, right, bottom)))
    return pieces


def seamless(im, band):
    """Makes a texture that repeats without a seam, by fading each edge into the opposite one."""
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    t = np.linspace(0, 1, band, dtype=np.float32)
    # top rows fade in from what follows the bottom rows, then the bottom band is cut off
    a[:band] = a[h - band:] * (1 - t)[:, None, None] + a[:band] * t[:, None, None]
    a = a[: h - band]
    a[:, :band] = a[:, w - band:] * (1 - t)[None, :, None] + a[:, :band] * t[None, :, None]
    a = a[:, : w - band]
    return Image.fromarray(a.round().clip(0, 255).astype(np.uint8), "RGB")


def earth_from(grass):
    """Packed earth for paths, made from the grass tile: its light and shade, in the colours of dirt."""
    a = np.asarray(grass.convert("RGB")).astype(np.float32)
    light = a @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    lo, hi = np.percentile(light, 2), np.percentile(light, 98)
    t = ((light - lo) / max(1.0, hi - lo)).clip(0, 1)[..., None]
    dark = np.array([74, 60, 66], dtype=np.float32)
    pale = np.array([132, 114, 104], dtype=np.float32)
    return Image.fromarray((dark + (pale - dark) * t).round().astype(np.uint8), "RGB")


def process_world(name, im, world):
    """The two images of the world: the sheet becomes twelve sprites, the grass two repeating tiles."""
    written = []
    if name == "world_sheet":
        for (sprite, longest), piece in zip(SHEET, cut_sheet(im)):
            dest = os.path.join(world, sprite + ".webp")
            fit(trimmed(piece), longest).save(dest, "WEBP", quality=90, method=6)
            written.append(dest)
    elif name == "world_grass":
        grass = seamless(im.convert("RGB").resize((512, 512), Image.LANCZOS), 64)
        for tile, picture in (("grass", grass), ("earth", earth_from(grass))):
            dest = os.path.join(world, tile + ".webp")
            picture.save(dest, "WEBP", quality=84, method=6)
            written.append(dest)
    return written


def main():
    for sub in ("sprites", "world"):
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
        if name.startswith("world_"):
            written = process_world(name, im, os.path.join(OUT, "world"))
            count += 1
            total += sum(os.path.getsize(dest) for dest in written)
            if fname.endswith(".png"):
                im.save(os.path.join(RAW, name + ".webp"), "WEBP", lossless=True, method=6)
                os.remove(os.path.join(RAW, fname))
            continue
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
