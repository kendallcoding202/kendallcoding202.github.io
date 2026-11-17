#!/usr/bin/env python3
"""Turns the originals in art/raw/ into the web-sized assets under web/assets/.

Only art made for this game is in art/raw/ (the people; the world: one
sheet of buildings and things, and one ground texture; and the insides of
the buildings you can walk into: for each a sheet of the things in it, its
back wall and its floor). A person's front and back views arrive two to an
image, and the cast four to an image; each is cut into its figures here.
The monsters, the paintings fights are seen against, the icons and the font
were painted for Pawst Lives and are copied from it already processed. Sprites are trimmed to their painted area and shrunk, exactly as
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
# The alley's sheet, the same way: things to wall it with, to block its gate, and to scatter about.
ALLEY = [
    ("a_bin", 200), ("a_bin2", 200), ("a_crate", 200), ("a_tyres", 200),
    ("a_drum", 200), ("a_boxes", 200), ("a_pallets", 220), ("a_bottles", 200),
    ("a_barricade", 420), ("a_fence", 260), ("a_heap", 200), ("a_cone", 160),
]


# The insides of buildings (web/assets/rooms/). For each room:
#   sheet  its twelve things, row by row: what each is called (it is saved as <room>_<name>) and its
#          longest side on the web. Things at home are seen close up, so they are kept larger.
#   wall   which rows of the back wall's painting are used (top, bottom): from just above whatever is
#          highest on it down to where it meets the floor, and how wide it is saved.
#   floor  how wide its repeating tile is saved. (These were painted to repeat and do, as they come:
#          no edge is faded into another, which would smear a pattern of tiles.)
INSIDES = {
    "home": {
        "sheet": [("bed", 420), ("phone", 200), ("shelf", 340), ("hearth", 340), ("basket", 230), ("armchair", 250), ("fern", 180), ("teatable", 180), ("rug", 520), ("mat", 220), ("coats", 320), ("drawers", 260)],
        "wall": (138, 842, 1240),
        "floor": 600,
    },
    "pantry": {
        "sheet": [("sack", 150), ("barrel", 150), ("potatoes", 150), ("tins", 150), ("pickles", 150), ("cheese", 150), ("eggs", 150), ("milk", 150), ("stool", 150), ("onions", 150), ("scales", 150), ("mat", 220)],
        "wall": (103, 911, 800),
        "floor": 512,
    },
    "wash": {
        "sheet": [("basket", 150), ("ironing", 180), ("towels", 150), ("soapbox", 150), ("airer", 180), ("bucket", 150), ("hamper", 150), ("socks", 150), ("chair", 150), ("sign", 150), ("trolley", 150), ("mat", 220)],
        "wall": (0, 808, 800),
        "floor": 512,
    },
    "stacks": {
        "sheet": [("pile", 150), ("tomes", 150), ("desk", 180), ("globe", 150), ("steps", 150), ("trolley", 150), ("catalogue", 180), ("armchair", 180), ("lectern", 150), ("plant", 150), ("inkdesk", 150), ("mat", 220)],
        "wall": (22, 830, 800),
        "floor": 512,
    },
    # (The rooftops' "wall" is the sky, and the attic's the gable end: each is one painting right across, and taller.
    # Their way out is a hatch, where another room has a mat. A skylight and a ladder lie flat on the slates.)
    "rooftops": {
        "sheet": [("chimney", 180), ("pot", 150), ("aerial", 180), ("skylight", 230), ("tank", 180), ("dovecote", 170), ("planter", 200), ("slates", 150), ("ladder", 220), ("finial", 150), ("dish", 150), ("mat", 230)],
        "wall": (154, 760, 1400),
        "floor": 512,
    },
    "attic": {
        "sheet": [("trunk", 180), ("sheet", 170), ("boxes", 160), ("horse", 180), ("dummy", 170), ("cage", 170), ("cases", 170), ("toys", 180), ("mirror", 170), ("gramophone", 170), ("rug", 170), ("mat", 230)],
        "wall": (95, 802, 1400),
        "floor": 512,
    },
    "dark": {
        "sheet": [("shoes", 170), ("shoeboxes", 150), ("toolbox", 150), ("ladder", 160), ("umbrellas", 160), ("broom", 160), ("paint", 150), ("cables", 170), ("reel", 150), ("board", 160), ("papers", 150), ("mat", 220)],
        "wall": (34, 842, 800),
        "floor": 512,
    },
}


# The country's sheet, row by row: things that stand about the roads between the rows of houses
# (web/assets/world/r_<name>). One was painted and is not used: a milestone that came out looking like a headstone.
ROAD = [
    ("bench", 200), ("signpost", 200), ("well", 220), ("haystack", 220),
    ("scarecrow", 200), ("logs", 200), ("rock", 200), ("fence", 200),
    ("wheelbarrow", 200), ("mailbox", 180), (None, 0), ("pond", 320),
]


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


def cut_cells(im, rows, cols):
    """
    Cuts a sheet of things laid out in a grid into its things, row by row. A thing is whatever paint
    has its middle in that cell of the grid. So it may be in two parts (a broom and its dustpan), may
    reach over the line into the next cell without being cut by it, and two rows may come so close
    that no clear line runs between them. Specks of stray paint are dropped.
    """
    im = im.convert("RGBA")
    data = np.asarray(im)
    solid = data[..., 3] > 40
    cell = 4  # worked out on a coarse grid, as cut_row does
    h, w = solid.shape[0] // cell, solid.shape[1] // cell
    coarse = solid[: h * cell, : w * cell].reshape(h, cell, w, cell).any(axis=(1, 3))
    label = np.zeros((h, w), dtype=np.int32)
    where = {}  # for each blob of paint that is not a speck: which cell of the grid its middle is in
    number = 0
    for y0, x0 in zip(*np.nonzero(coarse)):
        if label[y0, x0]:
            continue
        number += 1
        label[y0, x0] = number
        stack = [(y0, x0)]
        cells, across, down = 0, 0, 0
        while stack:
            y, x = stack.pop()
            cells += 1
            across += x
            down += y
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1), (y + 1, x + 1), (y - 1, x - 1), (y + 1, x - 1), (y - 1, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and coarse[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = number
                    stack.append((ny, nx))
        if cells >= 8:
            where[number] = (min(rows - 1, int(down / cells / h * rows)), min(cols - 1, int(across / cells / w * cols)))
    fine = np.kron(label, np.ones((cell, cell), dtype=np.int32))
    pieces = []
    for row in range(rows):
        for col in range(cols):
            mine = [blob for blob, at in where.items() if at == (row, col)]
            if not mine:
                raise SystemExit(f"nothing is painted in row {row + 1}, column {col + 1} of the sheet")
            figure = data[: h * cell, : w * cell].copy()
            figure[~np.isin(fine, mine)] = 0
            pieces.append(trimmed(Image.fromarray(figure, "RGBA")))
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


# The cast sheet, left to right.
CAST = ["cast_ines", "cast_dov", "cast_spick", "cast_maribel"]


def cut_row(im, count):
    """
    Cuts an image of figures standing in a row into its figures, left to right. Figures are told apart
    by which paint touches which, not by the gaps between them: an elbow may reach over a neighbour's
    column without the two being one. A stray fleck belongs to whichever figure it is nearest.
    """
    im = im.convert("RGBA")
    solid = np.asarray(im.getchannel("A")) > 40
    cell = 4  # worked out on a coarse grid: quick, and paint a hair apart still counts as touching
    h, w = solid.shape[0] // cell, solid.shape[1] // cell
    coarse = solid[: h * cell, : w * cell].reshape(h, cell, w, cell).any(axis=(1, 3))
    label = np.zeros((h, w), dtype=np.int32)
    blobs = []  # for each: how many cells, and the sum of their columns
    for y0, x0 in zip(*np.nonzero(coarse)):
        if label[y0, x0]:
            continue
        number = len(blobs) + 1
        label[y0, x0] = number
        stack = [(y0, x0)]
        cells, across = 0, 0
        while stack:
            y, x = stack.pop()
            cells += 1
            across += x
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1), (y + 1, x + 1), (y - 1, x - 1), (y + 1, x - 1), (y - 1, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and coarse[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = number
                    stack.append((ny, nx))
        blobs.append((cells, across / cells))
    if len(blobs) < count:
        raise SystemExit(f"expected {count} figures in the image, found {len(blobs)}")
    biggest = sorted(sorted(range(len(blobs)), key=lambda i: -blobs[i][0])[:count], key=lambda i: blobs[i][1])
    owner = {i: min(biggest, key=lambda big: abs(blobs[big][1] - blobs[i][1])) for i in range(len(blobs))}
    fine = np.kron(label, np.ones((cell, cell), dtype=np.int32))
    pieces = []
    for big in biggest:
        mine = np.isin(fine, [i + 1 for i in owner if owner[i] == big])
        figure = np.asarray(im)[: h * cell, : w * cell].copy()
        figure[~mine] = 0
        pieces.append(trimmed(Image.fromarray(figure, "RGBA")))
    return pieces


def process_people(name, im, sprites):
    """A look's front and back views, or the cast: several figures in one image, kept at the scale they were painted."""
    if name == "cast_sheet":
        names = CAST
    else:
        look = name[: -len("_turn")]
        names = [look + "_front", look + "_back"]
    pieces = cut_row(im, len(names))
    # One scale for the whole image, so the tallest stands as tall as any other person and a child stays a child.
    scale = SIZES["human"] / max(piece.height for piece in pieces)
    written = []
    for sprite, piece in zip(names, pieces):
        dest = os.path.join(sprites, sprite + ".webp")
        piece.resize((max(1, round(piece.width * scale)), max(1, round(piece.height * scale))), Image.LANCZOS).save(dest, "WEBP", quality=88, method=6)
        written.append(dest)
    return written


def process_world(name, im, world):
    """The two images of the world: the sheet becomes twelve sprites, the grass two repeating tiles."""
    written = []
    if name in ("world_sheet", "alley_sheet"):
        for (sprite, longest), piece in zip(SHEET if name == "world_sheet" else ALLEY, cut_sheet(im)):
            dest = os.path.join(world, sprite + ".webp")
            fit(trimmed(piece), longest).save(dest, "WEBP", quality=90, method=6)
            written.append(dest)
    elif name == "road_sheet":
        for (sprite, longest), piece in zip(ROAD, cut_cells(im, SHEET_ROWS, SHEET_COLS)):
            if sprite is None:
                continue
            dest = os.path.join(world, "r_" + sprite + ".webp")
            fit(piece, longest).save(dest, "WEBP", quality=90, method=6)
            written.append(dest)
    elif name == "alley_cobbles":
        dest = os.path.join(world, "cobbles.webp")
        seamless(im.convert("RGB").resize((512, 512), Image.LANCZOS), 64).save(dest, "WEBP", quality=84, method=6)
        written.append(dest)
    elif name == "world_grass":
        grass = seamless(im.convert("RGB").resize((512, 512), Image.LANCZOS), 64)
        for tile, picture in (("grass", grass), ("earth", earth_from(grass))):
            dest = os.path.join(world, tile + ".webp")
            picture.save(dest, "WEBP", quality=84, method=6)
            written.append(dest)
    return written


def process_room(name, im, rooms):
    """One of a room's three paintings: its sheet becomes twelve things, its wall a band, its floor a tile."""
    room, part = name.rsplit("_", 1)
    plan = INSIDES[room]
    written = []
    if part == "sheet":
        for (thing, longest), piece in zip(plan["sheet"], cut_cells(im, SHEET_ROWS, SHEET_COLS)):
            dest = os.path.join(rooms, f"{room}_{thing}.webp")
            fit(trimmed(piece), longest).save(dest, "WEBP", quality=90, method=6)
            written.append(dest)
    elif part == "wall":
        top, bottom, wide = plan["wall"]
        band = im.convert("RGB").crop((0, top, im.width, bottom))
        dest = os.path.join(rooms, f"{room}_wall.webp")
        band.resize((wide, round(wide * band.height / band.width)), Image.LANCZOS).save(dest, "WEBP", quality=86, method=6)
        written.append(dest)
    elif part == "floor":
        side = plan["floor"]
        dest = os.path.join(rooms, f"{room}_floor.webp")
        im.convert("RGB").resize((side, side), Image.LANCZOS).save(dest, "WEBP", quality=86, method=6)
        written.append(dest)
    return written


def room_part(name):
    """Whether an original is one of a room's three paintings."""
    room, _, part = name.rpartition("_")
    return room in INSIDES and part in ("sheet", "wall", "floor")


def main():
    for sub in ("sprites", "world", "rooms"):
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
        if name.startswith("bg_"):
            # What a fight is seen against: sized as Pawst Lives sizes its room paintings, which sit beside it.
            dest = os.path.join(OUT, "bg", name + ".webp")
            im.convert("RGB").resize((1152, 768), Image.LANCZOS).save(dest, "WEBP", quality=78, method=6)
            count += 1
            total += os.path.getsize(dest)
            if fname.endswith(".png"):
                im.convert("RGB").save(os.path.join(RAW, name + ".webp"), "WEBP", lossless=True, method=6)
                os.remove(os.path.join(RAW, fname))
            continue
        if name.startswith("app_"):
            # The app's own art (its icon) is not part of the game's pictures: tools/ios-art.py uses it. Only archived here.
            if fname.endswith(".png"):
                im.convert("RGB").save(os.path.join(RAW, name + ".webp"), "WEBP", lossless=True, method=6)
                os.remove(os.path.join(RAW, fname))
            continue
        if room_part(name) or name.startswith(("world_", "alley_", "road_")) or name.endswith("_turn") or name == "cast_sheet":
            written = (process_room(name, im, os.path.join(OUT, "rooms")) if room_part(name)
                       else process_world(name, im, os.path.join(OUT, "world")) if name.startswith(("world_", "alley_", "road_"))
                       else process_people(name, im, os.path.join(OUT, "sprites")))
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
