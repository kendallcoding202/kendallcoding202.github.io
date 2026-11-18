# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 48: all 40 kinds and the 8 bosses |
| Room paintings | Pawst Lives, copied as they are | 8, one for each place: what its fights are seen against |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 40, one for every kind |
| The house-sitter | **Generated for this game** | 4 images: four candidate looks (`sitter_a` to `sitter_d`), from the side |
| The house-sitter, turned | **Generated for this game** | 4 images, one per look, each holding that look from the front and from behind (8 sprites) |
| The cast | **Generated for this game** | 1 image holding all four: Ines Tock, Dov, Mr. Spick, Great-aunt Maribel |
| The world | **Generated for this game** | 2 images, which became 14 pictures (below) |
| Tin Can Alley | **Generated for this game** | 2 images, which became 13 pictures (below) |
| The country between the rows of houses | **Generated for this game** | 1 image (`road_sheet`): a sheet of twelve things, of which eleven are used: a bench, a signpost, a well, a haystack, a scarecrow, a pile of logs, a rock, a white fence, a wheelbarrow, a mailbox and a pond. The twelfth, a milestone, came out looking like a headstone and is left out |
| The lane, as a fight is seen against it | **Generated for this game** | 1 image (`bg_lane`), asked for in the words Pawst Lives used for its eight room paintings, so it sits beside them. It is what a fight with strays, out on the lane, is seen against |
| App icon | **Generated for this game** | 1 image: the house-sitter with a lantern and a calm Hopmote (the dust under the bed). `tools/ios-art.py` makes the icon from it |
| The insides of the seven buildings you walk into | **Generated for this game** | 21 images, three to a room, which became 98 pictures (below) |
| Launch image and loading screen | Painted from the game's own world by `tools/postcard.mjs` | A postcard of the lane, home in the middle; nothing generated |

**Thirty-seven images have been generated in all.** The first fourteen were each agreed before they were made. Twenty-one are the rooms, one is the lane seen as a fight's backdrop, and one is the sheet of things for the country, made on 16 November 2026 after the owner approved spending on them ("I approve spending on the rooms and anything we need for the game, I want a polished good looking game"). Every one of the thirty-seven came out usable on the first attempt (one thing on the last sheet, a milestone, is not used). One has been touched up since, in code and for nothing: on the icon the pencil in her hair was painted lying on top of the bun, and `tools/ios-art.py` grows hair over its lower end so that it comes out of the bun instead. The archived original is as it was painted. Close up, the covered patch is a little softer than the hair round it; a repaint would be one more image.

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

### The rooms' twenty-one images

Home and the six places you walk into by a door (the Midnight Pantry, the Wash, the Dusty Stacks, Moonlit Rooftops, the Tick-Tock Attic, the Roaring Dark) each took three images. Until 16 November 2026 all seven were drawn in code and looked plainer than the painted world outside them.

- **A sheet of twelve things** that stand in the room (`art/raw/<room>_sheet.webp`): at home a bed, the telephone on its table, a bookshelf, the hearth, the basket, an armchair, a fern, the tea things, a rug, a door mat, a coat stand and a chest of drawers with a lamp; in the pantry sacks, barrels, crates, tins, a jar of pickles, a cheese, eggs, milk, a stool, onions and the scales; and so on for each room. `tools/process-art.py` cuts a sheet by which cell of its grid each bit of paint has its middle in, so a thing may be in two parts (a broom and its dustpan) and two rows may nearly touch.
- **Its back wall**, seen straight on (`<room>_wall.webp`). Only a band of the painting is used: from just above whatever is highest on it down to where it meets the floor. The rows are in `INSIDES` in `tools/process-art.py`, read off each painting.
- **Its floor**, seen from above (`<room>_floor.webp`). All seven were painted to repeat and do, as they come, so they are only resized: fading one edge into another, as the grass has, would smear a pattern of tiles.

They are in `web/assets/rooms/`, fourteen pictures a room. Where each thing stands is in `web/js/core/indoors.js` (every block of floor is named for what stands on it) and how wide it stands is in `web/js/ui/roomart.js`; a test holds the two together.

Two things about the walls. At home, on the rooftops and in the attic the wall is one painting right across (the rooftops' is the night sky over the town; the attic's is the gable end with its shelf of clocks, and both stand taller than a room's wall). In the other four the wall is the painting **and its mirror image side by side**: a wall of shelves or washing machines painted once across the whole room would have had jars half as tall as you, and two paintings' width puts them at the size they should be. The join is in the middle, behind where the ringleader stands.

Still **drawn in code**, on top of the paintings: the night lying on each floor, pools of light (the fire, which flickers; lamps; skylights; moonlight from a window; the door), the shadow under each thing, the red light of Machine Six in the Wash and its puddles, and in the Roaring Dark the dark itself. Great-aunt Maribel's portrait, which is her own painting from the cast, is put into the frame over the telephone.

### The people

The front and back views were painted from each look's side view (the image service was given that picture to work from), so the three views of a look are the same person in the same clothes. The cast were painted together in one image so they share a scale: Dov, a child, stands shorter than the grown-ups, and great-aunt Maribel is tiny. `tools/process-art.py` cuts the figures apart by which paint touches which.

Great-aunt Maribel is only seen as a picture beside her words (she is on the phone). The three neighbours stand in the world, each from the one view painted.

### The house-sitter candidates

The four candidates used the Pawst Lives sprite style prompt word for word (`tools/art-manifest.mjs`), the same model and the same sizes. They match its outline, shading and colour, but one thing is off and should be decided before more people are painted: **they came out taller and slimmer than the Pawst Lives cats**, about three and a half heads tall where the cats are about two. The next round should ask for "very large head, about two heads tall" so people sit beside the monsters at the same scale.

## New art the full game would still need

| Count | What | Notes |
| --- | --- | --- |
| 1 | The house-sitter, final sprite | One of the four candidates, or a repaint at Pawst Lives proportions. A repaint would want its front and back views repainted to match. |
| 40 | Grown-up forms | Only if growing up is ever added: it is not in this version, on purpose (see `DESIGN.md`). One per kind. All forty have a name in the table of kinds; eighteen have a line for the painter (below). Bosses do not grow. |
| 1 | Things for the world | One sheet of painted gateways. Every place is built and painted now, and the country between has its own sheet of things. It shares the lane's grass: a ground of its own (a meadow, a ploughed field) would be one more image each. |
| 17 | Icons | Six elements, three Calls, three stats (Health exists), four tabs, the Heirloom mark. |
| 1 | Title art | The app icon is painted. |
| **60** | **new images** | Fewer if things are painted several to a sheet. |

No longer needed, because the two world images covered them: a painted map of the neighbourhood, the nine buildings, and a painted map for every place (a ground tile and things to stand on it build those).

What the eight places took: the garden nothing of its own (it is the world's grass, bushes and trees); Tin Can Alley two images (a sheet and a texture); and each of the six you walk into, and home, three (a sheet, a wall and a floor). A new place out of doors would cost what the alley did, and one indoors what a room did.

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
