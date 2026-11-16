// What a fight leaves behind: experience, levels, new moves, and new friends.
// Rules only: no DOM, no clock, no storage.
import { SPECIES, MAX_LEVEL, ROSTER_MAX, BENCH_SHARE, xpNeeded, xpFor, movesLearnedAt } from './balance.js';

export const newFriend = (id, species, level, heirloom = false) => ({ id, species, level, xp: 0, heirloom: !!heirloom });

/** Adds experience to a friend. Returns the levels gained and the moves learned on the way. */
export function gainXp(friend, amount) {
  const gained = { levels: 0, learned: [] };
  if (!(amount > 0) || friend.level >= MAX_LEVEL) return gained;
  friend.xp += Math.floor(amount);
  while (friend.level < MAX_LEVEL && friend.xp >= xpNeeded(friend.level)) {
    friend.xp -= xpNeeded(friend.level);
    friend.level++;
    gained.levels++;
    gained.learned.push(...movesLearnedAt(friend.species, friend.level));
  }
  if (friend.level >= MAX_LEVEL) friend.xp = 0;
  return gained;
}

/**
 * Banks a finished fight into the save and says what happened.
 *
 * Experience is paid for every restless Oddkin knocked down, win or lose,
 * and for every one calmed if the fight was won: the team in full, friends
 * at home a share. A calmed Oddkin comes home only from a fight that was
 * won. There is one friend of each kind: calming a kind you already have
 * sends it off happy and gives your friend of that kind the experience
 * (and, if the visitor was an Heirloom, its colours).
 */
export function settleUp(state, battle) {
  const won = battle.phase === 'won';
  const foes = battle.units.filter((unit) => unit.side === 'foe');
  const summary = { won, xp: 0, gains: [], joined: [], visited: [], heirlooms: [] };

  for (const foe of foes) if (foe.hp <= 0 || (won && foe.settled)) summary.xp += xpFor(foe.species, foe.level);
  for (const friend of state.friends) {
    const onTeam = state.team.includes(friend.id);
    const before = friend.level;
    const { levels, learned } = gainXp(friend, onTeam ? summary.xp : summary.xp * BENCH_SHARE);
    if (onTeam || levels) summary.gains.push({ id: friend.id, species: friend.species, team: onTeam, from: before, to: friend.level, learned });
  }

  if (won) {
    for (const foe of foes.filter((unit) => unit.settled)) {
      const mine = state.friends.find((friend) => friend.species === foe.species);
      if (!mine) {
        if (state.friends.length >= ROSTER_MAX || SPECIES[foe.species].boss) continue;
        const friend = newFriend(state.nextFriendId++, foe.species, foe.level, foe.heirloom);
        state.friends.push(friend);
        summary.joined.push({ id: friend.id, species: friend.species, level: friend.level, heirloom: friend.heirloom });
        state.stats.befriended++;
        if (friend.heirloom) state.stats.heirlooms++;
      } else {
        gainXp(mine, xpFor(foe.species, foe.level));
        summary.visited.push(foe.species);
        if (foe.heirloom && !mine.heirloom) {
          mine.heirloom = true;
          summary.heirlooms.push(foe.species);
          state.stats.heirlooms++;
        }
      }
    }
  }

  state.stats.battles++;
  state.stats[won ? 'wins' : 'losses']++;
  state.stats.rounds += battle.round;
  state.stats.knockouts += battle.tally.downs;
  return summary;
}
