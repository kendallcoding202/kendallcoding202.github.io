# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 49: the first 40 kinds, the first 8 bosses, and Fluff (the dust bunny who sits beside each Keepsake) |
| Room paintings | Pawst Lives, copied as they are | 8, one for each place: what its fights are seen against |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 40, one for every kind |
| The house-sitter | **Generated for this game** | 4 images: four candidate looks (`sitter_a` to `sitter_d`), from the side |
| The house-sitter, turned | **Generated for this game** | 4 images, one per look, each holding that look from the front and from behind (8 sprites) |
| The cast | **Generated for this game** | 1 image holding all four: Ines Tock, Dov, Mr. Spick, Great-aunt Maribel |
| The rival | **Generated for this game** | 1 image (`cast_tansy`): Tansy Brisk, junior clearance officer, in the words used for the cast so that she stands beside them |
| The world | **Generated for this game** | 2 images, which became 14 pictures (below) |
| Tin Can Alley | **Generated for this game** | 2 images, which became 13 pictures (below) |
| The country between the rows of houses | **Generated for this game** | 1 image (`road_sheet`): a sheet of twelve things, of which eleven are used: a bench, a signpost, a well, a haystack, a scarecrow, a pile of logs, a rock, a white fence, a wheelbarrow, a mailbox and a pond. The twelfth, a milestone, came out looking like a headstone and is left out |
| The lane, as a fight is seen against it | **Generated for this game** | 1 image (`bg_lane`), asked for in the words Pawst Lives used for its eight room paintings, so it sits beside them. It is what a fight with strays, out on the lane, is seen against |
| App icon | **Generated for this game** | 1 image: the house-sitter with a lantern and a calm Hopmote (the dust under the bed). `tools/ios-art.py` makes the icon from it |
| The insides of the seven buildings you walk into | **Generated for this game** | 21 images, three to a room, which became 98 pictures (below) |
| The grown-up form of each of the forty kinds | **Generated for this game** | 40 images, one a kind, each painted from the kind's own Pawst Lives picture so that it is plainly the same creature, older and bigger (below) |
| The eight keys | **Generated for this game** | 2 images: one sheet of eight keys, and the rooftop key again on its own (below) |
| Launch image and loading screen | Painted from the game's own world by `tools/postcard.mjs` | A postcard of the lane, home in the middle; nothing generated |

**Two hundred and sixteen images have been generated in all. One hundred and eighty-four are used in the game, and thirty-two were set aside.** (The two hundred and sixteenth is the rival, Tansy Brisk, of 18 November 2026.) One hundred and ten of them are chapter two's, of 18 November 2026, and are accounted for under *Chapter two: the far bank*, below. What follows in this paragraph is the first hundred and five, of which seventy-nine are used. Thirty-seven are everything before the grown-up forms, and each of those is in the game. Sixty-six were made for the grown-up forms on 18 November 2026, after the owner said "yes you can start on the new forms": twenty-two to a first brief (the young one, with new things added), which came out as the young one in the same pose wearing something, and were set aside when the owner said "Make sure the change is obvious enough"; eight to try a bolder brief two ways, four with the young one's picture to work from and four from words alone (the four from words alone drifted from the Pawst Lives look and were set aside); and thirty-six more to the bolder brief with the picture. The forty in the game are those thirty-six and the four of the trial that were painted from the picture. Two are the keys, made the same day when the owner asked for "special looking keys": a sheet of eight, and one more of the rooftop key, because on the sheet its bow came out as a star set inside a crescent, which reads as an emblem and not as a moon over rooftops; the one used has a chimney pot in the moon's curve and no star. Of the first thirty-seven: the first fourteen were each agreed before they were made. Twenty-one are the rooms, one is the lane seen as a fight's backdrop, and one is the sheet of things for the country, made on 16 November 2026 after the owner approved spending on them ("I approve spending on the rooms and anything we need for the game, I want a polished good looking game"). Every one of those thirty-seven came out usable on the first attempt (one thing on the last sheet, a milestone, is not used). One has been touched up since, in code and for nothing: on the icon the pencil in her hair was painted lying on top of the bun, and `tools/ios-art.py` grows hair over its lower end so that it comes out of the bun instead. The archived original is as it was painted. Close up, the covered patch is a little softer than the hair round it; a repaint would be one more image.

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

Tansy Brisk, the rival, was painted later and on her own, in the same words as the cast with a description of her own: a young woman in a pale-blue boiler suit a size too big, a yellow armband, round glasses and a blunt black fringe, a clipboard, a feather duster on her belt and flat-packed boxes on her back. Set beside Mr. Spick, Ines Tock and the house-sitter she is the same height, line and colour. She was looked at for a likeness to anybody in another game and has none that I can see: a clearance officer with a clipboard is nobody's character but ours.

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

## The eight keys

One sheet (`art/raw/world_keys.webp`), which `tools/process-art.py` cuts into its eight keys in the order of the places, and one more painting for the rooftop key (`art/raw/world_key_rooftops.webp`), used in place of the sheet's. Each key says where it is from by its bow: a leaf and a daisy for the garden gate; a bottle cap and a ring-pull for Tin Can Alley; a slice of toast with a bite out of it for the pantry; a ring of soap bubbles and a clothes peg for the Wash; an open book with a ribbon for the Dusty Stacks; a crescent moon, a chimney pot and a weathercock for the rooftops; the wings of a clock key with a gear for the attic; and a swirl of dust round one red light for the Roaring Dark. A key not yet earned is shown as the same picture, blacked out.

## The forty grown-up forms

Every kind that can be a friend has one (ringleaders do not grow). Each was painted from the young one's own picture, with a brief that asks for a new drawing: a new pose, a bigger build and a changed outline, so that the change is plain at a glance and it is still plainly the same creature. The whole brief for each is in `tools/art-manifest.mjs`; this is the start of it. A grown form's picture is kept a tenth larger than a young one's, and the game draws it bigger again. Its Heirloom colours are the same recolour as its kind's, made by `tools/heirlooms.py`.

| Kind | Grows up into | At level | The brief begins |
| --- | --- | --- | --- |
| Hopmote | Hartmote | 8 | A tall, proud stag-like beast made entirely of grey dust and lint. |
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
| Pegadile | Clipgator | 12 | A long, heavy crocodile built from dozens of wooden clothes pegs, rearing its head up with jaws wide open. |
| Footnote | Marginalia | 13 | A long, thick green bookworm reared up tall in an S shape out of a towering. |
| Dribblewax | Everwick | 13 | A wax giant: a very tall. |
| Blottle | Wellspill | 13 | A great wave of dark-blue ink towering up and curling over like a breaking wave out of a large tipped-over glass inkwell, with two big dripping arms spread wide, long splashes and drops flying, white glowing eyes high in the crest of the wave, a gold fountain-pen nib on its head like a crow. |
| Inkspine | Scrivenspine | 13 | A big porcupine standing upright on its hind legs like a stern clerk, with round glasses on its nose. |
| Foldwing | Broadsheet | 13 | A tall, elegant origami heron folded from many sheets of newspaper. |
| Gutterflit | Eaveswoop | 14 | A big purple bat swooping with enormous wings spread wide, each wing covered in overlapping orange. |
| Shingleskink | Slateridge | 14 | A big, heavy, broad gecko climbing upward with its body curved in an S, three times as bulky as before. |
| Vanecrow | Galecomb | 14 | A large, proud green-copper weathercock rooster with wings spread wide and beak open, crowing into a gale. |
| Spoutling | Grimspout | 14 | A massive hunched stone grotesque crouching on a carved stone ledge, twice as big and broad as before. |
| Emberdrift | Smokecrown | 14 | A tall towering spirit of purple smoke rising in a great twisting column out of a brick chimney stack with two terracotta pots, with broad smoky shoulders, two long arms of smoke, glowing ember eyes and a wide ember grin, wearing a tall crown made of rings of smoke set with glowing embers like jewels, sparks drifting u. |
| Cogscuttle | Cogmarshal | 15 | A big brass clockwork beetle standing upright on its hind legs like a general on parade. |
| Stalwind | Marchwind | 15 | A tall tin toy drum major marching with one knee raised high. |
| Tocktalon | Midnightjar | 15 | A large night bird bursting out of the top of a tall wooden cuckoo-clock tower with its wings spread wide. |
| Lampmourn | Lanternlorn | 15 | A large ghostly moth with four great tattered wings spread wide, each with a softly glowing eye spot. |
| Crankjaw | Harlecrank | 15 | A tall, gangly jester sprung high out of a big fancy striped box on a long coiled spring. |
| Tanglecoil | Drumcoil | 16 | A gigantic snake made of thick braided black power cables with red, yellow and green wires woven through. |
| Grimeshade | Shroudmote | 16 | A large, tall, drifting wraith of dark dust and cobwebs with glowing cyan eyes. |
| Bumpabout | Rovabout | 16 | A big all-terrain robot vacuum cleaner raised high on four chunky off-road wheels with springs. |

## Chapter two: the far bank

Painted on 18 November 2026, after the owner asked to double the number of creatures and chose four new places to put half of them in ("Go with the four new places"), and asked for "a legendary or something similar type creature at the end of each chapter". One hundred and ten images were generated for it: four trials of the first new kinds, to see whether a brief of words alone would sit beside the Pawst Lives monsters (it does: the brief is the Pawst Lives monster brief word for word, with one sentence added, that the creature is nobody else's); forty young forms; forty grown forms, each painted from its young one's picture; four ringleaders; four paintings for a fight to be seen against; two Keepsakes; twelve for the four rooms (a sheet of twelve things, a back wall and a floor each); one sheet for the far bank (its four buildings, the gate on the bridge, a boat, reeds, lily pads, a beehive, a barrow, a pump and crates); one sheet of four keys; and two done again. The grown paint-brush fox first came out with three tails, too close to a well-known many-tailed fox, and was redone with one. The Deep End's floor first came out as a black and white checkerboard that nobody could be seen against, and was redone in two soft greens. I looked at every one.

Each kind's rare Heirloom colours are made from its own picture by `tools/heirlooms.py`, as before: nothing generated.

### The forty new kinds

| Where it lives | Young | Grown up | Element | What it is (from its brief) |
|---|---|---|---|---|
| The Garden Gate | Tintrunk (`canphant`) | Raintusker | Suds | A small grumpy elephant made from a dented green tin watering can: the long spout is its trunk with the… |
| The Garden Gate | Fumblethumb (`glovecrab`) | Secateer | Sprout | A single green-and-tan canvas gardening glove that scuttles on its five fingertips like a crab, the open cuff… |
| Tin Can Alley | Brollyflap (`brollybat`) | Squallbrella | Fluff | A broken black umbrella that flies like a bat: bent silver ribs for wing bones, torn black cloth wings, the… |
| Tin Can Alley | Wonkwheel (`trolleypup`) | Trundlebeast | Clank | A small dog-like creature made from a wire shopping basket on four little trolley wheels, one wheel bent… |
| Tin Can Alley | Coneling (`conekin`) | Beaconspire | Spark | A small orange-and-white striped traffic cone with stubby legs and arms, a flashing amber road lamp on its… |
| The Midnight Pantry | Steepling (`teabagjelly`) | Teapotentate | Suds | A floating jellyfish that is a plump wet brown pyramid teabag with a sleepy cross face, its string and square… |
| The Midnight Pantry | Whisklet (`whiskbird`) | Whirlwhisk | Clank | A small wiry bird whose round body is a steel balloon whisk: the looped whisk wires form its cage of a chest,… |
| The Midnight Pantry | Gherkroak (`picklefrog`) | Brinebelly | Crumb | A warty green frog shaped like a pickled gherkin, squatting half out of an open glass pickle jar full of… |
| The Wash | Steamstoat (`ironweasel`) | Starchback | Spark | A small sleek weasel whose body is a little steam iron: the shiny flat soleplate is its belly, the handle… |
| The Wash | Hamperling (`baskettortoise`) | Wickerback | Fluff | A small tortoise whose shell is a round wicker laundry basket with a lid, a striped sock and a shirt sleeve… |
| The Wash | Zipnip (`zipcrawler`) | Zipperpede | Clank | A small centipede made of a brass zip: the two rows of zip teeth are its many little legs, the zip slider… |
| The Dusty Stacks | Stampling (`stamphopper`) | Inkstomper | Clank | A small hopping creature that is a wooden-handled rubber date stamp: a round wooden knob for a head with a… |
| The Dusty Stacks | Globlet (`globehog`) | Worldwhirl | Fluff | A small hedgehog-like creature curled round an old desk globe: the globe with blue seas and yellowed land is… |
| Moonlit Rooftops | Statichare (`aerialhare`) | Dishleaper | Spark | A lean grey hare whose long ears are a bent pair of telescopic silver television aerial rods, with a little… |
| Moonlit Rooftops | Snagkite (`kiteray`) | Stunthawk | Fluff | A diamond-shaped paper kite that swims through the air like a manta ray: red and yellow patched paper with a… |
| The Tick-Tock Attic | Patchpaw (`teddybear`) | Darnbruin | Fluff | A small moth-eaten teddy bear that has come alive, tan fur worn thin, one button eye and one empty patch with… |
| The Tick-Tock Attic | Flurryglobe (`snowglobe`) | Blizzardome | Suds | A small snow globe creature: a glass dome on a red wooden base with little feet, inside it a tiny frowning… |
| The Roaring Dark | Burrowbeam (`torchmole`) | Dazzledig | Spark | A small velvet-black mole whose long snout is an old yellow rubber torch shining a bright beam of light, big… |
| The Roaring Dark | Scuffpup (`bootpup`) | Hobnailhound | Fluff | A puppy made from an old brown leather walking boot: the open top of the boot is its mouth with the boot's… |
| The Roaring Dark | Dustpincer (`dustpancrab`) | Sweepclaw | Clank | A crab whose shell is a red metal dustpan worn on its back, one big claw is a stiff-bristled hand brush and… |
| The Glasshouse | Sproutlark (`seedfinch`) | Harvestwing | Sprout | A small plump bird folded from a paper seed packet with a faded picture of a sunflower on its chest, wings of… |
| The Glasshouse | Terracub (`potcub`) | Kilnbear | Clank | A small bear cub wearing a terracotta flowerpot: its body is the upturned clay pot with a chip out of the… |
| The Glasshouse | Mulchkin (`compostkin`) | Steamheap | Sprout | A small round creature made of dark crumbly compost with potato peelings, bits of eggshell and leaves stuck… |
| The Glasshouse | Tomarin (`tomatomonkey`) | Tomatogre | Crumb | A small monkey whose head and body are two ripe red tomatoes with a green leafy stalk for a cap of hair, long… |
| The Glasshouse | Trailbloom (`basketjelly`) | Hangarden | Suds | A floating jellyfish that is a hanging flower basket: a moss-lined wire basket dome with a hook and three… |
| The Deep End | Squeakbill (`rubberduck`) | Squeakswan | Suds | A cross yellow rubber bath duck with a chipped orange beak, a squeaker hole in its side, a tuft of soap foam… |
| The Deep End | Mintgrub (`pastegrub`) | Pastepillar | Suds | A fat caterpillar that is a half-squeezed tube of toothpaste: a white tube body with blue and red stripes,… |
| The Deep End | Loofling (`loofahdillo`) | Scrubadillo | Sprout | A small armadillo whose armour is a tan natural loofah sponge with a rough fibrous net texture, a loop of… |
| The Deep End | Clogtuft (`drainhair`) | Clogmane | Fluff | A small scruffy creature made of a wet tangled clump of dark hair like a tumbleweed with eight wispy hair… |
| The Deep End | Showershade (`curtainghost`) | Curtaincall | Fluff | A ghost made of a white plastic shower curtain patterned with little blue fish and a few grey mildew spots, a… |
| The Tinker's Shed | Tapetail (`tapelizard`) | Yardwhip | Clank | A small lizard whose body is a yellow retractable tape measure case, with the steel measuring tape pulled out… |
| The Tinker's Shed | Peckhammer (`hammerpecker`) | Sledgebeak | Clank | A woodpecker whose head and beak are a steel claw hammer, the claw of the hammer standing up as its crest, on… |
| The Tinker's Shed | Daubfox (`brushfox`) | Glossvixen | Suds | A small fox whose big bushy tail is a wide paintbrush loaded with bright blue paint, orange fur splashed with… |
| The Tinker's Shed | Sawnose (`sawfish`) | Bandsawback | Clank | A small sawfish that swims through sawdust: its long flat nose is a toothed hand-saw blade, a red wooden saw… |
| The Tinker's Shed | Filamoth (`bulbmoth`) | Lumenwing | Spark | A moth whose plump body is an old clear glass light bulb with a glowing orange filament inside and a brass… |
| The Mending Room | Pinbobber (`pinpuffer`) | Needleglobe | Fluff | A round pufferfish that is a red tomato-shaped pincushion with green felt leaves on top, stuck all over with… |
| The Mending Room | Thimblet (`thimblemouse`) | Thimbleguard | Clank | A tiny brave grey mouse wearing a silver thimble as a helmet, holding a sewing needle threaded with red… |
| The Mending Room | Snipstork (`scissorstork`) | Shearcrane | Clank | A tall thin stork whose long beak is a pair of silver dressmaking scissors and whose legs are two long sewing… |
| The Mending Room | Buttonhoot (`buttonowl`) | Haberhoot | Fluff | A round owl made entirely of mismatched buttons like feathers (pearl, brass and coloured ones), with two big… |
| The Mending Room | Doilyspin (`lacespider`) | Lacewidow | Fluff | A neat little white spider sitting in the middle of a round lace doily it is still making, with a cotton reel… |

### The four ringleaders

| Place | Ringleader | Element | What it is |
|---|---|---|---|
| The Glasshouse | The Prize Marrow (`boss_marrow`) | Sprout | The Prize Marrow, an enormous green striped vegetable marrow monster the size of a sofa, with a wide scowling face, thick curling vine tendrils for… |
| The Deep End | Old Clawfoot (`boss_bathtub`) | Suds | Old Clawfoot, a huge white cast-iron bathtub monster walking on four heavy lion-paw iron feet, brimming over with foamy water, two brass taps like… |
| The Tinker's Shed | Captain Twostroke (`boss_mower`) | Clank | Captain Twostroke, a monstrous old red petrol lawnmower rearing up like a bull, with a snarling grille mouth full of spinning steel blades, two… |
| The Mending Room | Madam Treadle (`boss_treadle`) | Fluff | Madam Treadle, a towering antique black sewing machine monster with gold scrollwork, standing on its cast-iron treadle table legs like a spider, a… |

### The two Keepsakes

| Chapter | Keepsake | Element | What it is |
|---|---|---|---|
| 1 | Lullawren (`keep_musicbox`) | Clank | A small, graceful nightingale made from an old music box: a body that is a little lacquered wooden music box with its lid open like wings showing the brass comb and… |
| 2 | Farewhale (`keep_bottleship`) | Suds | A small gentle whale that is a clear glass bottle lying on its side, with a tiny three-masted sailing ship inside it riding a little blue sea, the cork in the bottle's… |

Fluff, who sits beside each Keepsake, is not in this count and is not in `tools/art-manifest.mjs`: its picture (`web/assets/sprites/npc_fluff.webp`) is the one painted for Pawst Lives on that game's own account, copied here as it is.

### The rooms, the far bank and the keys

The four places over the water are rooms you walk into, made as the lane's six are: `art/raw/<room>_sheet.webp`, `<room>_wall.webp` and `<room>_floor.webp` for `glasshouse`, `deepend`, `shed` and `mending`, cut and sized by `tools/process-art.py` into fourteen pictures a room. Each back wall is one painting right across. The far bank's sheet is `art/raw/world_far_sheet.webp` (the buildings are `b_<place>`, the rest `r_<thing>`, in `web/assets/world/`); the four keys are `art/raw/world_keys2.webp`, cut two by two in the order of the places.

Drawn in code, not painted: the river, the moonlight moving on it, and the deck of the bridge. The gate on the bridge is the sheet's painting; when it is open only its two posts are shown.

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
