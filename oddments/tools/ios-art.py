#!/usr/bin/env python3
"""Makes the iOS app's icon and launch image from the icon painting.

The painting (art/raw/app_icon.webp, generated for this game: see
docs/ART.md) is the house-sitter in lantern light with a calm Dust Bunny in
the crook of an arm, which is the game in one picture: a person, and a
household thing that has stopped fretting. It is square and has no
transparency, which is what the App Store asks of an icon.

The launch image is the same picture, small, fading into the game's night
purple at its edges, so the app opens on what was just tapped.

Run from the project root:  python3 tools/ios-art.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets")
PAINTING = os.path.join(ROOT, "art", "raw", "app_icon.webp")
NIGHT = np.array([23, 19, 46], dtype=np.float32)  # #17132e, the colour behind everything in the game
ICON = 1024
LAUNCH = 2732


def painting():
    art = Image.open(PAINTING).convert("RGB")
    if art.width != art.height:
        raise SystemExit(f"the icon painting must be square, and is {art.width}x{art.height}")
    return art


def launch_image(art, across):
    """The painting `across` pixels wide in the middle of a night-purple square, its edges faded away."""
    small = np.asarray(art.resize((across, across), Image.LANCZOS), dtype=np.float32)
    y, x = np.mgrid[0:across, 0:across].astype(np.float32)
    far = np.sqrt((x - across / 2) ** 2 + (y - across / 2) ** 2) / (across / 2)
    # All of the picture out to two thirds of the way; gone by the edge.
    keep = np.clip((1 - far) / (1 - 0.66), 0, 1)
    keep = (keep * keep * (3 - 2 * keep))[..., None]
    faded = small * keep + NIGHT * (1 - keep)
    canvas = np.empty((LAUNCH, LAUNCH, 3), dtype=np.float32)
    canvas[:] = NIGHT
    at = (LAUNCH - across) // 2
    canvas[at:at + across, at:at + across] = faded
    return Image.fromarray(canvas.round().clip(0, 255).astype(np.uint8), "RGB")


def main():
    art = painting()
    # The icon: 1024 square, no transparency (the App Store refuses an icon with any). iOS rounds the corners itself.
    icon = art if art.width == ICON else art.resize((ICON, ICON), Image.LANCZOS)
    icon.save(os.path.join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), "PNG", optimize=True)
    # The launch image: mostly night, the picture in the middle. iOS crops it to the screen.
    launch = launch_image(art, 900)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        launch.save(os.path.join(ASSETS, "Splash.imageset", name), "PNG", optimize=True)
    print("icon and launch image written")


if __name__ == "__main__":
    main()
