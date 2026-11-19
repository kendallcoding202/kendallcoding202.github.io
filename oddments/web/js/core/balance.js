// Every number and name in the game lives here, so tuning is one file.
// Nothing in this module touches the DOM, the clock or storage.

export const VERSION = '0.1.0';
export const SAVE_VERSION = 2;
export const TITLE = 'Clutterkin'; // the game's name, and what its creatures are called (one Clutterkin, many Clutterkin): clutter to some, kin to you

export const TEAM_SIZE = 3;
export const ROSTER_MAX = 120; // friends kept; one per kind, so never reached: there are far fewer kinds than that
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
  // (`hint` is said wherever the number is shown; `more` is the second half of it, where there is room.)
  hp: { name: 'Health', hint: 'How much it can take.', more: 'At none, it sits the rest of the fight out.' },
  oomph: { name: 'Oomph', hint: 'How hard it hits.', more: 'More Oomph, more damage from every move.' },
  grit: { name: 'Grit', hint: 'How well it shrugs hits off.', more: 'More Grit, less damage from every hit it takes.' },
  pep: { name: 'Pep', hint: 'How quick it is.', more: 'The quickest moves first each round.' },
};
export const STAT_IDS = Object.keys(STATS);
export const GROWTH = 0.1; // each level adds this share of the base stat
// Growing up: a friend that reaches its kind's level grows into its new form, for good: a new
// look, a new name for its kind, and every stat this much stronger. And as the game advances,
// more of whoever is restless has grown up too (GROWN_ODDS, below): as much stronger, worth more,
// and grown already if it comes home with you.
// (The boost is small on purpose. The whole team grows about half-way through, and the simulator
// showed how much that tips every fight after it: at 15% nobody could lose anywhere past the alley;
// at 5% the later places are calmed in one go about 85 times in 100 where it was 55 to 65, and the
// last of them about half the time where it was one in five. What makes growing up plain to see
// is the new form and its size, not this number.)
export const GROWN_BOOST = 1.05;
// The share of the restless that are grown, place by place: none on the lane itself, a few from
// the Wash, more than half by the Roaring Dark. So the further you go the more of a mix you meet.
// Strays go by the furthest place open to you. Ringleaders are as they are.
export const GROWN_ODDS = { garden: 0, alley: 0, pantry: 0, wash: 0.2, stacks: 0.3, rooftops: 0.4, attic: 0.5, dark: 0.6, glasshouse: 0.6, deepend: 0.65, shed: 0.7, mending: 0.7 };
export const grownOdds = (room) => (room && GROWN_ODDS[room.id]) || 0;
// A grown one teaches this much more than a young one of its level.
export const GROWN_WORTH = 1.25;
export const statAt = (base, level, grown = false) => Math.max(1, Math.round(base * (1 + GROWTH * (level - 1)) * (grown ? GROWN_BOOST : 1)));

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
  // ---- chapter two: twenty more kinds for the eight places ----
  // Tintrunk
  spoutsquirt: hit('Spout Squirt', 'suds', 1.0, 0, 'A cold jet, right in the eye.'),
  fillup: mend('Fill Up', 'suds', 0.25, 'self', 3, 'Stands under a drip until it feels better.'),
  roseshower: sweep('Rose Shower', 'suds', 0.7, 3, 'The whole sprinkler rose, over everyone.'),
  // Fumblethumb
  greenthumb: hit('Green Thumb', 'sprout', 1.0, 0, 'A firm prod with a muddy thumb.'),
  fivefingerpinch: hit('Five-Finger Pinch', 'sprout', 1.65, 2, 'All of them at once, and it holds on.'),
  scattersoil: sweep('Scatter Soil', 'sprout', 0.65, 3, 'A handful of earth for everybody.'),
  // Brollyflap
  ribjab: hit('Rib Jab', 'fluff', 1.0, 0, 'One bent rib, well aimed.'),
  colddrip: sap('Cold Drip', 'fluff', 'pep', 0.2, 2, 'foes', 3, 'Down the back of every neck: lowers Pep.'),
  gustdive: hit('Gust Dive', 'fluff', 1.65, 2, 'Catches the wind and comes down hard.'),
  // Wonkwheel
  wonkyram: hit('Wonky Ram', 'clank', 1.0, 0, 'Meant for your shins. Gets your ankle.'),
  squeakywheel: hit('Squeaky Wheel', 'clank', 1.1, 2, 'A noise that slows anyone down: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  trolleydash: hit('Trolley Dash', 'clank', 1.75, 3, 'Downhill, no brakes.'),
  // Coneling
  flashamber: hit('Amber Wink', 'spark', 1.0, 0, 'One sharp flash.'),
  conecharge: hit('Cone Charge', 'spark', 1.65, 2, 'Pointy end first.'),
  hazardlights: sweep('Hazard Lights', 'spark', 0.65, 3, 'On, off, on, off, in everybody\'s eyes.'),
  // Steepling
  tagflick: hit('Tag Flick', 'suds', 1.0, 0, 'The paper tag, like a wet towel.'),
  nicecupoftea: mend('Nice Cup of Tea', 'suds', 0.3, 'ally', 2, 'Puts a friend right. It always does.'),
  stew: sweep('Stewed', 'suds', 0.65, 3, 'Far too strong, all over everyone.'),
  // Whisklet
  wirepeck: hit('Wire Peck', 'clank', 1.0, 0, 'Quick, and springy.'),
  beatstiff: hit('Beat Stiff', 'clank', 1.65, 2, 'Round and round until it stands up by itself.'),
  whipup: sweep('Whip Up', 'clank', 0.65, 3, 'Cream everywhere. Mostly on them.'),
  // Gherkroak
  sourspit: hit('Sour Spit', 'crumb', 1.0, 0, 'Sharp enough to make your eyes water.'),
  brinesoak: boost('Brine Soak', 'crumb', 'grit', 0.5, 3, 'self', 3, 'A good long pickle: raises Grit.'),
  jarslam: hit('Jar Slam', 'crumb', 1.75, 3, 'The whole jar, lid first.'),
  // Steamstoat
  hotfoot: hit('Hot Foot', 'spark', 1.0, 0, 'Still warm from the last shirt.'),
  flatten: hit('Flatten', 'spark', 1.1, 2, 'Takes the stiffening out of anybody: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  steamburst: sweep('Steam Burst', 'spark', 0.65, 3, 'A hot, wet cloud over the lot of them.'),
  // Hamperling
  wickerbump: hit('Wicker Bump', 'fluff', 1.0, 0, 'Slow, scratchy, and it does not stop.'),
  hamperlid: boost('Shut the Lid', 'fluff', 'grit', 0.5, 3, 'self', 3, 'Shuts itself in: raises Grit.'),
  heapofwashing: hit('Heap of Washing', 'fluff', 1.75, 3, 'A week of it, all at once.'),
  // Zipnip
  zipnip: hit('Nip', 'clank', 1.0, 0, 'A pinch, like a zip on a chin.'),
  zipup: hit('Zip Up', 'clank', 1.6, 2, 'All the way to the top in one go.'),
  caughtfast: hit('Caught Fast', 'clank', 0.8, 3, 'Snags them and will not let go: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Stampling
  thump: hit('Thump', 'clank', 1.0, 0, 'Down, firmly, in purple.'),
  overdue: hit('Overdue', 'clank', 1.1, 2, 'Nobody argues with a stamp: lowers Oomph.', { sap: { stat: 'oomph', by: 0.3, turns: 2 } }),
  stampstampstamp: sweep('Stamp, Stamp, Stamp', 'clank', 0.65, 3, 'One for each of them.'),
  // Globlet
  spinbump: hit('Spin Bump', 'fluff', 1.0, 0, 'A slow turn with some weight behind it.'),
  curlround: boost('Curl Round', 'fluff', 'grit', 0.5, 3, 'self', 3, 'Tucks everything in: raises Grit.'),
  roundtheworld: hit('Round the World', 'fluff', 1.75, 3, 'Once round, and into you.'),
  // Statichare
  staticnip: hit('Static Nip', 'spark', 1.0, 0, 'A small, mean crackle.'),
  snowonthescreen: sap('Snow on the Screen', 'spark', 'oomph', 0.2, 2, 'foes', 3, 'Nobody can see what they are doing: lowers Oomph.'),
  signaljolt: hit('Signal Jolt', 'spark', 1.65, 2, 'Every channel at once.'),
  // Snagkite
  taillash: hit('Tail Lash', 'fluff', 1.0, 0, 'A flick of ribbon bows.'),
  catchthewind: boost('Catch the Wind', 'fluff', 'pep', 0.4, 3, 'self', 3, 'Finds a good breeze: raises Pep.'),
  stringburn: hit('String Burn', 'fluff', 1.75, 3, 'Down the line, fast.'),
  // Patchpaw
  bearcuff: hit('Bear Cuff', 'fluff', 1.0, 0, 'Soft paw. Not a soft hit.'),
  bearhug: mend('Bear Hug', 'fluff', 0.3, 'ally', 2, 'The one thing it was made for: mends a friend.'),
  stuffingstorm: sweep('Stuffing Storm', 'fluff', 0.65, 3, 'It comes out at the seams and gets everywhere.'),
  // Flurryglobe
  snowballflick: hit('Snowball', 'suds', 1.0, 0, 'Small, cold, and down your collar.'),
  shakeup: sap('Shake Up', 'suds', 'pep', 0.2, 2, 'foes', 3, 'Turns everything over: lowers Pep.'),
  whiteout: sweep('White Out', 'suds', 0.7, 3, 'Nobody can see a thing.'),
  // Burrowbeam
  noselight: hit('Nose Light', 'spark', 1.0, 0, 'Straight in the eyes.'),
  dazzle: hit('Dazzle', 'spark', 0.8, 2, 'They see spots for a while: lowers Oomph.', { sap: { stat: 'oomph', by: 0.3, turns: 2 } }),
  fullbeam: hit('Full Beam', 'spark', 1.75, 3, 'Every last bit of battery.'),
  // Scuffpup
  scuff: hit('Scuff', 'fluff', 1.0, 0, 'A muddy toe-cap.'),
  lacetrip: hit('Lace Trip', 'fluff', 0.8, 2, 'Round the ankles and down you go: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  theboot: hit('The Boot', 'fluff', 1.75, 3, 'Exactly what it sounds like.'),
  // Dustpincer
  sweepaside: hit('Sweep Aside', 'clank', 1.0, 0, 'Out of the way, with bristles.'),
  panguard: boost('Pan Guard', 'clank', 'grit', 0.5, 3, 'self', 3, 'Gets behind the dustpan: raises Grit.'),
  cleansweep: hit('Clean Sweep', 'clank', 1.75, 3, 'One long stroke, wall to wall.'),
  // ---- chapter two: the four new places ----
  // Sproutlark
  seedspit: hit('Seed Spit', 'sprout', 1.0, 0, 'Pip, pip, pip.'),
  dawnchorus: boost('Dawn Chorus', 'sprout', 'oomph', 0.3, 2, 'allies', 3, 'Gets everyone up: raises its whole side\'s Oomph.'),
  divesow: hit('Dive and Sow', 'sprout', 1.65, 2, 'Plants one right on your head.'),
  // Terracub
  potbutt: hit('Pot Butt', 'clank', 1.0, 0, 'Rim first.'),
  crockup: boost('Crock Up', 'clank', 'grit', 0.5, 3, 'self', 3, 'Pulls the pot down tight: raises Grit.'),
  claytumble: hit('Clay Tumble', 'clank', 1.75, 3, 'Rolls the whole length of the bench.'),
  // Mulchkin
  clodlob: hit('Clod Lob', 'sprout', 1.0, 0, 'Warm, damp, and well aimed.'),
  feedthesoil: mend('Feed the Soil', 'sprout', 0.3, 'ally', 2, 'Does a friend a power of good.'),
  steamingheap: sweep('Steaming Heap', 'sprout', 0.65, 3, 'Turns itself over on top of them.'),
  // Tomarin
  pipflick: hit('Pip Flick', 'crumb', 1.0, 0, 'A seed, hard, between the eyes.'),
  vineswing: hit('Vine Swing', 'crumb', 1.65, 2, 'Feet first off the nearest cane.'),
  overripe: hit('Overripe', 'crumb', 0.8, 3, 'Goes off all over them: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Trailbloom
  petalsting: hit('Petal Sting', 'suds', 1.0, 0, 'Prettier than it feels.'),
  dripdrip: sap('Drip, Drip', 'suds', 'grit', 0.2, 2, 'foes', 3, 'On every head, for ever: lowers Grit.'),
  traillash: hit('Trailing Lash', 'suds', 1.65, 2, 'A long wet swipe of ivy.'),
  // The Prize Marrow
  tendrillash: hit('Tendril Lash', 'sprout', 1.0, 0, 'A long green reach.'),
  benchroll: sweep('Show Bench Roll', 'sprout', 0.6, 2, 'Rolls the length of the bench, over everyone.'),
  firstprize: hit('First Prize', 'sprout', 1.3, 3, 'The full weight of a champion: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Squeakbill
  beakbop: hit('Beak Bop', 'suds', 1.0, 0, 'Harder than rubber ought to be.'),
  bigsqueak: sap('SQUEAK', 'suds', 'oomph', 0.2, 2, 'foes', 3, 'Right through everyone\'s teeth: lowers Oomph.'),
  bathbomb: hit('Bath Bomb', 'suds', 1.65, 2, 'Fizzes on the way in.'),
  // Mintgrub
  mintyspit: hit('Minty Spit', 'suds', 1.0, 0, 'Stings a bit. Fresh, though.'),
  squeezeupwards: mend('Squeeze Upwards', 'suds', 0.25, 'self', 3, 'Finds a bit more in itself.'),
  stripe: sweep('Triple Stripe', 'suds', 0.7, 3, 'Red, white and blue, over everyone.'),
  // Loofling
  scratchyroll: hit('Scratchy Roll', 'sprout', 1.0, 0, 'Like being scrubbed by a hedge.'),
  curluptight: boost('Curl Up Tight', 'sprout', 'grit', 0.5, 3, 'self', 3, 'Nothing gets in: raises Grit.'),
  scrubdown: hit('Scrub Down', 'sprout', 1.75, 3, 'Takes the top layer off.'),
  // Clogtuft
  wetknot: hit('Wet Knot', 'fluff', 1.0, 0, 'Round your fingers, and tight.'),
  clog: hit('Clog', 'fluff', 1.1, 2, 'Slows everything to a trickle: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  hairball: sweep('Hairball', 'fluff', 0.65, 3, 'Nobody wants this.'),
  // Showershade
  clingyslap: hit('Clingy Slap', 'fluff', 1.0, 0, 'Cold, wet, and it sticks.'),
  clammycling: hit('Clammy Cling', 'fluff', 0.8, 2, 'Wraps right round: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  coldshower: sweep('Cold Shower', 'fluff', 0.65, 3, 'For everyone, without warning.'),
  // Old Clawfoot
  clawstomp: hit('Iron Foot', 'suds', 1.0, 0, 'One of four, and heavy.'),
  overflow: sweep('Overflow', 'suds', 0.6, 2, 'Over the side, on everyone.'),
  pulltheplug: hit('Pull the Plug', 'suds', 1.3, 3, 'Everything goes down with it: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Tapetail
  tapesnap: hit('Tape Snap', 'clank', 1.0, 0, 'Steel, with a sharp edge.'),
  measuretwice: boost('Measure Twice', 'clank', 'oomph', 0.4, 3, 'self', 3, 'Lines it up properly: raises Oomph.'),
  whiplash: hit('Full Extension', 'clank', 1.7, 2, 'All five metres, at speed.'),
  // Peckhammer
  taptap: hit('Tap Tap', 'clank', 1.0, 0, 'Finding the spot.'),
  hitthenail: hit('Hit the Nail', 'clank', 1.7, 2, 'On the head. First time.'),
  ratatat: sweep('Rat-a-Tat', 'clank', 0.65, 3, 'Along the whole row of them.'),
  // Daubfox
  daub: hit('Daub', 'suds', 1.0, 0, 'A wet swipe of blue.'),
  wetpaint: hit('Wet Paint', 'suds', 0.8, 2, 'Sticks them where they stand: lowers Pep.', { sap: { stat: 'pep', by: 0.3, turns: 2 } }),
  splatter: sweep('Splatter', 'suds', 0.65, 3, 'One good shake of the tail.'),
  // Sawnose
  roughcut: hit('Rough Cut', 'clank', 1.0, 0, 'Near enough.'),
  againstthegrain: hit('Against the Grain', 'clank', 1.1, 2, 'Leaves them splintery: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  sawduststorm: sweep('Sawdust Storm', 'clank', 0.65, 3, 'In everyone\'s eyes and down every neck.'),
  // Filamoth
  flicker: hit('Flicker', 'spark', 1.0, 0, 'On, off, and a sting.'),
  glare: sap('Glare', 'spark', 'oomph', 0.2, 2, 'foes', 3, 'A bare bulb at eye level: lowers Oomph.'),
  hundredwatts: hit('Hundred Watts', 'spark', 1.65, 2, 'Far brighter than is safe.'),
  // Captain Twostroke
  bladespin: hit('Blade Spin', 'clank', 1.0, 0, 'Short back and sides.'),
  grassclippings: sweep('Grass Clippings', 'clank', 0.6, 2, 'A green fog over everyone.'),
  fullthrottle: hit('Full Throttle', 'clank', 1.3, 3, 'Straight through, and never mind the edges: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Pinbobber
  pinprick: hit('Pin Prick', 'fluff', 1.0, 0, 'Just the one. This time.'),
  puffup: boost('Puff Up', 'fluff', 'grit', 0.5, 3, 'self', 3, 'Twice as round and twice as prickly: raises Grit.'),
  pinsandneedles: sweep('Pins and Needles', 'fluff', 0.7, 3, 'All of them. Outwards.'),
  // Thimblet
  needlejab: hit('Needle Jab', 'clank', 1.0, 0, 'En garde.'),
  thimblecharge: hit('Thimble Charge', 'clank', 1.65, 2, 'Head down, helmet first.'),
  stitchintime: mend('Stitch in Time', 'clank', 0.15, 'allies', 4, 'A quick mend for everyone on its side.'),
  // Snipstork
  snip: hit('Snip', 'clank', 1.0, 0, 'A neat one.'),
  cutonthebias: hit('Cut on the Bias', 'clank', 1.7, 2, 'Corner to corner, in one stroke.'),
  loosethreads: hit('Loose Threads', 'clank', 0.8, 3, 'They start to come apart: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // Buttonhoot
  toggleshot: hit('Toggle Shot', 'fluff', 1.0, 0, 'Four holes, one bruise.'),
  wiselook: sap('Wise Look', 'fluff', 'oomph', 0.2, 2, 'foes', 3, 'Makes everyone feel a bit silly: lowers Oomph.'),
  spillthejar: sweep('Spill the Jar', 'fluff', 0.65, 3, 'Thousands of them, across the floor.'),
  // Doilyspin
  threadsnare: hit('Thread Snare', 'fluff', 1.0, 0, 'One loop, pulled tight.'),
  weboflace: sap('Web of Lace', 'fluff', 'pep', 0.25, 2, 'foes', 3, 'Too pretty to break, too fine to see: lowers Pep.'),
  bobbindrop: hit('Bobbin Drop', 'fluff', 1.65, 2, 'From the ceiling, on a thread.'),
  // Madam Treadle
  needledown: hit('Needle Down', 'fluff', 1.0, 0, 'Up, down, and through.'),
  runaseam: sweep('Run a Seam', 'fluff', 0.6, 2, 'One long line through all of them.'),
  sewnshut: hit('Sewn Shut', 'fluff', 1.3, 3, 'Neat, tight, and you cannot move: lowers Grit.', { sap: { stat: 'grit', by: 0.3, turns: 2 } }),
  // ---- the Keepsakes ----
  // Lullawren
  chime: hit('Chime', 'clank', 1.0, 0, 'One clear note, right between the ears.'),
  lullaby: sap('Lullaby', 'clank', 'pep', 0.3, 2, 'foes', 3, 'Everybody\'s eyes get heavy: lowers Pep.'),
  woundrightup: hit('Wound Right Up', 'clank', 1.7, 2, 'The whole tune at once, fortissimo.'),
  // Farewhale
  bowwave: hit('Bow Wave', 'suds', 1.0, 0, 'A small sea, moving fast.'),
  becalm: sap('Becalm', 'suds', 'oomph', 0.3, 2, 'foes', 3, 'Not a breath of wind for anyone: lowers Oomph.'),
  fullsail: hit('Full Sail', 'suds', 1.7, 2, 'Every scrap of sail, and the tide behind it.'),
};

// Anyone can do this instead of a move: sit tight until its next turn.
export const BRACE = { id: 'brace', name: 'Brace', element: null, kind: 'boost', aim: 'self', boost: { stat: 'grit', by: 0.5, turns: 1 }, wait: 0, desc: 'Sit tight: takes a third less until its next turn.' };
export const moveOf = (id) => (id === BRACE.id ? BRACE : MOVES[id]);

// ---------------------------------------------------------------- the Clutterkin
//
// The first twelve. `moves` pairs each move with the level it is learned at.
// `huff` is how worked up one is when it is not yet a friend: the pips Reach
// out has to clear. A boss has none and cannot be reached. `turns` is how
// many times it acts in a round. `grown` is the form a friend of this kind grows
// up into, and the level it does so at (see GROWN_BOOST): the three you set out
// with at 8, and every other kind a few levels above where it is first met.
// `notYet` is what it does when you Reach out and it is not ready to come.
export const SPECIES = {
  dustbunny: {
    name: 'Hopmote', element: 'fluff', hp: 44, oomph: 13, grit: 9, pep: 15, huff: 4,
    moves: [['lintflurry', 1], ['underbed', 3], ['kickupdust', 6]],
    blurb: 'Lives under the bed. Has always lived under the bed.',
    notYet: 'scoots back under something',
    grown: { at: 8, name: 'Hartmote' },
  },
  sockeel: {
    name: 'Eelastic', element: 'suds', hp: 52, oomph: 12, grit: 11, pep: 10, huff: 4,
    moves: [['wringout', 1], ['oddsocksnap', 3], ['soakthrough', 6]],
    blurb: 'Went into the wash as one of a pair.',
    notYet: 'ties itself in a knot',
    grown: { at: 8, name: 'Toeviathan' },
  },
  toastghost: {
    name: 'Crumbwisp', element: 'crumb', hp: 50, oomph: 10, grit: 12, pep: 8, huff: 4,
    moves: [['crumbtoss', 1], ['butterup', 3], ['burntoffering', 6]],
    fly: true,
    blurb: 'Somebody forgot it in the toaster. It has not forgotten.',
    notYet: 'pops back down out of sight',
    grown: { at: 8, name: 'Crustwraith' },
  },
  dandepuff: {
    name: 'Wishclock', element: 'sprout', hp: 36, oomph: 10, grit: 8, pep: 12, huff: 3,
    moves: [['puffscatter', 1], ['takeroot', 3], ['seedstorm', 6]],
    blurb: 'One good sneeze from being a hundred of itself.',
    notYet: 'puffs up and turns its back',
    grown: { at: 9, name: 'Wishmane' },
  },
  thornhog: {
    name: 'Pricklebud', element: 'sprout', hp: 56, oomph: 10, grit: 13, pep: 6, huff: 5,
    moves: [['brambleshove', 1], ['bristleup', 3], ['rosebudjab', 6]],
    blurb: 'Grew out of the rose bush nobody prunes.',
    notYet: 'bristles',
    grown: { at: 9, name: 'Briartusk' },
  },
  grumblebee: {
    name: 'Grumbuzz', element: 'sprout', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['needlework', 1], ['beeline', 3], ['grumble', 6]],
    fly: true,
    blurb: 'Furious about something. Will not say what.',
    notYet: 'buzzes a tight, cross circle',
    grown: { at: 9, name: 'Rumblepatch' },
  },
  snailor: {
    name: 'Shellfarer', element: 'suds', hp: 58, oomph: 9, grit: 14, pep: 4, huff: 5,
    moves: [['saltspray', 1], ['battendown', 3], ['slowtide', 6]],
    blurb: 'Sailed here from the water butt. It took a year.',
    notYet: 'pulls its head in',
    grown: { at: 9, name: 'Seawhorl' },
  },
  gnome: {
    name: 'Gnomudgeon', element: 'clank', hp: 50, oomph: 12, grit: 11, pep: 9, huff: 5,
    moves: [['rodwhack', 1], ['hookandyank', 3], ['lawnorder', 6]],
    blurb: 'Chipped in 1987 and still not over it.',
    notYet: 'folds its arms',
    grown: { at: 9, name: 'Gnomarch' },
  },
  capbeetle: {
    name: 'Crimpet', element: 'clank', hp: 46, oomph: 11, grit: 13, pep: 8, huff: 4,
    moves: [['pincerpop', 1], ['capclamp', 3], ['shakenfizz', 6]],
    blurb: 'Wandered in from the alley wearing somebody\'s lemonade.',
    notYet: 'clacks its pincers at you',
    grown: { at: 9, name: 'Corkhorn' },
  },
  sparkplug: {
    name: 'Strayglow', element: 'spark', hp: 40, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['staticsnap', 1], ['shortcircuit', 3], ['tripthefuse', 6]],
    blurb: 'Fell off the garden lights and kept the charge.',
    notYet: 'crackles and backs off',
    grown: { at: 9, name: 'Floodglow' },
  },
  ratscal: {
    name: 'Snaffle', element: 'crumb', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 3,
    moves: [['forkjab', 1], ['binraid', 3], ['scrapsforall', 6]],
    blurb: 'Knows what is in every bin on the street.',
    notYet: 'hides its fork behind it',
    grown: { at: 9, name: 'Snafflemore' },
  },
  cancrab: {
    name: 'Hermitin', element: 'clank', hp: 54, oomph: 11, grit: 15, pep: 6, huff: 5,
    moves: [['tinnip', 1], ['liddown', 3], ['canopener', 6]],
    blurb: 'Moved into a tin of tomatoes one winter and has not been out since.',
    notYet: 'pulls its lid down',
    grown: { at: 10, name: 'Clangster' },
  },
  sockgoblin: {
    name: 'Frayling', element: 'fluff', hp: 44, oomph: 14, grit: 9, pep: 14, huff: 4,
    moves: [['buttonflick', 1], ['pullathread', 3], ['darnit', 6]],
    blurb: 'The other sock. It has been looking for you.',
    notYet: 'sticks out a woolly tongue',
    grown: { at: 10, name: 'Woolligan' },
  },
  coothug: {
    name: 'Preenager', element: 'crumb', hp: 46, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['peckingorder', 1], ['shakedown', 3], ['flocktogether', 6]],
    blurb: 'A feather duster that fell in with a bad crowd.',
    notYet: 'ruffles up and struts off',
    grown: { at: 10, name: 'Kingpinion' },
  },
  dumpling: {
    name: 'Scrumpling', element: 'crumb', hp: 50, oomph: 13, grit: 11, pep: 11, huff: 4,
    moves: [['steampuff', 1], ['doughythump', 3], ['stickyfold', 6]],
    blurb: 'Steamed on Sunday. Still steaming about it.',
    notYet: 'lets off steam',
    grown: { at: 11, name: 'Scrumplord' },
  },
  pepperimp: {
    name: 'Embernip', element: 'spark', hp: 40, oomph: 14, grit: 8, pep: 15, huff: 4,
    moves: [['chilliflick', 1], ['hotstreak', 3], ['fivealarm', 6]],
    blurb: 'The last chilli in the jar, and the reason it is the last.',
    notYet: 'blows a smoke ring at you',
    grown: { at: 11, name: 'Scorchfoot' },
  },
  eggknight: {
    name: 'Eggallant', element: 'clank', hp: 58, oomph: 10, grit: 15, pep: 6, huff: 5,
    moves: [['spoonrap', 1], ['shellup', 3], ['softboiledcharge', 6]],
    blurb: 'Sworn to defend the egg cup. Nobody asked it to.',
    notYet: 'salutes, and stays put',
    grown: { at: 11, name: 'Eggalahad' },
  },
  jellywobble: {
    name: 'Wibblet', element: 'suds', hp: 54, oomph: 11, grit: 12, pep: 9, huff: 4,
    moves: [['wobbleslap', 1], ['cherryontop', 3], ['jellyquake', 6]],
    blurb: 'Set at midnight. Has not stopped shaking since.',
    notYet: 'wobbles the other way',
    grown: { at: 11, name: 'Blancmangler' },
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
    grown: { at: 12, name: 'Clipgator' },
  },
  bookworm: {
    name: 'Footnote', element: 'fluff', hp: 50, oomph: 12, grit: 11, pep: 9, huff: 4,
    moves: [['pageturner', 1], ['wellread', 3], ['hardback', 6]],
    blurb: 'Has read everything in here, and has notes.',
    notYet: 'goes back to its page',
    grown: { at: 13, name: 'Marginalia' },
  },
  candlecreep: {
    name: 'Dribblewax', element: 'spark', hp: 42, oomph: 14, grit: 9, pep: 12, huff: 4,
    moves: [['hotdrip', 1], ['snuffout', 3], ['flareup', 6]],
    blurb: 'Lit for a power cut in 1994 and never blown out.',
    notYet: 'gutters, and turns away',
    grown: { at: 13, name: 'Everwick' },
  },
  inkblot: {
    name: 'Blottle', element: 'suds', hp: 46, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['inkflick', 1], ['blotout', 3], ['spillage', 6]],
    blurb: 'Somebody knocked the bottle over. It got up.',
    notYet: 'sinks back into its bottle',
    grown: { at: 13, name: 'Wellspill' },
  },
  quillhog: {
    name: 'Inkspine', element: 'fluff', hp: 56, oomph: 11, grit: 14, pep: 6, huff: 5,
    moves: [['nibjab', 1], ['rollup', 3], ['lastword', 6]],
    blurb: 'Writes angry letters. Signs every one.',
    notYet: 'peers over its glasses',
    grown: { at: 13, name: 'Scrivenspine' },
  },
  papercrane: {
    name: 'Foldwing', element: 'fluff', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 3,
    moves: [['papercut', 1], ['foldedswoop', 3], ['goodnews', 6]],
    fly: true,
    blurb: 'Yesterday\'s paper, folded by somebody patient.',
    notYet: 'flaps up to a high shelf',
    grown: { at: 13, name: 'Broadsheet' },
  },
  gutterbat: {
    name: 'Gutterflit', element: 'sprout', hp: 40, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['leafdive', 1], ['squeak', 3], ['nightswoop', 6]],
    fly: true,
    blurb: 'Sleeps in the guttering and keeps the leaf for rain.',
    notYet: 'hides under its leaf',
    grown: { at: 14, name: 'Eaveswoop' },
  },
  slategecko: {
    name: 'Shingleskink', element: 'clank', hp: 48, oomph: 12, grit: 12, pep: 11, huff: 4,
    moves: [['slateslap', 1], ['looseslate', 3], ['bask', 6]],
    blurb: 'One slate on every roof is warm. This is why.',
    notYet: 'scuttles up the chimney',
    grown: { at: 14, name: 'Slateridge' },
  },
  weathercock: {
    name: 'Vanecrow', element: 'clank', hp: 46, oomph: 14, grit: 10, pep: 13, huff: 4,
    moves: [['northpeck', 1], ['changeofwind', 3], ['cockcrow', 6]],
    blurb: 'Has pointed north-east since the storm of 1987.',
    notYet: 'turns to face the wind',
    grown: { at: 14, name: 'Galecomb' },
  },
  gargoylet: {
    name: 'Spoutling', element: 'suds', hp: 58, oomph: 10, grit: 15, pep: 5, huff: 5,
    moves: [['spout', 1], ['stonestill', 3], ['downpipe', 6]],
    blurb: 'Carved to frighten the rain. The rain was not frightened.',
    notYet: 'sticks its tongue out',
    grown: { at: 14, name: 'Grimspout' },
  },
  chimneywisp: {
    name: 'Emberdrift', element: 'spark', hp: 42, oomph: 13, grit: 9, pep: 12, huff: 4,
    moves: [['sootpuff', 1], ['smokescreen', 3], ['backdraught', 6]],
    fly: true,
    blurb: 'What is left of a fire somebody enjoyed.',
    notYet: 'curls back into its pot',
    grown: { at: 14, name: 'Smokecrown' },
  },
  gearbeetle: {
    name: 'Cogscuttle', element: 'clank', hp: 56, oomph: 10, grit: 15, pep: 6, huff: 5,
    moves: [['cogbite', 1], ['windup', 3], ['sprungcoil', 6]],
    blurb: 'Fell out of a clock and kept time anyway.',
    notYet: 'ticks at you, crossly',
    grown: { at: 15, name: 'Cogmarshal' },
  },
  tintrooper: {
    name: 'Stalwind', element: 'clank', hp: 50, oomph: 13, grit: 11, pep: 10, huff: 4,
    moves: [['paradejab', 1], ['drumroll', 3], ['quickmarch', 6]],
    blurb: 'The last of a box of twelve. Still on parade.',
    notYet: 'about-turns, smartly',
    grown: { at: 15, name: 'Marchwind' },
  },
  cuckoo: {
    name: 'Tocktalon', element: 'sprout', hp: 40, oomph: 14, grit: 8, pep: 16, huff: 4,
    moves: [['onthehour', 1], ['nestrobber', 3], ['twelveoclock', 6]],
    blurb: 'Comes out on the hour. Any hour it likes.',
    notYet: 'pops back behind its door',
    grown: { at: 15, name: 'Midnightjar' },
  },
  mothphantom: {
    name: 'Lampmourn', element: 'fluff', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 4,
    moves: [['dustywing', 1], ['mothholes', 3], ['lightsout', 6]],
    fly: true,
    blurb: 'Still circling a lamp that was thrown out years ago.',
    notYet: 'flutters off to the rafters',
    grown: { at: 15, name: 'Lanternlorn' },
  },
  jackbox: {
    name: 'Crankjaw', element: 'clank', hp: 48, oomph: 14, grit: 10, pep: 12, huff: 4,
    moves: [['popgoes', 1], ['liddown2', 3], ['lastlaugh', 6]],
    blurb: 'Nobody has turned the handle since 1962. It is ready.',
    notYet: 'ducks back into its box',
    grown: { at: 15, name: 'Harlecrank' },
  },
  cordserpent: {
    name: 'Tanglecoil', element: 'spark', hp: 48, oomph: 13, grit: 10, pep: 13, huff: 4,
    moves: [['plugbite', 1], ['tangle', 3], ['livewire', 6]],
    blurb: 'Every lead in the drawer, tied in one knot.',
    notYet: 'coils up tighter',
    grown: { at: 16, name: 'Drumcoil' },
  },
  dustwraith: {
    name: 'Grimeshade', element: 'fluff', hp: 44, oomph: 13, grit: 9, pep: 15, huff: 5,
    moves: [['coldfluff', 1], ['dreadhop', 3], ['duststorm', 6]],
    fly: true,
    blurb: 'What a Hopmote becomes if nobody ever looks.',
    notYet: 'melts into the shadows',
    grown: { at: 16, name: 'Shroudmote' },
  },
  robodisc: {
    name: 'Bumpabout', element: 'clank', hp: 60, oomph: 11, grit: 15, pep: 7, huff: 5,
    moves: [['bumper', 1], ['dock', 3], ['edgeclean', 6]],
    blurb: 'Has cleaned the same square of carpet since Tuesday.',
    notYet: 'reverses, beeping',
    grown: { at: 16, name: 'Rovabout' },
  },
  // ---- chapter two: twenty more kinds, two or three to each of the eight places. Each grows up at the
  // level the other kinds of its place do. ----
  canphant: {
    name: 'Tintrunk', element: 'suds', hp: 56, oomph: 10, grit: 13, pep: 6, huff: 5,
    moves: [['spoutsquirt', 1], ['fillup', 3], ['roseshower', 6]],
    blurb: 'A watering can somebody left out in the rain. It filled up and walked off.',
    notYet: 'squirts you and backs away',
    grown: { at: 9, name: 'Raintusker' },
  },
  glovecrab: {
    name: 'Fumblethumb', element: 'sprout', hp: 40, oomph: 13, grit: 8, pep: 15, huff: 4,
    moves: [['greenthumb', 1], ['fivefingerpinch', 3], ['scattersoil', 6]],
    blurb: 'One gardening glove. The other is still in the shed, and they are not speaking.',
    notYet: 'scuttles off sideways',
    grown: { at: 9, name: 'Secateer' },
  },
  brollybat: {
    name: 'Brollyflap', element: 'fluff', hp: 40, oomph: 13, grit: 8, pep: 16, huff: 4,
    moves: [['ribjab', 1], ['colddrip', 3], ['gustdive', 6]],
    fly: true,
    blurb: 'Blew inside out in the gale of \'98 and has refused to fold ever since.',
    notYet: 'snaps shut and sulks',
    grown: { at: 10, name: 'Squallbrella' },
  },
  trolleypup: {
    name: 'Wonkwheel', element: 'clank', hp: 50, oomph: 12, grit: 12, pep: 9, huff: 4,
    moves: [['wonkyram', 1], ['squeakywheel', 3], ['trolleydash', 6]],
    blurb: 'One wheel has always wanted to go somewhere else.',
    notYet: 'veers off to the left',
    grown: { at: 10, name: 'Trundlebeast' },
  },
  conekin: {
    name: 'Coneling', element: 'spark', hp: 42, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['flashamber', 1], ['conecharge', 3], ['hazardlights', 6]],
    blurb: 'Nobody remembers what it was put there to warn about. It remembers.',
    notYet: 'flashes amber at you',
    grown: { at: 10, name: 'Beaconspire' },
  },
  teabagjelly: {
    name: 'Steepling', element: 'suds', hp: 46, oomph: 11, grit: 11, pep: 10, huff: 4,
    moves: [['tagflick', 1], ['nicecupoftea', 3], ['stew', 6]],
    fly: true,
    blurb: 'Left in the cup too long. It has gone strong, and a bit bitter.',
    notYet: 'bobs back down into the cup',
    grown: { at: 11, name: 'Teapotentate' },
  },
  whiskbird: {
    name: 'Whisklet', element: 'clank', hp: 40, oomph: 14, grit: 8, pep: 15, huff: 4,
    moves: [['wirepeck', 1], ['beatstiff', 3], ['whipup', 6]],
    blurb: 'Beats eggs, cream, and anyone who calls it an egg beater.',
    notYet: 'spins round on the spot',
    grown: { at: 11, name: 'Whirlwhisk' },
  },
  picklefrog: {
    name: 'Gherkroak', element: 'crumb', hp: 56, oomph: 10, grit: 14, pep: 6, huff: 5,
    moves: [['sourspit', 1], ['brinesoak', 3], ['jarslam', 6]],
    blurb: 'The last gherkin in the jar. It has had a long time to think.',
    notYet: 'sinks back into its jar',
    grown: { at: 11, name: 'Brinebelly' },
  },
  ironweasel: {
    name: 'Steamstoat', element: 'spark', hp: 42, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['hotfoot', 1], ['flatten', 3], ['steamburst', 6]],
    blurb: 'A travel iron. It has been everywhere and pressed all of it flat.',
    notYet: 'hisses and slides away',
    grown: { at: 12, name: 'Starchback' },
  },
  baskettortoise: {
    name: 'Hamperling', element: 'fluff', hp: 58, oomph: 9, grit: 15, pep: 5, huff: 5,
    moves: [['wickerbump', 1], ['hamperlid', 3], ['heapofwashing', 6]],
    blurb: 'Has been full since the summer. Nobody dares lift the lid.',
    notYet: 'pulls its head under its lid',
    grown: { at: 12, name: 'Wickerback' },
  },
  zipcrawler: {
    name: 'Zipnip', element: 'clank', hp: 40, oomph: 14, grit: 8, pep: 16, huff: 3,
    moves: [['zipnip', 1], ['zipup', 3], ['caughtfast', 6]],
    blurb: 'Got stuck half way in 2009. Now it gets everything else stuck.',
    notYet: 'zips itself up to the chin',
    grown: { at: 12, name: 'Zipperpede' },
  },
  stamphopper: {
    name: 'Stampling', element: 'clank', hp: 42, oomph: 13, grit: 9, pep: 14, huff: 4,
    moves: [['thump', 1], ['overdue', 3], ['stampstampstamp', 6]],
    blurb: 'Has said the same date since the ink ran dry.',
    notYet: 'hops back onto its ink pad',
    grown: { at: 13, name: 'Inkstomper' },
  },
  globehog: {
    name: 'Globlet', element: 'fluff', hp: 56, oomph: 10, grit: 14, pep: 6, huff: 5,
    moves: [['spinbump', 1], ['curlround', 3], ['roundtheworld', 6]],
    blurb: 'A desk globe from before half these countries. It rolls where it likes.',
    notYet: 'rolls away under a shelf',
    grown: { at: 13, name: 'Worldwhirl' },
  },
  aerialhare: {
    name: 'Statichare', element: 'spark', hp: 40, oomph: 14, grit: 8, pep: 16, huff: 4,
    moves: [['staticnip', 1], ['snowonthescreen', 3], ['signaljolt', 6]],
    blurb: 'Picks up three channels and a great deal of thunder.',
    notYet: 'bounds to the next chimney',
    grown: { at: 14, name: 'Dishleaper' },
  },
  kiteray: {
    name: 'Snagkite', element: 'fluff', hp: 38, oomph: 13, grit: 8, pep: 16, huff: 3,
    moves: [['taillash', 1], ['catchthewind', 3], ['stringburn', 6]],
    fly: true,
    blurb: 'Got away from somebody in 1996. It has stayed up here since, on purpose.',
    notYet: 'lets out more string',
    grown: { at: 14, name: 'Stunthawk' },
  },
  teddybear: {
    name: 'Patchpaw', element: 'fluff', hp: 54, oomph: 11, grit: 12, pep: 8, huff: 4,
    moves: [['bearcuff', 1], ['bearhug', 3], ['stuffingstorm', 6]],
    blurb: 'Loved until one eye came off, then put in a box. It kept the other eye open.',
    notYet: 'turns its back, arms folded',
    grown: { at: 15, name: 'Darnbruin' },
  },
  snowglobe: {
    name: 'Flurryglobe', element: 'suds', hp: 46, oomph: 12, grit: 11, pep: 10, huff: 4,
    moves: [['snowballflick', 1], ['shakeup', 3], ['whiteout', 6]],
    blurb: 'Somebody shook it once, hard. It has been snowing in there ever since.',
    notYet: 'turns upside down',
    grown: { at: 15, name: 'Blizzardome' },
  },
  torchmole: {
    name: 'Burrowbeam', element: 'spark', hp: 48, oomph: 13, grit: 10, pep: 11, huff: 4,
    moves: [['noselight', 1], ['dazzle', 3], ['fullbeam', 6]],
    blurb: 'A torch nobody could find in the dark, which is the trouble with torches.',
    notYet: 'switches itself off',
    grown: { at: 16, name: 'Dazzledig' },
  },
  bootpup: {
    name: 'Scuffpup', element: 'fluff', hp: 46, oomph: 13, grit: 10, pep: 13, huff: 4,
    moves: [['scuff', 1], ['lacetrip', 3], ['theboot', 6]],
    blurb: 'The left one. It waits by the door for walks that stopped years ago.',
    notYet: 'chews its own laces',
    grown: { at: 16, name: 'Hobnailhound' },
  },
  dustpancrab: {
    name: 'Dustpincer', element: 'clank', hp: 56, oomph: 10, grit: 15, pep: 5, huff: 5,
    moves: [['sweepaside', 1], ['panguard', 3], ['cleansweep', 6]],
    blurb: 'Pan in one claw, brush in the other. It has never once finished.',
    notYet: 'sweeps itself under the mat',
    grown: { at: 16, name: 'Sweepclaw' },
  },
  // ---- chapter two: the kinds of the four new places, five to each ----
  seedfinch: {
    name: 'Sproutlark', element: 'sprout', hp: 40, oomph: 14, grit: 8, pep: 16, huff: 4,
    moves: [['seedspit', 1], ['dawnchorus', 3], ['divesow', 6]],
    fly: true,
    blurb: 'Hatched out of a packet of mixed seeds. Nobody knows what it will come up as.',
    notYet: 'flits up into the rafters',
    grown: { at: 16, name: 'Harvestwing' },
  },
  potcub: {
    name: 'Terracub', element: 'clank', hp: 58, oomph: 10, grit: 15, pep: 5, huff: 5,
    moves: [['potbutt', 1], ['crockup', 3], ['claytumble', 6]],
    blurb: 'Somebody planted a bulb in it and forgot. The bulb did not.',
    notYet: 'ducks down inside its pot',
    grown: { at: 16, name: 'Kilnbear' },
  },
  compostkin: {
    name: 'Mulchkin', element: 'sprout', hp: 52, oomph: 11, grit: 12, pep: 8, huff: 4,
    moves: [['clodlob', 1], ['feedthesoil', 3], ['steamingheap', 6]],
    blurb: 'Peelings, grass and a great deal of time. Warm to the touch, and proud of it.',
    notYet: 'burrows into itself',
    grown: { at: 16, name: 'Steamheap' },
  },
  tomatomonkey: {
    name: 'Tomarin', element: 'crumb', hp: 42, oomph: 14, grit: 8, pep: 15, huff: 4,
    moves: [['pipflick', 1], ['vineswing', 3], ['overripe', 6]],
    blurb: 'Ripened on the vine. Stayed on the vine. Swings on the vine.',
    notYet: 'swings up out of reach',
    grown: { at: 16, name: 'Tomatogre' },
  },
  basketjelly: {
    name: 'Trailbloom', element: 'suds', hp: 44, oomph: 12, grit: 10, pep: 12, huff: 4,
    moves: [['petalsting', 1], ['dripdrip', 3], ['traillash', 6]],
    fly: true,
    blurb: 'Watered every day for a summer, then never again. It waters itself now.',
    notYet: 'drifts up to the roof',
    grown: { at: 16, name: 'Hangarden' },
  },
  rubberduck: {
    name: 'Squeakbill', element: 'suds', hp: 48, oomph: 13, grit: 10, pep: 12, huff: 4,
    moves: [['beakbop', 1], ['bigsqueak', 3], ['bathbomb', 6]],
    blurb: 'Squeaks when squeezed. Bites when squeezed twice.',
    notYet: 'paddles off in a huff',
    grown: { at: 17, name: 'Squeakswan' },
  },
  pastegrub: {
    name: 'Mintgrub', element: 'suds', hp: 56, oomph: 10, grit: 14, pep: 6, huff: 5,
    moves: [['mintyspit', 1], ['squeezeupwards', 3], ['stripe', 6]],
    blurb: 'Rolled up from the bottom, properly, for once.',
    notYet: 'screws its cap back on',
    grown: { at: 17, name: 'Pastepillar' },
  },
  loofahdillo: {
    name: 'Loofling', element: 'sprout', hp: 58, oomph: 9, grit: 15, pep: 5, huff: 5,
    moves: [['scratchyroll', 1], ['curluptight', 3], ['scrubdown', 6]],
    blurb: 'Rough on the outside. Also rough on the inside.',
    notYet: 'rolls into a ball',
    grown: { at: 17, name: 'Scrubadillo' },
  },
  drainhair: {
    name: 'Clogtuft', element: 'fluff', hp: 40, oomph: 13, grit: 8, pep: 15, huff: 4,
    moves: [['wetknot', 1], ['clog', 3], ['hairball', 6]],
    blurb: 'Everybody\'s hair, and nobody\'s. It came up out of the plughole to see who.',
    notYet: 'slips back down the plughole',
    grown: { at: 17, name: 'Clogmane' },
  },
  curtainghost: {
    name: 'Showershade', element: 'fluff', hp: 42, oomph: 12, grit: 9, pep: 13, huff: 4,
    moves: [['clingyslap', 1], ['clammycling', 3], ['coldshower', 6]],
    fly: true,
    blurb: 'It only wants to cling to somebody. It cannot see why that is a problem.',
    notYet: 'billows away along the rail',
    grown: { at: 17, name: 'Curtaincall' },
  },
  tapelizard: {
    name: 'Tapetail', element: 'clank', hp: 42, oomph: 14, grit: 9, pep: 15, huff: 4,
    moves: [['tapesnap', 1], ['measuretwice', 3], ['whiplash', 6]],
    blurb: 'Five metres long when it wants to be. It usually wants to be.',
    notYet: 'retracts with a snap',
    grown: { at: 18, name: 'Yardwhip' },
  },
  hammerpecker: {
    name: 'Peckhammer', element: 'clank', hp: 46, oomph: 14, grit: 9, pep: 12, huff: 4,
    moves: [['taptap', 1], ['hitthenail', 3], ['ratatat', 6]],
    blurb: 'Has one answer to every problem, and it is nearly always right.',
    notYet: 'hammers at the wall instead',
    grown: { at: 18, name: 'Sledgebeak' },
  },
  brushfox: {
    name: 'Daubfox', element: 'suds', hp: 46, oomph: 13, grit: 10, pep: 13, huff: 4,
    moves: [['daub', 1], ['wetpaint', 3], ['splatter', 6]],
    blurb: 'Leaves paw prints in three colours. None of them the colours anyone chose.',
    notYet: 'flicks paint and trots off',
    grown: { at: 18, name: 'Glossvixen' },
  },
  sawfish: {
    name: 'Sawnose', element: 'clank', hp: 48, oomph: 13, grit: 11, pep: 10, huff: 4,
    moves: [['roughcut', 1], ['againstthegrain', 3], ['sawduststorm', 6]],
    blurb: 'Swims through sawdust. Measures nothing, cuts everything.',
    notYet: 'dives into the sawdust',
    grown: { at: 18, name: 'Bandsawback' },
  },
  bulbmoth: {
    name: 'Filamoth', element: 'spark', hp: 38, oomph: 14, grit: 8, pep: 16, huff: 4,
    moves: [['flicker', 1], ['glare', 3], ['hundredwatts', 6]],
    fly: true,
    blurb: 'The bulb went years ago. Nobody told the moth.',
    notYet: 'flutters back to the light',
    grown: { at: 18, name: 'Lumenwing' },
  },
  pinpuffer: {
    name: 'Pinbobber', element: 'fluff', hp: 54, oomph: 10, grit: 15, pep: 7, huff: 5,
    moves: [['pinprick', 1], ['puffup', 3], ['pinsandneedles', 6]],
    fly: true,
    blurb: 'Everything sharp in the house ends up in it. It has stopped minding.',
    notYet: 'puffs up to twice the size',
    grown: { at: 19, name: 'Needleglobe' },
  },
  thimblemouse: {
    name: 'Thimblet', element: 'clank', hp: 40, oomph: 13, grit: 9, pep: 16, huff: 4,
    moves: [['needlejab', 1], ['thimblecharge', 3], ['stitchintime', 6]],
    blurb: 'Small enough to be overlooked. Sharp enough to make that a mistake.',
    notYet: 'hides under its thimble',
    grown: { at: 19, name: 'Thimbleguard' },
  },
  scissorstork: {
    name: 'Snipstork', element: 'clank', hp: 46, oomph: 14, grit: 9, pep: 13, huff: 4,
    moves: [['snip', 1], ['cutonthebias', 3], ['loosethreads', 6]],
    blurb: 'Measures once and cuts twice. It likes the cutting.',
    notYet: 'stalks off on tiptoe',
    grown: { at: 19, name: 'Shearcrane' },
  },
  buttonowl: {
    name: 'Buttonhoot', element: 'fluff', hp: 50, oomph: 12, grit: 12, pep: 9, huff: 4,
    moves: [['toggleshot', 1], ['wiselook', 3], ['spillthejar', 6]],
    blurb: 'Every spare button from every coat. It knows which one is yours.',
    notYet: 'turns its head right round',
    grown: { at: 19, name: 'Haberhoot' },
  },
  lacespider: {
    name: 'Doilyspin', element: 'fluff', hp: 40, oomph: 13, grit: 8, pep: 15, huff: 4,
    moves: [['threadsnare', 1], ['weboflace', 3], ['bobbindrop', 6]],
    blurb: 'Has been making the same doily since 1962. It is nearly happy with it.',
    notYet: 'scurries back up its thread',
    grown: { at: 19, name: 'Lacewidow' },
  },
  // ---- the Keepsakes: one of a kind, one to a chapter. Not restless, and in no place's pool: each is found at
  // its own spot in the open once its chapter's places are all calm (core/strays.js). `keepsake` is its chapter and
  // the level it is met at. A Keepsake does not grow up: it is what it is. It takes a long while to reach. ----
  keep_musicbox: {
    name: 'Lullawren', element: 'clank', hp: 74, oomph: 13, grit: 14, pep: 13, huff: 8, keepsake: { chapter: 1, level: 13 },
    moves: [['chime', 1], ['lullaby', 1], ['woundrightup', 1]],
    blurb: 'The lullaby you have been hearing all along the lane. This is who was playing it.',
    notYet: 'closes its lid and plays on',
  },
  keep_bottleship: {
    name: 'Farewhale', element: 'suds', hp: 82, oomph: 14, grit: 14, pep: 12, huff: 8, keepsake: { chapter: 2, level: 17 },
    moves: [['bowwave', 1], ['becalm', 1], ['fullsail', 1]],
    fly: true,
    blurb: 'A ship in a bottle that never did get to sea. So it brought the sea.',
    notYet: 'sinks into its little sea',
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
  boss_marrow: {
    name: 'The Prize Marrow', element: 'sprout', hp: 122, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['tendrillash', 1], ['benchroll', 1], ['firstprize', 1]],
    blurb: 'First prize, 1987. It never stopped growing, and it wants the cup back.',
  },
  boss_bathtub: {
    name: 'Old Clawfoot', element: 'suds', hp: 124, oomph: 12, grit: 13, pep: 9, huff: 0, boss: true, turns: 2,
    moves: [['clawstomp', 1], ['overflow', 1], ['pulltheplug', 1]],
    blurb: 'A bath that got up on its four iron feet one night. It has been running ever since.',
  },
  boss_mower: {
    name: 'Captain Twostroke', element: 'clank', hp: 126, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['bladespin', 1], ['grassclippings', 1], ['fullthrottle', 1]],
    blurb: 'Started first pull in 1974. Nobody has found the off switch.',
  },
  boss_treadle: {
    name: 'Madam Treadle', element: 'fluff', hp: 120, oomph: 12, grit: 13, pep: 10, huff: 0, boss: true, turns: 2,
    moves: [['needledown', 1], ['runaseam', 1], ['sewnshut', 1]],
    blurb: 'Has run the same seam since 1953. It will stitch anything that stands still.',
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

// A Keepsake is out at its spot every time you set out, from when its chapter's places are all calm
// until it is your friend. After that it comes out only now and then, and only in its rare colours:
// `again` is how often. (Until it is your friend it is in them as often as anyone in a calm place.)
export const KEEPSAKE = { again: 1 / 10 };

// Once a place is calm, word gets round, and kinds like the three you set out with come calling
// there too (never beside its ringleader). It is the only way one of theirs can turn up as an
// Heirloom. `weight` is how likely each is beside the place's own kinds, which weigh 1 to 3.
export const VISITORS = { kinds: START_TEAM.map(([id]) => id), weight: 0.4 };

// A place that has been calmed stays calm: its five groups and its ringleader do not come back.
// What you find there instead is a few wanderers: this many small groups (at least, at most),
// strolling about some of its stops, different each time you come back from a rest. Nobody has
// to be met; they are there for the friends still to be made, and for Heirlooms.
export const WANDERERS = { groups: [1, 3] };

// Each real day one calm place is lively: a different one each day, going round them all. More
// wander there that night (this many groups, where a calm place has WANDERERS'), and they are in
// their rare colours much more often (`heirloom`, each of them, where a calm place has
// HEIRLOOM.calmOdds). Nothing else changes, nothing is lost by missing a day, and the game never
// looks at a clock itself: whoever runs it says what day it is (see Game.setDay).
export const LIVELY = { groups: [3, 4], heirloom: 3 / 20 };

// Strays: lost Clutterkin out in the open, between places (core/strays.js). This many small
// groups turn up each time you set out rested, each of this size, most of them in the country
// between the rows of houses. `meet` is how near you must walk
// to meet one: much nearer than to a group that holds its ground, because nobody has to meet a
// stray. `berth` is how wide the way found for you goes round one you are not heading for.
export const STRAYS = { groups: [4, 7], farGroups: [6, 9], size: [1, 3], meet: 58, berth: 104 }; // (`farGroups`: once the far bank is open too)

// ---------------------------------------------------------------- the rival
//
// Tansy Brisk, junior clearance officer, and her three: a feather duster, a bar of soap and a travel
// iron, issued to her by the depot (see core/rival.js). She waits by the road at five points along
// the way, each once the place named here is calm. Her three are as strong as `levels` says, and
// grown up once they are big enough. The levels were set with the simulator, against a rested team
// that has come straight there: it wins about nine bouts in ten, and the first a little oftener.
export const RIVAL = {
  kinds: ['coothug', 'soapslug', 'ironweasel'],
  meetings: [
    { after: 'garden', levels: [6, 5, 5] },
    { after: 'pantry', levels: [10, 9, 9] },
    { after: 'stacks', levels: [12, 13, 13] },
    { after: 'dark', levels: [16, 16, 16] },
    { after: 'shed', levels: [20, 20, 20] },
  ],
};

// ---------------------------------------------------------------- ringleaders as friends
//
// A ringleader whose wish you have granted comes home (see core/wishes.js). As a friend it is one of
// the team: it acts once a round, like anyone, and has this share (`hp`) of the Health it had when it
// held a whole place against three. That leaves it sturdier than any ordinary kind (about 66 before
// levels, where the sturdiest of those has 60) and less so than a Keepsake; its moves hit no harder
// than anyone's. Being sturdier, only so many walk with you at once (`team`).
export const CHIEF = { hp: 0.55, team: 1 };
/** A kind's Health before levels, as a friend has it: a ringleader's is cut down to size. */
export const friendHp = (species) => (SPECIES[species].boss ? Math.round(SPECIES[species].hp * CHIEF.hp) : SPECIES[species].hp);

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
export const xpFor = (species, level, grown = false) => Math.round(Math.round((6 + 5 * level) * XP_RATE) * (SPECIES[species].boss ? 4 : 1) * (grown && SPECIES[species].grown ? GROWN_WORTH : 1));
export const BENCH_SHARE = 0.5; // friends left at home learn half as much
// A fight teaches by its size: something for each of them, so two teach twice what one does and
// three, three times. And one on its own against your team is hardly a fight, so it teaches only
// this share of its worth. Only a stray is ever met alone: a place's groups are two or three, and
// a ringleader has company.
export const LONE_SHARE = 0.6;

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
      { name: 'The Washing Line', size: [2, 2], level: [2, 3], pool: [['dandepuff', 2], ['grumblebee', 2], ['snailor', 2], ['sparkplug', 2], ['canphant', 2]] },
      { name: 'The Flower Bed', size: [3, 3], level: [2, 3], pool: [['dandepuff', 2], ['thornhog', 2], ['grumblebee', 2], ['sparkplug', 1], ['glovecrab', 2]] },
      { name: 'The Potting Shed', size: [3, 3], level: [3, 4], pool: [['gnome', 3], ['capbeetle', 3], ['thornhog', 1], ['ratscal', 1], ['snailor', 1], ['canphant', 2], ['glovecrab', 2]] },
      { name: 'The Sprinkler', boss: 'boss_hydra', bossLevel: 5, size: [2, 2], level: [3, 3], pool: [['snailor', 1], ['dandepuff', 2]] },
    ],
  },
  {
    id: 'alley', name: 'Tin Can Alley', bg: 'bg_alley', tint: '#8c9bb5', element: 'clank',
    blurb: 'Bins, bottle caps and whoever is in charge of them. A narrow place: they come one after another.',
    path: [
      { name: 'The Dented Bins', size: [2, 2], level: [4, 4], pool: [['cancrab', 3], ['ratscal', 2], ['brollybat', 1], ['conekin', 1]] },
      { name: 'The Bottle Bank', size: [2, 3], level: [4, 5], pool: [['capbeetle', 3], ['sockgoblin', 2], ['cancrab', 1], ['trolleypup', 1], ['conekin', 1]] },
      { name: 'The Fire Escape', size: [3, 3], level: [4, 5], pool: [['coothug', 3], ['sockgoblin', 2], ['sparkplug', 1], ['brollybat', 1]] },
      { name: 'The Loading Bay', size: [3, 3], level: [5, 5], pool: [['cancrab', 2], ['coothug', 2], ['capbeetle', 2], ['ratscal', 1], ['trolleypup', 1]] },
      { name: 'The Baron\'s Court', boss: 'boss_baron', bossLevel: 6, size: [1, 2], level: [4, 4], pool: [['coothug', 2], ['ratscal', 2]] },
    ],
  },
  {
    id: 'pantry', name: 'The Midnight Pantry', bg: 'bg_pantry', tint: '#f2a65a', element: 'crumb',
    blurb: 'Everything in here is past its date and wide awake.',
    path: [
      { name: 'The Bottom Shelf', size: [2, 2], level: [5, 5], pool: [['dumpling', 3], ['jellywobble', 1], ['teabagjelly', 2]] },
      { name: 'The Spice Rack', size: [2, 2], level: [6, 6], pool: [['pepperimp', 2], ['dumpling', 2], ['whiskbird', 2]] },
      { name: 'The Egg Cups', size: [3, 3], level: [6, 6], pool: [['eggknight', 3], ['jellywobble', 2], ['pepperimp', 1], ['teabagjelly', 2], ['picklefrog', 2]] },
      { name: 'The Cold Shelf', size: [3, 3], level: [6, 7], pool: [['jellywobble', 3], ['eggknight', 2], ['dumpling', 1], ['whiskbird', 2], ['picklefrog', 2]] },
      { name: 'The Toaster', boss: 'boss_crumbwyrm', bossLevel: 7, size: [1, 2], level: [6, 6], pool: [['pepperimp', 2], ['dumpling', 2]] },
    ],
  },
  {
    id: 'wash', name: 'The Wash', bg: 'bg_wash', tint: '#4fc4cf', element: 'suds',
    blurb: 'Where socks go in as pairs.',
    path: [
      { name: 'The Sock Basket', size: [2, 2], level: [7, 7], pool: [['pegsnapper', 3], ['soapslug', 2], ['ironweasel', 2]] },
      { name: 'The Soap Shelf', size: [2, 2], level: [7, 8], pool: [['soapslug', 3], ['bubblejelly', 2], ['baskettortoise', 2]] },
      { name: 'The Dryers', size: [2, 3], level: [7, 8], pool: [['lintgolem', 3], ['pegsnapper', 2], ['bubblejelly', 1], ['ironweasel', 2], ['zipcrawler', 2]] },
      { name: 'The Rinse', size: [3, 3], level: [7, 8], pool: [['bubblejelly', 3], ['lintgolem', 2], ['soapslug', 1], ['baskettortoise', 2], ['zipcrawler', 2]] },
      { name: 'Machine Six', boss: 'boss_spincycle', bossLevel: 9, size: [1, 2], level: [7, 7], pool: [['pegsnapper', 2], ['bubblejelly', 2]] },
    ],
  },
  {
    id: 'stacks', name: 'The Dusty Stacks', bg: 'bg_stacks', tint: '#c08552', element: 'fluff',
    blurb: 'Overdue books and what lives between the pages.',
    path: [
      { name: 'The Returns Desk', size: [2, 2], level: [8, 9], pool: [['bookworm', 3], ['papercrane', 2], ['stamphopper', 2]] },
      { name: 'Periodicals', size: [2, 2], level: [9, 9], pool: [['papercrane', 3], ['inkblot', 2], ['globehog', 2]] },
      { name: 'The Reading Lamp', size: [2, 3], level: [9, 9], pool: [['candlecreep', 3], ['bookworm', 2], ['inkblot', 1], ['stamphopper', 2]] },
      { name: 'Reference Only', size: [2, 3], level: [9, 9], pool: [['quillhog', 3], ['inkblot', 2], ['candlecreep', 1], ['globehog', 2]] },
      { name: 'The Locked Case', boss: 'boss_tome', bossLevel: 10, size: [1, 1], level: [9, 9], pool: [['bookworm', 2], ['candlecreep', 2]] },
    ],
  },
  {
    id: 'rooftops', name: 'Moonlit Rooftops', bg: 'bg_rooftops', tint: '#7d6bd6', element: 'clank',
    blurb: 'Slates, chimneys and a long way down.',
    path: [
      { name: 'The Gutter', size: [2, 2], level: [9, 10], pool: [['gutterbat', 3], ['slategecko', 2], ['aerialhare', 2]] },
      { name: 'The Ridge', size: [2, 2], level: [10, 10], pool: [['slategecko', 3], ['weathercock', 2], ['kiteray', 2]] },
      { name: 'The Chimney Pots', size: [2, 3], level: [10, 10], pool: [['chimneywisp', 3], ['gutterbat', 2], ['weathercock', 1], ['aerialhare', 2]] },
      { name: 'The Parapet', size: [3, 3], level: [10, 11], pool: [['gargoylet', 3], ['slategecko', 2], ['chimneywisp', 1], ['kiteray', 2]] },
      { name: 'The Weathervane', boss: 'boss_warden', bossLevel: 11, size: [1, 2], level: [10, 10], pool: [['weathercock', 2], ['gutterbat', 2]] },
    ],
  },
  {
    id: 'attic', name: 'The Tick-Tock Attic', bg: 'bg_attic', tint: '#d9a441', element: 'clank',
    blurb: 'Every clock up here is wrong in a different way.',
    path: [
      { name: 'The Hatch', size: [2, 2], level: [10, 11], pool: [['tintrooper', 3], ['gearbeetle', 2], ['teddybear', 2]] },
      { name: 'The Toy Chest', size: [2, 2], level: [11, 11], pool: [['jackbox', 3], ['tintrooper', 2], ['snowglobe', 2]] },
      { name: 'The Dust Sheets', size: [2, 3], level: [11, 11], pool: [['mothphantom', 3], ['cuckoo', 2], ['jackbox', 1], ['teddybear', 2]] },
      { name: 'The Clock Shelf', size: [2, 3], level: [11, 12], pool: [['gearbeetle', 3], ['cuckoo', 2], ['mothphantom', 1], ['snowglobe', 2]] },
      { name: 'The Long Case', boss: 'boss_clock', bossLevel: 12, size: [1, 2], level: [11, 11], pool: [['tintrooper', 2], ['cuckoo', 2]] },
    ],
  },
  {
    id: 'dark', name: 'The Roaring Dark', bg: 'bg_dark', tint: '#d6455d', element: 'spark',
    blurb: 'The cupboard under the stairs. Something in it is plugged in.',
    path: [
      { name: 'The Coat Hooks', size: [2, 2], level: [11, 11], pool: [['dustwraith', 3], ['sparkplug', 2], ['torchmole', 2]] },
      { name: 'The Fuse Box', size: [2, 2], level: [11, 12], pool: [['cordserpent', 3], ['sparkplug', 2], ['bootpup', 2]] },
      { name: 'The Shoe Rack', size: [2, 3], level: [12, 12], pool: [['robodisc', 3], ['dustwraith', 2], ['cordserpent', 1], ['torchmole', 2], ['dustpancrab', 2]] },
      { name: 'The Back Corner', size: [2, 3], level: [12, 12], pool: [['cordserpent', 2], ['dustwraith', 2], ['robodisc', 2], ['bootpup', 2], ['dustpancrab', 2]] },
      { name: 'The Plug Socket', boss: 'boss_vacuum', bossLevel: 13, size: [1, 1], level: [11, 11], pool: [['cordserpent', 2], ['robodisc', 2]] },
    ],
  },
  {
    id: 'glasshouse', name: 'The Glasshouse', bg: 'bg_glasshouse', tint: '#8fd17a', element: 'sprout', chapter: 2,
    blurb: 'Warm, wet, and everything in it has been growing all night.',
    path: [
      { name: 'The Seed Trays', size: [2, 2], level: [12, 12], pool: [['seedfinch', 3], ['compostkin', 2]] },
      { name: 'The Potting Bench', size: [2, 2], level: [12, 13], pool: [['potcub', 3], ['seedfinch', 2], ['compostkin', 1]] },
      { name: 'The Tomato Row', size: [2, 3], level: [13, 13], pool: [['tomatomonkey', 3], ['potcub', 2], ['basketjelly', 1]] },
      { name: 'The Hanging Baskets', size: [3, 3], level: [13, 13], pool: [['basketjelly', 3], ['tomatomonkey', 2], ['compostkin', 1]] },
      { name: 'The Show Bench', boss: 'boss_marrow', bossLevel: 14, size: [1, 2], level: [12, 12], pool: [['compostkin', 2], ['potcub', 2]] },
    ],
  },
  {
    id: 'deepend', name: 'The Deep End', bg: 'bg_deepend', tint: '#6fd0dc', element: 'suds', chapter: 2,
    blurb: 'The old bath house, with the taps left running and the light off.',
    path: [
      { name: 'The Bath Mat', size: [2, 2], level: [13, 13], pool: [['rubberduck', 3], ['drainhair', 2]] },
      { name: 'The Basin', size: [2, 2], level: [13, 14], pool: [['pastegrub', 3], ['rubberduck', 2], ['drainhair', 1]] },
      { name: 'The Cabinet', size: [2, 3], level: [14, 14], pool: [['loofahdillo', 3], ['pastegrub', 2], ['curtainghost', 1]] },
      { name: 'The Shower', size: [3, 3], level: [14, 14], pool: [['curtainghost', 3], ['loofahdillo', 2], ['drainhair', 2]] },
      { name: 'The Tub', boss: 'boss_bathtub', bossLevel: 15, size: [1, 2], level: [13, 13], pool: [['rubberduck', 2], ['drainhair', 2]] },
    ],
  },
  {
    id: 'shed', name: 'The Tinker\'s Shed', bg: 'bg_shed', tint: '#c9a36a', element: 'clank', chapter: 2,
    blurb: 'Every tool he ever borrowed, and the mower he never took back.',
    path: [
      { name: 'The Woodpile', size: [2, 2], level: [14, 14], pool: [['sawfish', 3], ['hammerpecker', 2]] },
      { name: 'The Workbench', size: [2, 2], level: [14, 15], pool: [['hammerpecker', 3], ['tapelizard', 2], ['sawfish', 1]] },
      { name: 'The Paint Shelf', size: [2, 3], level: [15, 15], pool: [['brushfox', 3], ['tapelizard', 2], ['bulbmoth', 1]] },
      { name: 'The Pegboard', size: [3, 3], level: [15, 15], pool: [['bulbmoth', 3], ['brushfox', 2], ['tapelizard', 2]] },
      { name: 'The Mower Bay', boss: 'boss_mower', bossLevel: 16, size: [1, 1], level: [14, 14], pool: [['hammerpecker', 2], ['sawfish', 2]] },
    ],
  },
  {
    id: 'mending', name: 'The Mending Room', bg: 'bg_mending', tint: '#d9a5c8', element: 'fluff', chapter: 2,
    blurb: 'A sewing room where something has been stitching all night, and has started on the door.',
    path: [
      { name: 'The Scrap Basket', size: [2, 2], level: [15, 15], pool: [['thimblemouse', 3], ['lacespider', 2]] },
      { name: 'The Button Jar', size: [2, 2], level: [15, 16], pool: [['buttonowl', 3], ['thimblemouse', 2], ['pinpuffer', 1]] },
      { name: 'The Cutting Table', size: [2, 3], level: [16, 16], pool: [['scissorstork', 3], ['buttonowl', 2], ['lacespider', 1]] },
      { name: 'The Dress Form', size: [3, 3], level: [16, 16], pool: [['pinpuffer', 3], ['scissorstork', 2], ['lacespider', 2]] },
      { name: 'The Machine', boss: 'boss_treadle', bossLevel: 17, size: [1, 2], level: [14, 14], pool: [['thimblemouse', 2], ['pinpuffer', 2]] },
    ],
  },
];
export const ROOM_IDS = ROOMS.map((room) => room.id);
// The free sample (the copy on the web) holds this many places, from the first, and no more: see sample.js.
export const SAMPLE = { places: 2 };
export const roomOf = (id) => ROOMS.find((room) => room.id === id) || null;
/** A room can be walked into once it is built and the room before it has been cleared. */
export const roomBuilt = (room) => Array.isArray(room.path) && room.path.length > 0;
