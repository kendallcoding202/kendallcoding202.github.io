# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 21 (three you start with, eight met in the garden, three more met in Tin Can Alley, four more in the Midnight Pantry, and the three bosses). Pawst Lives has 48 in all: 40 kinds and 8 bosses |
| Room paintings | Pawst Lives, copied as they are | 8 (the garden's and the alley's are used in fights) |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 18 |
| The house-sitter | **Generated for this game** | 4 images: four candidate looks (`sitter_a` to `sitter_d`), from the side |
| The house-sitter, turned | **Generated for this game** | 4 images, one per look, each holding that look from the front and from behind (8 sprites) |
| The cast | **Generated for this game** | 1 image holding all four: Ines Tock, Dov, Mr. Spick, Great-aunt Maribel |
| The world | **Generated for this game** | 2 images, which became 14 pictures (below) |
| Tin Can Alley | **Generated for this game** | 2 images, which became 13 pictures (below) |
| App icon | **Generated for this game** | 1 image: the house-sitter with a lantern and a calm Hopmote (the dust under the bed). `tools/ios-art.py` makes the icon from it |
| The insides of home and the Midnight Pantry | Drawn in code by `web/js/ui/roomart.js` | Nothing generated. Walls, floors and furniture are code; the pantry's crates and boxes are Tin Can Alley's paintings; great-aunt Maribel's portrait is her own |
| Launch image and loading screen | Painted from the game's own world by `tools/postcard.mjs` | A postcard of the lane, home in the middle; nothing generated |

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
| 40 | Grown-up forms | One per kind. Eighteen are named (below); twenty-two still to design. Bosses do not grow. |
| 11 | Things for the world | For each of the five places still to build, a sheet of the things that stand in it and a ground of its own, as Tin Can Alley has (10). And one sheet of painted gateways (1). A place can be built with none, drawn in code as the Midnight Pantry is; it looks plainer. |
| 17 | Icons | Six elements, three Calls, three stats (Health exists), four tabs, the Heirloom mark. |
| 1 | Title art | The app icon is painted. |
| **70** | **new images** | Fewer if things are painted several to a sheet. Not counted: painted furniture for home and painted things for the pantry (a sheet each) if the rooms drawn in code are to match the painted world. |

No longer needed, because the two world images covered them: a painted map of the neighbourhood, the nine buildings, and a painted map for every place (a ground tile and things to stand on it build those).

The count for the places still to build comes from building two. Tin Can Alley took one sheet and one texture, and that is what is counted for each of the other five. The Midnight Pantry took nothing: its floor, wall and shelves are drawn in code and its crates are the alley's. Two places that suit the same floor could share a texture and save an image.

Needs **no** new images:

- **Heirlooms**: rare colours for all 40 kinds and their 40 grown forms are recoloured in code (80 sprites, free). A hand-painted one can replace any recolour later.
- **Fights**: the 8 room paintings and all 48 Pawst Lives monster sprites are used as they are.

Optional, not counted: front and back views of the neighbours if they are ever to walk about, and of the Clutterkin that follow you (48 kinds, so best done a sheet at a time and only for the ones that walk with you most).

## The eighteen grown-up forms named so far

| Kind | Grows up into | One line for the painter |
| --- | --- | --- |
| Hopmote | Lintelope | The same dust rabbit, bigger, with antlers made of bent wire coat hangers. |
| Eelastic | Toeviathan | A long thigh-high stocking sea serpent with a darning-needle fin. |
| Crumbwisp | Crustwraith | A toasted-sandwich ghost trailing a cloak of melted cheese. |
| Wishclock | Wishmane | A dandelion lion: a full seed-head mane on a leafy body. |
| Pricklebud | Briartusk | A boar grown from a whole rose hedge, thorn tusks, three roses. |
| Grumbuzz | Rumblepatch | A heavier, armoured bee with a fencing foil for a sting. |
| Shellfarer | Seawhorl | The snail in an admiral's hat, its shell a little galleon. |
| Gnomudgeon | Gnomarch | The gnome crowned with a flowerpot, a wheelbarrow for a throne. |
| Crimpet | Corkhorn | A stag beetle with a corkscrew horn and a shell of many caps. |
| Strayglow | Floodglow | A knightly power strip: six sockets for a visor, cable for a cape. |
| Snaffle | Snafflemore | The rat in a colander helmet with a spatula halberd. |
| Hermitin | Clangster | A lobster that has moved up to a whole dented dustbin, the lid for a hat. |
| Frayling | Woolligan | A hulking troll knitted from a whole unravelling jumper, sleeves trailing. |
| Preenager | Kingpinion | The feather-duster pigeon grown stout, in a waistcoat, with a pocket watch. |
| Scrumpling | Scrumplord | The dumpling grown to a whole steamer basket, lid for a helmet, steam for a plume. |
| Embernip | Scorchfoot | The chilli grown long and horned, trailing a string of smaller chillies like a tail of sparks. |
| Eggallant | Eggalahad | The egg in a silver egg cup with a toast-soldier lance and a teaspoon shield. |
| Wibblet | Blancmangler | A towering moulded jelly in three tiers, a cherry on each, quivering with rage. |

## Making art

```sh
NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs   # generates only what is in the manifest and missing. Costs money.
python3 tools/process-art.py                  # trims and sizes art/raw/ into web/assets/, cuts the sheets, makes the ground tiles
python3 tools/ios-art.py                      # makes the app icon from the icon painting
node tools/postcard.mjs                       # paints the loading screen and launch image from the game's own world (needs Playwright)
python3 tools/heirlooms.py                    # repaints every Heirloom; contact sheet in art/review/heirlooms.jpg
```

Nothing is generated unless it is listed in `tools/art-manifest.mjs`, and nothing goes on that list until it has been agreed.
