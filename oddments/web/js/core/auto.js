// A stand-in player: given a fight, says what to do next. The simulator
// plays whole rooms with it, and a save is rehearsed with it before the game
// trusts it (trial.js). It is deliberately plain: roughly what a sensible
// person does without thinking very hard.
//
//   careless  picks any allowed move at random and never makes a Call
//   befriend  tries to calm kinds not in `have` (one at a time)
import { moveOf, BRACE } from './balance.js';
import { choices, act, alliesOf, foesOf, damageOf, reachAmount } from './battle.js';
import { nextRandom, rollPick } from './util.js';

const share = (unit) => unit.hp / unit.maxHp;
const lowest = (units) => units.slice().sort((a, b) => share(a) - share(b))[0];

/** The one restless Oddkin worth calming right now, or null. */
function wanted(battle, { befriend = false, have = [], heirlooms = [] }) {
  if (!befriend) return null;
  const allies = alliesOf(battle);
  const healthy = allies.reduce((sum, ally) => sum + share(ally), 0) / 3 > 0.45;
  const settled = battle.units.filter((unit) => unit.settled).map((unit) => unit.species);
  const fresh = foesOf(battle).filter((foe) => foe.maxHuff > 0 && !settled.includes(foe.species)
    && (!have.includes(foe.species) || (foe.heirloom && !heirlooms.includes(foe.species))));
  // Carry on with one already started; only start a new one while the team is in good shape.
  const started = fresh.filter((foe) => foe.huff < foe.maxHuff);
  if (started.length) return started.sort((a, b) => a.huff - b.huff)[0];
  const rare = fresh.find((foe) => foe.heirloom);
  if (rare) return rare; // worth it even when the team is tired
  if (!healthy) return null;
  // An Heirloom first, as anyone would; then whoever takes the fewest goes.
  const goes = (foe) => Math.ceil(foe.huff / reachAmount(battle, foe)) - (foe.heirloom ? 100 : 0);
  return fresh.sort((a, b) => goes(a) - goes(b))[0] || null;
}

/** The next action to pass to `act`, or null when the fight is over. */
export function suggest(battle, style = {}) {
  const options = choices(battle);
  if (!options) return null;
  const { unit } = options;
  const ready = options.moves.filter((m) => m.ready);

  if (style.careless) {
    const pick = rollPick(battle.dice, ready);
    return { type: 'move', id: pick.id, target: pick.targets ? pick.targets[Math.floor(nextRandom(battle.dice) * pick.targets.length)] : undefined };
  }

  const allies = alliesOf(battle);
  const foes = foesOf(battle);
  const pet = wanted(battle, style);

  // The house-sitter's Call first: patch up whoever is in trouble, else keep
  // calming, else cheer on whoever is about to hit.
  const call = (id) => options.calls.find((c) => c.id === id);
  if (!battle.called) {
    const weakest = lowest(allies);
    if (share(weakest) < 0.5 && call('patch').targets.includes(weakest.key)) return { type: 'call', id: 'patch', target: weakest.key };
    if (pet && call('reach').targets.includes(pet.key)) return { type: 'call', id: 'reach', target: pet.key };
  }

  // Mend a friend who needs it.
  for (const option of ready) {
    const move = moveOf(option.id);
    if (!move.mend) continue;
    const group = move.aim === 'self' ? [unit] : allies;
    const worst = lowest(group);
    if (share(worst) < (move.aim === 'allies' ? 0.6 : 0.5)) return { type: 'move', id: option.id, target: worst.key };
  }

  // Otherwise hit: whatever does the most, with a knock-out worth extra, and
  // never the one being calmed.
  const fair = foes.filter((foe) => foe !== pet);
  let best = null;
  for (const option of ready) {
    const move = moveOf(option.id);
    if (!move.power) continue;
    if (move.aim === 'foes') {
      if (pet) continue; // a sweep would hit it too
      const score = foes.reduce((sum, foe) => sum + worth(unit, foe, move), 0);
      if (!best || score > best.score) best = { score, action: { type: 'move', id: option.id } };
    } else {
      for (const foe of fair) {
        const score = worth(unit, foe, move);
        if (!best || score > best.score) best = { score, action: { type: 'move', id: option.id, target: foe.key } };
      }
    }
  }
  if (best) {
    if (!battle.called && call('cheer').targets.includes(unit.key)) return { type: 'call', id: 'cheer', target: unit.key };
    return best.action;
  }

  // Nothing to hit but the one being calmed: dig in.
  const boost = ready.find((m) => moveOf(m.id).boost && m.id !== BRACE.id && !unit.mods.some((mod) => mod.by > 0));
  if (boost) return { type: 'move', id: boost.id, target: unit.key };
  return { type: 'move', id: BRACE.id };
}

// How much a hit is worth: the damage that is not wasted, and a bonus for finishing something off.
function worth(unit, foe, move) {
  const dmg = damageOf(unit, foe, move);
  return Math.min(dmg, foe.hp) + (dmg >= foe.hp ? 12 : 0);
}

/** Plays a fight to its end with `suggest`. Returns the fight. */
export function playOut(battle, style) {
  for (let guard = 0; guard < 5000 && battle.phase === 'fight'; guard++) {
    if (!act(battle, suggest(battle, style))) break;
  }
  return battle;
}
