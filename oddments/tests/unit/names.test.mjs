// A name of your own for a friend: what may be typed, where it is then used,
// that it is kept in the save, and that the kind's name is never lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { SPECIES, NAME_LENGTH } from '../../web/js/core/balance.js';
import { tidyName, nameOf, calledOf, toldOf, giveName } from '../../web/js/core/names.js';
import { THREE, putRight } from '../../web/js/core/story.js';
import { playOut } from '../../web/js/core/auto.js';

const NOW = 1_800_000_000_000;
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}
const back = (game, edit = () => {}) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };

test('a typed name is tidied: one line, no unseen marks, cut to length, and nothing at all if nothing is left', () => {
  assert.equal(tidyName('  Biscuit  '), 'Biscuit');
  assert.equal(tidyName('Sir   Hops\na\tlot'), 'Sir Hops a l', 'runs of space and new lines become one space, then it is cut');
  assert.equal(tidyName('x'.repeat(500)).length, NAME_LENGTH);
  assert.equal(tidyName('abcdefghijk lmnop'), 'abcdefghijk', 'a cut that ends on a space loses the space');
  assert.equal(tidyName(`a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x200b)}c${String.fromCodePoint(0)}`), 'a b c', 'marks that turn the line round, or draw nothing, are taken for spaces');
  assert.equal(tidyName(String.fromCodePoint(0x200b, 0xfeff, 0xad, 0x2060)), '', 'a name of nothing but unseen marks is no name');
  assert.equal(tidyName('🐇🐇🐇🐇🐇🐇🐇🐇🐇🐇🐇🐇🐇🐇'), '🐇'.repeat(NAME_LENGTH), 'a picture counts as one letter, and is never cut in half');
  assert.equal(tidyName('Żółć Ñandú'), 'Żółć Ñandú', 'any alphabet will do');
  for (const not of ['', '   ', '\n\t', null, undefined, 7, {}, ['Biscuit'], true]) assert.equal(tidyName(not), '');
});

test('a friend goes by the name you give it, and by its kind\'s again when you take it away', () => {
  const game = fresh(5);
  const [first, second] = game.state.friends;
  const kind = SPECIES[first.species].name;
  assert.equal(nameOf(first), kind);
  assert.equal(game.nameFriend(first.id, '  Biscuit '), 'Biscuit');
  assert.equal(first.nick, 'Biscuit');
  assert.equal(nameOf(first), 'Biscuit');
  assert.equal(calledOf(game.state, first.species), 'Biscuit');
  assert.equal(calledOf(game.state, second.species), SPECIES[second.species].name, 'the others are as they were');
  assert.equal(calledOf(game.state, 'gnome'), SPECIES.gnome.name, 'a kind with no friend at home goes by its own name');
  assert.equal(toldOf(game.state, first.species, `${kind} sneezes. Nothing happens. ${kind} sneezes again.`), 'Biscuit sneezes. Nothing happens. Biscuit sneezes again.');
  // Its kind's own name is not a name of your own; nor is nothing.
  assert.equal(game.nameFriend(first.id, kind), kind);
  assert.equal('nick' in first, false);
  game.nameFriend(first.id, 'Biscuit');
  assert.equal(game.nameFriend(first.id, '   '), kind);
  assert.equal('nick' in first, false, 'taken away, it leaves nothing behind in the save');
  assert.equal(game.nameFriend(999, 'Nobody'), null, 'there is no such friend');
  assert.equal(giveName(second, 'x'.repeat(40)).length, NAME_LENGTH);
});

test('the name is kept in the save, and tidied again on the way back in', () => {
  const game = fresh(6);
  const [first, second, third] = game.state.friends;
  game.nameFriend(first.id, 'Biscuit');
  let state = back(game);
  assert.equal(state.friends[0].nick, 'Biscuit');
  assert.equal('nick' in state.friends[1], false);
  // A save that has been tampered with: only a tidy name of the right length comes through.
  state = back(game, (raw) => {
    raw.friends[0].nick = `<img src=x onerror=alert(1)>${'x'.repeat(4000)}`;
    raw.friends[1].nick = { toString: 'Eel' };
    raw.friends[2].nick = SPECIES[third.species].name;
  });
  assert.equal(state.friends[0].nick, '<img src=x o', 'text is kept as text, cut to length (it is only ever drawn as text)');
  assert.equal('nick' in state.friends[1], false, 'something that is not text is not a name');
  assert.equal('nick' in state.friends[2], false, 'its kind\'s own name is not kept as a name of your own');
  assert.equal(nameOf(state.friends[1]), SPECIES[second.species].name);
});

test('in a fight your friend stands under its own name; one of its kind across the way keeps the kind\'s', () => {
  const game = fresh(3);
  game.begin({ name: 'Kit' });
  const friend = game.team()[0];
  const kind = SPECIES[friend.species].name;
  game.nameFriend(friend.id, 'Biscuit');
  // Out on the lane, among the strays.
  const strays = game.strays();
  assert.ok(strays.length > 0);
  assert.equal(game.approachStrays(strays[0].index), true);
  let battle = game.startStrays();
  assert.ok(battle);
  assert.deepEqual(battle.units.filter((unit) => unit.side === 'ally').map((unit) => unit.name), ['Biscuit', ...game.team().slice(1).map((each) => SPECIES[each.species].name)]);
  assert.ok(battle.units.filter((unit) => unit.side === 'foe').every((unit) => unit.name === SPECIES[unit.species].name));
  assert.equal(game.nameFriend(friend.id, 'Crumpet'), null, 'not in the middle of a fight');
  assert.equal(friend.nick, 'Biscuit');
  playOut(battle, {});
  game.finishBattle();
  // And in a place.
  game.rest();
  assert.equal(game.travelTo('garden'), true);
  battle = game.startEncounter();
  assert.ok(battle);
  assert.equal(battle.units.find((unit) => unit.side === 'ally' && unit.friendId === friend.id).name, 'Biscuit');
  assert.notEqual(kind, 'Biscuit');
});

test('the story of one of the three is told with the name you gave it', () => {
  const game = fresh(4);
  const one = THREE[0];
  const kind = SPECIES[one.kind].name;
  assert.ok(one.after.includes(kind), 'what is put right for it names it');
  assert.equal(putRight(game.state, one.place).text, one.after, 'by its kind\'s name, until you give it one');
  const friend = game.state.friends.find((each) => each.species === one.kind);
  game.nameFriend(friend.id, 'Biscuit');
  const told = putRight(game.state, one.place).text;
  assert.ok(told.includes('Biscuit') && !told.includes(kind), told);
  assert.equal(told, one.after.split(kind).join('Biscuit'));
  // The other two are told as they were.
  assert.equal(putRight(game.state, THREE[1].place).text, THREE[1].after);
});
