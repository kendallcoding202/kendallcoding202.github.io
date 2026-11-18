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
| The grown-up form of each of the forty kinds | **Generated for this game** | 40 images, one a kind, each painted from the kind's own Pawst Lives picture so that it is plainly the same creature, older and bigger (below) |
| Launch image and loading screen | Painted from the game's own world by `tools/postcard.mjs` | A postcard of the lane, home in the middle; nothing generated |

**One hundred and three images have been generated in all, and seventy-seven of them are used.** Thirty-seven are everything before the grown-up forms, and each of those is in the game. Sixty-six were made for the grown-up forms on 18 November 2026, after the owner said "yes you can start on the new forms": twenty-two to a first brief (the young one, with new things added), which came out as the young one in the same pose wearing something, and were set aside when the owner said "Make sure the change is obvious enough"; eight to try a bolder brief two ways, four with the young one's picture to work from and four from words alone (the four from words alone drifted from the Pawst Lives look and were set aside); and thirty-six more to the bolder brief with the picture. The forty in the game are those thirty-six and the four of the trial that were painted from the picture. Of the first thirty-seven: the first fourteen were each agreed before they were made. Twenty-one are the rooms, one is the lane seen as a fight's backdrop, and one is the sheet of things for the country, made on 16 November 2026 after the owner approved spending on them ("I approve spending on the rooms and anything we need for the game, I want a polished good looking game"). Every one of those thirty-seven came out usable on the first attempt (one thing on the last sheet, a milestone, is not used). One has been touched up since, in code and for nothing: on the icon the pencil in her hair was painted lying on top of the bun, and `tools/ios-art.py` grows hair over its lower end so that it comes out of the bun instead. The archived original is as it was painted. Close up, the covered patch is a little softer than the hair round it; a repaint would be one more image.

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

## The forty grown-up forms

Every kind that can be a friend has one (ringleaders do not grow). Each was painted from the young one's own picture, with a brief that asks for a new drawing: a new pose, a bigger build and a changed outline, so that the change is plain at a glance and it is still plainly the same creature. The whole brief for each is in `tools/art-manifest.mjs`; this is the start of it. A grown form's picture is kept a tenth larger than a young one's, and the game draws it bigger again. Its Heirloom colours are the same recolour as its kind's, made by `tools/heirlooms.py`.

| Kind | Grows up into | At level | The brief begins |
| --- | --- | --- | --- |
| Hopmote | Lintelope | 8 | A tall, proud stag-like beast made entirely of grey dust and lint. |
| Eelastic | Toeviathan | 8 | A huge sea serpent made of one very long blue-and-yellow striped stocking. |
| Crumbwisp | Crustwraith | 8 | A towering hooded wraith made of burnt toast. |
| Wishclock | Wishmane | 9 | A proud lion made from a dandelion plant. |
| Pricklebud | Briartusk | 9 | A great wild boar made of a whole rose hedge, head lowered to charge. |
| Grumbuzz | Rumblepatch | 9 | A huge, heavy bumblebee standing upright like a wrestler, twice as broad as before. |
| Shellfarer | Seawhorl | 9 | A grand sea snail rearing up tall on a wave-shaped foot. |
| Gnomudgeon | Gnomarch | 9 | A stout garden-gnome king standing tall with one boot up on an upturned flowerpot. |
| Crimpet | Corkhorn | 9 | A hulking rhinoceros beetle reared up on its hind legs like a strongman, twice the size. |
| Strayglow | Floodglow | 9 | A tall armoured knight built from electrical fittings. |
| Snaffle | Snafflemore | 9 | A big, burly, broad-shouldered brown rat standing tall like a bandit chief. |
| Hermitin | Clangster | 10 | A huge red lobster-like hermit crab rearing up with both enormous claws raised and snapping. |
| Frayling | Woolligan | 10 | A hulking troll knitted from a whole red-and-white striped woolly jumper. |
| Preenager | Kingpinion | 10 | A big, stout, barrel-chested pigeon boss standing with wings on hips. |
| Scrumpling | Scrumplord | 11 | A big warlord dumpling. |
| Embernip | Scorchfoot | 11 | A tall, lean, long-limbed red chilli-pepper devil standing upright with arms folded and a swaggering grin. |
| Eggallant | Eggalahad | 11 | A tall noble egg knight striding forward. |
| Wibblet | Blancmangler | 11 | A towering wobbling jelly monster in three big tiers like a wedding cake, each tier a deeper pink. |
| Shimmerbell | Glistenveil | 12 | A tall, queenly jellyfish made of soap bubbles. |
| Slipsud | Latherback | 12 | A massive pink soap slug reared up like a walrus, three times as big, shaped like a great new bar of soap. |
| Fluffolith | Linthenge | 12 | A towering giant made of blue-grey dryer lint with button eyes, built like a ring of standing stones. |
| Pegadile | Clampodile | 12 | A long, heavy crocodile built from dozens of wooden clothes pegs, rearing its head up with jaws wide open. |
| Footnote | Appendix | 13 | A long, thick green bookworm reared up tall in an S shape out of a towering. |
| Dribblewax | Candelabrute | 13 | A wax giant: a very tall. |
| Blottle | Wellspill | 13 | A great wave of dark-blue ink towering up and curling over like a breaking wave out of a large tipped-over glass inkwell, with two big dripping arms spread wide, long splashes and drops flying, white glowing eyes high in the crest of the wave, a gold fountain-pen nib on its head like a crow. |
| Inkspine | Scrivenspine | 13 | A big porcupine standing upright on its hind legs like a stern clerk, with round glasses on its nose. |
| Foldwing | Broadsheet | 13 | A tall, elegant origami heron folded from many sheets of newspaper. |
| Gutterflit | Eaveswoop | 14 | A big purple bat swooping with enormous wings spread wide, each wing covered in overlapping orange. |
| Shingleskink | Slatedrake | 14 | A big, heavy, broad gecko climbing upward with its body curved in an S, three times as bulky as before. |
| Vanecrow | Galecomb | 14 | A large, proud green-copper weathercock rooster with wings spread wide and beak open, crowing into a gale. |
| Spoutling | Grotesque | 14 | A massive hunched stone grotesque crouching on a carved stone ledge, twice as big and broad as before. |
| Emberdrift | Smokecrown | 14 | A tall towering spirit of purple smoke rising in a great twisting column out of a brick chimney stack with two terracotta pots, with broad smoky shoulders, two long arms of smoke, glowing ember eyes and a wide ember grin, wearing a tall crown made of rings of smoke set with glowing embers like jewels, sparks drifting u. |
| Cogscuttle | Cogmarshal | 15 | A big brass clockwork beetle standing upright on its hind legs like a general on parade. |
| Stalwind | Marchwind | 15 | A tall tin toy drum major marching with one knee raised high. |
| Tocktalon | Midnightjar | 15 | A large night bird bursting out of the top of a tall wooden cuckoo-clock tower with its wings spread wide. |
| Lampmourn | Lanternlorn | 15 | A large ghostly moth with four great tattered wings spread wide, each with a softly glowing eye spot. |
| Crankjaw | Jackanapes | 15 | A tall, gangly jester sprung high out of a big fancy striped box on a long coiled spring. |
| Tanglecoil | Anacorda | 16 | A gigantic snake made of thick braided black power cables with red, yellow and green wires woven through. |
| Grimeshade | Gloomdrift | 16 | A large, tall, drifting wraith of dark dust and cobwebs with glowing cyan eyes. |
| Bumpabout | Rovabout | 16 | A big all-terrain robot vacuum cleaner raised high on four chunky off-road wheels with springs. |

## Making art

```sh
NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs   # generates only what is in the manifest and missing. Costs money.
                                              # (A grown-up form is painted from its kind's picture: set ART_REF_DIR to a folder of the
                                              # Pawst Lives originals to work from those; otherwise the game's own small copy is used.)
python3 tools/process-art.py                  # trims and sizes art/raw/ into web/assets/, cuts the sheets, makes the ground tiles
python3 tools/ios-art.py                      # makes the app icon from the icon painting
node tools/postcard.mjs                       # paints the loading screen and launch image from the game's own world (needs Playwright)
python3 tools/heirlooms.py                    # repaints every Heirloom, young and grown; contact sheets in art/review/
```

Nothing is generated unless it is listed in `tools/art-manifest.mjs`, and nothing goes on that list until it has been agreed.
