// Every number and name in the game lives here, so tuning is one file.
// Nothing in this module touches the DOM, the clock or storage.

export const VERSION = '0.1.0';
export const SAVE_VERSION = 2;
export const TITLE = 'Clutterkin'; // the game's name, and what its creatures are called (one Clutterkin, many Clutterkin): clutter to some, kin to you

export const TEAM_SIZE = 3;
export const ROSTER_MAX = 60; // friends kept; one per kind, so never reached with 40 kinds
export const MAX_LEVEL = 40;
export const NAME_LENGTH = 12;

// ---------------------------------------------------------------- elements
//
// Six household elements in one ring. Each beats exactly one other and is
// beaten by exactly one other; every other pairing is even.
export const ELEMENTS = {
  spark: { name: 'Spark', beats: 'fluff', why: 'Spark singes Fluff', color: '#ffc83d' },
  fluff: { name: 'Fluff', beats: 'suds', why: 'Fluff mops up Suds', color: '#c9b8e8' },
  suds: { name: 'Suds', beats: 'crumb', why: 'Suds wash away Crumb', color: '#4fc4cf' },
  crumb: { name: 'Crumb', beats: 'clank', why: 'Crumb jams Clank', color: '#f2a65a' },
  clank: { name: 'Clank', beats: 'sprout', why: 'Clank mows Sprout', color: '#9fb0c8' },
  sprout: { name: 'Sprout', beats: 'spark', why: 'Sprout grounds Spark', color: '#7ac74f' },
};
export const ELEMENT_IDS = Object.keys(ELEMENTS);
export const STRONG = 1.5; // damage into the element you beat
export const WEAK = 0.7; // damage into the element that beats you

/** +1 if `attack` beats `defend`, -1 if `defend` beats `attack`, otherwise 0. */
export function elementEdge(attack, defend) {
  if (!ELEMENTS[attack] || !ELEMENTS[defend]) return 0;
  if (ELEMENTS[attack].beats === defend) return 1;
  if (ELEMENTS[defend].beats === attack) return -1;
  return 0;
}
export const elementMult = (attack, defend) => [WEAK, 1, STRONG][elementEdge(attack, defend) + 1];
/** The element an Clutterkin lets its guard down around: the one it beats. */
export const softSpotOf = (element) => ELEMENTS[element].beats;

// ---------------------------------------------------------------- stats

export const STATS = {
  hp: { name: 'Health', hint: 'How much it can take.' },
  oomph: { name: 'Oomph', hint: 'How hard it hits.' },
  grit: { name: 'Grit', hint: 'How well it shrugs hits off.' },
  pep: { name: 'Pep', hint: 'Who goes first.' },
};
export const STAT_IDS = Object.keys(STATS);
export const GROWTH = 0.1; // each level adds this share of the base stat
export const statAt = (base, level) => Math.max(1, Math.round(base * (1 + GROWTH * (level - 1))));

export const WOBBLE = 0.1; // damage varies by this much either way
export const MAX_ROUNDS = 40; // a fight that long is a draw, and a draw is a loss

// ---------------------------------------------------------------- moves
//
// A move does one or more of four things. `power` hits (a multiple of Oomph);
// `sap` lowers a stat of whatever it was aimed at; `mend` heals (a share of
// full Health); `boost` raises a stat. `aim`: foe, foes, self, ally, allies.
// `wait` is how many of its own turns the user sits out before using it again.
const hit = (name, element, power, wait, desc, extra) => ({ name, element, kind: 'hit', aim: 'foe', power, wait, desc, ...extra });
const sweep = (name, element, power, wait, desc, extra) => ({ name, element, kind: 'sweep', aim: 'foes', power, wait, desc, ...extra });
const mend = (name, element, share, aim, wait, desc) => ({ name, element, kind: 'mend', aim, mend: share, wait, desc });
const boost = (name, element, stat, by, turns, aim, wait, desc) => ({ name, element, kind: 'boost', aim, boost: { stat, by, turns }, wait, desc });
const sap = (name, element, stat, by, turns, aim, wait, desc) => ({ name, element, kind: 'sap', aim, sap: { stat, by, turns }, wait, desc });

export const MOVES = {
  // Dust Bunny
  lintflurry: hit('Lint Flurry', 'fluff', 1.0, 0, 'A puff of lint in the face.'),
  underbed: hit('Under-the-Bed Pounce', 'fluff', 1.7, 2, 'Out of the dark, all at once.'),
  kickupdust: sweep('Kick Up Dust', 'fluff', 0.65, 3, 'Everyone on the other side gets a lungful.'),
  // Sock Eel
  wringout: hit('Wring Out', 'suds', 1.0, 0, 'A cold, wet squeeze.'),
  oddsocksnap: hit('Odd-Sock Snap', 'suds', 1.65, 2, 'Stretches right back and lets go.'),
  soakthrough: hit('Soak Through', 'suds', 0.7, 3, 'Sodden things take hits badly: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Toast Ghost
  crumbtoss: hit('Crumb Toss', 'crumb', 1.0, 0, 'A handful of very dry crumbs.'),
  butterup: mend('Butter Up', 'crumb', 0.3, 'ally', 2, 'A warm pat of butter mends a friend.'),
  burntoffering: sweep('Burnt Offering', 'crumb', 0.7, 3, 'Smoke gets in everyone\'s eyes.'),
  // Dandepuff
  puffscatter: hit('Puff Scatter', 'sprout', 1.0, 0, 'A sneeze of seeds.'),
  takeroot: mend('Take Root', 'sprout', 0.25, 'self', 3, 'Digs in and drinks.'),
  seedstorm: sweep('Seed Storm', 'sprout', 0.65, 3, 'The whole clock blows at once.'),
  // Thornhog
  brambleshove: hit('Bramble Shove', 'sprout', 1.0, 0, 'Shoulder first, thorns out.'),
  bristleup: boost('Bristle Up', 'sprout', 'grit', 0.4, 3, 'self', 3, 'Every thorn stands on end: raises Grit.'),
  rosebudjab: hit('Rosebud Jab', 'sprout', 1.7, 2, 'Pretty, then painful.'),
  // Grumblebee
  needlework: hit('Needlework', 'sprout', 1.0, 0, 'Small, neat, sharp stitches.'),
  beeline: hit('Beeline', 'sprout', 1.6, 2, 'The shortest way to a sore spot.'),
  grumble: sap('Grumble', 'sprout', 'oomph', 0.2, 2, 'foes', 3, 'A drone that takes the fight out of everyone: lowers Oomph.'),
  // Snailor
  saltspray: hit('Salt Spray', 'suds', 1.0, 0, 'It stings, and it knows it.'),
  battendown: boost('Batten Down', 'suds', 'grit', 0.5, 3, 'self', 3, 'Hatches shut: raises Grit.'),
  slowtide: sweep('Slow Tide', 'suds', 0.7, 3, 'Comes in gently and soaks everyone.'),
  // Grumpy Gnome
  rodwhack: hit('Rod Whack', 'clank', 1.0, 0, 'Not what a fishing rod is for.'),
  hookandyank: hit('Hook and Yank', 'clank', 1.1, 2, 'Trips its catch: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  lawnorder: hit('Lawn Order', 'clank', 1.8, 3, 'Keep off the grass.'),
  // Cap Beetle
  pincerpop: hit('Pincer Pop', 'clank', 1.0, 0, 'Opens things. You are a thing.'),
  capclamp: hit('Cap Clamp', 'clank', 0.8, 2, 'Holds on and squeezes: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  shakenfizz: hit('Shaken Fizz', 'clank', 1.8, 3, 'Somebody shook the bottle.'),
  // Sparkplug
  staticsnap: hit('Static Snap', 'spark', 1.0, 0, 'A crack off the carpet.'),
  shortcircuit: hit('Short Circuit', 'spark', 1.6, 2, 'The quick way through.'),
  tripthefuse: sweep('Trip the Fuse', 'spark', 0.65, 3, 'Lights out for everybody.'),
  // Ratscal
  forkjab: hit('Fork Jab', 'crumb', 1.0, 0, 'Bent, but it still has four points.'),
  binraid: hit('Bin Raid', 'crumb', 1.6, 2, 'Whatever was in there, it is on you now.'),
  scrapsforall: mend('Scraps for All', 'crumb', 0.15, 'allies', 4, 'Shares the haul: mends its whole side a little.'),
  // Can Crab
  tinnip: hit('Tin Nip', 'clank', 1.0, 0, 'A claw, from somewhere inside the tin.'),
  liddown: boost('Pull the Lid Down', 'clank', 'grit', 0.5, 3, 'self', 3, 'Back inside, lid shut: raises Grit.'),
  canopener: hit('Can Opener', 'clank', 1.2, 3, 'Finds the seam and works at it: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Sock Goblin
  buttonflick: hit('Button Flick', 'fluff', 1.0, 0, 'It has spares.'),
  pullathread: hit('Pull a Thread', 'fluff', 0.8, 2, 'Finds the loose end and keeps pulling: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  darnit: hit('Darn It', 'fluff', 1.75, 3, 'A needle, and a very short temper.'),
  // Coo-Thug
  peckingorder: hit('Pecking Order', 'crumb', 1.0, 0, 'You are at the bottom of it.'),
  shakedown: hit('Shakedown', 'crumb', 1.1, 2, 'Hand over the crumbs: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  flocktogether: sweep('Flock Together', 'crumb', 0.65, 3, 'Suddenly there are forty of it.'),
  // The Bandit Baron
  lidbash: hit('Lid Bash', 'clank', 1.0, 0, 'A dustbin lid, edge on.'),
  fishbonesweep: sweep('Fishbone Sweep', 'clank', 0.6, 2, 'The sceptre comes round, and so does the smell.'),
  standanddeliver: hit('Stand and Deliver', 'clank', 1.3, 3, 'Takes the fight out of you, and your lunch: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  // Sprinkler Hydra
  nozzlejet: hit('Nozzle Jet', 'suds', 1.0, 0, 'One head, full pressure.'),
  fullsprinkle: sweep('Full Sprinkle', 'suds', 0.6, 2, 'Round and round and round.'),
  hosedown: hit('Hose Down', 'suds', 1.3, 3, 'Drenched and dragging: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
};

// Anyone can do this instead of a move: sit tight until its next turn.
export const BRACE = { id: 'brace', name: 'Brace', element: null, kind: 'boost', aim: 'self', boost: { stat: 'grit', by: 0.5, turns: 1 }, wait: 0, desc: 'Sit tight: takes a third less until its next turn.' };
export const moveOf = (id) => (id === BRACE.id ? BRACE : MOVES[id]);

// ---------------------------------------------------------------- the Clutterkin
//
// The first twelve. `moves` pairs each move with the level it is learned at.
// `huff` is how worked up one is when it is not yet a friend: the pips Reach
// out has to clear. A boss has none and cannot be reached. `turns` is how
// many times it acts in a round. `grown` is the form it will grow into: the
// data is here for the art list, but nothing grows up until that art exists.
export const SPECIES = {
  dustbunny: {
    name: 'Dust Bunny', element: 'fluff', hp: 44, oomph: 13, grit: 9, pep: 15, huff: 4,
    moves: [['lintflurry', 1], ['underbed', 3], ['kickupdust', 6]],
    blurb: 'Lives under the bed. Has always lived under the bed.',
    grown: { at: 12, name: 'Dust Jackalope' },
  },
  sockeel: {
    name: 'Sock Eel', element: 'suds', hp: 52, oomph: 12, grit: 11, pep: 10, huff: 4,
    moves: [['wringout', 1], ['oddsocksnap', 3], ['soakthrough', 6]],
    blurb: 'Went into the wash as one of a pair.',
    grown: { at: 12, name: 'Stocking Serpent' },
  },
  toastghost: {
    name: 'Toast Ghost', element: 'crumb', hp: 50, oomph: 10, grit: 12, pep: 8, huff: 4,
    moves: [['crumbtoss', 1], ['butterup', 3], ['burntoffering', 6]],
    fly: true,
    blurb: 'Somebody forgot it in the toaster. It has not forgotten.',
    grown: { at: 12, name: 'Toastie Phantom' },
  },
  dandepuff: {
    name: 'Dandepuff', element: 'sprout', hp: 36, oomph: 10, grit: 8, pep: 12, huff: 3,
    moves: [['puffscatter', 1], ['takeroot', 3], ['seedstorm', 6]],
    blurb: 'One good sneeze from being a hundred of itself.',
    grown: { at: 12, name: 'Dandemane' },
  },
  thornhog: {
    name: 'Thornhog', element: 'sprout', hp: 56, oomph: 10, grit: 13, pep: 6, huff: 5,
    moves: [['brambleshove', 1], ['bristleup', 3], ['rosebudjab', 6]],
    blurb: 'Grew out of the rose bush nobody prunes.',
    grown: { at: 12, name: 'Bramble Boar' },
  },
  grumblebee: {
    name: 'Grumblebee', element: 'sprout', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['needlework', 1], ['beeline', 3], ['grumble', 6]],
    fly: true,
    blurb: 'Furious about something. Will not say what.',
    grown: { at: 12, name: 'Rumblebee' },
  },
  snailor: {
    name: 'Snailor', element: 'suds', hp: 58, oomph: 9, grit: 14, pep: 4, huff: 5,
    moves: [['saltspray', 1], ['battendown', 3], ['slowtide', 6]],
    blurb: 'Sailed here from the water butt. It took a year.',
    grown: { at: 12, name: 'Snadmiral' },
  },
  gnome: {
    name: 'Grumpy Gnome', element: 'clank', hp: 50, oomph: 12, grit: 11, pep: 9, huff: 5,
    moves: [['rodwhack', 1], ['hookandyank', 3], ['lawnorder', 6]],
    blurb: 'Chipped in 1987 and still not over it.',
    grown: { at: 12, name: 'Gnomarch' },
  },
  capbeetle: {
    name: 'Cap Beetle', element: 'clank', hp: 46, oomph: 11, grit: 13, pep: 8, huff: 4,
    moves: [['pincerpop', 1], ['capclamp', 3], ['shakenfizz', 6]],
    blurb: 'Wandered in from the alley wearing somebody\'s lemonade.',
    grown: { at: 12, name: 'Corkscrew Stag' },
  },
  sparkplug: {
    name: 'Sparkplug', element: 'spark', hp: 40, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['staticsnap', 1], ['shortcircuit', 3], ['tripthefuse', 6]],
    blurb: 'Fell off the garden lights and kept the charge.',
    grown: { at: 12, name: 'Surge Protector' },
  },
  ratscal: {
    name: 'Ratscal', element: 'crumb', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 3,
    moves: [['forkjab', 1], ['binraid', 3], ['scrapsforall', 6]],
    blurb: 'Knows what is in every bin on the street.',
    grown: { at: 12, name: 'Ratscallion' },
  },
  cancrab: {
    name: 'Can Crab', element: 'clank', hp: 54, oomph: 11, grit: 15, pep: 6, huff: 5,
    moves: [['tinnip', 1], ['liddown', 3], ['canopener', 6]],
    blurb: 'Moved into a tin of tomatoes one winter and has not been out since.',
    grown: { at: 12, name: 'Dustbin Lobster' },
  },
  sockgoblin: {
    name: 'Sock Goblin', element: 'fluff', hp: 44, oomph: 14, grit: 9, pep: 14, huff: 4,
    moves: [['buttonflick', 1], ['pullathread', 3], ['darnit', 6]],
    blurb: 'The other sock. It has been looking for you.',
    grown: { at: 12, name: 'Jumper Troll' },
  },
  coothug: {
    name: 'Coo-Thug', element: 'crumb', hp: 46, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['peckingorder', 1], ['shakedown', 3], ['flocktogether', 6]],
    blurb: 'A feather duster that fell in with a bad crowd.',
    grown: { at: 12, name: 'Coo-Kingpin' },
  },
  boss_hydra: {
    name: 'Sprinkler Hydra', element: 'suds', hp: 118, oomph: 11, grit: 12, pep: 9, huff: 0, boss: true, turns: 2,
    moves: [['nozzlejet', 1], ['fullsprinkle', 1], ['hosedown', 1]],
    blurb: 'Left on all summer. Three heads, one opinion.',
  },
  boss_baron: {
    name: 'The Bandit Baron', element: 'clank', hp: 120, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['lidbash', 1], ['fishbonesweep', 1], ['standanddeliver', 1]],
    blurb: 'A fur stole somebody threw out. It crowned itself the same night.',
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

/** The moves a kind knows at a level, in the order it learned them. */
export const movesAt = (species, level) => SPECIES[species].moves.filter(([, at]) => at <= level).map(([id]) => id);
/** The moves a kind learns on reaching exactly `level`. */
export const movesLearnedAt = (species, level) => SPECIES[species].moves.filter(([, at]) => at === level).map(([id]) => id);

// Who you start with: the three things that were already in your room.
export const START_TEAM = [['dustbunny', 3], ['sockeel', 3], ['toastghost', 3]];

// ---------------------------------------------------------------- heirlooms
//
// Now and then a restless Clutterkin is an Heirloom: the same kind in rare
// colours, as if it had been handed down. Looks only; it fights the same.
// It is a little prouder, so it takes one more pip to calm. Looking for them
// is a game of its own: go back to the places you have calmed.
export const HEIRLOOM = {
  odds: 1 / 60, // each restless Clutterkin in an encounter, bosses never
  // A place you have calmed feels safe, and they bring out their best colours there: three times as often.
  calmOdds: 1 / 20,
  huff: 1, // extra pips
};

// Once a place is calm, word gets round, and kinds like the three you set out with come calling
// there too (never beside its ringleader). It is the only way one of theirs can turn up as an
// Heirloom. `weight` is how likely each is beside the place's own kinds, which weigh 1 to 3.
export const VISITORS = { kinds: START_TEAM.map(([id]) => id), weight: 0.4 };

// ---------------------------------------------------------------- the house-sitter
//
// The human makes one Call a round. `every`: 1 = any round, 2 = every other.
export const CALLS = {
  reach: { name: 'Reach out', aim: 'foe', every: 1, desc: 'Calm a restless Clutterkin. Best on one you have stopped hitting.' },
  cheer: { name: 'Cheer on', aim: 'ally', every: 1, boost: { stat: 'oomph', by: 0.3, turns: 1 }, desc: 'A friend\'s next move hits 30% harder.' },
  patch: { name: 'Patch up', aim: 'ally', every: 2, mend: 0.2, desc: 'Mend a friend by a fifth of its Health. Every other round.' },
};
export const CALL_IDS = Object.keys(CALLS);

// Reach out takes `base` pips off a Huff, `soft` more if a friend of the
// element it has a soft spot for is standing. Each hit you land puts
// `hitBack` pips on again: you cannot calm what you are still hitting.
export const REACH = { base: 2, soft: 1, hitBack: 1 };

// The looks a player can choose for the house-sitter. Looks only.
export const LOOKS = [
  { id: 'sitter_a', name: 'Lantern' },
  { id: 'sitter_b', name: 'Torch' },
  { id: 'sitter_c', name: 'Headlamp' },
  { id: 'sitter_d', name: 'Candle' },
];
export const LOOK_IDS = LOOKS.map((look) => look.id);
export const lookOf = (id) => (LOOK_IDS.includes(id) ? id : LOOK_IDS[0]);
export const DEFAULT_NAME = 'Sitter';

// ---------------------------------------------------------------- experience

export const xpNeeded = (level) => Math.round(24 * Math.pow(level, 1.5));
/** What beating (or calming) one is worth to each friend on the team. */
export const xpFor = (species, level) => Math.round((6 + 5 * level) * (SPECIES[species].boss ? 4 : 1));
export const BENCH_SHARE = 0.5; // friends left at home learn half as much

// ---------------------------------------------------------------- rooms
//
// The eight rooms of the house, in the order they open. A room is a path of
// encounters ending in a boss. `size` is how many restless Clutterkin turn up,
// `pool` who they may be (kind, weight) and `level` how strong. The first two
// are built; the rest are on the map and locked.
export const BREATHER = 0.3; // share of Health everyone regains between encounters

export const ROOMS = [
  {
    id: 'garden', name: 'The Garden Gate', bg: 'bg_garden', tint: '#7ac74f', element: 'sprout',
    blurb: 'Long grass, a gate that sticks, and a sprinkler nobody turned off.',
    path: [
      { name: 'By the Gate', size: [2, 2], level: [1, 2], pool: [['dandepuff', 3], ['ratscal', 2]] },
      { name: 'The Washing Line', size: [2, 2], level: [2, 3], pool: [['dandepuff', 2], ['grumblebee', 2], ['snailor', 2], ['sparkplug', 2]] },
      { name: 'The Flower Bed', size: [3, 3], level: [2, 3], pool: [['dandepuff', 2], ['thornhog', 2], ['grumblebee', 2], ['sparkplug', 1]] },
      { name: 'The Potting Shed', size: [3, 3], level: [3, 4], pool: [['gnome', 3], ['capbeetle', 3], ['thornhog', 1], ['ratscal', 1], ['snailor', 1]] },
      { name: 'The Sprinkler', boss: 'boss_hydra', bossLevel: 5, size: [2, 2], level: [3, 3], pool: [['snailor', 1], ['dandepuff', 2]] },
    ],
  },
  {
    id: 'alley', name: 'Tin Can Alley', bg: 'bg_alley', tint: '#8c9bb5', element: 'clank',
    blurb: 'Bins, bottle caps and whoever is in charge of them. A narrow place: they come one after another.',
    path: [
      { name: 'The Dented Bins', size: [2, 2], level: [4, 4], pool: [['cancrab', 3], ['ratscal', 2]] },
      { name: 'The Bottle Bank', size: [2, 3], level: [4, 5], pool: [['capbeetle', 3], ['sockgoblin', 2], ['cancrab', 1]] },
      { name: 'The Fire Escape', size: [3, 3], level: [4, 5], pool: [['coothug', 3], ['sockgoblin', 2], ['sparkplug', 1]] },
      { name: 'The Loading Bay', size: [3, 3], level: [5, 5], pool: [['cancrab', 2], ['coothug', 2], ['capbeetle', 2], ['ratscal', 1]] },
      { name: 'The Baron\'s Court', boss: 'boss_baron', bossLevel: 6, size: [1, 2], level: [4, 4], pool: [['coothug', 2], ['ratscal', 2]] },
    ],
  },
  { id: 'pantry', name: 'The Midnight Pantry', bg: 'bg_pantry', tint: '#f2a65a', element: 'crumb', blurb: 'Everything in here is past its date and wide awake.', path: null },
  { id: 'wash', name: 'The Wash', bg: 'bg_wash', tint: '#4fc4cf', element: 'suds', blurb: 'Where socks go in as pairs.', path: null },
  { id: 'stacks', name: 'The Dusty Stacks', bg: 'bg_stacks', tint: '#c08552', element: 'fluff', blurb: 'Overdue books and what lives between the pages.', path: null },
  { id: 'rooftops', name: 'Moonlit Rooftops', bg: 'bg_rooftops', tint: '#7d6bd6', element: 'clank', blurb: 'Slates, chimneys and a long way down.', path: null },
  { id: 'attic', name: 'The Tick-Tock Attic', bg: 'bg_attic', tint: '#d9a441', element: 'clank', blurb: 'Every clock up here is wrong in a different way.', path: null },
  { id: 'dark', name: 'The Roaring Dark', bg: 'bg_dark', tint: '#d6455d', element: 'spark', blurb: 'The cupboard under the stairs. Something in it is plugged in.', path: null },
];
export const ROOM_IDS = ROOMS.map((room) => room.id);
export const roomOf = (id) => ROOMS.find((room) => room.id === id) || null;
/** A room can be walked into once it is built and the room before it has been cleared. */
export const roomBuilt = (room) => Array.isArray(room.path) && room.path.length > 0;
