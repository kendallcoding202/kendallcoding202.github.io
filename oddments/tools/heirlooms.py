#!/usr/bin/env python3
"""Paints the Heirloom (rare colour) version of every Clutterkin from its own sprite.

Nothing is generated: each Heirloom is the ordinary sprite recoloured in
code, so a rare one costs no new art. For each kind, LOOKS says how:

  turn   degrees to turn every colour round the colour wheel
  dye    (hue, strength) to tint the greys and whites, which turning cannot change
  spare  (from, to) hues in degrees to leave as painted (a face, say)

Dark outline pixels are left alone so the linework stays the same.

  python3 tools/heirlooms.py          writes web/assets/sprites/<kind>_heirloom.webp
                                      and a contact sheet at art/review/heirlooms.jpg
To replace a recolour with a painted sprite later, drop the painted
<kind>_heirloom.webp into web/assets/sprites/ and remove the kind from LOOKS.
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, "web", "assets", "sprites")
REVIEW = os.path.join(ROOT, "art", "review")

LOOKS = {
    "dustbunny": {"turn": 200, "dye": (40, 0.78)},
    "sockeel": {"turn": 95},
    "toastghost": {"turn": 285},
    "dandepuff": {"turn": 180, "dye": (325, 0.32)},
    "thornhog": {"turn": 205},
    "grumblebee": {"turn": 150},
    "snailor": {"turn": 120},
    "gnome": {"turn": 270, "spare": (10, 50)},
    "capbeetle": {"turn": 130},
    "sparkplug": {"turn": 170, "dye": (265, 0.3)},
    "ratscal": {"turn": 185, "dye": (200, 0.25)},
    "cancrab": {"turn": 150},
    "sockgoblin": {"turn": 215},
    "coothug": {"turn": 175, "dye": (42, 0.5)},
}


def recolour(im, turn=0, dye=None, spare=None):
    rgba = np.asarray(im.convert("RGBA")).astype(np.float32) / 255.0
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]
    mx = np.max(rgba[..., :3], axis=-1)
    mn = np.min(rgba[..., :3], axis=-1)
    v = mx
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rc = np.where(nz, (mx - r) / np.maximum(d, 1e-6), 0)
    gc = np.where(nz, (mx - g) / np.maximum(d, 1e-6), 0)
    bc = np.where(nz, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(mx == r, bc - gc, np.where(mx == g, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0

    h2 = (h + turn / 360.0) % 1.0
    if spare:
        h2 = np.where((h * 360 >= spare[0]) & (h * 360 <= spare[1]), h, h2)
    s2 = s
    if dye:
        hue, strength = dye
        # Greys and whites: no colour to turn, so give them one. Fades in as
        # the pixel gets less colourful, and leaves the darkest lines alone.
        grey = np.clip((0.28 - s) / 0.28, 0, 1) * np.clip((v - 0.22) / 0.2, 0, 1)
        h2 = np.where(grey > 0.02, hue / 360.0, h2)
        s2 = np.clip(s2 * (1 - grey) + strength * grey, 0, 1)

    i = np.floor(h2 * 6.0)
    f = h2 * 6.0 - i
    p = v * (1 - s2)
    q = v * (1 - s2 * f)
    t = v * (1 - s2 * (1 - f))
    i = i.astype(np.int32) % 6
    r2 = np.choose(i, [v, q, p, p, t, v])
    g2 = np.choose(i, [t, v, v, q, p, p])
    b2 = np.choose(i, [p, p, t, v, v, q])
    # Leave the dark outline exactly as painted.
    keep = v < 0.2
    out = np.stack([np.where(keep, r, r2), np.where(keep, g, g2), np.where(keep, b, b2), a], axis=-1)
    return Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8), "RGBA")


def main():
    os.makedirs(REVIEW, exist_ok=True)
    cell = 190
    sheet = Image.new("RGB", (cell * len(LOOKS), cell * 2 + 22), (44, 37, 84))
    draw = ImageDraw.Draw(sheet)
    for i, (kind, look) in enumerate(LOOKS.items()):
        plain = Image.open(os.path.join(SPRITES, kind + ".webp")).convert("RGBA")
        rare = recolour(plain, **look)
        rare.save(os.path.join(SPRITES, kind + "_heirloom.webp"), "WEBP", quality=88, method=6)
        for row, art in enumerate((plain, rare)):
            thumb = art.copy()
            thumb.thumbnail((cell - 14, cell - 14))
            sheet.paste(thumb, (i * cell + (cell - thumb.width) // 2, row * cell + (cell - thumb.height) // 2), thumb)
        draw.text((i * cell + 6, cell * 2 + 4), kind, fill=(255, 255, 255))
    sheet.save(os.path.join(REVIEW, "heirlooms.jpg"), quality=88)
    print(f"painted {len(LOOKS)} heirlooms; contact sheet at art/review/heirlooms.jpg")
    _ = colorsys  # the maths above is colorsys.rgb_to_hsv / hsv_to_rgb, done on whole images


if __name__ == "__main__":
    sys.exit(main())
