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
  // Hopmote
  lintflurry: hit('Lint Flurry', 'fluff', 1.0, 0, 'A puff of lint in the face.'),
  underbed: hit('Under-the-Bed Pounce', 'fluff', 1.7, 2, 'Out of the dark, all at once.'),
  kickupdust: sweep('Kick Up Dust', 'fluff', 0.65, 3, 'Everyone on the other side gets a lungful.'),
  // Eelastic
  wringout: hit('Wring Out', 'suds', 1.0, 0, 'A cold, wet squeeze.'),
  oddsocksnap: hit('Odd-Sock Snap', 'suds', 1.65, 2, 'Stretches right back and lets go.'),
  soakthrough: hit('Soak Through', 'suds', 0.7, 3, 'Sodden things take hits badly: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Crumbwisp
  crumbtoss: hit('Crumb Toss', 'crumb', 1.0, 0, 'A handful of very dry crumbs.'),
  butterup: mend('Butter Up', 'crumb', 0.3, 'ally', 2, 'A warm pat of butter mends a friend.'),
  burntoffering: sweep('Burnt Offering', 'crumb', 0.7, 3, 'Smoke gets in everyone\'s eyes.'),
  // Wishclock
  puffscatter: hit('Puff Scatter', 'sprout', 1.0, 0, 'A sneeze of seeds.'),
  takeroot: mend('Take Root', 'sprout', 0.25, 'self', 3, 'Digs in and drinks.'),
  seedstorm: sweep('Seed Storm', 'sprout', 0.65, 3, 'The whole clock blows at once.'),
  // Pricklebud
  brambleshove: hit('Bramble Shove', 'sprout', 1.0, 0, 'Shoulder first, thorns out.'),
  bristleup: boost('Bristle Up', 'sprout', 'grit', 0.4, 3, 'self', 3, 'Every thorn stands on end: raises Grit.'),
  rosebudjab: hit('Rosebud Jab', 'sprout', 1.7, 2, 'Pretty, then painful.'),
  // Grumbuzz
  needlework: hit('Needlework', 'sprout', 1.0, 0, 'Small, neat, sharp stitches.'),
  beeline: hit('Beeline', 'sprout', 1.6, 2, 'The shortest way to a sore spot.'),
  grumble: sap('Grumble', 'sprout', 'oomph', 0.2, 2, 'foes', 3, 'A drone that takes the fight out of everyone: lowers Oomph.'),
  // Shellfarer
  saltspray: hit('Salt Spray', 'suds', 1.0, 0, 'It stings, and it knows it.'),
  battendown: boost('Batten Down', 'suds', 'grit', 0.5, 3, 'self', 3, 'Hatches shut: raises Grit.'),
  slowtide: sweep('Slow Tide', 'suds', 0.7, 3, 'Comes in gently and soaks everyone.'),
  // Gnomudgeon
  rodwhack: hit('Rod Whack', 'clank', 1.0, 0, 'Not what a fishing rod is for.'),
  hookandyank: hit('Hook and Yank', 'clank', 1.1, 2, 'Trips its catch: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  lawnorder: hit('Lawn Order', 'clank', 1.8, 3, 'Keep off the grass.'),
  // Crimpet
  pincerpop: hit('Pincer Pop', 'clank', 1.0, 0, 'Opens things. You are a thing.'),
  capclamp: hit('Cap Clamp', 'clank', 0.8, 2, 'Holds on and squeezes: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  shakenfizz: hit('Shaken Fizz', 'clank', 1.8, 3, 'Somebody shook the bottle.'),
  // Strayglow
  staticsnap: hit('Static Snap', 'spark', 1.0, 0, 'A crack off the carpet.'),
  shortcircuit: hit('Short Circuit', 'spark', 1.6, 2, 'The quick way through.'),
  tripthefuse: sweep('Trip the Fuse', 'spark', 0.65, 3, 'Lights out for everybody.'),
  // Snaffle
  forkjab: hit('Fork Jab', 'crumb', 1.0, 0, 'Bent, but it still has four points.'),
  binraid: hit('Bin Raid', 'crumb', 1.6, 2, 'Whatever was in there, it is on you now.'),
  scrapsforall: mend('Scraps for All', 'crumb', 0.15, 'allies', 4, 'Shares the haul: mends its whole side a little.'),
  // Hermitin
  tinnip: hit('Tin Nip', 'clank', 1.0, 0, 'A claw, from somewhere inside the tin.'),
  liddown: boost('Pull the Lid Down', 'clank', 'grit', 0.5, 3, 'self', 3, 'Back inside, lid shut: raises Grit.'),
  canopener: hit('Can Opener', 'clank', 1.2, 3, 'Finds the seam and works at it: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Frayling
  buttonflick: hit('Button Flick', 'fluff', 1.0, 0, 'It has spares.'),
  pullathread: hit('Pull a Thread', 'fluff', 0.8, 2, 'Finds the loose end and keeps pulling: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  darnit: hit('Darn It', 'fluff', 1.75, 3, 'A needle, and a very short temper.'),
  // Preenager
  peckingorder: hit('Pecking Order', 'crumb', 1.0, 0, 'You are at the bottom of it.'),
  shakedown: hit('Shakedown', 'crumb', 1.1, 2, 'Hand over the crumbs: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  flocktogether: sweep('Flock Together', 'crumb', 0.65, 3, 'Suddenly there are forty of it.'),
  // Scrumpling
  steampuff: hit('Steam Puff', 'crumb', 1.0, 0, 'Lifts its own lid at you.'),
  doughythump: hit('Doughy Thump', 'crumb', 1.65, 2, 'Soft, until it lands.'),
  stickyfold: hit('Sticky Fold', 'crumb', 0.8, 3, 'Folds you in and pinches the edges: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  // Embernip
  chilliflick: hit('Chilli Flick', 'spark', 1.0, 0, 'A seed, right in the eye.'),
  hotstreak: hit('Hot Streak', 'spark', 1.7, 2, 'Too hot to hold, and coming your way.'),
  fivealarm: sweep('Five-Alarm', 'spark', 0.65, 3, 'Everyone reaches for the water.'),
  // Eggallant
  spoonrap: hit('Spoon Rap', 'clank', 1.0, 0, 'Across the knuckles.'),
  shellup: boost('Shell Up', 'clank', 'grit', 0.5, 3, 'self', 3, 'Back inside the shell: raises Grit.'),
  softboiledcharge: hit('Soft-Boiled Charge', 'clank', 1.75, 3, 'Runnier than it looks, and faster.'),
  // Wibblet
  wobbleslap: hit('Wobble Slap', 'suds', 1.0, 0, 'Cold, and it keeps going after it lands.'),
  cherryontop: mend('Cherry on Top', 'suds', 0.3, 'ally', 2, 'A cherry makes anybody feel better.'),
  jellyquake: sweep('Jelly Quake', 'suds', 0.65, 3, 'The whole plate goes.'),
  // The Crumbwyrm
  popup: hit('Pop-Up Pounce', 'crumb', 1.0, 0, 'Up out of the slot, all at once.'),
  crumbbreath: sweep('Crumb Breath', 'crumb', 0.6, 2, 'Years of crumbs, in one go.'),
  settingsix: hit('Setting Six', 'crumb', 1.3, 3, 'Burnt right through: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Baron Pilfer
  lidbash: hit('Lid Bash', 'clank', 1.0, 0, 'A dustbin lid, edge on.'),
  fishbonesweep: sweep('Fishbone Sweep', 'clank', 0.6, 2, 'The sceptre comes round, and so does the smell.'),
  standanddeliver: hit('Stand and Deliver', 'clank', 1.3, 3, 'Takes the fight out of you, and your lunch: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  // Old Summerlong
  nozzlejet: hit('Nozzle Jet', 'suds', 1.0, 0, 'One head, full pressure.'),
  fullsprinkle: sweep('Full Sprinkle', 'suds', 0.6, 2, 'Round and round and round.'),
  hosedown: hit('Hose Down', 'suds', 1.3, 3, 'Drenched and dragging: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  // ---- The Wash
  // Shimmerbell
  bubblepop: hit('Bubble Pop', 'suds', 1.0, 0, 'Right on the nose.'),
  rainbowsheen: sap('Rainbow Sheen', 'suds', 'oomph', 0.2, 2, 'foes', 3, 'Too pretty to hit hard at: lowers Oomph.'),
  longsting: hit('Long Sting', 'suds', 1.65, 2, 'It has a lot of arms, and all of them tingle.'),
  // Slipsud
  soapslick: hit('Soap Slick', 'suds', 1.0, 0, 'The floor goes out from under you.'),
  latherup: boost('Lather Up', 'suds', 'grit', 0.5, 3, 'self', 3, 'A coat of foam: raises Grit.'),
  slipandslide: hit('Slip and Slide', 'suds', 1.1, 2, 'You go one way, your feet the other: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  // Fluffolith
  lintlob: hit('Lint Lob', 'fluff', 1.0, 0, 'A fistful of the filter.'),
  pegpinch: hit('Peg Pinch', 'fluff', 1.7, 2, 'It keeps them for this.'),
  tumbledry: sweep('Tumble Dry', 'fluff', 0.65, 3, 'Round and round, and everyone comes out creased.'),
  // Pegadile
  snapshut: hit('Snap Shut', 'clank', 1.0, 0, 'A spring, and two bits of wood.'),
  clampdown: hit('Clamp Down', 'clank', 0.8, 2, 'Holds on like washing in a gale: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  linedance: hit('Line Dance', 'clank', 1.75, 3, 'All the way along the washing line and off the end.'),
  // The Spin Cycle
  sockwhip: hit('Sock Whip', 'suds', 1.0, 0, 'A wet sock, at speed.'),
  rinserepeat: sweep('Rinse and Repeat', 'suds', 0.6, 2, 'Everybody gets a go round.'),
  fullspin: hit('Full Spin', 'suds', 1.3, 3, 'Twelve hundred turns a minute: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // ---- The Dusty Stacks
  // Footnote
  pageturner: hit('Page Turner', 'fluff', 1.0, 0, 'A paper cut, delivered with care.'),
  wellread: boost('Well Read', 'fluff', 'oomph', 0.4, 3, 'self', 3, 'It has read ahead: raises Oomph.'),
  hardback: hit('Hardback', 'fluff', 1.7, 2, 'Four hundred pages, shut on you.'),
  // Dribblewax
  hotdrip: hit('Hot Drip', 'spark', 1.0, 0, 'Wax, where you least want it.'),
  snuffout: hit('Snuff Out', 'spark', 1.1, 2, 'Pinches your spark between two fingers: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  flareup: sweep('Flare Up', 'spark', 0.65, 3, 'Suddenly a lot more candle.'),
  // Blottle
  inkflick: hit('Ink Flick', 'suds', 1.0, 0, 'It will not come out.'),
  blotout: hit('Blot Out', 'suds', 1.1, 2, 'Right across the eyes: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  spillage: sweep('Spillage', 'suds', 0.65, 3, 'Over the whole desk.'),
  // Inkspine
  nibjab: hit('Nib Jab', 'fluff', 1.0, 0, 'Sharp, and it leaves a mark.'),
  rollup: boost('Roll Up', 'fluff', 'grit', 0.5, 3, 'self', 3, 'Nothing to hit but quills: raises Grit.'),
  lastword: hit('The Last Word', 'fluff', 1.75, 3, 'Signed, with a flourish.'),
  // Foldwing
  papercut: hit('Paper Cut', 'fluff', 1.0, 0, 'Small. Stings for days.'),
  foldedswoop: hit('Folded Swoop', 'fluff', 1.6, 2, 'Along the crease, very fast.'),
  goodnews: mend('Good News', 'fluff', 0.15, 'allies', 4, 'Reads everyone something cheerful: mends its whole side a little.'),
  // The Overdue Tome
  slamshut: hit('Slam Shut', 'fluff', 1.0, 0, 'Mind your fingers.'),
  latefees: sweep('Late Fees', 'fluff', 0.6, 2, 'Everybody owes.'),
  tonguelash: hit('Tongue Lash', 'fluff', 1.3, 3, 'Its bookmark, and it is rough: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // ---- Moonlit Rooftops
  // Gutterflit
  leafdive: hit('Leaf Dive', 'sprout', 1.0, 0, 'Out of the gutter, umbrella first.'),
  squeak: sap('Squeak', 'sprout', 'pep', 0.25, 2, 'foes', 3, 'Too high to hear, and everyone flinches: lowers Pep.'),
  nightswoop: hit('Night Swoop', 'sprout', 1.65, 2, 'You hear it after it has gone.'),
  // Shingleskink
  slateslap: hit('Slate Slap', 'clank', 1.0, 0, 'A tail like a roof tile.'),
  looseslate: hit('Loose Slate', 'clank', 1.7, 2, 'It knows which ones are loose.'),
  bask: mend('Bask', 'clank', 0.25, 'self', 3, 'Finds a warm chimney and soaks it up.'),
  // Vanecrow
  northpeck: hit('North Peck', 'clank', 1.0, 0, 'It always knows which way is you.'),
  changeofwind: boost('Change of Wind', 'clank', 'pep', 0.4, 3, 'self', 3, 'Swings round with the weather: raises Pep.'),
  cockcrow: sweep('Cock-Crow', 'clank', 0.65, 3, 'At three in the morning, to everyone.'),
  // Spoutling
  spout: hit('Spout', 'suds', 1.0, 0, 'A mouthful of last week\'s rain.'),
  stonestill: boost('Stone Still', 'suds', 'grit', 0.5, 3, 'self', 3, 'Does what it has done for a hundred years: raises Grit.'),
  downpipe: hit('Downpipe', 'suds', 1.75, 3, 'The whole gutter at once.'),
  // Emberdrift
  sootpuff: hit('Soot Puff', 'spark', 1.0, 0, 'Warm, black and in your eyes.'),
  smokescreen: sap('Smoke Screen', 'spark', 'oomph', 0.2, 2, 'foes', 3, 'Nobody can see what they are hitting: lowers Oomph.'),
  backdraught: hit('Backdraught', 'spark', 1.65, 2, 'The fire it came from, for a moment.'),
  // The Night Warden
  talonrake: hit('Talon Rake', 'clank', 1.0, 0, 'Stone, and sharper than it should be.'),
  wingbuffet: sweep('Wing Buffet', 'clank', 0.6, 2, 'Moss and grit, in a gale.'),
  stonystare: hit('Stony Stare', 'clank', 1.3, 3, 'You stop where you stand: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  // ---- The Tick-Tock Attic
  // Cogscuttle
  cogbite: hit('Cog Bite', 'clank', 1.0, 0, 'Small teeth, and a lot of them.'),
  windup: boost('Wind Up', 'clank', 'grit', 0.5, 3, 'self', 3, 'Three turns of its own key: raises Grit.'),
  sprungcoil: hit('Sprung Coil', 'clank', 1.75, 3, 'It has been wound for years.'),
  // Stalwind
  paradejab: hit('Parade Jab', 'clank', 1.0, 0, 'By the left, quick jab.'),
  drumroll: boost('Drum Roll', 'clank', 'oomph', 0.3, 2, 'allies', 3, 'Stirs the ranks: raises its whole side\'s Oomph.'),
  quickmarch: hit('Quick March', 'clank', 1.65, 2, 'Straight through you and out the other side.'),
  // Tocktalon
  onthehour: hit('On the Hour', 'sprout', 1.0, 0, 'Out, peck, back in.'),
  nestrobber: hit('Nest Robber', 'sprout', 1.1, 2, 'Takes something you were using: lowers Oomph.', { sap: { stat: 'oomph', by: 0.25, turns: 2 } }),
  twelveoclock: hit('Twelve o\'Clock', 'sprout', 1.75, 3, 'Twelve pecks, counted.'),
  // Lampmourn
  dustywing: hit('Dusty Wing', 'fluff', 1.0, 0, 'Powder, and a chill.'),
  mothholes: hit('Moth Holes', 'fluff', 0.8, 2, 'Finds the weak spot in the weave: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  lightsout: sweep('Lights Out', 'fluff', 0.65, 3, 'Every lamp at once, and something soft in the dark.'),
  // Crankjaw
  popgoes: hit('Pop Goes', 'clank', 1.0, 0, 'You knew it was coming. It still got you.'),
  liddown2: boost('Back in the Box', 'clank', 'grit', 0.4, 3, 'self', 3, 'Lid shut, handle still: raises Grit.'),
  lastlaugh: hit('The Last Laugh', 'clank', 1.75, 3, 'On a spring, with teeth.'),
  // Grandfather Golem
  pendulum: hit('Pendulum Swing', 'clank', 1.0, 0, 'Tick.'),
  chimes: sweep('Every Quarter', 'clank', 0.6, 2, 'All four chimes, on everybody.'),
  stoptheclock: hit('Stop the Clock', 'clank', 1.3, 3, 'Everything slows but it: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  // ---- The Roaring Dark
  // Tanglecoil
  plugbite: hit('Plug Bite', 'spark', 1.0, 0, 'Three pins.'),
  tangle: hit('Tangle', 'spark', 1.1, 2, 'Round your ankles twice: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  livewire: hit('Live Wire', 'spark', 1.75, 3, 'Somebody left it switched on.'),
  // Grimeshade
  coldfluff: hit('Cold Fluff', 'fluff', 1.0, 0, 'What was under the stairs all along.'),
  dreadhop: hit('Dread Hop', 'fluff', 1.7, 2, 'Like its cousin, with the lights off.'),
  duststorm: sweep('Dust Storm', 'fluff', 0.65, 3, 'Thirty years of it, all at once.'),
  // Bumpabout
  bumper: hit('Bumper', 'clank', 1.0, 0, 'Into your shin, again.'),
  dock: mend('Dock', 'clank', 0.25, 'self', 3, 'Backs onto its charger for a minute.'),
  edgeclean: sweep('Edge Clean', 'clank', 0.65, 3, 'Does the whole room, and you are in the room.'),
  // THE VACUUM
  hosewhip: hit('Hose Whip', 'spark', 1.0, 0, 'Ribbed, for extra sting.'),
  fullsuction: sweep('Full Suction', 'spark', 0.6, 2, 'Hold on to something.'),
  bagburst: hit('Bag Burst', 'spark', 1.3, 3, 'Everything it ever ate: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
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
// `notYet` is what it does when you Reach out and it is not ready to come.
export const SPECIES = {
  dustbunny: {
    name: 'Hopmote', element: 'fluff', hp: 44, oomph: 13, grit: 9, pep: 15, huff: 4,
    moves: [['lintflurry', 1], ['underbed', 3], ['kickupdust', 6]],
    blurb: 'Lives under the bed. Has always lived under the bed.',
    notYet: 'scoots back under something',
    grown: { at: 12, name: 'Lintelope' },
  },
  sockeel: {
    name: 'Eelastic', element: 'suds', hp: 52, oomph: 12, grit: 11, pep: 10, huff: 4,
    moves: [['wringout', 1], ['oddsocksnap', 3], ['soakthrough', 6]],
    blurb: 'Went into the wash as one of a pair.',
    notYet: 'ties itself in a knot',
    grown: { at: 12, name: 'Toeviathan' },
  },
  toastghost: {
    name: 'Crumbwisp', element: 'crumb', hp: 50, oomph: 10, grit: 12, pep: 8, huff: 4,
    moves: [['crumbtoss', 1], ['butterup', 3], ['burntoffering', 6]],
    fly: true,
    blurb: 'Somebody forgot it in the toaster. It has not forgotten.',
    notYet: 'pops back down out of sight',
    grown: { at: 12, name: 'Crustwraith' },
  },
  dandepuff: {
    name: 'Wishclock', element: 'sprout', hp: 36, oomph: 10, grit: 8, pep: 12, huff: 3,
    moves: [['puffscatter', 1], ['takeroot', 3], ['seedstorm', 6]],
    blurb: 'One good sneeze from being a hundred of itself.',
    notYet: 'puffs up and turns its back',
    grown: { at: 12, name: 'Wishmane' },
  },
  thornhog: {
    name: 'Pricklebud', element: 'sprout', hp: 56, oomph: 10, grit: 13, pep: 6, huff: 5,
    moves: [['brambleshove', 1], ['bristleup', 3], ['rosebudjab', 6]],
    blurb: 'Grew out of the rose bush nobody prunes.',
    notYet: 'bristles',
    grown: { at: 12, name: 'Briartusk' },
  },
  grumblebee: {
    name: 'Grumbuzz', element: 'sprout', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['needlework', 1], ['beeline', 3], ['grumble', 6]],
    fly: true,
    blurb: 'Furious about something. Will not say what.',
    notYet: 'buzzes a tight, cross circle',
    grown: { at: 12, name: 'Rumblepatch' },
  },
  snailor: {
    name: 'Shellfarer', element: 'suds', hp: 58, oomph: 9, grit: 14, pep: 4, huff: 5,
    moves: [['saltspray', 1], ['battendown', 3], ['slowtide', 6]],
    blurb: 'Sailed here from the water butt. It took a year.',
    notYet: 'pulls its head in',
    grown: { at: 12, name: 'Seawhorl' },
  },
  gnome: {
    name: 'Gnomudgeon', element: 'clank', hp: 50, oomph: 12, grit: 11, pep: 9, huff: 5,
    moves: [['rodwhack', 1], ['hookandyank', 3], ['lawnorder', 6]],
    blurb: 'Chipped in 1987 and still not over it.',
    notYet: 'folds its arms',
    grown: { at: 12, name: 'Gnomarch' },
  },
  capbeetle: {
    name: 'Crimpet', element: 'clank', hp: 46, oomph: 11, grit: 13, pep: 8, huff: 4,
    moves: [['pincerpop', 1], ['capclamp', 3], ['shakenfizz', 6]],
    blurb: 'Wandered in from the alley wearing somebody\'s lemonade.',
    notYet: 'clacks its pincers at you',
    grown: { at: 12, name: 'Corkhorn' },
  },
  sparkplug: {
    name: 'Strayglow', element: 'spark', hp: 40, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['staticsnap', 1], ['shortcircuit', 3], ['tripthefuse', 6]],
    blurb: 'Fell off the garden lights and kept the charge.',
    notYet: 'crackles and backs off',
    grown: { at: 12, name: 'Floodglow' },
  },
  ratscal: {
    name: 'Snaffle', element: 'crumb', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 3,
    moves: [['forkjab', 1], ['binraid', 3], ['scrapsforall', 6]],
    blurb: 'Knows what is in every bin on the street.',
    notYet: 'hides its fork behind it',
    grown: { at: 12, name: 'Snafflemore' },
  },
  cancrab: {
    name: 'Hermitin', element: 'clank', hp: 54, oomph: 11, grit: 15, pep: 6, huff: 5,
    moves: [['tinnip', 1], ['liddown', 3], ['canopener', 6]],
    blurb: 'Moved into a tin of tomatoes one winter and has not been out since.',
    notYet: 'pulls its lid down',
    grown: { at: 12, name: 'Clangster' },
  },
  sockgoblin: {
    name: 'Frayling', element: 'fluff', hp: 44, oomph: 14, grit: 9, pep: 14, huff: 4,
    moves: [['buttonflick', 1], ['pullathread', 3], ['darnit', 6]],
    blurb: 'The other sock. It has been looking for you.',
    notYet: 'sticks out a woolly tongue',
    grown: { at: 12, name: 'Woolligan' },
  },
  coothug: {
    name: 'Preenager', element: 'crumb', hp: 46, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['peckingorder', 1], ['shakedown', 3], ['flocktogether', 6]],
    blurb: 'A feather duster that fell in with a bad crowd.',
    notYet: 'ruffles up and struts off',
    grown: { at: 12, name: 'Kingpinion' },
  },
  dumpling: {
    name: 'Scrumpling', element: 'crumb', hp: 50, oomph: 13, grit: 11, pep: 11, huff: 4,
    moves: [['steampuff', 1], ['doughythump', 3], ['stickyfold', 6]],
    blurb: 'Steamed on Sunday. Still steaming about it.',
    notYet: 'lets off steam',
    grown: { at: 12, name: 'Scrumplord' },
  },
  pepperimp: {
    name: 'Embernip', element: 'spark', hp: 40, oomph: 14, grit: 8, pep: 15, huff: 4,
    moves: [['chilliflick', 1], ['hotstreak', 3], ['fivealarm', 6]],
    blurb: 'The last chilli in the jar, and the reason it is the last.',
    notYet: 'blows a smoke ring at you',
    grown: { at: 12, name: 'Scorchfoot' },
  },
  eggknight: {
    name: 'Eggallant', element: 'clank', hp: 58, oomph: 10, grit: 15, pep: 6, huff: 5,
    moves: [['spoonrap', 1], ['shellup', 3], ['softboiledcharge', 6]],
    blurb: 'Sworn to defend the egg cup. Nobody asked it to.',
    notYet: 'salutes, and stays put',
    grown: { at: 12, name: 'Eggalahad' },
  },
  jellywobble: {
    name: 'Wibblet', element: 'suds', hp: 54, oomph: 11, grit: 12, pep: 9, huff: 4,
    moves: [['wobbleslap', 1], ['cherryontop', 3], ['jellyquake', 6]],
    blurb: 'Set at midnight. Has not stopped shaking since.',
    notYet: 'wobbles the other way',
    grown: { at: 12, name: 'Blancmangler' },
  },
  bubblejelly: {
    name: 'Shimmerbell', element: 'suds', hp: 40, oomph: 13, grit: 8, pep: 15, huff: 4,
    moves: [['bubblepop', 1], ['rainbowsheen', 3], ['longsting', 6]],
    fly: true,
    blurb: 'Blown from a bubble wand and never popped.',
    notYet: 'drifts just out of reach',
    grown: { at: 12, name: 'Glistenveil' },
  },
  soapslug: {
    name: 'Slipsud', element: 'suds', hp: 58, oomph: 9, grit: 14, pep: 5, huff: 5,
    moves: [['soapslick', 1], ['latherup', 3], ['slipandslide', 6]],
    blurb: 'The last sliver of soap. It got up and left the dish.',
    notYet: 'slides off behind a bubble',
    grown: { at: 12, name: 'Latherback' },
  },
  lintgolem: {
    name: 'Fluffolith', element: 'fluff', hp: 56, oomph: 12, grit: 12, pep: 7, huff: 5,
    moves: [['lintlob', 1], ['pegpinch', 3], ['tumbledry', 6]],
    blurb: 'Everything the dryer ever took, in one piece.',
    notYet: 'crosses its fluffy arms',
    grown: { at: 12, name: 'Linthenge' },
  },
  pegsnapper: {
    name: 'Pegadile', element: 'clank', hp: 44, oomph: 14, grit: 10, pep: 13, huff: 4,
    moves: [['snapshut', 1], ['clampdown', 3], ['linedance', 6]],
    blurb: 'Held up the washing for years. Now it holds grudges.',
    notYet: 'snaps at the air',
    grown: { at: 12, name: 'Clampodile' },
  },
  bookworm: {
    name: 'Footnote', element: 'fluff', hp: 50, oomph: 12, grit: 11, pep: 9, huff: 4,
    moves: [['pageturner', 1], ['wellread', 3], ['hardback', 6]],
    blurb: 'Has read everything in here, and has notes.',
    notYet: 'goes back to its page',
    grown: { at: 12, name: 'Appendix' },
  },
  candlecreep: {
    name: 'Dribblewax', element: 'spark', hp: 42, oomph: 14, grit: 9, pep: 12, huff: 4,
    moves: [['hotdrip', 1], ['snuffout', 3], ['flareup', 6]],
    blurb: 'Lit for a power cut in 1994 and never blown out.',
    notYet: 'gutters, and turns away',
    grown: { at: 12, name: 'Candelabrute' },
  },
  inkblot: {
    name: 'Blottle', element: 'suds', hp: 46, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['inkflick', 1], ['blotout', 3], ['spillage', 6]],
    blurb: 'Somebody knocked the bottle over. It got up.',
    notYet: 'sinks back into its bottle',
    grown: { at: 12, name: 'Wellspill' },
  },
  quillhog: {
    name: 'Inkspine', element: 'fluff', hp: 56, oomph: 11, grit: 14, pep: 6, huff: 5,
    moves: [['nibjab', 1], ['rollup', 3], ['lastword', 6]],
    blurb: 'Writes angry letters. Signs every one.',
    notYet: 'peers over its glasses',
    grown: { at: 12, name: 'Scrivenspine' },
  },
  papercrane: {
    name: 'Foldwing', element: 'fluff', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 3,
    moves: [['papercut', 1], ['foldedswoop', 3], ['goodnews', 6]],
    fly: true,
    blurb: 'Yesterday\'s paper, folded by somebody patient.',
    notYet: 'flaps up to a high shelf',
    grown: { at: 12, name: 'Broadsheet' },
  },
  gutterbat: {
    name: 'Gutterflit', element: 'sprout', hp: 40, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['leafdive', 1], ['squeak', 3], ['nightswoop', 6]],
    fly: true,
    blurb: 'Sleeps in the guttering and keeps the leaf for rain.',
    notYet: 'hides under its leaf',
    grown: { at: 12, name: 'Eaveswoop' },
  },
  slategecko: {
    name: 'Shingleskink', element: 'clank', hp: 48, oomph: 12, grit: 12, pep: 11, huff: 4,
    moves: [['slateslap', 1], ['looseslate', 3], ['bask', 6]],
    blurb: 'One slate on every roof is warm. This is why.',
    notYet: 'scuttles up the chimney',
    grown: { at: 12, name: 'Slatedrake' },
  },
  weathercock: {
    name: 'Vanecrow', element: 'clank', hp: 46, oomph: 14, grit: 10, pep: 13, huff: 4,
    moves: [['northpeck', 1], ['changeofwind', 3], ['cockcrow', 6]],
    blurb: 'Has pointed north-east since the storm of 1987.',
    notYet: 'turns to face the wind',
    grown: { at: 12, name: 'Galecomb' },
  },
  gargoylet: {
    name: 'Spoutling', element: 'suds', hp: 58, oomph: 10, grit: 15, pep: 5, huff: 5,
    moves: [['spout', 1], ['stonestill', 3], ['downpipe', 6]],
    blurb: 'Carved to frighten the rain. The rain was not frightened.',
    notYet: 'sticks its tongue out',
    grown: { at: 12, name: 'Grotesque' },
  },
  chimneywisp: {
    name: 'Emberdrift', element: 'spark', hp: 42, oomph: 13, grit: 9, pep: 12, huff: 4,
    moves: [['sootpuff', 1], ['smokescreen', 3], ['backdraught', 6]],
    fly: true,
    blurb: 'What is left of a fire somebody enjoyed.',
    notYet: 'curls back into its pot',
    grown: { at: 12, name: 'Smokecrown' },
  },
  gearbeetle: {
    name: 'Cogscuttle', element: 'clank', hp: 56, oomph: 10, grit: 15, pep: 6, huff: 5,
    moves: [['cogbite', 1], ['windup', 3], ['sprungcoil', 6]],
    blurb: 'Fell out of a clock and kept time anyway.',
    notYet: 'ticks at you, crossly',
    grown: { at: 12, name: 'Cogmarshal' },
  },
  tintrooper: {
    name: 'Stalwind', element: 'clank', hp: 50, oomph: 13, grit: 11, pep: 10, huff: 4,
    moves: [['paradejab', 1], ['drumroll', 3], ['quickmarch', 6]],
    blurb: 'The last of a box of twelve. Still on parade.',
    notYet: 'about-turns, smartly',
    grown: { at: 12, name: 'Marchwind' },
  },
  cuckoo: {
    name: 'Tocktalon', element: 'sprout', hp: 40, oomph: 14, grit: 8, pep: 16, huff: 4,
    moves: [['onthehour', 1], ['nestrobber', 3], ['twelveoclock', 6]],
    blurb: 'Comes out on the hour. Any hour it likes.',
    notYet: 'pops back behind its door',
    grown: { at: 12, name: 'Midnightjar' },
  },
  mothphantom: {
    name: 'Lampmourn', element: 'fluff', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 4,
    moves: [['dustywing', 1], ['mothholes', 3], ['lightsout', 6]],
    fly: true,
    blurb: 'Still circling a lamp that was thrown out years ago.',
    notYet: 'flutters off to the rafters',
    grown: { at: 12, name: 'Lanternlorn' },
  },
  jackbox: {
    name: 'Crankjaw', element: 'clank', hp: 48, oomph: 14, grit: 10, pep: 12, huff: 4,
    moves: [['popgoes', 1], ['liddown2', 3], ['lastlaugh', 6]],
    blurb: 'Nobody has turned the handle since 1962. It is ready.',
    notYet: 'ducks back into its box',
    grown: { at: 12, name: 'Jackanapes' },
  },
  cordserpent: {
    name: 'Tanglecoil', element: 'spark', hp: 48, oomph: 13, grit: 10, pep: 13, huff: 4,
    moves: [['plugbite', 1], ['tangle', 3], ['livewire', 6]],
    blurb: 'Every lead in the drawer, tied in one knot.',
    notYet: 'coils up tighter',
    grown: { at: 12, name: 'Anacorda' },
  },
  dustwraith: {
    name: 'Grimeshade', element: 'fluff', hp: 44, oomph: 13, grit: 9, pep: 15, huff: 5,
    moves: [['coldfluff', 1], ['dreadhop', 3], ['duststorm', 6]],
    fly: true,
    blurb: 'What a Hopmote becomes if nobody ever looks.',
    notYet: 'melts into the shadows',
    grown: { at: 12, name: 'Gloomdrift' },
  },
  robodisc: {
    name: 'Bumpabout', element: 'clank', hp: 60, oomph: 11, grit: 15, pep: 7, huff: 5,
    moves: [['bumper', 1], ['dock', 3], ['edgeclean', 6]],
    blurb: 'Has cleaned the same square of carpet since Tuesday.',
    notYet: 'reverses, beeping',
    grown: { at: 12, name: 'Rovabout' },
  },
  boss_hydra: {
    name: 'Old Summerlong', element: 'suds', hp: 118, oomph: 11, grit: 12, pep: 9, huff: 0, boss: true, turns: 2,
    moves: [['nozzlejet', 1], ['fullsprinkle', 1], ['hosedown', 1]],
    blurb: 'Left on all summer. Three heads, one opinion.',
  },
  boss_baron: {
    name: 'Baron Pilfer', element: 'clank', hp: 120, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['lidbash', 1], ['fishbonesweep', 1], ['standanddeliver', 1]],
    blurb: 'A fur stole somebody threw out. It crowned itself the same night.',
  },
  boss_crumbwyrm: {
    name: 'The Crumbwyrm', element: 'crumb', hp: 122, oomph: 12, grit: 13, pep: 11, huff: 0, boss: true, turns: 2,
    moves: [['popup', 1], ['crumbbreath', 1], ['settingsix', 1]],
    blurb: 'A toaster that kept every crumb it was ever given.',
  },
  boss_spincycle: {
    name: 'The Spin Cycle', element: 'suds', hp: 120, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['sockwhip', 1], ['rinserepeat', 1], ['fullspin', 1]],
    blurb: 'It stopped giving socks back in March.',
  },
  boss_tome: {
    name: 'The Overdue Tome', element: 'fluff', hp: 118, oomph: 11, grit: 12, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['slamshut', 1], ['latefees', 1], ['tonguelash', 1]],
    blurb: 'Due back in 1971. The fine is now a matter of principle.',
  },
  boss_warden: {
    name: 'The Night Warden', element: 'clank', hp: 126, oomph: 12, grit: 13, pep: 11, huff: 0, boss: true, turns: 2,
    moves: [['talonrake', 1], ['wingbuffet', 1], ['stonystare', 1]],
    blurb: 'Has watched this roof for two hundred years. It saw what you did.',
  },
  boss_clock: {
    name: 'Grandfather Golem', element: 'clank', hp: 126, oomph: 12, grit: 14, pep: 9, huff: 0, boss: true, turns: 2,
    moves: [['pendulum', 1], ['chimes', 1], ['stoptheclock', 1]],
    blurb: 'Wrong twice a day, and furious about both.',
  },
  boss_vacuum: {
    name: 'THE VACUUM', element: 'spark', hp: 120, oomph: 12, grit: 13, pep: 11, huff: 0, boss: true, turns: 2,
    moves: [['hosewhip', 1], ['fullsuction', 1], ['bagburst', 1]],
    blurb: 'Mr. Spick\'s. It does not calm things. It collects them.',
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

// A place that has been calmed stays calm: its five groups and its ringleader do not come back.
// What you find there instead is a few wanderers: this many small groups (at least, at most),
// strolling about some of its stops, different each time you come back from a rest. Nobody has
// to be met; they are there for the friends still to be made, and for Heirlooms.
export const WANDERERS = { groups: [1, 3] };

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
// (XP_RATE: since whoever you calm stays calm, nobody is fought twice on the way to a ringleader, so
// each fight has to teach more for the team to keep pace with the lane. At 1 the last places were a wall.)
export const XP_RATE = 1.3;
export const xpFor = (species, level) => Math.round((6 + 5 * level) * XP_RATE) * (SPECIES[species].boss ? 4 : 1);
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
  {
    id: 'pantry', name: 'The Midnight Pantry', bg: 'bg_pantry', tint: '#f2a65a', element: 'crumb',
    blurb: 'Everything in here is past its date and wide awake.',
    path: [
      { name: 'The Bottom Shelf', size: [2, 2], level: [5, 5], pool: [['dumpling', 3], ['jellywobble', 1]] },
      { name: 'The Spice Rack', size: [2, 2], level: [6, 6], pool: [['pepperimp', 2], ['dumpling', 2]] },
      { name: 'The Egg Cups', size: [3, 3], level: [6, 6], pool: [['eggknight', 3], ['jellywobble', 2], ['pepperimp', 1]] },
      { name: 'The Cold Shelf', size: [3, 3], level: [6, 7], pool: [['jellywobble', 3], ['eggknight', 2], ['dumpling', 1]] },
      { name: 'The Toaster', boss: 'boss_crumbwyrm', bossLevel: 7, size: [1, 2], level: [6, 6], pool: [['pepperimp', 2], ['dumpling', 2]] },
    ],
  },
  {
    id: 'wash', name: 'The Wash', bg: 'bg_wash', tint: '#4fc4cf', element: 'suds',
    blurb: 'Where socks go in as pairs.',
    path: [
      { name: 'The Sock Basket', size: [2, 2], level: [7, 7], pool: [['pegsnapper', 3], ['soapslug', 2]] },
      { name: 'The Soap Shelf', size: [2, 2], level: [7, 8], pool: [['soapslug', 3], ['bubblejelly', 2]] },
      { name: 'The Dryers', size: [2, 3], level: [7, 8], pool: [['lintgolem', 3], ['pegsnapper', 2], ['bubblejelly', 1]] },
      { name: 'The Rinse', size: [3, 3], level: [7, 8], pool: [['bubblejelly', 3], ['lintgolem', 2], ['soapslug', 1]] },
      { name: 'Machine Six', boss: 'boss_spincycle', bossLevel: 9, size: [1, 2], level: [7, 7], pool: [['pegsnapper', 2], ['bubblejelly', 2]] },
    ],
  },
  {
    id: 'stacks', name: 'The Dusty Stacks', bg: 'bg_stacks', tint: '#c08552', element: 'fluff',
    blurb: 'Overdue books and what lives between the pages.',
    path: [
      { name: 'The Returns Desk', size: [2, 2], level: [8, 9], pool: [['bookworm', 3], ['papercrane', 2]] },
      { name: 'Periodicals', size: [2, 2], level: [9, 9], pool: [['papercrane', 3], ['inkblot', 2]] },
      { name: 'The Reading Lamp', size: [2, 3], level: [9, 9], pool: [['candlecreep', 3], ['bookworm', 2], ['inkblot', 1]] },
      { name: 'Reference Only', size: [2, 3], level: [9, 9], pool: [['quillhog', 3], ['inkblot', 2], ['candlecreep', 1]] },
      { name: 'The Locked Case', boss: 'boss_tome', bossLevel: 10, size: [1, 1], level: [9, 9], pool: [['bookworm', 2], ['candlecreep', 2]] },
    ],
  },
  {
    id: 'rooftops', name: 'Moonlit Rooftops', bg: 'bg_rooftops', tint: '#7d6bd6', element: 'clank',
    blurb: 'Slates, chimneys and a long way down.',
    path: [
      { name: 'The Gutter', size: [2, 2], level: [9, 10], pool: [['gutterbat', 3], ['slategecko', 2]] },
      { name: 'The Ridge', size: [2, 2], level: [10, 10], pool: [['slategecko', 3], ['weathercock', 2]] },
      { name: 'The Chimney Pots', size: [2, 3], level: [10, 10], pool: [['chimneywisp', 3], ['gutterbat', 2], ['weathercock', 1]] },
      { name: 'The Parapet', size: [3, 3], level: [10, 11], pool: [['gargoylet', 3], ['slategecko', 2], ['chimneywisp', 1]] },
      { name: 'The Weathervane', boss: 'boss_warden', bossLevel: 11, size: [1, 2], level: [10, 10], pool: [['weathercock', 2], ['gutterbat', 2]] },
    ],
  },
  {
    id: 'attic', name: 'The Tick-Tock Attic', bg: 'bg_attic', tint: '#d9a441', element: 'clank',
    blurb: 'Every clock up here is wrong in a different way.',
    path: [
      { name: 'The Hatch', size: [2, 2], level: [10, 11], pool: [['tintrooper', 3], ['gearbeetle', 2]] },
      { name: 'The Toy Chest', size: [2, 2], level: [11, 11], pool: [['jackbox', 3], ['tintrooper', 2]] },
      { name: 'The Dust Sheets', size: [2, 3], level: [11, 11], pool: [['mothphantom', 3], ['cuckoo', 2], ['jackbox', 1]] },
      { name: 'The Clock Shelf', size: [2, 3], level: [11, 12], pool: [['gearbeetle', 3], ['cuckoo', 2], ['mothphantom', 1]] },
      { name: 'The Long Case', boss: 'boss_clock', bossLevel: 12, size: [1, 2], level: [11, 11], pool: [['tintrooper', 2], ['cuckoo', 2]] },
    ],
  },
  {
    id: 'dark', name: 'The Roaring Dark', bg: 'bg_dark', tint: '#d6455d', element: 'spark',
    blurb: 'The cupboard under the stairs. Something in it is plugged in.',
    path: [
      { name: 'The Coat Hooks', size: [2, 2], level: [11, 11], pool: [['dustwraith', 3], ['sparkplug', 2]] },
      { name: 'The Fuse Box', size: [2, 2], level: [11, 12], pool: [['cordserpent', 3], ['sparkplug', 2]] },
      { name: 'The Shoe Rack', size: [2, 3], level: [12, 12], pool: [['robodisc', 3], ['dustwraith', 2], ['cordserpent', 1]] },
      { name: 'The Back Corner', size: [2, 3], level: [12, 12], pool: [['cordserpent', 2], ['dustwraith', 2], ['robodisc', 2]] },
      { name: 'The Plug Socket', boss: 'boss_vacuum', bossLevel: 13, size: [1, 1], level: [11, 11], pool: [['cordserpent', 2], ['robodisc', 2]] },
    ],
  },
];
export const ROOM_IDS = ROOMS.map((room) => room.id);
export const roomOf = (id) => ROOMS.find((room) => room.id === id) || null;
/** A room can be walked into once it is built and the room before it has been cleared. */
export const roomBuilt = (room) => Array.isArray(room.path) && room.path.length > 0;
