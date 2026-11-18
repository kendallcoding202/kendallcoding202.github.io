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

// A brand-new kind, a ringleader, and a Keepsake. The first two are the Pawst Lives monster and boss
// briefs, word for word (with one sentence added, that it is nobody else's creature), so the new ones
// sit beside the forty-eight that were painted for Pawst Lives. Agreed on 18 November 2026: "Go with
// the four new places", and "a legendary or something similar type creature at the end of each
// chapter". A Keepsake is not cross: it is the one gentle thing in the game.
const mob = (id, desc) => ({
  id, kind: 'mob', size: '1024x1024', quality: 'medium', transparent: true,
  prompt: `A single game enemy monster sprite: ${desc} Facing left in side three-quarter view, grumpy mischievous expression. An original creature, not based on any existing game, film or cartoon character. ${SPRITE_STYLE}`,
});
const boss = (id, desc) => ({
  id, kind: 'boss', size: '1024x1024', quality: 'medium', transparent: true,
  prompt: `A single game boss monster sprite, big and imposing but still cartoony: ${desc} Facing left in side three-quarter view, menacing glowing eyes. An original creature, not based on any existing game, film or cartoon character. ${SPRITE_STYLE}`,
});
const keepsake = (id, desc) => ({
  id, kind: 'keep', size: '1024x1024', quality: 'medium', transparent: true,
  prompt: `A single game creature sprite, rare, precious and a little magical: ${desc} Facing left in side three-quarter view, calm and kind expression, softly glowing. An original creature, not based on any existing game, film or cartoon character. ${SPRITE_STYLE}`,
});

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
  // ---- chapter two: forty new kinds, in the order of the places they live in ----
  mob('canphant', 'a small grumpy elephant made from a dented green tin watering can: the long spout is its trunk with the sprinkler rose on the end, the handle arches over its back, two big ears of bent tin, stubby legs, a few drips of water falling from the rose.'),
  mob('glovecrab', 'a single green-and-tan canvas gardening glove that scuttles on its five fingertips like a crab, the open cuff is its mouth with two angry eyes peering out, a daisy tucked in the wrist strap, soil on the fingertips.'),
  mob('brollybat', 'a broken black umbrella that flies like a bat: bent silver ribs for wing bones, torn black cloth wings, the curved wooden handle for a tail, two yellow eyes peering out from under the canopy.'),
  mob('trolleypup', 'a small dog-like creature made from a wire shopping basket on four little trolley wheels, one wheel bent sideways, the red plastic handles folded back for ears, a wire-mesh face with bright eyes and a tongue of paper till receipt hanging out.'),
  mob('conekin', 'a small orange-and-white striped traffic cone with stubby legs and arms, a flashing amber road lamp on its tip, a cross little face on its front, a scrap of red-and-white barrier tape tied round it like a scarf.'),
  mob('teabagjelly', 'a floating jellyfish that is a plump wet brown pyramid teabag with a sleepy cross face, its string and square paper tag trailing below like a tentacle, drips of tea falling from it, a curl of steam above.'),
  mob('whiskbird', 'a small wiry bird whose round body is a steel balloon whisk: the looped whisk wires form its cage of a chest, the wooden handle is its tail, two thin wire legs, a small sharp beak and angry eyes, a blob of whipped cream on its head.'),
  mob('picklefrog', 'a warty green frog shaped like a pickled gherkin, squatting half out of an open glass pickle jar full of cloudy brine, a sprig of dill on its head, a mustard seed stuck to its cheek.'),
  mob('ironweasel', 'a small sleek weasel whose body is a little steam iron: the shiny flat soleplate is its belly, the handle arches over its back, a round temperature dial on its side, the cord and plug for a tail, puffs of steam hissing from its sides.'),
  mob('baskettortoise', 'a small tortoise whose shell is a round wicker laundry basket with a lid, a striped sock and a shirt sleeve hanging out from under the lid, stubby legs with a woven wicker pattern, a patient cross face.'),
  mob('zipcrawler', 'a small centipede made of a brass zip: the two rows of zip teeth are its many little legs, the zip slider with its pull tab is its head with tiny bright eyes, a strip of red fabric tape runs down its back.'),
  mob('stamphopper', 'a small hopping creature that is a wooden-handled rubber date stamp: a round wooden knob for a head with a cross face, a brass body, one flat rubber foot stained with purple ink, hopping off a purple ink pad and leaving inky footprints. No readable numbers or letters.'),
  mob('globehog', 'a small hedgehog-like creature curled round an old desk globe: the globe with blue seas and yellowed land is its round back, a brass half-ring over it, a little snout and clawed feet poking out underneath, sleepy grumpy eyes. No words or letters.'),
  mob('aerialhare', 'a lean grey hare whose long ears are a bent pair of telescopic silver television aerial rods, with a little tuning-dial tail, wisps of blue static sparks jumping between its ears, sitting up alert.'),
  mob('kiteray', 'a diamond-shaped paper kite that swims through the air like a manta ray: red and yellow patched paper with a rip or two, a cross face on its front, a long tail of ribbon bows, a broken length of string trailing behind.'),
  mob('teddybear', 'a small moth-eaten teddy bear that has come alive, tan fur worn thin, one button eye and one empty patch with a cross of thread, stuffing poking out at one shoulder, a faded red ribbon round its neck, fists up ready to box.'),
  mob('snowglobe', 'a small snow globe creature: a glass dome on a red wooden base with little feet, inside it a tiny frowning snowman in a swirl of glitter snow, the snowman\'s face is its face, frost creeping over the glass.'),
  mob('torchmole', 'a small velvet-black mole whose long snout is an old yellow rubber torch shining a bright beam of light, big pink digging claws, tiny squinting eyes, a spare battery strapped to its back with a rubber band.'),
  mob('bootpup', 'a puppy made from an old brown leather walking boot: the open top of the boot is its mouth with the boot\'s tongue lolling out, the laces flop down as ears, two brass eyelets are its eyes, a muddy tread sole for a belly, a frayed lace end for a wagging tail.'),
  mob('dustpancrab', 'a crab whose shell is a red metal dustpan worn on its back, one big claw is a stiff-bristled hand brush and the other an ordinary pincer, eyes on stalks, a little pile of swept dust beside it.'),
  mob('seedfinch', 'a small plump bird folded from a paper seed packet with a faded picture of a sunflower on its chest, wings of green seedling leaves, a sprouting bean for a tail, seeds scattering from its beak. No words or letters.'),
  mob('potcub', 'a small bear cub wearing a terracotta flowerpot: its body is the upturned clay pot with a chip out of the rim, four stubby clay legs, round ears, and a green shoot with two leaves growing out of the hole in the top like a sprout of hair.'),
  mob('compostkin', 'a small round creature made of dark crumbly compost with potato peelings, bits of eggshell and leaves stuck in it, two worms poking out like hair, a little mushroom on its head, steam rising gently, short arms, a contented grumpy face.'),
  mob('tomatomonkey', 'a small monkey whose head and body are two ripe red tomatoes with a green leafy stalk for a cap of hair, long thin green vine arms and a curly vine tail, hanging from a tomato vine by one hand, a cheeky cross face.'),
  mob('basketjelly', 'a floating jellyfish that is a hanging flower basket: a moss-lined wire basket dome with a hook and three chains on top, a sleepy face on the moss, long trailing tentacles of pink and purple petunias and ivy, water dripping from them.'),
  mob('rubberduck', 'a cross yellow rubber bath duck with a chipped orange beak, a squeaker hole in its side, a tuft of soap foam on its head like a quiff, standing on little orange feet with its wings on its hips, a few soap bubbles around it.'),
  mob('pastegrub', 'a fat caterpillar that is a half-squeezed tube of toothpaste: a white tube body with blue and red stripes, crimped flat at the tail end, the screw nozzle for a snout oozing a blob of striped toothpaste, tiny legs, a minty sparkle.'),
  mob('loofahdillo', 'a small armadillo whose armour is a tan natural loofah sponge with a rough fibrous net texture, a loop of string at its tail for hanging it up, a little pink snout and feet, soap suds on its back.'),
  mob('drainhair', 'a small scruffy creature made of a wet tangled clump of dark hair like a tumbleweed with eight wispy hair legs, two big round worried eyes peeping out, a hair grip and a sliver of soap caught in it, climbing out of a chrome plughole.'),
  mob('curtainghost', 'a ghost made of a white plastic shower curtain patterned with little blue fish and a few grey mildew spots, a row of curtain rings along its top like a crest, two dark eye holes and a wavy mouth, arms of draped curtain, dripping.'),
  mob('tapelizard', 'a small lizard whose body is a yellow retractable tape measure case, with the steel measuring tape pulled out as its long curling tail, a belt clip on its side and a lock button on its back, quick clever eyes. Tick marks but no readable numbers.'),
  mob('hammerpecker', 'a woodpecker whose head and beak are a steel claw hammer, the claw of the hammer standing up as its crest, on a wooden handle neck, with a body of brown and red feathers like wood shavings, gripping a plank, three nails held in its tail.'),
  mob('brushfox', 'a small fox whose big bushy tail is a wide paintbrush loaded with bright blue paint, orange fur splashed with spots of red, yellow and blue paint, one paw standing in a tin lid of paint, a sly cross face.'),
  mob('sawfish', 'a small sawfish that swims through sawdust: its long flat nose is a toothed hand-saw blade, a red wooden saw handle for a back fin, a grey-blue body dusted with sawdust, leaping out of a pile of curly wood shavings.'),
  mob('bulbmoth', 'a moth whose plump body is an old clear glass light bulb with a glowing orange filament inside and a brass screw cap for a tail, dusty tan wings, feathery antennae, a short pull cord dangling.'),
  mob('pinpuffer', 'a round pufferfish that is a red tomato-shaped pincushion with green felt leaves on top, stuck all over with coloured-headed pins and one threaded needle like spines, puffed cheeks, little fabric fins, floating.'),
  mob('thimblemouse', 'a tiny brave grey mouse wearing a silver thimble as a helmet, holding a sewing needle threaded with red cotton like a sword, a button for a shield, a scrap of tartan cloth for a cape.'),
  mob('scissorstork', 'a tall thin stork whose long beak is a pair of silver dressmaking scissors and whose legs are two long sewing needles, with a body of folded grey felt, a yellow measuring tape for a scarf and red thread trailing from its beak.'),
  mob('buttonowl', 'a round owl made entirely of mismatched buttons like feathers (pearl, brass and coloured ones), with two big four-hole coat buttons for eyes and a wooden toggle for a beak, perched on a glass jar of buttons.'),
  mob('lacespider', 'a neat little white spider sitting in the middle of a round lace doily it is still making, with a cotton reel for a body, eight thin legs like crochet hooks, a tiny pair of spectacles, a thread trailing from its tail.'),
  // ---- the four new places: their ringleaders, and what a fight in each is seen against ----
  boss('boss_marrow', 'the Prize Marrow, an enormous green striped vegetable marrow monster the size of a sofa, with a wide scowling face, thick curling vine tendrils for arms, big leaves like a cloak, and a tattered red first-prize rosette pinned to its side. No words or letters.'),
  boss('boss_bathtub', 'Old Clawfoot, a huge white cast-iron bathtub monster walking on four heavy lion-paw iron feet, brimming over with foamy water, two brass taps like horns pouring water, a furious face made by the overflow and plughole on its end, a plug swinging on a chain like a flail.'),
  boss('boss_mower', 'Captain Twostroke, a monstrous old red petrol lawnmower rearing up like a bull, with a snarling grille mouth full of spinning steel blades, two glowing headlamp eyes, tall handlebars swept back like horns, a puffing exhaust, a grass-collecting bag for a belly, clippings flying.'),
  boss('boss_treadle', 'Madam Treadle, a towering antique black sewing machine monster with gold scrollwork, standing on its cast-iron treadle table legs like a spider, a flashing needle for a stinger, a spool of red thread on top like a hat, a balance wheel spinning, two lamp eyes, trailing a long stitched ribbon of cloth.'),
  backdrop('bg_glasshouse', 'The inside of an old glass greenhouse at night: tall panes of misted glass with the moon behind them, shelves of terracotta pots, tomato vines on canes, hanging baskets trailing flowers, a watering can.'),
  backdrop('bg_deepend', 'A big old-fashioned bathroom at night: black-and-white tiled walls and floor, a tall window with frosted glass and moonlight, a pedestal basin, a mirror, a towel rail, a shower curtain, steam drifting, a rubber bath mat.'),
  backdrop('bg_shed', 'The inside of a cluttered wooden garden shed at night: a workbench with a vice, tools hanging on a pegboard, shelves of paint tins and jam jars of screws, a bare light bulb, a small cobwebbed window with moonlight, wood shavings.'),
  backdrop('bg_mending', 'A cosy old sewing room at night: a dressmaker\'s dummy, shelves of cotton reels and folded fabric, a cutting table with scissors and pins, a big jar of buttons, lace curtains at a moonlit window, a lamp with a fringed shade.'),
  // ---- the Keepsakes: one of a kind, at the end of each chapter ----
  keepsake('keep_musicbox', 'a small, graceful nightingale made from an old music box: a body that is a little lacquered wooden music box with its lid open like wings showing the brass comb and pinned cylinder inside, a golden wind-up key for a tail, a slender brass neck and head with gentle half-closed eyes, a few musical notes and tiny stars drifting from it.'),
  keepsake('keep_bottleship', 'a small gentle whale that is a clear glass bottle lying on its side, with a tiny three-masted sailing ship inside it riding a little blue sea, the cork in the bottle\'s neck for a nose, glass flippers and a glass tail, a soft spout of spray and a few stars above it, a kind sleepy eye.'),
  // ---- chapter two: the grown-up form of each new kind, painted from its own young picture ----
  grown('canphant', 'a big elephant built from a galvanised steel rain barrel with riveted hoops, rearing up on its hind legs: a long coiled green garden hose for a trunk spraying a great arc of water, two watering-can roses for tusks, wide ears of beaten tin, a brass tap on its side.'),
  grown('glovecrab', 'a big crab-like creature made of two thick leather gardening gauntlets joined at the cuffs, standing tall on its fingertip legs, holding a pair of red-handled secateurs high like great pincers, ivy and bindweed trailing from it, soil flying.'),
  grown('brollybat', 'a great storm bird made of a huge striped golf umbrella blown inside out, its long ribs spread like wings with panels of red and white cloth, a dark rain cloud caught in its spokes, a hooked wooden handle for a beak, rain pouring from it, wings spread wide.'),
  grown('trolleypup', 'a big bull-like beast made of a full-size wire shopping trolley, head down and charging: the handlebar ends curl up as horns, the child-seat flap is its jaw, loaded with junk (a traffic cone, an old tyre, crushed cans), four heavy wheels throwing sparks.'),
  grown('conekin', 'a tall tower of three stacked orange traffic cones with long arms, wearing red-and-white barrier tape across its chest like a sash, a big rotating amber beacon blazing on top, holding a striped road barrier board like a shield. No words or letters.'),
  grown('teabagjelly', 'a grand round china teapot floating on a cloud of steam like a little ruler: the spout is its nose, the handle its ear, it wears a striped knitted tea cosy as a robe with a bobble for a crown, a ring of teabags orbits it on their strings, and it pours a long arc of tea.'),
  grown('whiskbird', 'a tall ostrich-like bird built from a big electric hand mixer: two long spinning steel beaters for legs, the cream-coloured mixer body with its speed dial for a chest, a long neck of coiled cable ending in a small fierce head, a plug for a tail, flinging cream as it strides.'),
  grown('picklefrog', 'a huge fat gherkin toad with its mouth open in a great croak, wearing a big glass pickle jar round its belly like armour with brine sloshing inside, the metal jar lid on its head as a hat, garlands of pickled onions and dill round its neck.'),
  grown('ironweasel', 'a big badger-like beast made from a heavy old steam iron, with a folding ironing board strapped along its back like a shell, a glowing hot soleplate chest, great clouds of steam pouring from it, its cord tail whipping, front paws raised.'),
  grown('baskettortoise', 'a great giant tortoise with a tall wicker laundry hamper for a shell, piled high with a mountain of washing, a bath towel worn like a cape, a pair of spotted pants on its head like a hat, heavy legs planted wide, neck stretched up.'),
  grown('zipcrawler', 'a long centipede rearing up, made of a heavy brass zip from a big coat: dozens of zip-tooth legs, the slider head pulled open to show a jagged zip mouth, strips of blue denim and red cloth along its back, a cord and toggle for a tail.'),
  grown('stamphopper', 'a heavy kangaroo-like creature made of a big brass library date-stamping machine, with two great flat rubber stamp feet dripping purple ink, a long lever arm raised to strike, a purple ink pad carried like a shield, bounding. No readable numbers or letters.'),
  grown('globehog', 'a big armadillo-like beast whose plated back is a large antique floor globe spinning in a tilted brass and dark wood stand, a brass compass rose on its forehead, tiny paper sailing ships and wisps of cloud circling it. No words or letters.'),
  grown('aerialhare', 'a big powerful hare in a great leap, with two white satellite dishes for ears, a coil of black cable round its neck like a scarf, crackling blue-white static running down its back, long strong hind legs kicked out behind.'),
  grown('kiteray', 'a large bird of prey made of a red-and-yellow stunt kite, diving: wide swept-back kite wings with thin struts, a sharp folded paper beak, talons of knotted string, a long streaming tail of ribbons and bows.'),
  grown('teddybear', 'a big bear standing tall with its arms flung wide, the same teddy grown huge and mended all over with patches of different fabrics and neat darning, one button eye and one stitched cross, a brass music-box key in its back, a long red ribbon scarf.'),
  grown('snowglobe', 'a big snow-globe giant: a large cracked glass dome full of a raging blizzard, with an angry snowman inside pressing its mittened hands against the glass, a carved dark wooden base on four feet with a brass wind-up key, snow pouring out of the crack and swirling round it.'),
  grown('torchmole', 'a big burly mole standing upright with massive shovel claws raised, wearing a miner\'s helmet with a headlamp, a huge square lantern torch built into its chest throwing a wide beam, a bandolier of batteries across its shoulder.'),
  grown('bootpup', 'a big shaggy hound bounding forward, made from a tall old leather army boot: a jaw lined with hobnail teeth, long lace ears flying, a studded collar made from a dog lead with a brass tag, heavy muddy paws, mud flying behind it.'),
  grown('dustpancrab', 'a big fiddler crab with one giant claw that is a wide yard-broom head and one that is a steel coal shovel, a galvanised dustbin lid for a shell, a moustache of bristles, a cloud of dust around it, the broom claw raised high.'),
  grown('seedfinch', 'a proud pheasant-like bird with a great fan tail made of many colourful paper seed packets showing pictures of flowers and vegetables, a crest of wheat ears, leafy green wings spread, seeds raining from it. No words or letters.'),
  grown('potcub', 'a big bear standing up, built from stacked terracotta flowerpots like plates of armour, a large cracked clay urn for a chest with a flowering plant bursting out of the top and spilling red flowers, heavy clay claws, roots trailing like fur.'),
  grown('compostkin', 'a big hulking heap of steaming dark compost with broad shoulders, a ring of wooden compost-bin slats round its middle like a barrel, a garden fork over its shoulder, pumpkins and mushrooms growing on its back, worms hanging like a beard.'),
  grown('tomatomonkey', 'a big gorilla-like brute made of huge ribbed beefsteak tomatoes: a great tomato torso and tomato fists, thick green vine arms, a mane of leafy stalks, a bamboo garden cane held like a club, knuckles on the ground.'),
  grown('basketjelly', 'a large majestic floating jellyfish made of three tiers of hanging flower baskets on chains like a chandelier, cascades of trailing blossoms and vines for long tentacles, butterflies around it, a brass watering-can rose worn as a crown.'),
  grown('rubberduck', 'a big proud rubber duck the size and shape of a swan, with a long curved yellow neck, wings raised, wearing a frilly shower cap like a crown, riding a wave of bath foam and bubbles, the same chipped orange beak and cross eyes.'),
  grown('pastegrub', 'a long thick caterpillar rearing up, made of a giant toothpaste tube with red and blue stripes, a row of toothbrush bristles standing along its back, holding two toothbrushes like staves, its screw cap worn as a little hat, swirls of striped paste around it.'),
  grown('loofahdillo', 'a big armadillo rolling forward in banded armour of loofah and grey pumice stone, a long-handled wooden back brush for a tail, a nail brush on each shoulder, suds flying off it.'),
  grown('drainhair', 'a big shaggy beast of tangled wet dark hair with a great mane like a lion, pink hair curlers for horns, combs and hair grips caught in it like spines, a chrome plug chain for a collar, dripping, mouth open.'),
  grown('curtainghost', 'a tall grand phantom made of a long white shower curtain patterned with blue fish, wrapped in a fluffy bath towel like a robe, a bent chrome shower rail with rings across its shoulders, a shower head on a hose rising behind it and spraying, steam billowing, arms spread.'),
  grown('tapelizard', 'a big monitor lizard built from a heavy yellow-and-black tape measure, its long steel tape tail whipping in a great curl overhead, a spirit level strapped along its back with a green bubble, claws made of a folding wooden rule. No readable numbers.'),
  grown('hammerpecker', 'a large heavy bird like a shoebill stork with a great steel sledgehammer head for a beak, a leather tool belt slung round it full of nails and chisels, wings of sawn plywood feathers, standing on a split log with wood chips flying.'),
  grown('brushfox', 'a large elegant fox with one enormous bushy tail that is a wide wall-painting brush loaded with a bright sweep of red, yellow and blue paint, carrying a paint roller in its mouth, fur streaked with glossy paint, a paint-spattered dust sheet worn like a cape, a paint tin hanging from a strap, drips trailing behind it. One tail only.'),
  grown('sawfish', 'a big shark-like fish leaping, with a long toothed saw blade for a nose and a row of round circular-saw blades for fins along its back, skin like sandpaper, a great cloud of sawdust and wood shavings around it.'),
  grown('bulbmoth', 'a large splendid moth with a big glowing glass bulb for a body and four wide wings like the stained-glass panels of a lampshade in amber and green, long feathery antennae, a halo of warm light, a brass lamp chain for a tail.'),
  grown('pinpuffer', 'a large puffed-up pufferfish made of a big patchwork pincushion ball, bristling with long knitting needles, hat pins and safety pins like a sea mine, a tape-measure ribbon for a tail, a cross-stitched scowl, floating.'),
  grown('thimblemouse', 'a tall mouse knight in armour made of silver thimbles with a big brass button for a breastplate, a long darning needle lance flying a ribbon pennant, a cotton reel crest on its helmet, a velvet cape, standing like a hero.'),
  grown('scissorstork', 'a tall grand crane with a huge pair of black-handled tailor\'s shears for a beak, wide wings made of fabric swatches in many patterns cut with zigzag edges, long knitting-needle legs, a tape measure draped round its neck like a stole, a spool of thread unwinding behind it.'),
  grown('buttonowl', 'a great horned owl made of hundreds of buttons, its wide wings spread to show rows of buttons like feathers, two big horn toggles for ear tufts, huge mother-of-pearl button eyes, ribbons and lace trailing from its talons.'),
  grown('lacespider', 'a large elegant spider with a body like a big spool of white thread, long crochet-hook legs, wearing a veil and a wide fan collar of fine lace, weaving a great lace web hung with wooden lace bobbins, a ruby brooch on its back.'),
  // ---- chapter two: the four new places, each a room you walk into ----
  // Agreed on 18 November 2026: "Go with the four new places". Spending on rooms was approved on 16 November 2026.
  roomSheet('glasshouse', 'an old glass greenhouse at night', [
    ['a stack of terracotta flowerpots', 'a wooden seed tray full of green seedlings', 'a dented metal watering can', 'a plump sack of compost with no words on it'],
    ['a tomato plant heavy with red tomatoes growing up a bamboo cane in a big pot', 'a wooden potting bench with flowerpots and a trowel on it', 'a tall leafy palm in a round pot', 'a wooden crate of carrots and marrows'],
    ['a coiled green garden hose', 'a small wooden stepladder with a flowerpot on each step', 'a glass bell cloche over a little plant', 'a green doormat with a leaf pattern lying flat, seen from directly above'],
  ]),
  roomWall('glasshouse', 'the end wall of an old glass greenhouse at night: tall glass panes in white-painted iron frames from one edge to the other, misted with condensation, a big moon and stars seen through them, one long wooden shelf across the middle crowded with terracotta pots of seedlings and flowers, and green vines climbing the frames. Under the glass is a low red brick wall.'),
  roomFloor('glasshouse', 'old red brick paving laid in a herringbone pattern, with a little green moss between the bricks.'),
  roomSheet('deepend', 'a big old-fashioned bathroom at night', [
    ['a white pedestal washbasin with two brass taps', 'a tall brass towel rail hung with striped towels', 'old-fashioned bathroom weighing scales with a big round dial and no numbers', 'a wooden stool with a neat stack of folded towels'],
    ['a big fern in a pot on a tall plant stand', 'a tin bucket full of sponges and bath toys', 'a white enamel jug standing in a wash bowl on a small table', 'a tall oval mirror on a wooden stand'],
    ['an old iron radiator with a towel drying on it', 'a small white bathroom cabinet on legs with a plain door', 'a little shelf unit of soap bars and coloured bottles with no labels', 'a pale blue bath mat lying flat, seen from directly above'],
  ]),
  roomWall('deepend', 'a big old-fashioned bathroom at night: white and sea-green wall tiles with a wave-pattern border from one edge to the other, three tall frosted windows with moonlight behind them, brass pipes running along the top, a big round mirror in a brass frame, and one long shelf of bottles and folded towels. Under the tiles is a plain dark skirting band.'),
  // (Painted twice. The first was a black and white checkerboard, and nobody could be seen against it.)
  roomFloor('deepend', 'small square bathroom floor tiles in two soft, close shades of pale sea-green, laid as a gentle checkerboard, very low in contrast, a little wet and shiny, with thin pale grout.'),
  roomSheet('shed', 'an old wooden tool shed and workshop at night', [
    ['a sturdy wooden workbench with a vice and a few tools on it', 'a red metal tool chest on wheels', 'a stack of old paint tins with drips of coloured paint', 'a wooden barrel full of rakes, spades and brooms standing upright'],
    ['a big coil of thick rope', 'a wooden sawhorse with a plank and a hand saw on it', 'a neat pile of timber planks', 'a small shelf unit of jam jars full of screws and nails'],
    ['a round grindstone wheel on a wooden frame', 'a wooden stepladder standing open', 'a metal dustbin full of wood offcuts and sawdust', 'a brown bristly doormat lying flat, seen from directly above'],
  ]),
  roomWall('shed', 'the inside wall of an old wooden garden shed at night: rough wooden planks from one edge to the other, a big pegboard hung with hammers, saws, spanners and pliers, a small cobwebbed window with moonlight, one long shelf of jam jars and oil cans, and a bare light bulb on a cord glowing warm yellow.'),
  roomFloor('shed', 'old grey-brown wooden shed floorboards with a light dusting of sawdust, planks running left to right.'),
  roomSheet('mending', 'a cosy old sewing room at night', [
    ['a dressmaker\'s dummy on a wooden stand with a tape measure round its neck', 'a round wicker basket overflowing with balls of wool', 'a very big glass jar of colourful buttons', 'a stack of folded cloth in different patterns'],
    ['a wooden chair with a patchwork cushion', 'a tall wooden rack of big cotton reels in rainbow colours', 'a small round table with a pincushion, a pair of scissors and a teacup on it', 'a floor lamp with a fringed shade, lit and glowing'],
    ['a wooden chest of many little drawers with brass handles', 'a stand of ribbon and lace rolls', 'a soft pile of folded patchwork quilts', 'a round pink rag rug lying flat, seen from directly above'],
  ]),
  roomWall('mending', 'a cosy old sewing room at night: wallpaper with a small flower pattern above pale wood panelling from one edge to the other, a window in the middle with lace curtains and a crescent moon outside, one long shelf of cotton reels and folded cloth, a pegboard of scissors and tape measures, and two framed embroidered pictures of flowers.'),
  roomFloor('mending', 'a soft faded rose-and-cream carpet with a small repeating diamond pattern.'),
  // ---- the far bank: its four buildings, and eight things that stand about it, on one sheet ----
  // (tools/process-art.py cuts the sheet into its twelve sprites, in this order. The lily pads lie flat.)
  {
    id: 'world_far_sheet', kind: 'sheet', size: '1536x1024', quality: 'medium', transparent: true,
    prompt:
      'A sprite sheet for a game: exactly twelve separate objects arranged in a neat grid of three rows and four columns, evenly spaced, ' +
      'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at a similar size. ' +
      'Four are tiny storybook buildings at night, each a different shape and colour, each seen from the front and slightly from above, ' +
      'with its door at the bottom centre facing the viewer and warm yellow light glowing in its windows. ' +
      'Row one, left to right: a pretty Victorian glass greenhouse with a white iron frame, a curved glass roof and green plants pressing against the panes; ' +
      'a small old public bath house of white and sea-green tiles with a blue domed roof, round steamy windows and a wave pattern over the door; ' +
      'a big crooked wooden workshop shed painted barn red, with a tin chimney, a cogwheel over the door and tools hanging on its wall; ' +
      'a little lilac haberdashery shop with a bay window full of ribbons and a big wooden cotton reel and a pair of scissors over the door. ' +
      'Row two, left to right: a tall ornate wrought-iron double gate, shut, with stone gateposts topped by lanterns and a row of eight small brass keyholes across its middle, seen from the front; ' +
      'a small wooden rowing boat with two oars, pulled up out of the water; a clump of tall bulrushes and reeds; ' +
      'a cluster of green lily pads with two pink water lilies, lying flat, seen from directly above. ' +
      'Row three, left to right: a white wooden beehive with a little sloping roof; a wooden market barrow with two wheels, loaded with flowerpots; ' +
      'an old cast-iron village water pump with a stone trough; a stack of wooden apple crates. ' +
      WORLD_STYLE,
  },
  // ---- the four keys of chapter two (tools/process-art.py cuts the sheet, in the order of the places) ----
  {
    id: 'world_keys2', kind: 'sheet', size: '1024x1024', quality: 'medium', transparent: true,
    prompt:
      'A sprite sheet for a game: exactly four separate ornate old-fashioned door keys arranged in a neat grid of two rows and two columns, evenly spaced, ' +
      'each centred in its own cell with clear empty space all around it, none touching or overlapping, all drawn at the same size, ' +
      'each key lying on a slant with its bow (the handle end) at the top left and its teeth at the bottom right. ' +
      'Every key is plainly different from the others, with its own colour and its own shape of bow. ' +
      'Row one, left to right: a key of green bottle glass in a white iron frame whose bow is a little arched greenhouse window with a yellow marrow flower growing through it; ' +
      'a white porcelain and brass bathroom key whose bow is a four-spoked brass tap handle, with a rubber bath plug hanging from it on a bead chain. ' +
      'Row two, left to right: a grey steel workshop key whose bow is a toothed cogwheel with a small spanner crossed over it, with a brown luggage tag tied on with string; ' +
      'a rose-gold sewing key whose bow is the two finger loops of a pair of scissors, with a length of red thread wound round it and a tiny silver thimble charm. ' +
      `${WORLD_STYLE}`,
  },
  // ---- the rival: one more person, painted to stand beside the four of the cast sheet ----
  // Asked for on 18 November 2026: "a villain to the game that's our counterpart ... to add more depth".
  // She is our own: a junior clearance officer who thinks a mess is to be filed, not befriended.
  {
    id: 'cast_tansy', kind: 'human', size: '1024x1024', quality: 'medium', transparent: true,
    prompt:
      'A single game character sprite, full body, standing upright facing the viewer, turned very slightly to the right: ' +
      'a brisk young woman in her twenties, a junior clearance officer, with warm tan skin, a sharp black bob with a blunt fringe and round wire glasses, ' +
      'wearing a pale-blue boiler suit a size too big with the cuffs rolled up and a bright yellow armband, spotless white trainers, ' +
      'a clipboard held against her chest in one arm, a feather duster hanging from her belt, and a bundle of flat-packed cardboard boxes strapped on her back. ' +
      'Chin up, one eyebrow raised, a confident competitive smile: sure she is right, not unkind. ' +
      `Big head, chunky proportions. An original character, not based on any existing game, film or cartoon character. ${SPRITE_STYLE}`,
  },
];
