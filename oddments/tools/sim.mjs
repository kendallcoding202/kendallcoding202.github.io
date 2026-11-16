// Plays the first room many times with a stand-in player and reports two
// things: how long fights last, and how hard the room is.
//   node tools/sim.mjs [players=400] [--style=friendly|brawler|careless] [--visits=4]
// friendly  a sensible player who also calms kinds they do not have yet
// brawler   a sensible player who never reaches out
// careless  taps any move at random and never makes a Call
import { Game } from '../web/js/core/game.js';
import { newState } from '../web/js/core/state.js';
import { ROOMS, HEIRLOOM } from '../web/js/core/balance.js';
import { playOut } from '../web/js/core/auto.js';

// Rough seconds of real time: a choice takes a moment's thought and every
// action plays a short animation.
const SECONDS = { choice: 3.2, action: 1.3, call: 1.6 };

const STYLES = {
  friendly: (state) => ({ befriend: true, have: state.friends.map((f) => f.species), heirlooms: state.friends.filter((f) => f.heirloom).map((f) => f.species) }),
  brawler: () => ({}),
  careless: () => ({ careless: true }),
};

/** One visit to a room, from walking in to going home. Returns a record per fight. */
export function playVisit(game, style, roomId = ROOMS[0].id) {
  const fights = [];
  if (!game.travelTo(roomId)) return fights;
  while (game.place() === 'path') {
    const stop = game.state.visit.stop;
    const battle = game.startEncounter();
    const heirloom = battle.units.some((unit) => unit.side === 'foe' && unit.heirloom);
    playOut(battle, STYLES[style](game.state));
    const allies = battle.units.filter((unit) => unit.side === 'ally');
    const left = allies.reduce((sum, unit) => sum + unit.hp, 0) / allies.reduce((sum, unit) => sum + unit.maxHp, 0);
    const { allyTurns, foeTurns, calls, downs } = battle.tally;
    const result = game.finishBattle();
    fights.push({
      stop, won: result.won, cleared: result.cleared, rounds: battle.round, choices: allyTurns + calls, downs, left, heirloom,
      seconds: allyTurns * (SECONDS.choice + SECONDS.action) + foeTurns * SECONDS.action + calls * SECONDS.call,
      joined: result.joined.length,
    });
  }
  return fights;
}

/** One player from a new game through `visits` visits to the first room. */
export function playPlayer({ seed, visits = 4, style = 'friendly' }) {
  const start = 1_800_000_000_000;
  const state = newState(start, seed);
  state.started = true;
  const game = new Game(state, { now: start, fx: false });
  const record = [];
  for (let v = 0; v < visits; v++) {
    const fights = playVisit(game, style);
    record.push({
      fights, cleared: fights.some((f) => f.cleared),
      level: Math.max(...game.team().map((f) => f.level)), friends: state.friends.length,
    });
  }
  return { state, visits: record };
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const at = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Plays `players` players and gathers the numbers the report prints. */
export function simulate({ players = 400, visits = 4, style = 'friendly' } = {}) {
  const all = Array.from({ length: players }, (_, i) => playPlayer({ seed: 1000 + i * 7919, visits, style }));
  const room = ROOMS[0];

  // How long fights last: every fight of every player's first visit, by stop.
  const stops = room.path.map((spot, stop) => {
    const fights = all.map((p) => p.visits[0].fights.find((f) => f.stop === stop)).filter(Boolean);
    const rounds = fights.map((f) => f.rounds).sort((a, b) => a - b);
    return {
      stop, name: spot.name, boss: !!spot.boss, reached: fights.length / players,
      won: mean(fights.map((f) => (f.won ? 1 : 0))),
      rounds: mean(rounds), roundsLow: at(rounds, 0.1) || 0, roundsHigh: at(rounds, 0.9) || 0,
      choices: mean(fights.map((f) => f.choices)), seconds: mean(fights.map((f) => f.seconds)),
      left: mean(fights.filter((f) => f.won).map((f) => f.left)), downs: mean(fights.map((f) => f.downs)),
    };
  });

  // How hard the room is: the share of players who have cleared it by each visit.
  let done = new Array(players).fill(false);
  const byVisit = [];
  for (let v = 0; v < visits; v++) {
    done = done.map((d, i) => d || all[i].visits[v].cleared);
    byVisit.push({
      visit: v + 1, clearedThisVisit: mean(all.map((p) => (p.visits[v].cleared ? 1 : 0))), clearedByNow: mean(done.map((d) => (d ? 1 : 0))),
      level: mean(all.map((p) => p.visits[v].level)), friends: mean(all.map((p) => p.visits[v].friends)),
      minutes: mean(all.map((p) => p.visits[v].fights.reduce((sum, f) => sum + f.seconds, 0))) / 60,
    });
  }
  const firstLoss = room.path.map((spot, stop) => mean(all.map((p) => (p.visits[0].fights.some((f) => f.stop === stop && !f.won) ? 1 : 0))));
  const fights = all.reduce((sum, p) => sum + p.visits.reduce((n, v) => n + v.fights.length, 0), 0);
  const heirloomFights = all.reduce((sum, p) => sum + p.visits.reduce((n, v) => n + v.fights.filter((f) => f.heirloom).length, 0), 0);
  return { players, visits, style, stops, byVisit, firstLoss, heirloomFightShare: heirloomFights / fights, heirloomsKept: mean(all.map((p) => p.state.stats.heirlooms)) };
}

const pc = (v) => `${Math.round(v * 100)}%`.padStart(4);

export function report(result) {
  const lines = [];
  const room = ROOMS[0];
  lines.push(`${room.name}: ${result.players} ${result.style} players, ${result.visits} visits each`);
  lines.push('');
  lines.push('How long fights last (first visit)');
  lines.push('stop                    reached   won   rounds (10%-90%)   choices   about    Health left   knocked out');
  for (const s of result.stops) {
    lines.push(`${(s.stop + 1 + ' ' + s.name + (s.boss ? ' *' : '')).padEnd(22)}   ${pc(s.reached)}   ${pc(s.won)}   ${s.rounds.toFixed(1).padStart(4)}  (${s.roundsLow}-${s.roundsHigh})`.padEnd(60)
      + `${s.choices.toFixed(1).padStart(5)}   ${String(Math.round(s.seconds)).padStart(4)}s      ${pc(s.left)}          ${s.downs.toFixed(2)}`);
  }
  lines.push('* boss');
  lines.push('');
  lines.push('How hard the room is');
  lines.push('visit   cleared this visit   cleared by now   top level   friends   minutes played');
  for (const v of result.byVisit) {
    lines.push(`${String(v.visit).padStart(3)}     ${pc(v.clearedThisVisit).padStart(8)}             ${pc(v.clearedByNow).padStart(6)}          ${v.level.toFixed(1).padStart(4)}       ${v.friends.toFixed(1).padStart(4)}      ${v.minutes.toFixed(1).padStart(5)}`);
  }
  const worst = result.firstLoss.indexOf(Math.max(...result.firstLoss));
  lines.push('');
  lines.push(`First visits that end in a loss, by stop: ${result.firstLoss.map((share, stop) => `${stop + 1}: ${pc(share).trim()}`).join('   ')}`);
  lines.push(`Most first visits that fail, fail at stop ${worst + 1} (${room.path[worst].name}).`);
  lines.push(`Heirlooms: 1 in ${Math.round(1 / HEIRLOOM.odds)} restless Oddkin; one turned up in ${(result.heirloomFightShare * 100).toFixed(1)}% of fights; kept per player after ${result.visits} visits: ${result.heirloomsKept.toFixed(2)}.`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
  const players = Number(args.find((a) => !a.startsWith('--'))) || 400;
  const style = option('style', 'friendly');
  if (!STYLES[style]) { console.error(`unknown style "${style}": friendly, brawler or careless`); process.exit(1); }
  console.log(report(simulate({ players, visits: Number(option('visits', 4)), style })));
}
