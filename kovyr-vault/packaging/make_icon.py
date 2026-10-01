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


def render_mark(size: int = 40) -> Image.Image:
    """The dial alone, on transparency, for the in-app masthead.

    Not the app icon shrunk down. The icon's rounded navy square is there
    to sit on a Dock or a desktop; dropped onto the app's own navy bar it
    reads as a pasted-in app icon rather than a logotype. This draws the
    mark by itself so it sits on the bar as part of the design.

    Rendered large and resampled with Lanczos. Letting Tk's subsample()
    do the reduction is what made the first attempt look shattered — it
    is nearest-neighbour point sampling, so at a 28:1 reduction the
    spokes and tick marks simply lost the pixels they were made of.
    """
    master = 1024
    img = Image.new("RGBA", (master, master), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = master // 2

    # Heavier strokes than the app icon: at 40px a hairline disappears,
    # and a mark that reads at a glance beats one that is faithful.
    ring_r, ring_w = 300, 76
    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
                 outline=WHITE, width=ring_w)
    for angle_deg in range(0, 360, 45):
        a = math.radians(angle_deg)
        r0, r1 = ring_r + 58, ring_r + 126
        draw.line(
            [(cx + r0 * math.cos(a), cy + r0 * math.sin(a)),
             (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
            fill=WHITE, width=52,
        )
    for angle_deg in (90, 210, 330):
        a = math.radians(angle_deg)
        r1 = ring_r - ring_w - 20
        draw.line(
            [(cx, cy), (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
            fill=WHITE, width=58,
        )
    draw.ellipse([cx - 104, cy - 104, cx + 104, cy + 104], fill=WHITE)
    draw.ellipse([cx - 58, cy - 58, cx + 58, cy + 58], fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    art = render()
    art.save("kovyr.png")
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    art.save("kovyr.ico", sizes=ico_sizes)
    for s in (16, 32, 48, 128, 256, 512):
        art.resize((s, s), Image.LANCZOS).save(f"icon_{s}.png")
    render_mark(40).save("kovyr-mark.png")
    print("wrote kovyr.png, kovyr.ico, kovyr-mark.png, icon_*.png")


if __name__ == "__main__":
    main()
