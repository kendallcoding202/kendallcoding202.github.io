// The fight: three against three, one actor at a time. Rules only: no DOM,
// no clock, no storage. All chance comes from the seeded generator handed in
// as `dice` (anything with an integer `rng`), so the same seed and the same
// choices always give the same fight.
//
// A round: everyone standing acts once, fastest first; a boss acts again at
// the end. A friend's turn waits for a choice (see `choices` and `act`); a
// restless Oddment chooses for itself. Once a round the house-sitter may
// make one Call, during any friend's turn, without using that turn up.
import {
  SPECIES, CALLS, CALL_IDS, REACH, HEIRLOOM, BRACE, WOBBLE, MAX_ROUNDS, TEAM_SIZE,
  statAt, movesAt, moveOf, elementEdge, elementMult, softSpotOf,
} from './balance.js';
import { nextRandom, rollPick, clamp } from './util.js';

// ---------------------------------------------------------------- fighters

/** One Oddment as it stands in a fight. `side` is 'ally' or 'foe'. */
export function makeFighter(side, slot, { species, level, hp, friendId = 0, heirloom = false }) {
  const kind = SPECIES[species];
  const maxHp = statAt(kind.hp, level);
  const huff = side === 'foe' && kind.huff > 0 ? kind.huff + (heirloom ? HEIRLOOM.huff : 0) : 0;
  return {
    key: `${side === 'ally' ? 'a' : 'f'}${slot}`, side, slot, species, friendId, heirloom: !!heirloom,
    name: kind.name, element: kind.element, level, boss: !!kind.boss, turns: kind.turns || 1,
    maxHp, hp: hp === undefined ? maxHp : clamp(Math.round(hp), 0, maxHp),
    oomph: statAt(kind.oomph, level), grit: statAt(kind.grit, level), pep: statAt(kind.pep, level),
    moves: movesAt(species, level).map((id) => ({ id, wait: 0 })),
    mods: [], // temporary changes to a stat: { stat, by, turns, fresh }
    huff, maxHuff: huff, // pips of temper left; 0 of 0 means it cannot be reached
    settled: false, // calmed: out of the fight, and coming home if it is won
  };
}

export const standing = (unit) => unit.hp > 0 && !unit.settled;
export const unitOf = (battle, key) => battle.units.find((unit) => unit.key === key) || null;
const sideOf = (battle, side) => battle.units.filter((unit) => unit.side === side && standing(unit));
export const alliesOf = (battle) => sideOf(battle, 'ally');
export const foesOf = (battle) => sideOf(battle, 'foe');

/**
 * A stat as it is right now. Nothing stacks: of several boosts to one stat
 * only the biggest counts, and of several saps only the worst.
 */
export function stat(unit, name) {
  let up = 0;
  let down = 0;
  for (const mod of unit.mods) {
    if (mod.stat !== name) continue;
    if (mod.by > up) up = mod.by;
    if (mod.by < down) down = mod.by;
  }
  return unit[name] * (1 + up) * (1 + down);
}

// The same boost (or sap) again starts its count afresh rather than adding to it.
function addMod(battle, unit, { stat: name, by, turns }, fresh) {
  unit.mods = unit.mods.filter((mod) => !(mod.stat === name && mod.by === by));
  unit.mods.push({ stat: name, by, turns, fresh });
  emit(battle, { t: 'mod', target: unit.key, stat: name, by, turns });
}

const emit = (battle, event) => { if (battle.events) battle.events.push(event); };

// ---------------------------------------------------------------- damage

/**
 * What a move does to a target. `roll` is 0..1 and sets the wobble; 0.5 is
 * the average. Oomph against Grit matters, but only within sensible bounds.
 */
export function damageOf(attacker, defender, move, roll = 0.5) {
  const oomph = stat(attacker, 'oomph');
  const grit = stat(defender, 'grit');
  const wobble = 1 - WOBBLE + 2 * WOBBLE * roll;
  return Math.max(1, Math.round(move.power * oomph * clamp(oomph / grit, 0.4, 2.5) * elementMult(move.element, defender.element) * wobble));
}

function strike(battle, attacker, target, move) {
  const dmg = damageOf(attacker, target, move, nextRandom(battle.dice));
  target.hp = Math.max(0, target.hp - dmg);
  emit(battle, { t: 'hit', who: attacker.key, target: target.key, dmg, edge: elementEdge(move.element, target.element), hp: target.hp, down: target.hp === 0 });
  if (target.hp === 0) {
    if (target.side === 'ally') battle.tally.downs++;
    return;
  }
  // You cannot calm what you are still hitting: every hit puts a pip back.
  if (attacker.side === 'ally' && target.maxHuff > 0 && target.huff < target.maxHuff) {
    target.huff = Math.min(target.maxHuff, target.huff + REACH.hitBack);
    emit(battle, { t: 'huff', target: target.key, huff: target.huff, by: REACH.hitBack });
  }
}

function heal(battle, target, amount) {
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + Math.max(0, Math.round(amount)));
  emit(battle, { t: 'mend', target: target.key, amount: target.hp - before, hp: target.hp });
}

// ---------------------------------------------------------------- moves

/** Who a move would land on, or null if `targetKey` is not a fair target for it. */
function targetsFor(battle, unit, move, targetKey) {
  const mine = sideOf(battle, unit.side);
  const theirs = sideOf(battle, unit.side === 'ally' ? 'foe' : 'ally');
  const one = (group) => { const target = group.find((u) => u.key === targetKey); return target ? [target] : null; };
  switch (move.aim) {
    case 'foe': return one(theirs);
    case 'foes': return theirs.length ? theirs : null;
    case 'ally': return one(mine);
    case 'allies': return mine;
    case 'self': return [unit];
    default: return null;
  }
}

function useMove(battle, unit, id, targets) {
  const move = moveOf(id);
  const slot = unit.moves.find((m) => m.id === id);
  // +1 because the wait is counted down at the start of each of its own turns, the next included.
  if (slot && move.wait > 0) slot.wait = move.wait + 1;
  emit(battle, { t: 'use', who: unit.key, move: id, targets: targets.map((target) => target.key) });
  for (const target of targets) {
    if (move.power) strike(battle, unit, target, move);
    if (move.sap && standing(target)) addMod(battle, target, { stat: move.sap.stat, by: -move.sap.by, turns: move.sap.turns }, false);
    if (move.mend) heal(battle, target, target.maxHp * move.mend);
    // A boost on itself starts counting after this turn, so "3 turns" covers three rounds of being hit.
    if (move.boost) addMod(battle, target, move.boost, target === unit);
  }
}

// ---------------------------------------------------------------- reaching out

/** How many pips Reach out would take off `target` right now. */
export function reachAmount(battle, target) {
  const soft = alliesOf(battle).some((ally) => ally.element === softSpotOf(target.element));
  return REACH.base + (soft ? REACH.soft : 0);
}

function reachOut(battle, target) {
  const by = Math.min(target.huff, reachAmount(battle, target));
  target.huff -= by;
  emit(battle, { t: 'huff', target: target.key, huff: target.huff, by: -by });
  if (target.huff === 0) {
    target.settled = true;
    target.mods = [];
    emit(battle, { t: 'settle', target: target.key });
  }
}

/** Whether the house-sitter can make this Call now, and on whom. */
function callTargets(battle, id) {
  if (battle.phase !== 'fight' || battle.called || battle.callWait[id] > 0) return [];
  if (id === 'reach') return foesOf(battle).filter((foe) => foe.maxHuff > 0);
  if (id === 'patch') return alliesOf(battle).filter((ally) => ally.hp < ally.maxHp);
  return alliesOf(battle);
}

function makeCall(battle, id, targetKey) {
  const call = CALLS[id];
  const target = call && callTargets(battle, id).find((unit) => unit.key === targetKey);
  if (!target) return false;
  battle.called = true;
  battle.callWait[id] = call.every;
  battle.tally.calls++;
  emit(battle, { t: 'call', call: id, target: target.key });
  if (id === 'reach') reachOut(battle, target);
  if (call.mend) heal(battle, target, target.maxHp * call.mend);
  if (call.boost) addMod(battle, target, call.boost, false);
  judge(battle);
  return true;
}

// ---------------------------------------------------------------- the round

function beginRound(battle) {
  if (battle.round >= MAX_ROUNDS) { finish(battle, 'lost', 'draw'); return; }
  battle.round++;
  battle.called = false;
  for (const id of CALL_IDS) if (battle.callWait[id] > 0) battle.callWait[id]--;
  // Fastest first; equal Pep is settled by the dice. A boss's extra turns come last.
  const entries = battle.units.filter(standing).map((unit) => ({ unit, pep: stat(unit, 'pep'), tie: nextRandom(battle.dice) }));
  entries.sort((a, b) => b.pep - a.pep || b.tie - a.tie);
  const order = entries.map((entry) => entry.unit.key);
  for (const { unit } of entries) for (let extra = 1; extra < unit.turns; extra++) order.push(unit.key);
  battle.order = order;
  battle.at = -1;
  emit(battle, { t: 'round', n: battle.round, order: [...order] });
}

function startTurn(battle, unit) {
  for (const slot of unit.moves) if (slot.wait > 0) slot.wait--;
  emit(battle, { t: 'turn', who: unit.key });
}

function endTurn(battle, unit) {
  unit.mods = unit.mods.filter((mod) => {
    if (mod.fresh) { mod.fresh = false; return true; }
    return --mod.turns > 0;
  });
  judge(battle);
}

function judge(battle) {
  if (battle.phase !== 'fight') return;
  if (foesOf(battle).length === 0) finish(battle, 'won', 'cleared');
  else if (alliesOf(battle).length === 0) finish(battle, 'lost', 'down');
}

function finish(battle, phase, why) {
  battle.phase = phase;
  emit(battle, { t: 'end', won: phase === 'won', why });
}

/** Runs the fight forward until a friend has to choose, or it is over. */
function advance(battle) {
  while (battle.phase === 'fight') {
    battle.at++;
    if (battle.at >= battle.order.length) { beginRound(battle); continue; }
    const unit = unitOf(battle, battle.order[battle.at]);
    if (!standing(unit)) continue;
    startTurn(battle, unit);
    if (unit.side === 'ally') return;
    foeTurn(battle, unit);
    battle.tally.foeTurns++;
    endTurn(battle, unit);
  }
}

// ---------------------------------------------------------------- the other side

// A restless Oddment's turn. Not clever: it mends when its side is hurting,
// sometimes braces itself or saps you, and otherwise hits, leaning toward
// its strong moves, the element it beats and whoever is nearly down.
function foeTurn(battle, unit) {
  const { dice } = battle;
  const ready = unit.moves.filter((slot) => slot.wait === 0).map((slot) => ({ id: slot.id, move: moveOf(slot.id) }));
  const mates = foesOf(battle);
  const targets = alliesOf(battle);
  const hurting = (u) => u.hp / u.maxHp < 0.5;

  const mend = ready.find((r) => r.move.mend);
  if (mend) {
    const group = mend.move.aim === 'self' ? [unit] : mates;
    const worst = group.filter(hurting).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (worst && nextRandom(dice) < 0.7) return useMove(battle, unit, mend.id, mend.move.aim === 'allies' ? mates : [worst]);
  }
  const boost = ready.find((r) => r.move.boost && !unit.mods.some((mod) => mod.stat === r.move.boost.stat && mod.by > 0));
  if (boost && nextRandom(dice) < 0.4) return useMove(battle, unit, boost.id, boost.move.aim === 'allies' ? mates : [unit]);
  const sap = ready.find((r) => r.move.kind === 'sap' && targets.some((t) => !t.mods.some((mod) => mod.stat === r.move.sap.stat && mod.by < 0)));
  if (sap && nextRandom(dice) < 0.4) return useMove(battle, unit, sap.id, sap.move.aim === 'foes' ? targets : [rollPick(dice, targets)]);

  const strikes = ready.filter((r) => r.move.power);
  const pick = rollPick(dice, strikes, (r) => r.move.power * r.move.power * (r.move.aim === 'foes' ? (targets.length > 1 ? 1.6 : 0.4) : 1));
  if (pick.move.aim === 'foes') return useMove(battle, unit, pick.id, targets);
  const target = rollPick(dice, targets, (t) => Math.max(0.3, 1 + 1.5 * elementEdge(pick.move.element, t.element)) + 1.5 * (1 - t.hp / t.maxHp));
  return useMove(battle, unit, pick.id, [target]);
}

// ---------------------------------------------------------------- the player's side

/**
 * Starts a fight. `allies` and `foes` are lists of { species, level, hp?,
 * friendId?, heirloom? }, at most three a side. `fx: false` skips recording
 * events (headless simulation).
 */
export function createBattle(dice, { allies, foes, fx = true }) {
  const battle = {
    dice,
    units: [
      ...allies.slice(0, TEAM_SIZE).map((spec, slot) => makeFighter('ally', slot, spec)),
      ...foes.slice(0, TEAM_SIZE).map((spec, slot) => makeFighter('foe', slot, spec)),
    ],
    round: 0,
    order: [],
    at: 0,
    phase: 'fight', // 'fight', then 'won' or 'lost'
    called: false, // has the house-sitter made this round's Call
    callWait: Object.fromEntries(CALL_IDS.map((id) => [id, 0])),
    events: fx ? [] : null,
    tally: { allyTurns: 0, foeTurns: 0, calls: 0, downs: 0 },
  };
  judge(battle); // a side with nobody standing has already lost
  if (battle.phase === 'fight') { beginRound(battle); advance(battle); }
  return battle;
}

/** The friend whose turn it is, or null when the fight is over. */
export const chooser = (battle) => (battle.phase === 'fight' ? unitOf(battle, battle.order[battle.at]) : null);

/**
 * Everything the player may do right now: the current friend's moves (each
 * with the turns it still has to wait and whom it may be aimed at) and the
 * house-sitter's Calls. Null when the fight is over.
 */
export function choices(battle) {
  const unit = chooser(battle);
  if (!unit) return null;
  const keys = (list) => (list || []).map((u) => u.key);
  const moves = [...unit.moves, { id: BRACE.id, wait: 0 }].map(({ id, wait }) => {
    const move = moveOf(id);
    const group = move.aim === 'foe' ? foesOf(battle) : move.aim === 'ally' ? alliesOf(battle) : null;
    return { id, wait, ready: wait === 0, aim: move.aim, targets: group ? keys(group) : null };
  });
  const calls = CALL_IDS.map((id) => {
    const targets = keys(callTargets(battle, id));
    return { id, wait: battle.callWait[id], used: battle.called, ready: targets.length > 0, targets };
  });
  return { unit, moves, calls };
}

/**
 * The player's choice: { type: 'move', id, target? } or { type: 'call', id,
 * target }. Returns false, changing nothing, if it is not allowed. A move
 * ends the turn and runs the fight on to the next choice; a Call does not.
 */
export function act(battle, action) {
  const unit = chooser(battle);
  if (!unit || !action || typeof action !== 'object') return false;
  if (action.type === 'call') return makeCall(battle, action.id, action.target);
  if (action.type !== 'move') return false;
  const slot = action.id === BRACE.id ? { wait: 0 } : unit.moves.find((m) => m.id === action.id);
  if (!slot || slot.wait > 0) return false;
  const targets = targetsFor(battle, unit, moveOf(action.id), action.target);
  if (!targets || targets.length === 0) return false;
  useMove(battle, unit, action.id, targets);
  battle.tally.allyTurns++;
  endTurn(battle, unit);
  advance(battle);
  return true;
}

/** Walking away. The fight counts as lost. */
export function concede(battle) {
  if (battle.phase !== 'fight') return false;
  finish(battle, 'lost', 'conceded');
  return true;
}
