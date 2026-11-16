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
