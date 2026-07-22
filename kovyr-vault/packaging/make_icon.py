"""Generate the Kovyr Vault app icon (vault dial on navy).

Renders kovyr.png master art plus kovyr.ico (Windows) and the PNG set
png2icns needs for kovyr.icns (macOS). Run from packaging/:

    python3 make_icon.py && png2icns kovyr.icns icon_*.png
"""

from __future__ import annotations

import math

from PIL import Image, ImageDraw

SIZE = 1024
NAVY_TOP = (36, 68, 105)
NAVY_BOTTOM = (12, 27, 46)
WHITE = (238, 244, 251, 255)
ACCENT = (110, 163, 216, 255)


def render() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-square background with a vertical navy gradient.
    margin, radius = 64, 224
    grad = Image.new("RGBA", (SIZE, SIZE))
    gdraw = ImageDraw.Draw(grad)
    for y in range(SIZE):
        t = y / SIZE
        color = tuple(
            round(NAVY_TOP[i] + (NAVY_BOTTOM[i] - NAVY_TOP[i]) * t)
            for i in range(3)
        )
        gdraw.line([(0, y), (SIZE, y)], fill=color + (255,))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [margin, margin, SIZE - margin, SIZE - margin],
        radius=radius, fill=255,
    )
    img.paste(grad, (0, 0), mask)

    # Vault dial: outer ring, tick marks, spindle with three spokes.
    cx = cy = SIZE // 2
    ring_r, ring_w = 300, 58
    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
                 outline=WHITE, width=ring_w)
    for angle_deg in range(0, 360, 45):
        a = math.radians(angle_deg)
        r0, r1 = ring_r + 44, ring_r + 92
        draw.line(
            [(cx + r0 * math.cos(a), cy + r0 * math.sin(a)),
             (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
            fill=WHITE, width=34,
        )
    for angle_deg in (90, 210, 330):
        a = math.radians(angle_deg)
        r1 = ring_r - ring_w - 26
        draw.line(
            [(cx, cy), (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
            fill=WHITE, width=44,
        )
    draw.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=WHITE)
    draw.ellipse([cx - 52, cy - 52, cx + 52, cy + 52], fill=ACCENT)

    return img


def main() -> None:
    art = render()
    art.save("kovyr.png")
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    art.save("kovyr.ico", sizes=ico_sizes)
    for s in (16, 32, 48, 128, 256, 512):
        art.resize((s, s), Image.LANCZOS).save(f"icon_{s}.png")
    print("wrote kovyr.png, kovyr.ico, icon_*.png")


if __name__ == "__main__":
    main()
