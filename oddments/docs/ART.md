# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 12 (three you start with, eight met in the garden, the Sprinkler Hydra) |
| Room paintings | Pawst Lives, copied as they are | 8 (the garden is used in fights) |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 11 |
| The house-sitter | **Generated for this game** | 4 images: four candidate looks (`sitter_a` to `sitter_d`) |
| The world | **Generated for this game** | 2 images, which became 14 pictures (below) |

**Six images have been generated in all.** Each was agreed before it was made.

### The world's two images

- **One sheet** (`art/raw/world_sheet.webp`) holding twelve sprites, which `tools/process-art.py` cuts apart by finding where the paint is: the nine buildings of the lane (home, and one for each of the eight places), a tree, a lamp post and a hedge bush. Hedges are that bush, shoulder to shoulder.
- **One grass texture** (`art/raw/world_grass.webp`), which the same tool fades edge into edge so it repeats without a seam, and from which it makes a second tile in the colours of earth, for paths.

They are in `web/assets/world/`. Both came out usable on the first attempt.

Still **drawn in code** (`web/js/ui/scenery.js`), on top of the paintings: the shape of the path and its stepping stones, the flowers, the garden's gate, the name plates over buildings, and light (lamplight, an open door, fireflies). A place that is shut is its own painting, darkened, with a padlock on it.

### The house-sitter candidates

The four candidates used the Pawst Lives sprite style prompt word for word (`tools/art-manifest.mjs`), the same model and the same sizes. They match its outline, shading and colour, but one thing is off and should be decided before more people are painted: **they came out taller and slimmer than the Pawst Lives cats**, about three and a half heads tall where the cats are about two. The next round should ask for "very large head, about two heads tall" so people sit beside the monsters at the same scale.

## New art the full game would still need

| Count | What | Notes |
| --- | --- | --- |
| 1 | The house-sitter, final sprite | One of the four candidates, or a repaint at Pawst Lives proportions. |
| 4 | The cast | Great-aunt Maribel, Dov, Ines Tock, Mr. Spick. |
| 40 | Grown-up forms | One per kind. Eleven are named (below); twenty-nine still to design. Bosses do not grow. |
| 10 | Things for the world | A painted gate and fence, and one special thing for the inside of each place (the sprinkler, the washing line...). As a sheet or two, as the buildings were. |
| 17 | Icons | Six elements, three Calls, three stats (Health exists), four tabs, the Heirloom mark. |
| 2 | App icon and title art | Once the game has its name. |
| **74** | **new images** | Fewer if things are painted several to a sheet. |

No longer needed, because the two world images covered them: a painted map of the lane, the nine buildings, and a painted map for the inside of every place (the grass tile and the hedge bush build those).

Needs **no** new images:

- **Heirlooms**: rare colours for all 40 kinds and their 40 grown forms are recoloured in code (80 sprites, free). A hand-painted one can replace any recolour later.
- **Fights**: the 8 room paintings and all 48 Pawst Lives monster sprites are used as they are.

Optional, not counted: a second and third view of the house-sitter (from the front and from behind) so they turn as they walk, and the same for the cast if they ever walk with you.

## The eleven grown-up forms named so far

| Kind | Grows up into | One line for the painter |
| --- | --- | --- |
| Dust Bunny | Dust Jackalope | The same dust rabbit, bigger, with antlers made of bent wire coat hangers. |
| Sock Eel | Stocking Serpent | A long thigh-high stocking sea serpent with a darning-needle fin. |
| Toast Ghost | Toastie Phantom | A toasted-sandwich ghost trailing a cloak of melted cheese. |
| Dandepuff | Dandemane | A dandelion lion: a full seed-head mane on a leafy body. |
| Thornhog | Bramble Boar | A boar grown from a whole rose hedge, thorn tusks, three roses. |
| Grumblebee | Rumblebee | A heavier, armoured bee with a fencing foil for a sting. |
| Snailor | Snadmiral | The snail in an admiral's hat, its shell a little galleon. |
| Grumpy Gnome | Gnomarch | The gnome crowned with a flowerpot, a wheelbarrow for a throne. |
| Cap Beetle | Corkscrew Stag | A stag beetle with a corkscrew horn and a shell of many caps. |
| Sparkplug | Surge Protector | A knightly power strip: six sockets for a visor, cable for a cape. |
| Ratscal | Ratscallion | The rat in a colander helmet with a spatula halberd. |

## Making art

```sh
NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs   # generates only what is in the manifest and missing. Costs money.
python3 tools/process-art.py                  # trims and sizes art/raw/ into web/assets/, cuts the world sheet, makes the ground tiles
python3 tools/heirlooms.py                    # repaints every Heirloom; contact sheet in art/review/heirlooms.jpg
```

Nothing is generated unless it is listed in `tools/art-manifest.mjs`, and nothing goes on that list until it has been agreed.
