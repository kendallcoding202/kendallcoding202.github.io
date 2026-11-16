#!/usr/bin/env python3
"""Makes the iOS app's icon and launch image from art already in the game.

A stand-in until the game has its name and proper icon art (docs/ART.md): the
Dust Bunny, full size as painted for Pawst Lives (art/icon/dustbunny.webp), in
lamplight on the game's night purple. Generates nothing new and costs nothing.

Run from the project root:  python3 tools/ios-art.py
"""
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets")
NIGHT = np.array([23, 19, 46], dtype=np.float32)  # #17132e, the colour behind everything in the game
DUSK = np.array([58, 44, 108], dtype=np.float32)
LAMP = np.array([255, 200, 61], dtype=np.float32)


def backdrop(size, glow):
    """Night purple, lighter toward the middle, with a pool of lamplight low down."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    far = np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.72
    base = DUSK + (NIGHT - DUSK) * np.clip(far, 0, 1)[..., None]
    pool = np.clip(1 - np.sqrt(((x - 0.5) / 0.5) ** 2 + ((y - 0.6) / 0.42) ** 2), 0, 1) ** 2
    lit = base + (LAMP - base) * (pool * glow)[..., None]
    return Image.fromarray(lit.round().clip(0, 255).astype(np.uint8), "RGB")


def bunny(height):
    art = Image.open(os.path.join(ROOT, "art", "icon", "dustbunny.webp")).convert("RGBA")
    art = art.crop(art.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox())
    scale = height / art.height
    return art.resize((round(art.width * scale), height), Image.LANCZOS)


def stand(canvas, figure, foot):
    """Puts a figure on the canvas, centred, feet at `foot`, with a soft shadow under it."""
    size = canvas.width
    shadow = Image.new("L", (size, size), 0)
    w = round(figure.width * 0.8)
    h = round(figure.height * 0.12)
    shadow.paste(Image.new("L", (w, h), 150), ((size - w) // 2, foot - h // 2), Image.new("L", (w, h), 0).point(lambda _: 255))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.02))
    canvas.paste(Image.new("RGB", (size, size), tuple(int(v * 0.4) for v in NIGHT)), (0, 0), shadow)
    canvas.paste(figure, ((size - figure.width) // 2, foot - figure.height), figure)
    return canvas


def main():
    # The icon: 1024 square, no transparency (the App Store refuses an icon with any).
    icon = stand(backdrop(1024, 0.42), bunny(700), 880)
    icon.save(os.path.join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), "PNG", optimize=True)
    # The launch image: mostly night, the bunny small in the middle. iOS crops it to the screen.
    launch = stand(backdrop(2732, 0.2), bunny(460), 1500)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        launch.save(os.path.join(ASSETS, "Splash.imageset", name), "PNG", optimize=True)
    print("icon and launch image written")


if __name__ == "__main__":
    main()
