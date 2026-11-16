// A dress rehearsal for a save. reviveState makes a save well-formed; this
// proves it can actually be played, by walking a copy of it into a room and
// through a fight and touching what the screens read. It is run on a save
// before the game starts with it, so a save that would break the game is
// found here, on a copy, and never by the player.
import { ROOMS, SPECIES } from './balance.js';
import { Game } from './game.js';
import { playOut } from './auto.js';

export function playable(state, now = Date.now()) {
  try {
    const game = new Game(JSON.parse(JSON.stringify(state)), { now, fx: false });
    game.state.started = true;
    if (game.team().length === 0) return false;
    for (const friend of game.state.friends) if (!SPECIES[friend.species].name) return false;
    game.teamHealth();
    for (let fights = 0; fights < 2; fights++) {
      if (game.place() === 'lane' && !game.travelTo(ROOMS[0].id)) return false;
      if (!game.startEncounter()) return false;
      if (game.battle.phase === 'fight' && !game.choices()) return false;
      playOut(game.battle, { befriend: true, have: game.state.friends.map((friend) => friend.species) });
      if (!game.finishBattle()) return false;
    }
    return typeof game.serialize(now) === 'string';
  } catch {
    return false;
  }
}
