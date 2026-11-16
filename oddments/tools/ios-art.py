#!/usr/bin/env python3
"""Makes the iOS app's icon and launch image from the icon painting.

The painting (art/raw/app_icon.webp, generated for this game: see
docs/ART.md) is the house-sitter in lantern light with a calm Dust Bunny in
the crook of an arm, which is the game in one picture: a person, and a
household thing that has stopped fretting. It is square and has no
transparency, which is what the App Store asks of an icon.

One thing is put right in code on the way. As painted, the pencil in her
hair lies on top of the bun from end to end, as if it had been set down
there. `tuck_pencil` grows hair over its lower end, so that it comes out of
the bun the way a pencil pushed into it would. The archived original is
left as it was painted.

The launch image is the same picture, small, fading into the game's night
purple at its edges, so the app opens on what was just tapped.

Run from the project root:  python3 tools/ios-art.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets")
PAINTING = os.path.join(ROOT, "art", "raw", "app_icon.webp")
NIGHT = np.array([23, 19, 46], dtype=np.float32)  # #17132e, the colour behind everything in the game
ICON = 1024
LAUNCH = 2732

# The pencil, in the painting's own pixels (it is 1024 square): where its two ends are, half its
# width with its outline, and how far up from the sharpened end the hair is to cover it.
PENCIL = {"tip": (263.0, 226.0), "eraser": (373.0, 66.0), "half": 17.0, "cover": 86.0}
OUTLINE = (30, 14, 24)  # the dark line every lock of her hair is drawn with


def painting():
    art = Image.open(PAINTING).convert("RGB")
    if art.size != (ICON, ICON):
        raise SystemExit(f"the icon painting must be {ICON} square, and is {art.width}x{art.height}")
    return art


def tuck_pencil(art):
    """Grows hair over the lower end of the pencil, from the hair either side of it."""
    a = np.asarray(art, dtype=np.float32)
    high, wide = a.shape[:2]
    tip = np.array(PENCIL["tip"])
    eraser = np.array(PENCIL["eraser"])
    half = PENCIL["half"]
    cover = PENCIL["cover"]
    u = (eraser - tip) / np.linalg.norm(eraser - tip)  # along the pencil
    n = np.array([-u[1], u[0]])  # across it
    yy, xx = np.mgrid[0:high, 0:wide].astype(np.float32)
    along = (xx - tip[0]) * u[0] + (yy - tip[1]) * u[1]
    across = (xx - tip[0]) * n[0] + (yy - tip[1]) * n[1]

    def sample(px, py):
        """The painting at points between pixels, by blending the four round each."""
        px = np.clip(px, 0, wide - 1.001)
        py = np.clip(py, 0, high - 1.001)
        x0 = np.floor(px).astype(int)
        y0 = np.floor(py).astype(int)
        fx = (px - x0)[..., None]
        fy = (py - y0)[..., None]
        return a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy

    # The hair on each side of the pencil, folded in over it (each side mirrored about its own edge,
    # and slid a little along the pencil so the fold does not read as a mirror), meeting in the middle.
    right = sample(xx + n[0] * (2 * half - 2 * across) + u[0] * 5, yy + n[1] * (2 * half - 2 * across) + u[1] * 5)
    left = sample(xx + n[0] * (-2 * half - 2 * across) - u[0] * 5, yy + n[1] * (-2 * half - 2 * across) - u[1] * 5)
    t = np.clip((across + half) / (2 * half), 0, 1)
    t = (t * t * (3 - 2 * t))[..., None]
    grown = left * (1 - t) + right * t

    # Where it goes: over the pencil from below its point up to where it is to come out, soft at the
    # sides and the foot. The top edge bows toward the eraser, as a curl lying over the pencil would.
    bow = lambda s: cover + 7.0 * np.cos(np.clip(s / half, -1, 1) * np.pi / 2)  # noqa: E731
    edge = bow(across)
    mask = (np.clip((half + 1.5 - np.abs(across)) / 3.0, 0, 1) * np.clip((along + 16) / 6.0, 0, 1) * np.clip((edge - along) / 1.5, 0, 1))[..., None]
    out = a * (1 - mask) + grown * mask
    # The pencil is in the shade of the hair just where it comes out of it.
    shade = np.clip(1 - (along - edge) / 9.0, 0, 1) * (along > edge) * (np.abs(across) < half - 3)
    out = out * (1 - 0.34 * shade[..., None])
    tucked = Image.fromarray(out.round().clip(0, 255).astype(np.uint8), "RGB")

    # And the edge of that curl is drawn with the same dark line as every other.
    line = Image.new("L", (wide * 4, high * 4), 0)
    points = [tuple((tip + u * bow(s) + n * s) * 4) for s in np.linspace(-half - 1, half + 1, 40)]
    ImageDraw.Draw(line).line(points, fill=255, width=13, joint="curve")
    line = line.resize((wide, high), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.4))
    tucked.paste(Image.new("RGB", (wide, high), OUTLINE), (0, 0), line)
    return tucked


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
    art = tuck_pencil(painting())
    # The icon: 1024 square, no transparency (the App Store refuses an icon with any). iOS rounds the corners itself.
    art.save(os.path.join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), "PNG", optimize=True)
    # The launch image: mostly night, the picture in the middle. iOS crops it to the screen.
    launch = launch_image(art, 900)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        launch.save(os.path.join(ASSETS, "Splash.imageset", name), "PNG", optimize=True)
    print("icon and launch image written")


if __name__ == "__main__":
    main()
