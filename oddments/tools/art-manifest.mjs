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
];
