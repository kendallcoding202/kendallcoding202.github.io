// Every piece of art generated for this game, with the prompt that made it.
// `tools/gen-art.mjs` reads this; `tools/process-art.py` turns the raw images
// into the web-sized assets under web/assets/.
//
// The monsters, rooms, icons and font are not here: they were painted for
// Pawst Lives and are copied from it as they are (see docs/ART.md). What is
// here is only what this game adds. SPRITE_STYLE is the Pawst Lives style
// prompt, word for word, so new art sits beside the old without a seam.
//
// Generating costs money. Add an entry only once the art has been agreed.

const SPRITE_STYLE =
  'Style: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, ' +
  'vibrant saturated colors, sticker-like, chibi proportions, cute but with attitude. ' +
  'Full body visible with empty margin on all sides, centered, a single character only, ' +
  'no ground, no shadow, no text, no border. Transparent background.';

// A person. Faces right, like everything on the player's side.
const human = (id, desc) => ({
  id, kind: 'human', size: '1024x1024', quality: 'medium', transparent: true,
  prompt: `A single game character sprite: ${desc} Standing upright, facing right in side three-quarter view. Big head, warm friendly but determined expression. An original character, not based on any existing game, film or cartoon character. ${SPRITE_STYLE}`,
});

// Two more views of a person already painted, so they can face any way they walk: one image holding
// the same character from the front and from behind. `ref` is the painting to match: where the
// image service takes a picture to work from it is given that one; where it does not, the words do.
const PEOPLE_STYLE =
  'Style: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, ' +
  'vibrant saturated colors, sticker-like, chibi proportions with a big head, cute but with attitude. ' +
  'Full bodies visible with empty margin on all sides, no ground, no shadow, no text, no letters, no border. Transparent background.';
const turnaround = (ref, desc) => ({
  id: `${ref}_turn`, kind: 'turn', ref, size: '1536x1024', quality: 'medium', transparent: true,
  prompt:
    `Two views of one and the same game character, the character shown in the reference picture: ${desc} ` +
    'Draw exactly two full-body figures side by side with a wide empty gap between them, the same height, feet on the same level, both standing upright. ' +
    'LEFT figure: seen straight from the FRONT, facing the viewer, looking at the viewer. ' +
    'RIGHT figure: seen straight from BEHIND, back to the viewer, face not visible. ' +
    'Both figures have exactly the same hair, skin, clothes, colours, proportions and carried things as the reference picture, and the same drawing style. ' +
    `An original character, not based on any existing game, film or cartoon character. ${PEOPLE_STYLE}`,
});

// The world you walk in. The same look as the sprites (it is the Pawst Lives
// sprite style, less the words that only fit a single character), so buildings
// sit beside the monsters as if painted together.
const WORLD_STYLE =
  'Style: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, ' +
  'vibrant saturated colors, sticker-like, chunky and cute. ' +
  'No ground, no shadow, no text, no letters, no numbers, no border. Transparent background.';

// A kind's grown-up form, painted from the kind's own picture (the Pawst Lives original, or the
// game's copy of it) so that it is plainly the same creature, older. Agreed on 18 November 2026:
// "yes you can start on the new forms", and then: "Make sure the change is obvious enough."
// A first brief ("the same creature, with these things added") gave paintings that were the young
// one in the same pose wearing something new, which was not obvious enough. This brief asks for a
// new drawing: a new pose, a bigger build, a changed outline, and the new features drawn large; and
// every description below says what the new shape is. Everything faces left, as the monsters do.
// (The style is the Pawst Lives sprite style, less "chibi": a grown one has a smaller head for its body.)
const GROWN_STYLE =
  'Style: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, ' +
  'vibrant saturated colors, sticker-like, chunky cartoon proportions, cute but with attitude. ' +
  'Full body visible with empty margin on all sides, centered, a single character only, ' +
  'no ground, no shadow, no text, no border. Transparent background.';
const grown = (base, desc) => ({
  id: `${base}_grown`, kind: 'grown', ref: base, size: '1024x1024', quality: 'medium', transparent: true,
  prompt:
    `A single game monster sprite. The reference picture shows this creature when it was young and small. Paint the same creature fully grown up, as a new drawing: ${desc} ` +
    'It has to look obviously different from the reference picture at a glance: much bigger and more heavily built, with sturdier grown-up proportions (a smaller head for its body, a longer and stronger body), in a new, bolder pose that is NOT the pose of the reference picture, and with its new features drawn large. ' +
    'It must still be recognisably the same creature: the same materials, the same colours, the same kind of face and eyes, the same drawing style. ' +
    `Facing left in side three-quarter view, proud and fierce with a hint of mischief. An original creature, not based on any existing game, film or cartoon character. ${GROWN_STYLE}`,
});

// ---- the insides of buildings ----
// A room you walk into is three pictures: a sheet of twelve things that stand in it (cut apart by
// tools/process-art.py, in the order given), its back wall seen straight on, and its floor seen
// from above. Agreed on 16 November 2026: "I approve spending on the rooms".
const roomSheet = (room, where, rows) => ({
  id: `${room}_sheet`, kind: 'sheet', size: '1536x1024', quality: 'medium', transparent: true,
  prompt:
    'A sprite sheet for a game: exactly twelve separate objects arranged in a neat grid of three rows and four columns, evenly spaced, ' +
    'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at a similar size. ' +
    `They are things from ${where}, each seen from the front and slightly from above unless said otherwise. ` +
    rows.map((row, i) => `Row ${['one', 'two', 'three'][i]}, left to right: ${row.join('; ')}.`).join(' ') + ' ' +
    WORLD_STYLE,
});
const roomWall = (room, what) => ({
  id: `${room}_wall`, kind: 'wall', size: '1536x1024', quality: 'medium', transparent: false,
  prompt:
    `The back wall of a room in a 2D mobile game, seen perfectly straight on like a stage backdrop: ${what} ` +
    'A very wide wall that fills the whole image from the left edge to the right edge with no side walls, no corners and no perspective. ' +
    'Everything of interest sits in the middle band of the picture; the top fifth and the bottom fifth are plain wall. ' +
    'No floor, no ceiling, no people, no creatures, no animals, no text, no letters, no numbers, no border. ' +
    'Style: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, rich night-time colours, chunky and cute.',
});
const roomFloor = (room, what) => ({
  id: `${room}_floor`, kind: 'tile', size: '1024x1024', quality: 'medium', transparent: false,
  prompt:
    `A seamless tileable floor texture for a 2D mobile game, seen from directly above: ${what} ` +
    'Painterly flat shapes with soft gradients. Evenly lit, no shadows, no objects, no rugs, no furniture, no text. ' +
    'Slightly desaturated and low in contrast so characters stand out on top of it. The texture fills the whole square image from edge to edge.',
});

// ---- what a fight is seen against ----
// The eight places have the room paintings of Pawst Lives. A fight with strays, out on the lane,
// needs one of its own. BG_STYLE is the Pawst Lives style for those paintings, word for word.
const BG_STYLE =
  'Style: clean 2D mobile game background art, painterly flat shapes, soft gradients, no outlines on distant things, ' +
  'slightly desaturated so characters stand out. Side-scrolling platformer background seen from a low, cat\'s-eye viewpoint, ' +
  'everyday household things look enormous. The bottom quarter of the image is a flat, even, uncluttered ground strip running ' +
  'the full width for characters to stand on. No characters, no animals, no text.';
const backdrop = (id, desc) => ({ id, kind: 'bg', size: '1536x1024', quality: 'medium', transparent: false, prompt: `${desc} ${BG_STYLE}` });

export const ART = [
  // ---- the house-sitter (the player): four candidate looks to choose from ----
  human('sitter_a', 'a young adult woman house-sitter with warm brown skin and curly dark hair in a messy bun held by a pencil, wearing an oversized mustard-yellow knitted cardigan over teal pyjamas, mismatched socks (one red-striped, one blue-dotted) and no shoes, holding up a small glowing brass wind-up lantern in one hand, the other hand held out open in a friendly way.'),
  human('sitter_b', 'a tall lanky young adult man house-sitter with dark brown skin, short twisted hair and round glasses, wearing a plum-purple quilted dressing gown over striped pyjamas and fluffy grey slippers, holding a big chunky flashlight with a warm beam in one hand, the other hand held out open in a friendly way.'),
  human('sitter_c', 'a short stocky young adult house-sitter with tan skin, freckles and a chin-length bob of teal-dyed hair, wearing a camping headlamp on the forehead, a baggy cream cable-knit jumper with rolled sleeves, patched olive-green dungarees and yellow rubber boots, a feather duster tucked in the belt, one hand held out open in a friendly way.'),
  human('sitter_d', 'a young adult house-sitter with East Asian features and short choppy black hair, wrapped in a colourful patchwork quilt worn like a cape over grey pyjamas, a big ring of old house keys at the belt, carrying a lit candle in a brass chamber-stick holder in one hand, the other hand held out open in a friendly way.'),
  // ---- the house-sitter from the front and from behind, one image per look ----
  // (tools/process-art.py cuts each into its two figures: <look>_front and <look>_back.)
  turnaround('sitter_a', 'a young adult woman house-sitter with warm brown skin and curly dark hair in a messy bun held by a pencil, wearing an oversized mustard-yellow knitted cardigan over teal pyjamas, mismatched socks (one red-striped, one blue-dotted) and no shoes, holding a small glowing brass wind-up lantern in one hand.'),
  turnaround('sitter_b', 'a tall lanky young adult man house-sitter with dark brown skin, short twisted hair and round glasses, wearing a plum-purple quilted dressing gown over striped pyjamas and fluffy grey slippers, holding a big chunky flashlight in one hand.'),
  turnaround('sitter_c', 'a short stocky young adult house-sitter with tan skin, freckles and a chin-length bob of teal-dyed hair, wearing a camping headlamp on the forehead, a baggy cream cable-knit jumper with rolled sleeves, patched olive-green dungarees and yellow rubber boots, a feather duster tucked in the belt.'),
  turnaround('sitter_d', 'a young adult house-sitter with East Asian features and short choppy black hair, wrapped in a colourful patchwork quilt worn like a cape over grey pyjamas, a big ring of old house keys at the belt, carrying a lit candle in a brass chamber-stick holder in one hand.'),
  // ---- the cast: the four people of the lane, on one sheet ----
  // (tools/process-art.py cuts it into cast_ines, cast_dov, cast_spick and cast_maribel, left to right.)
  {
    id: 'cast_sheet', kind: 'cast', size: '1536x1024', quality: 'medium', transparent: true,
    prompt:
      'Four separate game character sprites in one image, standing in a single row, evenly spaced with a wide empty gap between each, none touching or overlapping, ' +
      'feet on the same level, all drawn in the same style and to the same scale (the child clearly shorter than the adults). ' +
      'Each stands upright facing the viewer, turned very slightly to the right, full body. Left to right: ' +
      'ONE: a stout elderly woman clock-mender with deep brown skin and silver hair wrapped up in a patterned amber headscarf, a brass jeweller\'s magnifying loupe pushed up on her forehead, ' +
      'a moss-green shirt with rolled sleeves, a worn leather tool apron with tiny screwdrivers and clock keys in its pockets, a big pocket watch hanging on a chain, sturdy brown boots, a kind knowing smile, one hand raised in greeting. ' +
      'TWO: a ten-year-old kid with light olive skin, a mop of curly red-brown hair and a gap-toothed grin, an oversized denim jacket covered in bottle caps pinned on like medals, ' +
      'a glass jam jar full of bottle caps hugged under one arm, striped shorts, scabbed knees and green wellington boots. ' +
      'THREE: a tall thin middle-aged clearance man with pale skin, a neat grey moustache and a flat peaked cap, spotless pale-blue overalls buttoned to the neck with a yellow rubber glove hanging from a pocket, ' +
      'holding a clipboard against his chest and a pencil in the other hand, looking unimpressed and in a hurry. ' +
      'FOUR: a tiny sprightly great-aunt in her eighties with light brown skin and a big cloud of white hair, round sunglasses pushed up into it, a bright floral travelling coat, ' +
      'a patterned carpet bag in one hand and a walking stick with a cat-shaped handle in the other, a mischievous smile. ' +
      'All four are original characters, not based on any existing game, film or cartoon character. ' +
      PEOPLE_STYLE,
  },
  // ---- the world: every building in the lane and three things that stand in it, on one sheet ----
  // (tools/process-art.py cuts the sheet into its twelve sprites, in this order.)
  {
    id: 'world_sheet', kind: 'sheet', size: '1536x1024', quality: 'medium', transparent: true,
    prompt:
      'A sprite sheet for a game: exactly twelve separate objects arranged in a neat grid of three rows and four columns, evenly spaced, ' +
      'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at a similar size. ' +
      'Nine are tiny storybook buildings at night, each a different shape and colour, each seen from the front and slightly from above, ' +
      'with its door at the bottom centre facing the viewer and warm yellow light glowing in its windows. ' +
      'Row one, left to right: a cosy cottage with an orange tiled roof, a brick chimney and a round attic window; ' +
      'a small green garden shed with a glass greenhouse side, flower boxes and a little wooden gate; ' +
      'a grey-blue brick lean-to with a corrugated tin roof, two dented trash cans beside the door and a drainpipe; ' +
      'a little corner pantry shop with an orange-and-cream striped awning and jars in its window. ' +
      'Row two, left to right: a teal launderette with a big round porthole window like a washing machine door and soap bubbles above it; ' +
      'a tiny brown library with a bookshelf window, a stack of books by the door and a green reading lamp; ' +
      'a tall narrow indigo townhouse with crooked chimneys, a ladder up its side and a crescent moon weathervane; ' +
      'an amber cottage that is also a clock tower, with a big blank clock face with two hands and a little cuckoo door. ' +
      'Row three, left to right: a dark crimson boarded-up cellar shed with a heavy door, a red glow leaking from the cracks and a tangle of black power cord; ' +
      'a round leafy tree with a short trunk; an old iron street lamp post with a glowing yellow lantern; a round clipped green hedge bush. ' +
      WORLD_STYLE,
  },
  // ---- the app's icon: what the game is about, in one picture ----
  // (Painted from the first house-sitter look, so it is the same person. tools/ios-art.py sizes it for the app.)
  {
    id: 'app_icon', kind: 'icon', ref: 'sitter_a', size: '1024x1024', quality: 'medium', transparent: false,
    prompt:
      'An app icon for a mobile game: a square illustration that fills the whole image from edge to edge. ' +
      'The character from the reference picture, a young woman house-sitter with warm brown skin and curly dark hair in a messy bun held by a pencil, ' +
      'in an oversized mustard-yellow knitted cardigan over teal pyjamas, shown from the waist up, smiling warmly, holding up a small glowing brass lantern in one hand. ' +
      'Snuggled against her other arm is a small round fluffy grey dust bunny creature with long tattered grey ears that are pink inside, a brown button stuck in its fur, ' +
      'its eyes closed in a happy, contented smile. They are friends. Warm golden lantern light on both of them. ' +
      'Background: deep night purple, darker toward the corners, a soft warm glow behind them and a few tiny fireflies. ' +
      'Big simple shapes that read clearly at a very small size, centred. ' +
      'The same drawing style as the reference: clean 2D mobile game art, bold dark outline, flat cel shading with soft highlights, vibrant saturated colours. ' +
      'No text, no letters, no border, no frame, no rounded corners.',
  },
  // ---- Tin Can Alley: the things that stand in it, on one sheet ----
  // (tools/process-art.py cuts the sheet into its twelve sprites, in this order.)
  {
    id: 'alley_sheet', kind: 'sheet', size: '1536x1024', quality: 'medium', transparent: true,
    prompt:
      'A sprite sheet for a game: exactly twelve separate objects arranged in a neat grid of three rows and four columns, evenly spaced, ' +
      'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at a similar size. ' +
      'They are things from a back alley at night, each seen from the front and slightly from above. ' +
      'Row one, left to right: a dented round metal trash can with its lid on; a dented round metal trash can with its lid askew and a fish bone sticking out; ' +
      'a sturdy wooden crate with rope handles; a stack of two old car tyres. ' +
      'Row two, left to right: a rusty teal oil drum; a pile of flattened cardboard boxes tied with string; a stack of three wooden pallets; ' +
      'a blue plastic milk crate full of empty glass bottles. ' +
      'Row three, left to right: a big wide barricade of trash cans, crates and planks piled high, blocking the way; ' +
      'a short section of weathered wooden plank fence with one crooked board; a heap of shiny bottle caps and crushed tin cans; a dented orange traffic cone. ' +
      WORLD_STYLE,
  },
  // ---- Tin Can Alley: the ground you walk on there ----
  // (tools/process-art.py fades it edge into edge so it repeats without a seam.)
  {
    id: 'alley_cobbles', kind: 'tile', size: '1024x1024', quality: 'medium', transparent: false,
    prompt:
      'A seamless tileable ground texture for a 2D mobile game, seen from directly above: old rounded cobblestones at night, painterly flat shapes with soft gradients, ' +
      'slate blue-grey and dusty purple, a few slightly lighter and darker stones, thin dark gaps between them, the odd tuft of moss. Evenly lit, no shadows, ' +
      'no objects, no puddles, no outlines, no text. Slightly desaturated and low in contrast so characters stand out on top of it. ' +
      'The texture fills the whole square image from edge to edge.',
  },
  // ---- the world: the ground you walk on ----
  // (tools/process-art.py mirrors it into a tile with no seams, and recolours a second one for the path.)
  {
    id: 'world_grass', kind: 'tile', size: '1024x1024', quality: 'medium', transparent: false,
    prompt:
      'A seamless tileable ground texture for a 2D mobile game, seen from directly above: short grass at night, painterly flat shapes with soft gradients, ' +
      'deep blue-green and teal, a few slightly lighter and darker patches, tiny grass tufts and the odd clover leaf. Evenly lit, no shadows, no path, ' +
      'no objects, no flowers, no outlines, no text. Slightly desaturated and low in contrast so characters stand out on top of it. ' +
      'The texture fills the whole square image from edge to edge.',
  },
  // ---- home: great-aunt Maribel's front room ----
  roomSheet('home', 'the cosy front room of an old cottage at night', [
    ['a cosy single bed seen from the side, with a wooden headboard at the left end, a white pillow and a colourful patchwork quilt', 'a small wooden bedside table with an old red rotary telephone on it', 'a tall wooden bookshelf full of colourful books', 'a stone fireplace with a warm fire burning in it and a wooden mantelpiece'],
    ['a round wicker pet basket with a plump lilac cushion in it', 'a comfy green armchair with a knitted blanket over one arm', 'a leafy fern in a terracotta pot', 'a small round wooden table with a teapot and two cups on it'],
    ['a large oval braided rug lying flat, seen from directly above, red with a cream border', 'a striped green doormat lying flat, seen from directly above', 'a wooden coat stand with a coat and a hat on it', 'a wooden chest of drawers with a glowing table lamp on top'],
  ]),
  roomWall('home', 'a cosy cottage wall at night, striped blue-violet wallpaper above dark wood panelling, with a window in the middle showing a crescent moon and stars, red curtains drawn back, and two small framed pictures either side of it.'),
  roomFloor('home', 'old wooden floorboards at night, warm brown planks running left to right, with the odd knot and nail.'),
  // ---- the Midnight Pantry ----
  roomSheet('pantry', 'an old-fashioned pantry and store room at night', [
    ['a burlap sack of flour tied at the top', 'a wooden barrel with iron hoops', 'a wooden crate full of potatoes', 'a pyramid of stacked tin cans with bright labels and no words'],
    ['a giant glass jar of green pickles with a lid', 'a round wheel of yellow cheese on a small wooden stool', 'a wicker basket full of eggs', 'a wooden crate of glass milk bottles'],
    ['a small wooden step stool', 'a heap of onions and a string of garlic', 'an old-fashioned set of brass kitchen scales on a small table', 'a striped red doormat lying flat, seen from directly above'],
  ]),
  roomWall('pantry', 'an old pantry at night, long wooden shelves from one side to the other crowded with glass jars, tins, packets, bottles and a hanging string of garlic, dark blue-grey plaster behind them, warm light spilling in from the left.'),
  roomFloor('pantry', 'old kitchen floor tiles in a checkerboard of terracotta red and cream squares, a little worn, with thin dark grout.'),
  // ---- the Wash: the launderette ----
  roomSheet('wash', 'a launderette at night', [
    ['a wicker laundry basket heaped with colourful clothes', 'an ironing board with an iron on it', 'a neat stack of folded towels', 'a big cardboard box of washing powder with no words on it'],
    ['a folding clothes airer hung with odd socks', 'a metal mop bucket with a mop in it', 'a tall wicker hamper with its lid on', 'a pile of odd socks'],
    ['a plastic waiting-room chair', 'a yellow folding wet-floor sign with no words on it', 'a wheeled laundry trolley full of sheets', 'a striped blue doormat lying flat, seen from directly above'],
  ]),
  roomWall('wash', 'a launderette at night, a row of five white front-loading washing machines with round glass doors standing side by side along the lower part of the wall, small pale blue tiles above them, one long shelf with boxes of soap powder and folded towels, and a round wall clock with no numbers. Under the machines is a plain dark skirting band.'),
  roomFloor('wash', 'small square floor tiles in pale blue and white, a little wet and shiny, with thin grey grout.'),
  // ---- the Dusty Stacks: the old library ----
  roomSheet('stacks', 'an old dusty library at night', [
    ['a tall wobbly pile of old books', 'a short pile of three thick books', 'a wooden reading desk with a green glass lamp on it', 'an old globe on a wooden stand'],
    ['a small wooden library step stool', 'a wooden book trolley full of books', 'a wooden card-catalogue cabinet with many small drawers', 'a worn leather armchair'],
    ['a wooden lectern with a big open book on it', 'a leafy plant in a brass pot', 'a small table with an inkwell and a feather quill', 'a dark red doormat lying flat, seen from directly above'],
  ]),
  roomWall('stacks', 'an old library at night, tall dark wooden bookcases standing side by side from one edge to the other, packed with old books in faded colours, a brass rolling ladder leaning on one of them, and a small brass lamp fixed between two of them giving a warm glow.'),
  roomFloor('stacks', 'a dark polished wooden parquet floor in a herringbone pattern, deep brown.'),
  // ---- Moonlit Rooftops ----
  roomSheet('rooftops', 'the rooftops of a town at night', [
    ['a red brick chimney stack with two clay chimney pots', 'a single tall clay chimney pot with a metal cowl', 'an old television aerial on a short pole', 'a glowing skylight window set in a wooden frame, seen from above'],
    ['a round metal water tank on short legs', 'a wooden dovecote on a post', 'a long window box planter full of flowers', 'a neat stack of loose grey roof slates'],
    ['a short wooden roof ladder lying flat, seen from above', 'a stone ball finial on a square stone base', 'a small satellite dish on a bracket', 'an open wooden roof hatch with the top of a ladder showing, seen from above'],
  ]),
  roomWall('rooftops', 'the night sky over a town, seen from a rooftop: a deep blue sky with a big crescent moon a little right of the middle and many stars, and along the lower part the dark silhouettes of distant rooftops, chimneys and one church spire, with a few small windows lit warm yellow. A low stone parapet runs along the very bottom of the middle band.'),
  roomFloor('rooftops', 'blue-grey roof slates in neat overlapping rows, at night.'),
  // ---- the Tick-Tock Attic ----
  roomSheet('attic', 'a dusty attic at night', [
    ['an old leather travelling trunk with straps', 'a piece of furniture hidden under a white dust sheet', 'a stack of three cardboard boxes', 'a wooden rocking horse'],
    ['a dressmaker\'s dummy on a stand', 'an empty brass birdcage on a stand', 'a pile of three old suitcases', 'an open wooden toy chest with toys poking out'],
    ['a tall standing mirror half covered by a sheet', 'an old gramophone with a big brass horn', 'a rolled-up rug tied with string leaning on a box', 'an open attic hatch in the floor with the top of a ladder showing, seen from above'],
  ]),
  roomWall('attic', 'the gable end of an attic at night, dark wooden boards with two big sloping rafters meeting at the top in the middle, a round window between them showing the moon, cobwebs in the corners, and one long shelf crowded with many small old clocks of different shapes, all showing different times.'),
  roomFloor('attic', 'old pale bare floorboards, dusty, planks running left to right.'),
  // ---- the Roaring Dark: the cupboard under the stairs ----
  roomSheet('dark', 'a cupboard under the stairs, at night', [
    ['a wooden shoe rack with shoes and wellington boots on it', 'a stack of shoe boxes', 'a metal toolbox', 'a folded wooden stepladder leaning against nothing, standing upright'],
    ['an umbrella stand with three umbrellas', 'a broom and a dustpan standing together', 'a stack of old paint tins', 'a cardboard box full of tangled cables and light bulbs'],
    ['an extension lead wound on a reel', 'a folded ironing board standing upright', 'a pile of old newspapers tied with string', 'a dark grey doormat lying flat, seen from directly above'],
  ]),
  roomWall('dark', 'the inside of a cupboard under the stairs at night, very dark: dark wooden boards, a long row of coats, scarves and umbrellas hanging on hooks, one shelf above them with old boxes, jars of screws and a torch, old pipes running along the top, and cobwebs.'),
  roomFloor('dark', 'very dark old floorboards, almost black with a hint of purple, planks running left to right.'),
  // ---- out on the lane ----
  backdrop('bg_lane', 'A quiet village lane at night: a row of cosy cottages with warm glowing windows, a tall street lamp, a garden hedge and a wooden gate, a red pillar box, a crescent moon and stars over the rooftops, a few fireflies.'),
  // ---- the country between the rows of houses ----
  // (tools/process-art.py cuts the sheet into its twelve things, in this order. The pond lies flat.)
  roomSheet('road', 'a country lane and its meadows at night', [
    ['a wooden park bench with iron arms', 'a wooden signpost with two blank pointing arms and no words', 'a round stone well with a little tiled roof and a bucket', 'a haystack'],
    ['a friendly scarecrow in a patched coat and a straw hat', 'a neat pile of sawn logs', 'a big mossy rock', 'a short section of white picket fence'],
    ['an old wooden wheelbarrow full of pumpkins', 'a red mailbox on a wooden post', 'a low stone milestone with moss on it and no words', 'a small round pond with lily pads, lying flat, seen from directly above'],
  ]),
  // ---- the keys: one for each place, given when it is calmed ----
  // Asked for on 18 November 2026: "what if we got special looking keys when clearing an area or a house?"
  // (tools/process-art.py cuts the sheet into its eight keys, in the order of the places.)
  {
    id: 'world_keys', kind: 'sheet', size: '1536x1024', quality: 'medium', transparent: true,
    prompt:
      'A sprite sheet for a game: exactly eight separate ornate old-fashioned door keys arranged in a neat grid of two rows and four columns, evenly spaced, ' +
      'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at the same size, ' +
      'each key lying on a slant with its bow (the handle end) at the top left and its teeth at the bottom right. ' +
      'Every key is plainly different from the others, with its own colour and its own shape of bow. ' +
      'Row one, left to right: a green wrought-iron garden-gate key whose bow is shaped like a leaf, with a small daisy and a little moss on it; ' +
      'a tin key cut from a tin can whose bow is a crimped red bottle cap, with a ring-pull hanging from it; ' +
      'a warm copper pantry key whose bow is shaped like a slice of toast with a bite taken out, with a tiny cherry charm; ' +
      'a pale blue enamel laundry key whose bow is a ring of shiny soap bubbles, with a tiny wooden clothes peg clipped to it. ' +
      'Row two, left to right: an old brass library key whose bow is shaped like an open book, with a red ribbon tassel; ' +
      'a silver rooftop key whose bow is a crescent moon with a star, with a tiny weathercock on top; ' +
      'a golden clockwork key whose bow is the two wings of a clock winding key, set with a small gear and a clock hand; ' +
      'a heavy black iron skeleton key whose bow is a swirl of grey dust around one small glowing red light, with a short length of black cable tied to it. ' +
      `${WORLD_STYLE}`,
  },
  // (The sheet's rooftop key came out as a star set inside a crescent, which reads as an emblem rather than
  // as a moon over rooftops. This one is used in its place: the same key, with a chimney pot and no star.)
  {
    id: 'world_key_rooftops', kind: 'key', size: '1024x1024', quality: 'medium', transparent: true,
    prompt:
      'A single ornate old-fashioned door key for a game, lying on a slant with its bow (the handle end) at the top left and its teeth at the bottom right: ' +
      'a silver rooftop key whose bow is a plain crescent moon with a small terracotta chimney pot and a wisp of smoke sitting in its curve, and a tiny golden weathercock standing on top of the moon. No star anywhere. ' +
      `One object only, centred with empty margin on all sides. ${WORLD_STYLE}`,
  },
  // ---- grown-up forms: one for each of the forty kinds, in the order of the table of kinds ----
  grown('dustbunny', 'a tall, proud stag-like beast made entirely of grey dust and lint: a big jackalope standing high on four long strong legs with its chest out and head held up, a great branching pair of antlers made of bent wire coat hangers, a thick shaggy mane of lint down its neck and chest, long ears swept back, glowing red eyes, with buttons, a marble and one earring caught in its fur.'),
  grown('sockeel', 'a huge sea serpent made of one very long blue-and-yellow striped stocking, rearing up high in three great loops like a sea monster rising out of the water, with a tall fin of darning needles all down its back, a frilled ribbed sock-cuff around its head like a mane, a forked tail made from the heel and the toe, the same wide toothy mouth and googly eyes.'),
  grown('toastghost', 'a towering hooded wraith made of burnt toast: a tall stack of three thick slices of burnt toast for a body, draped in a long hooded cloak of melted cheese that hangs in dripping sleeves, two long reaching arms of toast crust, burning hollow eyes under the hood, the pat of butter melting on top, rising on a great swirling column of smoke.'),
  grown('dandepuff', 'a proud lion made from a dandelion plant, standing on four strong legs of twisted green stems with one front paw raised and its mouth open in a roar: a big body of layered green dandelion leaves, a huge round mane of white seed fluff around its frowning face, a long stem tail ending in a seed-puff tuft, seeds blowing off the mane.'),
  grown('thornhog', 'a great wild boar made of a whole rose hedge, head lowered to charge: a massive humped body of tangled green thorny stems and leaves, two huge curved thorn tusks, a ridge of long thorns down its back, four sturdy legs, and three big open red roses blooming on its shoulders.'),
  grown('grumblebee', 'a huge, heavy bumblebee standing upright like a wrestler, twice as broad as before, in a patchwork quilted waistcoat, with four thick arms: two fists on its hips and two holding a big wooden honey dipper dripping honey like a club; large powerful wings, a fluffy collar, the same furious face.'),
  grown('snailor', 'a grand sea snail rearing up tall on a wave-shaped foot, wearing an admiral\'s two-cornered hat and gold-fringed shoulder pieces, its spiked teal shell grown into a whole little sailing ship with three masts, striped sails and a flag, an anchor on a chain, a brass telescope held up to one eye stalk.'),
  grown('gnome', 'a stout garden-gnome king standing tall with one boot up on an upturned flowerpot: a very long white beard down to his boots, a big terracotta flowerpot crown with flowers growing out of it on top of his chipped red hat, a cloak made of a green garden sack, holding a garden spade like a royal sceptre with his fishing rod over his shoulder.'),
  grown('capbeetle', 'a hulking rhinoceros beetle reared up on its hind legs like a strongman, twice the size, with one enormous horn twisted like a corkscrew and two smaller side horns, a domed shell covered in many overlapping bottle caps in red, gold, green and blue like scale armour, four thick arms flexing.'),
  grown('sparkplug', 'a tall armoured knight built from electrical fittings: a long white power strip with a row of sockets for its body, a white plug with two metal prongs for its head like a helmet visor with yellow eyes, a thick black cable flowing behind as a cape, holding up a big blazing floodlight lamp on a pole that throws bright rays, with crackling yellow sparks around it.'),
  grown('ratscal', 'a big, burly, broad-shouldered brown rat standing tall like a bandit chief: a metal colander helmet, a long patched coat, a bulging sack of loot over one shoulder with a fish bone and a cheese rind poking out, a kitchen spatula carried like a halberd, a long thick tail, one torn ear, a gold tooth.'),
  grown('cancrab', 'a huge red lobster-like hermit crab rearing up with both enormous claws raised and snapping, wearing a whole dented metal dustbin as its shell with the lid on top like a helmet, long whip antennae, a broad fanned tail showing below the bin, twice the size of before.'),
  grown('sockgoblin', 'a hulking troll knitted from a whole red-and-white striped woolly jumper, hunched forward on long thick arms with huge mitten fists on the ground, a small head with two big button eyes and a stitched grin, the jumper unravelling into long trailing strands of wool, a ball of wool with two knitting needles stuck in it on its back.'),
  grown('coothug', 'a big, stout, barrel-chested pigeon boss standing with wings on hips: a black bowler hat, a buttoned waistcoat with a gold pocket-watch chain, the same eyepatch and red neckerchief, a broad feather-duster tail fanned out behind like a peacock\'s, chest puffed out, a toothpick in its beak.'),
  grown('dumpling', 'a big warlord dumpling: a large round steamed dumpling body armoured in a stack of two bamboo steamer baskets, the steamer lid worn as a wide round helmet, a great plume of steam rising from the top, thick arms, a soy-sauce dish for a shield and a pair of long chopsticks held like a spear, standing with feet wide apart, the same angry face.'),
  grown('pepperimp', 'a tall, lean, long-limbed red chilli-pepper devil standing upright with arms folded and a swaggering grin: a long curved chilli-pepper body, great sweeping curved horns, a big green stalk and leaves like a crest of hair, both feet and both hands wreathed in bright flames, a long whip-like tail ending in a large flame, and a string of dried red chillies worn across its chest like a sash. No wings.'),
  grown('eggknight', 'a tall noble egg knight striding forward: the egg sits in a tall shining silver egg cup like a suit of armour with silver gauntlets and boots, a long cape made of a checked napkin flying behind, a very long toast-soldier lance held upright, a big round saucer shield with a blue pattern, a tall plume of cress on its cracked shell helmet.'),
  grown('jellywobble', 'a towering wobbling jelly monster in three big tiers like a wedding cake, each tier a deeper pink, with two heavy jelly arms raised and dripping, a cherry on top and a ring of cherries round each tier, a frill of whipped cream at the base, the same cross face on the middle tier, leaning forward.'),
  grown('bubblejelly', 'a tall, queenly jellyfish made of soap bubbles: one very large iridescent bubble dome for a head with a tall crown of bubbles on top, a long gown of foam and many long ribbon tentacles of rainbow soap film sweeping far below and behind like a train, two tentacle arms raised holding a big bubble wand that is blowing a stream of bubbles.'),
  grown('soapslug', 'a massive pink soap slug reared up like a walrus, three times as big, shaped like a great new bar of soap, with a huge shaggy mane of white lather foam along its back and around its neck like a lion\'s, two long foam tusks, tall eye stalks, a bath plug on a chain round its neck, bubbles rising.'),
  grown('lintgolem', 'a towering giant made of blue-grey dryer lint with button eyes, built like a ring of standing stones: enormous square shoulders and arms like stone pillars, a great stone-circle arch of pressed lint slabs across its back, small head sunk between the shoulders, fists resting on the ground like a gorilla, many wooden clothes pegs stuck along its arms like studs, and an odd sock hanging from one shoulder.'),
  grown('pegsnapper', 'a long, heavy crocodile built from dozens of wooden clothes pegs, rearing its head up with jaws wide open: the jaws are one huge shiny metal bulldog clip with jagged teeth, a thick peg-plated tail curled up, four strong peg legs, and a washing line strung along its back between two peg posts with tiny socks and shirts pegged on like a crest.'),
  grown('bookworm', 'a long, thick green bookworm reared up tall in an S shape out of a towering, leaning stack of five heavy old books, three times as long as before, wearing round spectacles and a tasselled scholar\'s cap, a red ribbon bookmark tied round its neck like a scarf, holding a quill pen in the tip of its tail, loose pages fluttering. No words or letters.'),
  grown('candlecreep', 'a wax giant: a very tall, thick pillar candle that has melted and set many times into a hulking figure with broad sloping shoulders, heavy arms of dripped wax reaching to the ground, a long beard of wax drips, a big bright flame burning on its head, standing in a wide brass dish with a ring handle, a brass candle snuffer hanging at its side, the same sly melted face.'),
  grown('inkblot', 'a great wave of dark-blue ink towering up and curling over like a breaking wave out of a large tipped-over glass inkwell, with two big dripping arms spread wide, long splashes and drops flying, white glowing eyes high in the crest of the wave, a gold fountain-pen nib on its head like a crown.'),
  grown('quillhog', 'a big porcupine standing upright on its hind legs like a stern clerk, with round glasses on its nose, a huge fan of long feathered quill pens with inky tips spread wide behind it like a peacock\'s tail, ink-stained paws, a long unrolled paper scroll trailing from one paw with a red wax seal, a quill held in the other paw like a sword. No words or letters.'),
  grown('papercrane', 'a tall, elegant origami heron folded from many sheets of newspaper, standing on long folded legs with its huge wings spread wide open, a long curved neck, a long sharp folded beak, a fan tail of folded paper pleats, a folded paper hat as a crest. The newsprint is only tiny grey lines, no readable letters.'),
  grown('gutterbat', 'a big purple bat swooping with enormous wings spread wide, each wing covered in overlapping orange, red and gold autumn leaves like feathers, large ears, a fluffy ruff of leaf litter, an acorn-cup cap, clutching a twig of leaves in its feet, a scatter of raindrops and blown leaves around it.'),
  grown('slategecko', 'a big, heavy, broad gecko climbing upward with its body curved in an S, three times as bulky as before, still a gecko with sticky round toes: thick armour of overlapping grey roof slates over its whole back and tail like a rooftop, a tall row of curved orange ridge tiles down its spine, two terracotta chimney pots on its back puffing curls of warm smoke, a patch of green moss, a thick curled tail, bright yellow eyes. No wings, no fire: not a dragon.'),
  grown('weathercock', 'a large, proud green-copper weathercock rooster with wings spread wide and beak open, crowing into a gale: a tall wild comb and very long streaming tail feathers swept back by the wind, perched on top of a tall ornate weather vane with a spinning arrow and three wind cups, big swirls of wind curling round it. No letters on the vane.'),
  grown('gargoylet', 'a massive hunched stone grotesque crouching on a carved stone ledge, twice as big and broad as before, with huge curled ram horns, great stone wings spread wide, long arms with heavy claws gripping the ledge, thick moss and little ferns growing on its back, a stream of rainwater pouring from its wide-open mouth, a bird\'s nest with eggs on one shoulder.'),
  grown('chimneywisp', 'a tall towering spirit of purple smoke rising in a great twisting column out of a brick chimney stack with two terracotta pots, with broad smoky shoulders, two long arms of smoke, glowing ember eyes and a wide ember grin, wearing a tall crown made of rings of smoke set with glowing embers like jewels, sparks drifting up.'),
  grown('gearbeetle', 'a big brass clockwork beetle standing upright on its hind legs like a general on parade: a brass peaked cap, shoulder pieces made of cogs, a chest full of small gear medals, a long clock hand held like a sabre, wing cases open showing whirring gears inside, a large wind-up key on its back, four arms.'),
  grown('tintrooper', 'a tall tin toy drum major marching with one knee raised high: a very tall plumed hat, a long red coat with gold braid and medals, a big toy bass drum strapped on his front, a long baton with a ball on the end thrust high in the air, a large wind-up key in his back, chipped paint.'),
  grown('cuckoo', 'a large night bird bursting out of the top of a tall wooden cuckoo-clock tower with its wings spread wide: dark midnight-blue feathers speckled with tiny stars, a long tail, a wide open beak, the clock house below it with a pendulum and two pine-cone weights swinging on chains, its little door hanging open, a small crescent moon charm. No numbers.'),
  grown('mothphantom', 'a large ghostly moth with four great tattered wings spread wide, each with a softly glowing eye spot, long feathery antennae, a pale fluffy body trailing off into wisps, carrying a big old glowing paper lantern on a hooked stick in its front legs, a drift of moth dust and a warm halo of light around it.'),
  grown('jackbox', 'a tall, gangly jester sprung high out of a big fancy striped box on a long coiled spring, leaning forward with long arms spread wide: a patchwork harlequin coat with long drooping sleeves, a three-pointed jester hat with bells, a ruffled collar, a wide sharp-toothed grin, juggling three coloured balls, the crank handle on the box spinning.'),
  grown('cordserpent', 'a gigantic snake made of thick braided black power cables with red, yellow and green wires woven through, wound in huge heavy coils round a big wooden cable drum, its head reared up high: a large three-pin plug for a head with bright orange eyes and metal prong fangs, crackling yellow sparks jumping between its coils, a frayed sparking tail. No hood.'),
  grown('dustwraith', 'a large, tall, drifting wraith of dark dust and cobwebs with glowing cyan eyes: long ears swept back into a ragged hood, a long body trailing away into a wide drift of dust, two long thin arms with trailing ragged sleeves reaching forward, cobwebs strung between its ears and arms, and lost things caught in it: a coin, an old key, a spoon, a chess pawn.'),
  grown('robodisc', 'a big all-terrain robot vacuum cleaner raised high on four chunky off-road wheels with springs: a wide round disc body with a red glowing visor of angry eyes, a sturdy front bumper bar, two bright headlamps, large spinning side brushes like whiskers, a tall dust bin on its back, and two antennas, one flying a tiny flag.'),
];
