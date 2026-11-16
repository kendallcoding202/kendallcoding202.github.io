# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 16 (three you start with, eight met in the garden, three more met in Tin Can Alley, and the two bosses) |
| Room paintings | Pawst Lives, copied as they are | 8 (the garden's and the alley's are used in fights) |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 14 |
| The house-sitter | **Generated for this game** | 4 images: four candidate looks (`sitter_a` to `sitter_d`), from the side |
| The house-sitter, turned | **Generated for this game** | 4 images, one per look, each holding that look from the front and from behind (8 sprites) |
| The cast | **Generated for this game** | 1 image holding all four: Ines Tock, Dov, Mr. Spick, Great-aunt Maribel |
| The world | **Generated for this game** | 2 images, which became 14 pictures (below) |
| Tin Can Alley | **Generated for this game** | 2 images, which became 13 pictures (below) |
| App icon and launch image | **Generated for this game** | 1 image: the house-sitter with a lantern and a calm Dust Bunny. `tools/ios-art.py` makes the icon and the launch image from it |

**Fourteen images have been generated in all.** Each was agreed before it was made, and every one came out usable on the first attempt. One has been touched up since, in code and for nothing: on the icon the pencil in her hair was painted lying on top of the bun, and `tools/ios-art.py` grows hair over its lower end so that it comes out of the bun instead. The archived original is as it was painted. Close up, the covered patch is a little softer than the hair round it; a repaint would be one more image.

### The world's two images

- **One sheet** (`art/raw/world_sheet.webp`) holding twelve sprites, which `tools/process-art.py` cuts apart by finding where the paint is: nine buildings (home, and one for each of the eight places), a tree, a lamp post and a hedge bush. Hedges, and the edge of the world, are that bush shoulder to shoulder.
- **One grass texture** (`art/raw/world_grass.webp`), which the same tool fades edge into edge so it repeats without a seam, and from which it makes a second tile in the colours of earth, for paths.

They are in `web/assets/world/`. Both came out usable on the first attempt.

The whole open world is laid out from these: where each stands is in `web/js/core/world.js`.

Still **drawn in code** (`web/js/ui/scenery.js`), on top of the paintings: the streets and their stepping stones, the flowers, the gateways (wood for the garden, iron for the alley), the alley's puddles and dropped bottle caps, the name plates, and light (lamplight, the door of home, fireflies). A place that is shut is its own painting, darkened, with a padlock on it.

### Tin Can Alley's two images

- **One sheet** (`art/raw/alley_sheet.webp`) holding twelve sprites, cut apart the same way: two bins, a crate, a stack of tyres, an oil drum, tied cardboard, pallets, a crate of bottles, a traffic cone, a heap of cans and bottle caps, a fence panel, and a barricade.
- **One cobble texture** (`art/raw/alley_cobbles.webp`), made to repeat without a seam.

From these: the alley's walls are those things piled along it; its fence is the panel; whoever is restless there hides in the bins; and the barricade stands in its gateway until the garden is calm. Its three kinds and its boss came from Pawst Lives with everything else, so the whole place cost two images.

### The people

The front and back views were painted from each look's side view (the image service was given that picture to work from), so the three views of a look are the same person in the same clothes. The cast were painted together in one image so they share a scale: Dov, a child, stands shorter than the grown-ups, and great-aunt Maribel is tiny. `tools/process-art.py` cuts the figures apart by which paint touches which.

Great-aunt Maribel is only seen as a picture beside her words (she is on the phone). The three neighbours stand in the world, each from the one view painted.

### The house-sitter candidates

The four candidates used the Pawst Lives sprite style prompt word for word (`tools/art-manifest.mjs`), the same model and the same sizes. They match its outline, shading and colour, but one thing is off and should be decided before more people are painted: **they came out taller and slimmer than the Pawst Lives cats**, about three and a half heads tall where the cats are about two. The next round should ask for "very large head, about two heads tall" so people sit beside the monsters at the same scale.

## New art the full game would still need

| Count | What | Notes |
| --- | --- | --- |
| 1 | The house-sitter, final sprite | One of the four candidates, or a repaint at Pawst Lives proportions. A repaint would want its front and back views repainted to match. |
| 40 | Grown-up forms | One per kind. Fourteen are named (below); twenty-six still to design. Bosses do not grow. |
| 13 | Things for the world | For each of the six places still to build, a sheet of the things that stand in it and a ground of its own, as Tin Can Alley has (12). And one sheet of painted gateways (1). |
| 17 | Icons | Six elements, three Calls, three stats (Health exists), four tabs, the Heirloom mark. |
| 1 | Title art | The app icon is painted. |
| **72** | **new images** | Fewer if things are painted several to a sheet. |

No longer needed, because the two world images covered them: a painted map of the neighbourhood, the nine buildings, and a painted map for every place (a ground tile and things to stand on it build those).

The count for the places still to build comes from building one. None of them is a lawn (a pantry, a wash-house, a rooftop), so each wants ground of its own (floorboards, tiles, slates) and a boundary of its own (shelves, a parapet) in place of the grass and the hedge. Tin Can Alley took one sheet and one texture, and that is what is counted for each of the other six. Two places that suit the same floor could share a texture and save an image.

Needs **no** new images:

- **Heirlooms**: rare colours for all 40 kinds and their 40 grown forms are recoloured in code (80 sprites, free). A hand-painted one can replace any recolour later.
- **Fights**: the 8 room paintings and all 48 Pawst Lives monster sprites are used as they are.

Optional, not counted: front and back views of the neighbours if they are ever to walk about, and of the Clutterkin that follow you (48 kinds, so best done a sheet at a time and only for the ones that walk with you most).

## The fourteen grown-up forms named so far

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
| Can Crab | Dustbin Lobster | A lobster that has moved up to a whole dented dustbin, the lid for a hat. |
| Sock Goblin | Jumper Troll | A hulking troll knitted from a whole unravelling jumper, sleeves trailing. |
| Coo-Thug | Coo-Kingpin | The feather-duster pigeon grown stout, in a waistcoat, with a pocket watch. |

## Making art

```sh
NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs   # generates only what is in the manifest and missing. Costs money.
python3 tools/process-art.py                  # trims and sizes art/raw/ into web/assets/, cuts the sheets, makes the ground tiles
python3 tools/ios-art.py                      # makes the app icon and launch image from the icon painting
python3 tools/heirlooms.py                    # repaints every Heirloom; contact sheet in art/review/heirlooms.jpg
```

Nothing is generated unless it is listed in `tools/art-manifest.mjs`, and nothing goes on that list until it has been agreed.
