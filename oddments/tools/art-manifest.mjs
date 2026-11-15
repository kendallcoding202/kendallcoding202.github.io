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

export const ART = [
  // ---- the house-sitter (the player): four candidate looks to choose from ----
  human('sitter_a', 'a young adult woman house-sitter with warm brown skin and curly dark hair in a messy bun held by a pencil, wearing an oversized mustard-yellow knitted cardigan over teal pyjamas, mismatched socks (one red-striped, one blue-dotted) and no shoes, holding up a small glowing brass wind-up lantern in one hand, the other hand held out open in a friendly way.'),
  human('sitter_b', 'a tall lanky young adult man house-sitter with dark brown skin, short twisted hair and round glasses, wearing a plum-purple quilted dressing gown over striped pyjamas and fluffy grey slippers, holding a big chunky flashlight with a warm beam in one hand, the other hand held out open in a friendly way.'),
  human('sitter_c', 'a short stocky young adult house-sitter with tan skin, freckles and a chin-length bob of teal-dyed hair, wearing a camping headlamp on the forehead, a baggy cream cable-knit jumper with rolled sleeves, patched olive-green dungarees and yellow rubber boots, a feather duster tucked in the belt, one hand held out open in a friendly way.'),
  human('sitter_d', 'a young adult house-sitter with East Asian features and short choppy black hair, wrapped in a colourful patchwork quilt worn like a cape over grey pyjamas, a big ring of old house keys at the belt, carrying a lit candle in a brass chamber-stick holder in one hand, the other hand held out open in a friendly way.'),
];
