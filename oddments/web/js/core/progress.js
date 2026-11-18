// What a fight leaves behind: experience, levels, new moves, and new friends.
// Rules only: no DOM, no clock, no storage.
import { SPECIES, MAX_LEVEL, ROSTER_MAX, BENCH_SHARE, LONE_SHARE, xpNeeded, xpFor, movesLearnedAt } from './balance.js';

export const newFriend = (id, species, level, heirloom = false) => ({ id, species, level, xp: 0, heirloom: !!heirloom });

/**
 * Adds experience to a friend. Returns the levels gained, the moves learned on the way, and
 * whether it grew up: a friend grows into its kind's grown form on gaining a level that takes it
 * to the level its kind grows at, or past it (so one that came home already past that level
 * grows at its next).
 */
export function gainXp(friend, amount) {
  const gained = { levels: 0, learned: [], grew: false };
  if (!(amount > 0) || friend.level >= MAX_LEVEL) return gained;
  friend.xp += Math.floor(amount);
  while (friend.level < MAX_LEVEL && friend.xp >= xpNeeded(friend.level)) {
    friend.xp -= xpNeeded(friend.level);
    friend.level++;
    gained.levels++;
    gained.learned.push(...movesLearnedAt(friend.species, friend.level));
  }
  if (friend.level >= MAX_LEVEL) friend.xp = 0;
  const form = SPECIES[friend.species].grown;
  if (gained.levels > 0 && form && !friend.grown && friend.level >= form.at) { friend.grown = true; gained.grew = true; }
  return gained;
}

/**
 * Banks a finished fight into the save and says what happened.
 *
 * Experience is paid for every restless Clutterkin knocked down, win or lose,
 * and for every one calmed if the fight was won: the team in full, friends
 * at home a share. A calmed Clutterkin comes home only from a fight that was
 * won. A grown one is worth more than a young one, and comes home grown.
 * A fight teaches by its size: each of them is worth something, and one
 * met on its own is worth only a share of that (`lone` in the summary says
 * so). There is one friend of each kind: calming a kind you already have
 * sends it off happy and gives your friend of that kind the experience
 * (and, if the visitor was an Heirloom, its colours).
 */
export function settleUp(state, battle) {
  const won = battle.phase === 'won';
  const foes = battle.units.filter((unit) => unit.side === 'foe');
  const summary = { won, xp: 0, lone: foes.length === 1 && !SPECIES[foes[0].species].boss && !SPECIES[foes[0].species].keepsake, gains: [], joined: [], visited: [], heirlooms: [] };

  for (const foe of foes) if (foe.hp <= 0 || (won && foe.settled)) summary.xp += xpFor(foe.species, foe.level, foe.grown);
  if (summary.lone) summary.xp = Math.round(summary.xp * LONE_SHARE);
  for (const friend of state.friends) {
    const onTeam = state.team.includes(friend.id);
    const before = friend.level;
    const { levels, learned, grew } = gainXp(friend, onTeam ? summary.xp : summary.xp * BENCH_SHARE);
    if (onTeam || levels) summary.gains.push({ id: friend.id, species: friend.species, team: onTeam, from: before, to: friend.level, learned, grew });
  }

  if (won) {
    for (const foe of foes.filter((unit) => unit.settled)) {
      const mine = state.friends.find((friend) => friend.species === foe.species);
      if (!mine) {
        if (state.friends.length >= ROSTER_MAX || SPECIES[foe.species].boss) continue;
        const friend = newFriend(state.nextFriendId++, foe.species, foe.level, foe.heirloom);
        // One that was grown when you reached it comes home grown.
        if (foe.grown) { friend.grown = true; state.book[foe.species].grown = true; }
        state.friends.push(friend);
        summary.joined.push({ id: friend.id, species: friend.species, level: friend.level, heirloom: friend.heirloom, grown: !!friend.grown });
        state.stats.befriended++;
        if (friend.heirloom) state.stats.heirlooms++;
      } else {
        // What the visitor teaches may be the level that does it: the news must say so too.
        const before = mine.level;
        const more = gainXp(mine, xpFor(foe.species, foe.level, foe.grown));
        if (more.levels) {
          let gain = summary.gains.find((each) => each.id === mine.id);
          if (!gain) summary.gains.push(gain = { id: mine.id, species: mine.species, team: state.team.includes(mine.id), from: before, to: mine.level, learned: [], grew: false });
          gain.to = mine.level;
          gain.learned.push(...more.learned);
          gain.grew = gain.grew || more.grew;
        }
        summary.visited.push(foe.species);
        if (foe.heirloom && !mine.heirloom) {
          mine.heirloom = true;
          summary.heirlooms.push(foe.species);
          state.stats.heirlooms++;
        }
      }
    }
  }

  // The scrapbook keeps which kinds you have seen grown up.
  for (const gain of summary.gains) if (gain.grew) state.book[gain.species].grown = true;

  state.stats.battles++;
  state.stats[won ? 'wins' : 'losses']++;
  state.stats.rounds += battle.round;
  state.stats.knockouts += battle.tally.downs;
  return summary;
}
