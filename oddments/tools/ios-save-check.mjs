// Proves the iOS app's native save storage works, without tapping anything.
// Used by the "Oddments iOS" workflow in the Simulator:
//
//   node tools/ios-save-check.mjs seed                 prints a saved game as JSON
//   node tools/ios-save-check.mjs verify AFTER SEED    checks AFTER is that game, loaded by the app and saved back
//
// The workflow writes the seeded save into the app's native settings only
// (where the save is kept besides web storage), launches the app, lets it
// start, then reads the native settings back. If what is there is the seeded
// house-sitter with a fresh date on it, the app both loaded from and saved to
// native storage.
import { readFileSync } from 'node:fs';
import { newState, reviveState } from '../web/js/core/state.js';
import { newFriend } from '../web/js/core/progress.js';

const NAME = 'Saved';

if (process.argv[2] === 'seed') {
  const now = Date.now();
  const state = newState(now, 2024);
  // Dated a little ahead so it outranks whatever the first launch left in web storage. The game
  // never trusts a date in the future, so this is put right as it loads.
  Object.assign(state, { started: true, lastSeen: now + 300_000 });
  Object.assign(state.player, { name: NAME, look: 'sitter_c' });
  state.friends.push(newFriend(state.nextFriendId++, 'gnome', 4), newFriend(state.nextFriendId++, 'snailor', 3));
  state.book.gnome.met = true;
  state.book.snailor.met = true;
  Object.assign(state.stats, { battles: 12, wins: 9, befriended: 2 });
  if (!reviveState(JSON.parse(JSON.stringify(state)), now + 600_000)) throw new Error('the seeded save does not load');
  process.stdout.write(JSON.stringify(state));
} else if (process.argv[2] === 'verify') {
  const saved = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const seeded = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const problems = [];
  if (saved.player?.name !== NAME) problems.push(`expected the seeded house-sitter "${NAME}", found "${saved.player?.name}": the app did not load from native storage`);
  if (saved.lastSeen === seeded.lastSeen) problems.push('the date on the save has not changed: the app did not save back to native storage');
  if (!(saved.lastSeen > seeded.createdAt - 60_000 && saved.lastSeen < seeded.lastSeen)) problems.push(`the save is dated ${saved.lastSeen}, which is not while the app was running`);
  if (saved.friends?.length !== seeded.friends.length) problems.push(`friends changed from ${seeded.friends.length} to ${saved.friends?.length}`);
  if (saved.stats?.befriended !== 2 || saved.stats?.battles !== 12) problems.push('the counters did not come through');
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`native save OK: "${saved.player.name}" resumed with ${saved.friends.length} friends, and the app saved it back ${Math.max(0, Math.round((saved.lastSeen - (seeded.lastSeen - 300_000)) / 1000))}s after it was planted`);
} else {
  console.error('usage: ios-save-check.mjs seed | verify AFTER SEED');
  process.exit(2);
}
