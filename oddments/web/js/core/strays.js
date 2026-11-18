// Strays: lost Clutterkin out on the lane itself, between places. They are
// there to be met if you want them: for the practice, for a kind you missed,
// for the chance of an Heirloom. Nobody has to. Rules only: no DOM, no clock,
// no storage.
//
// A few turn up each time you set out rested, each small group at one of the
// world's quiet spots (`WILDS`), and stay where they are until you next rest.
// They do not hold their ground (you can walk past, or through), and are met
// only by walking right up to them.
//
// They are whoever lives in the places that are open to you, at about the
// strength of the furthest of those: so they are worth meeting however far
// you have got, and never a kind from somewhere you have not yet reached.
//
// Out on the lane with no visit on, how worn the team is has to be kept
// somewhere: `state.worn` (friend id to Health), null when rested. Stepping
// into a place carries it in; resting at home clears it. See rooms.js.
import { SPECIES, SPECIES_IDS, ROOMS, HEIRLOOM, STRAYS, KEEPSAKE, BREATHER, TEAM_SIZE, roomBuilt, grownOdds } from './balance.js';
import { nextRandom, rollInt, rollPick, own } from './util.js';
import { WILDS, HAUNTS, overTheWater } from './world.js';
import { roomOpen, bridgeOpen, maxHpOf, teamOf } from './rooms.js';

/** Strays have dice of their own, so that who wanders the lane never changes how a fight in a place falls out. */
const diceOf = (state) => ({ rng: state.strayRng | 0 });

// ---------------------------------------------------------------- the Keepsakes
//
// One of a kind, one to a chapter. A Keepsake is not a stray, but it is met the way one is: out in
// the open, at a spot you walk up to, in a fight of its own, and it is gone until you next rest. So
// it is kept in the same list, marked with its chapter (`keep`), and stands at its own haunt.

/** The Keepsakes: [{ species, chapter, level }]. */
export const KEEPSAKES = SPECIES_IDS.filter((id) => SPECIES[id].keepsake).map((id) => ({ species: id, ...SPECIES[id].keepsake }));
/** Whether every place of a chapter is calm. */
export const chapterCalm = (state, chapter) => ROOMS.filter((room) => (room.chapter || 1) === chapter).every((room) => state.rooms[room.id].clears > 0);
/**
 * Whether a chapter's Keepsake may be standing at its haunt, in these colours: its chapter is calm, and
 * it is not your friend yet; or it is, and this is it in the rare colours yours has not got.
 */
export function keepsakeMayBeOut(state, keep, heirloom) {
  if (!chapterCalm(state, keep.chapter)) return false;
  const mine = state.friends.find((friend) => friend.species === keep.species);
  return !mine || (!mine.heirloom && heirloom === true);
}
/** Whether an entry of the list is a Keepsake as it may fairly be: the right one, alone, at its own level. */
export function fairKeepsake(state, stray) {
  const keep = KEEPSAKES.find((one) => one.chapter === stray.keep);
  if (!keep || !Array.isArray(stray.foes) || stray.foes.length !== 1) return false;
  const foe = stray.foes[0];
  return !!foe && typeof foe === 'object' && foe.species === keep.species && foe.level === keep.level && typeof foe.heirloom === 'boolean'
    && foe.grown === undefined && keepsakeMayBeOut(state, keep, foe.heirloom);
}
/** Whether an entry of the list, strays or a Keepsake, is fair as things stand. */
export const fairGroup = (state, stray) => !!stray && (stray.keep ? fairKeepsake(state, stray) : fairStrays(state, stray.foes));
/** The Keepsake that is out just now and not yet met this outing ({ index, keep, species, heirloom }), or null. */
export function keepsakeOut(state) {
  const index = state.strays.findIndex((stray) => stray.keep && !stray.done);
  return index < 0 ? null : { index, keep: state.strays[index].keep, species: state.strays[index].foes[0].species, heirloom: state.strays[index].foes[0].heirloom };
}

/** The furthest place that is open: it sets how strong strays are. */
export function frontier(state) {
  let last = ROOMS[0];
  for (const room of ROOMS) if (roomBuilt(room) && roomOpen(state, room.id)) last = room;
  return last;
}

/** How strong strays are just now, as [lowest level, highest]: as whoever waits at the first two stops of the furthest place open. */
export function strayLevels(state) {
  const path = frontier(state).path;
  return [path[0].level[0], Math.max(path[0].level[1], path[1].level[1])];
}

/** Who may be a stray, as [kind, weight]: every kind that lives in a place that is open, ringleaders apart. */
export function strayPool(state) {
  const weights = new Map();
  for (const room of ROOMS) {
    if (!roomBuilt(room) || !roomOpen(state, room.id)) continue;
    for (const spot of room.path) for (const [kind, weight] of spot.pool) weights.set(kind, (weights.get(kind) || 0) + weight);
  }
  return [...weights];
}

/**
 * Who is out on the lane this time: a few small groups, each at a spot of its own. Called when a
 * game begins and each time everyone is rested. Returns the list it has put in the save.
 */
export function rollStrays(state) {
  const dice = diceOf(state);
  const pool = strayPool(state);
  const [low, high] = strayLevels(state);
  const grownShare = grownOdds(frontier(state)); // as many of them grown as in the furthest place open
  // Nobody strays where you cannot go: the quiet spots over the water are used once the bridge is open,
  // and then there are a couple more groups about, for there is more world to be about in.
  const far = bridgeOpen(state);
  const spots = WILDS.map((_, index) => index).filter((index) => far || !overTheWater(WILDS[index]));
  const [fewest, most] = far ? STRAYS.farGroups : STRAYS.groups;
  const count = Math.min(spots.length, rollInt(dice, fewest, most));
  const strays = [];
  for (let i = 0; i < count; i++) {
    const at = spots.splice(Math.floor(nextRandom(dice) * spots.length), 1)[0];
    const foes = [];
    const size = rollInt(dice, STRAYS.size[0], STRAYS.size[1]);
    for (let n = 0; n < size; n++) {
      const [species] = rollPick(dice, pool, ([, weight]) => weight);
      const level = rollInt(dice, low, high);
      const heirloom = SPECIES[species].huff > 0 && nextRandom(dice) < HEIRLOOM.odds;
      const grown = grownShare > 0 && !!SPECIES[species].grown && nextRandom(dice) < grownShare;
      foes.push(grown ? { species, level, heirloom, grown: true } : { species, level, heirloom });
    }
    strays.push({ at, foes, done: false });
  }
  // And the Keepsake of any chapter that is calm. (No dice are thrown for one until then, so who strays
  // on the way there is as it always was.)
  for (const keep of KEEPSAKES) {
    if (!chapterCalm(state, keep.chapter)) continue;
    const mine = state.friends.find((friend) => friend.species === keep.species);
    const roll = nextRandom(dice);
    const heirloom = roll < (mine ? KEEPSAKE.again : HEIRLOOM.calmOdds);
    if (mine && (mine.heirloom || !heirloom)) continue;
    strays.push({ at: -1, keep: keep.chapter, foes: [{ species: keep.species, level: keep.level, heirloom }], done: false });
  }
  state.strayRng = dice.rng;
  state.strays = strays;
  return strays;
}

/**
 * Whether a list is a fair group of strays as things stand: the right number of them, each a kind
 * that lives somewhere open to you (never a ringleader), no stronger than strays can be. A save
 * cannot put something soft, or something from further on, out on the lane.
 */
export function fairStrays(state, foes) {
  if (!Array.isArray(foes) || foes.length < STRAYS.size[0] || foes.length > Math.min(STRAYS.size[1], TEAM_SIZE)) return false;
  const kinds = new Set(strayPool(state).map(([kind]) => kind));
  const high = strayLevels(state)[1];
  return foes.every((foe) => !!foe && typeof foe === 'object' && own(SPECIES, foe.species) && kinds.has(foe.species) && !SPECIES[foe.species].boss
    && Number.isInteger(foe.level) && foe.level >= 1 && foe.level <= high && typeof foe.heirloom === 'boolean'
    && (foe.grown === undefined || (foe.grown === true && !!SPECIES[foe.species].grown && grownOdds(frontier(state)) > 0)));
}

/** Whoever is still out on the lane: [{ index, x, y, foes }], for the screen and for finding the way round them. */
export function straysAbout(state) {
  const about = [];
  state.strays.forEach((stray, index) => {
    if (stray.done) return;
    const at = stray.keep ? HAUNTS[stray.keep] : WILDS[stray.at];
    about.push(stray.keep ? { index, x: at.x, y: at.y, foes: stray.foes, keep: stray.keep } : { index, x: at.x, y: at.y, foes: stray.foes });
  });
  return about;
}

/** The strays you have walked right up to (their number in the save's list), or -1. */
export function strayNear(state, pos) {
  if (!pos) return -1;
  for (const stray of straysAbout(state)) if (Math.hypot(pos.x - stray.x, pos.y - stray.y) <= STRAYS.meet) return stray.index;
  return -1;
}

/**
 * Moves things on after a fight with a group of strays. `left` maps friend id to the Health it
 * finished with. A win and they are gone until you next rest, and everyone takes a breather; a
 * loss and you are carried home, which ends a visit too, as a loss anywhere does.
 * Returns { home }.
 */
export function afterStrays(state, index, won, left) {
  if (won) state.strays[index].done = true;
  return afterOpen(state, won, left);
}

/**
 * The same for any fight out in the open (strays, or a bout with somebody who was waiting by the
 * road): a win and everyone takes a breather where they stand; a loss and you are carried home.
 * Returns { home }.
 */
export function afterOpen(state, won, left) {
  if (!won) {
    state.visit = null;
    state.worn = null;
    return { home: true };
  }
  // On a visit, the visit keeps how everyone is. Out on the lane with none on, the save does.
  const health = state.visit ? state.visit.hp : (state.worn = state.worn || {});
  for (const friend of teamOf(state)) {
    const max = maxHpOf(friend);
    health[friend.id] = Math.min(max, Math.max(0, left[friend.id] || 0) + Math.ceil(max * BREATHER));
  }
  return { home: false };
}
