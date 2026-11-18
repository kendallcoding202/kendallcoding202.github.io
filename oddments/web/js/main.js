// Entry point: load the save, build the screens, hand over to the player.
import { Game } from './core/game.js';
import { newState, reviveState } from './core/state.js';
import { playable } from './core/trial.js';
import { putRight, grewWords, keyOf } from './core/story.js';
import { nameOf, calledOf, artOf } from './core/names.js';
import { SPECIES, ROOMS, MAX_LEVEL, roomOf, roomBuilt, moveOf, xpNeeded } from './core/balance.js';
import { loadAssets } from './ui/assets.js';
import { h, $, sprite } from './ui/dom.js';
import { modal, toast } from './ui/modals.js';
import { laneScreen } from './ui/lane.js';
import { converse } from './ui/talk.js';
import { CAST } from './core/story.js';
import { wishOf } from './core/wishes.js';
import { insideScreen } from './ui/inside.js';
import { fightScreen } from './ui/fight.js';
import { friendsScreen, bookScreen, settingsScreen, lookDialog } from './ui/friends.js';
import { heirloomTag, bar, aOrAn } from './ui/parts.js';
import { keyPicture } from './ui/keys.js';
import { loadSave, loadSaves, writeSave, clearSave, keepUnreadable, keepErased } from './platform/storage.js';
import { switches } from './platform/switches.js';
import { unlockSound, setSound, hushSound, play, setScene, sceneFor, soundState } from './platform/sound.js';

// Switches for testing in a browser: ?reset starts from a clean save, ?fast
// plays fights back quickly, ?seed=7 makes a new game the same every time,
// ?day=20001 says what day it is, ?debug exposes the game as window.oddments.
// In a numbered build (the app) there are none of them: see platform/switches.js.
const flag = (name) => switches.has(name);

const TABS = [
  { id: 'lane', label: 'Lane', build: laneScreen },
  { id: 'friends', label: 'Friends', build: friendsScreen },
  { id: 'book', label: 'Scrapbook', build: bookScreen },
  { id: 'settings', label: 'Settings', build: settingsScreen },
];
const SCREENS = { fight: fightScreen };
for (const tab of TABS) SCREENS[tab.id] = tab.build;

// What the loading screen says is being got ready, in order, and how long it is shown at the least (ms).
const BOOT_LINES = ['Finding the odd socks…', 'Buttering the toast…', 'Dusting under the bed…', 'Lighting the lantern…'];
const BOOT_SHOWN = 1200;

// Once the save is being erased, nothing may write the old game back
// (the page saves itself as it unloads, which would undo the change).
let frozen = false;

async function boot() {
  if (flag('reset')) {
    // A web address can carry ?reset, and an address can be sent to somebody. So a person who has a
    // game saved is asked before it is erased (a test driving the browser is not), and the game that
    // is erased is set aside, not destroyed.
    const had = await loadSave();
    // (A game nobody has begun is nothing to ask about. One that cannot be read might be anything: ask.)
    let begun = false;
    try { begun = !!had && JSON.parse(had).started !== false; } catch { begun = !!had; }
    const sure = !begun || navigator.webdriver === true || window.confirm('This link asks to erase the game saved on this device and start a new one. Erase it?');
    if (sure) { if (begun) keepErased(had); await clearSave(); }
  }
  let state = null;
  // Each stored copy is tried in turn, the newest first: a copy that cannot be used (damaged, or
  // tampered with) must not stand in the way of a good one behind it.
  const copies = await loadSaves();
  for (const copy of copies) {
    try {
      const candidate = reviveState(JSON.parse(copy), Date.now());
      // Well-formed is not enough: it must survive a rehearsal on a copy.
      if (candidate && playable(candidate, Date.now())) { state = candidate; break; }
    } catch (err) {
      console.warn('could not read a stored save', err);
    }
  }
  const stored = copies[0] || null;
  // A save that exists but cannot be used is about to be replaced by a new game. Keep a copy first.
  if (stored && !state) keepUnreadable(stored);
  const seed = switches.number('seed');
  const game = new Game(state || (Number.isFinite(seed) && seed ? newState(Date.now(), seed) : newState(Date.now())), { now: Date.now() });
  // What day it is, by this device's own clock: which calm place is lively goes by it. A run for
  // testing (`?debug`: a test, a screenshot) has no day unless it is given one (`&day=`), so that it
  // plays the same whenever it is run.
  const today = () => { const at = new Date(); return Math.floor((at.getTime() - at.getTimezoneOffset() * 60000) / 86400000); };
  const dayNow = () => (flag('day') ? switches.number('day') : flag('debug') ? 0 : today());
  game.setDay(dayNow());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) game.setDay(dayNow()); });

  // Sound: the two switches as the save has them. Nothing is heard until the first touch (a browser's
  // rule), every touch after that costs nothing, and away from the game there is silence.
  setSound({ effects: game.state.settings.sound, music: game.state.settings.music });
  window.addEventListener('pointerdown', unlockSound, true);
  window.addEventListener('keydown', unlockSound, true);
  document.addEventListener('visibilitychange', () => hushSound(document.hidden));
  // An iPhone does not always say the page was hidden when the app goes into the background, and
  // not always that it is back. These say so as well: the page shown again, the window looked at again.
  window.addEventListener('pageshow', () => { if (!document.hidden) hushSound(false); });
  window.addEventListener('focus', () => { if (!document.hidden) hushSound(false); });
  // Every button makes the same small sound when pressed; what it does may make another.
  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (button && !button.disabled) play('tap');
  }, true);

  let showing = null;
  const screenRoot = $('#screen');
  const tabsRoot = $('#tabs');
  const ctx = {
    game,
    fast: flag('fast'),
    current: 'lane',
    save: () => (frozen ? false : writeSave(game.serialize(Date.now()))),
    /** Shows a screen. A fight cannot be left by a tab; anything else is the world unless a tab is asked for. */
    show(name) {
      const place = game.place();
      const target = place === 'fight' ? 'fight' : (TABS.some((tab) => tab.id === name) ? name : 'lane');
      if (showing && showing.gone) showing.gone();
      ctx.current = target;
      // The music follows you: the lullaby out in the world; in a fight the scuffle, or the place's own
      // fight tune where it has one; and a ringleader's own tune wherever one is met.
      setScene(sceneFor({ fight: target === 'fight', boss: target === 'fight' && game.battle.units.some((unit) => unit.boss), room: game.state.visit && game.wild < 0 ? game.state.visit.room : '' }));
      // The Lane tab is wherever you are walking: out in the lane, or on the floor of whatever you are inside.
      const indoors = target === 'lane' ? game.indoors() : null;
      const screen = (indoors ? insideScreen : SCREENS[target])(ctx);
      showing = screen;
      screenRoot.replaceChildren(screen.el);
      screenRoot.scrollTop = 0;
      screenRoot.dataset.screen = target;
      screenRoot.dataset.indoors = indoors || '';
      tabsRoot.hidden = place === 'fight';
      for (const button of tabsRoot.children) button.classList.toggle('on', button.dataset.tab === target);
      if (screen.shown) screen.shown();
    },
    showTab: (name) => ctx.show(name),
    afterFight: (summary, foes) => resultDialog(ctx, summary, foes),
    resetGame() { frozen = true; Promise.resolve(loadSave()).then((had) => { if (had) keepErased(had); return clearSave(); }).then(() => location.reload()); },
  };

  tabsRoot.replaceChildren(...TABS.map((tab) => h('button', { class: 'tab', data: { tab: tab.id }, onclick: () => ctx.show(tab.id) }, h('i', { class: `tabicon t-${tab.id}` }), h('span', null, tab.label))));

  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.save(); });
  window.addEventListener('pagehide', () => ctx.save());

  // A handle for tests and for poking at the game from a browser console: with ?debug, or on your
  // own machine. Never in a numbered build: the app's own address is "localhost" too, and there the
  // game is not handed to whatever script might ask for it.
  if (switches.testing && (flag('debug') || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) window.oddments = { game, ctx, sound: soundState };

  // Whichever copy of the save was the newer, both places now hold it.
  if (state) ctx.save();
  // The loading screen says what is being got ready as its bar fills, and is seen for at least a moment:
  // on a phone the pictures arrive from the app itself almost at once, and a screen that flashed by would
  // only be a flicker. (?fast skips the wait, for tests.)
  const began = performance.now();
  return loadAssets((p) => {
    $('#bootfill').style.width = `${Math.round(p * 100)}%`;
    $('#bootline').textContent = BOOT_LINES[Math.min(BOOT_LINES.length - 1, Math.floor(p * BOOT_LINES.length))];
  }).then(() => new Promise((resolve) => { setTimeout(resolve, flag('fast') ? 0 : Math.max(0, BOOT_SHOWN - (performance.now() - began))); })).then(() => {
    $('#app').hidden = false;
    ctx.show('lane');
    if (!game.state.started) lookDialog(ctx, true);
    $('#boot').classList.add('done');
    setTimeout(() => $('#boot').remove(), 600);
  });
}

/** What a fight left behind, then back to the world: where you stood, or home if the team was worn out. */
function resultDialog(ctx, summary, foes) {
  const { game } = ctx;
  const room = roomOf(summary.room);
  const lines = [];
  const name = (species) => SPECIES[species].name;
  // Your own friend of a kind, by the name you gave it if you gave it one.
  const mine = (species, before) => (calledOf(game.state, species) === name(species) ? `${before} ${name(species)}` : calledOf(game.state, species));

  // How it went, to the ear: the place calm, a fight won, or the walk home; then anyone new, and anyone grown.
  play(summary.cleared ? 'calm' : summary.won ? 'win' : 'lose');
  if (summary.joined.length) setTimeout(() => play('joined'), summary.cleared ? 1500 : 650);
  if (summary.heirlooms.length || summary.joined.some((joined) => joined.heirloom)) setTimeout(() => play('heirloom'), summary.cleared ? 2100 : 1250);
  if (summary.gains.some((gain) => gain.to > gain.from)) setTimeout(() => play('level'), summary.cleared ? 2700 : summary.joined.length ? 1850 : 800);
  if (summary.gains.some((gain) => gain.grew)) setTimeout(() => play('grew'), summary.cleared ? 3300 : summary.joined.length ? 2450 : 1400);

  if (summary.cleared) {
    const next = ROOMS[ROOMS.indexOf(room) + 1];
    lines.push(h('p', { class: 'big' }, `${room.name} is calm!`), h('p', null, next && next.chapter === 2 && room.chapter !== 2
      // The last place on the lane: the first chapter's end. What comes next, great-aunt Maribel will ring about.
      ? 'That is all eight. Every place on the lane is calm, and it is not Monday yet. Everyone is rested. Ines Tock will want to hear, and so will great-aunt Maribel.'
      : next && roomBuilt(next)
      ? `Everyone is rested, and the way on is open: ${next.name} is next. Ines Tock will want to hear. (${room.name} will stay calm now. A few will always be wandering about in it: go back for the friends still to make.)`
      : next ? `Everyone is rested. That is as far as the lane is built: ${next.name} comes next, and is not there yet. (${room.name} will stay calm now. A few will always be wandering about in it: go back for the friends still to make.)`
        : 'That is all four over the water, and both banks quiet. Everyone is rested. Ines Tock will want to hear: there is a mailbox on Bobbin Row.'));
    // Its ringleader hands over the key to the place: yours to keep.
    const key = keyOf(room.id);
    if (key) lines.push(h('div', { class: 'keywon', data: { key: key.room } }, keyPicture(key.room), h('div', null, h('b', null, key.name), h('small', null, key.line))));
    // For one of the three you set out with, this is where its story began; and here it is put right.
    const right = putRight(game.state, room.id);
    // Its ringleader is calm now, and has a wish: from here on it takes the air outside.
    const chief = room.path[room.path.length - 1].boss;
    const wish = wishOf(game.state, chief);
    if (wish) lines.push(h('p', { class: 'note', data: { act: 'wish' } }, `${name(chief)} is calm now, and will be taking the air outside from here on, with a wish. Walk up some time and see.`));
    if (right) lines.push(h('div', { class: 'putright', data: { kind: right.kind } }, sprite(artOf(game.state.friends.find((friend) => friend.species === right.kind)), !!game.state.friends.find((friend) => friend.species === right.kind).heirloom, 'flip'), h('p', null, right.text)));
  }
  else if (summary.won && summary.keepsake) {
    // A Keepsake: made a friend of, it comes home; otherwise it has gone quiet, and will be out again.
    const yours = summary.joined.some((joined) => joined.species === summary.keepsake) || summary.heirlooms.includes(summary.keepsake);
    lines.push(h('p', { class: yours ? 'big' : null, data: { act: 'keepsake' } }, yours
      ? `${name(summary.keepsake)} is a Keepsake: there is only one, anywhere. And it has chosen to come home with you.`
      : `${name(summary.keepsake)} has slipped away, quite unhurt. A Keepsake cannot be made to stay: Reach out to it, and keep Reaching out. It will be here again after a rest.`));
  }
  // A bout with somebody who was waiting by the road: nobody is calmed; it is won, or it is not.
  // A ringleader's friendly bout: won, it comes home with you.
  else if (summary.won && summary.chief) lines.push(h('p', { class: 'big', data: { act: 'chief' } }, `${name(summary.chief.species)} has had a wish granted, and a good bout.`), h('p', null, summary.chief.text));
  else if (summary.won && summary.rival) lines.push(h('p', { data: { act: 'bout' } }, `${CAST.tansy.name} calls her three back to her. Everyone catches their breath.`));
  else if (summary.won) lines.push(h('p', null, summary.strays ? `${foes.length > 1 ? 'They are' : 'It is'} calm now, and off home. Everyone catches their breath.` : 'They are calm now. Everyone catches their breath.'));
  else {
    if (summary.rival) lines.push(h('p', { data: { act: 'bout' } }, summary.rival.text));
    if (summary.chief) lines.push(h('p', { data: { act: 'chief' } }, summary.chief.text));
    lines.push(h('p', null, 'Your friends are worn out. You carry them home for a rest. Whoever you calmed stays calm, and you keep everything they learned.'));
    // Nobody is ever stuck: there is always more practice to be had, and this is where.
    lines.push(h('p', { class: 'note', data: { act: 'practice' } }, 'Want them stronger first? After a rest there are always strays out on the roads, and a few wandering wherever is calm. The more of them together, the more they teach.'));
  }

  for (const joined of summary.joined) {
    lines.push(h('div', { class: `joined${joined.grown ? ' grownup' : ''}`, data: { joined: joined.species } }, sprite(artOf(joined), joined.heirloom, 'flip'),
      h('div', null, h('b', null, `${joined.grown ? SPECIES[joined.species].grown.name : name(joined.species)} comes home with you!`), joined.grown ? h('span', { class: 'growntag' }, 'Grown up') : null, joined.heirloom ? heirloomTag() : null, h('small', null, SPECIES[joined.species].boss
        ? 'Resting at home. Friends is where a place on your team is given: one turn a round now, like anyone, and only one ringleader walks with you at a time.'
        : 'It is resting at home. Put it on your team from Friends; you can give it a name of your own there too.'))));
  }
  for (const species of summary.visited) lines.push(h('p', { class: 'note' }, `The ${name(species)} goes off happy. ${mine(species, 'Your own')} learned from the visit.`));
  for (const species of summary.heirlooms) lines.push(h('p', { class: 'note gold' }, `It left ${mine(species, 'your')} its Heirloom colours.`));

  // A friend has grown up: said first and said big, with what it was and what it is now side by side.
  for (const gain of summary.gains.filter((each) => each.grew)) {
    const friend = game.friend(gain.id);
    if (!friend) continue;
    const kind = SPECIES[gain.species];
    const rare = !!friend.heirloom;
    lines.push(h('div', { class: 'grew', data: { grew: gain.species } },
      h('div', { class: 'grewpics' }, sprite(gain.species, rare, 'flip was'), h('i', { class: 'grewarrow' }, '➜'), sprite(`${gain.species}_grown`, rare, 'flip now')),
      h('b', null, `${friend.nick || kind.name} has grown up!`),
      h('p', null, friend.nick ? `${aOrAn(kind.grown.name) === 'an' ? 'An' : 'A'} ${kind.grown.name} now, and still ${friend.nick}.` : `It is ${aOrAn(kind.grown.name)} ${kind.grown.name} now.`),
      grewWords(gain.species) ? h('p', { class: 'grewstory' }, grewWords(gain.species)) : null,
      h('small', null, 'Bigger, and stronger in every way.')));
  }

  if (summary.xp > 0) {
    lines.push(h('p', { class: 'xp' }, `+${summary.xp} experience each`));
    // One met on its own is quick work, and teaches less than its worth: say so, so the number is no surprise.
    if (summary.lone) lines.push(h('p', { class: 'note', data: { act: 'lone' } }, 'One on its own is quick work. A bigger fight teaches more.'));
    // Everyone who walked with you, and anyone at home who went up a level.
    lines.push(h('div', { class: 'gains' }, summary.gains.filter((gain) => gain.team || gain.to > gain.from).map((gain) => {
      const friend = game.friend(gain.id);
      const up = gain.to > gain.from;
      return h('div', { class: `gain${up ? ' up' : ''}${gain.grew ? ' grownup' : ''}` }, sprite(friend ? artOf(friend) : gain.species, !!(friend && friend.heirloom), 'flip'),
        h('div', null,
          h('div', { class: 'line' }, h('b', null, friend ? nameOf(friend) : name(gain.species)),
            h('small', { class: up ? 'lvup' : '' }, up ? `Level ${gain.from} → ${gain.to}${gain.team ? '' : ' (at home)'}` : `Level ${gain.to}`)),
          friend && friend.level < MAX_LEVEL ? bar('xp', friend.xp / xpNeeded(friend.level)) : null,
          gain.learned.map((id) => h('small', { class: 'learned' }, `Learned ${moveOf(id).name}`))));
    })));
  }
  if (!summary.won && foes.some((foe) => foe.settled)) lines.push(h('p', { class: 'note' }, 'The one you calmed slipped away in the muddle.'));

  modal({
    title: summary.cleared ? 'All calm' : summary.won ? 'Won' : 'Home again', cls: `result ${summary.won ? 'won' : 'lost'}`, fixed: true, body: lines,
    // (After a bout that was won, whoever lost it has something to say, once you are back in the lane.)
    actions: [{ id: 'next', label: summary.home ? 'Home' : 'Onward', onClick: () => {
      ctx.show('lane');
      if (summary.rival && summary.rival.lines.length) setTimeout(() => converse(summary.rival.lines, () => { game.seenOff(); ctx.save(); }), 0);
      else game.seenOff();
    } }],
  });
  if (summary.joined.length) toast(`${summary.joined.length === 1 ? 'A new friend' : `${summary.joined.length} new friends`}!`, { kind: 'good' });
}

/** The last resort when the game cannot start: never a dead end. Starting over sets the old save aside. */
function showRescue() {
  if (document.getElementById('rescue')) return;
  const button = (cls, label, onClick) => h('button', { class: `btn ${cls}`, onclick: onClick }, label);
  document.body.append(h('div', { id: 'rescue', role: 'alertdialog' },
    h('h2', null, 'Something went wrong'),
    h('p', null, 'You can try again, or start a new game. Starting a new game sets your old save aside; it is not deleted.'),
    button('plain', 'Try again', () => location.reload()),
    button('danger', 'Start a new game', () => {
      frozen = true;
      loadSave().then((stored) => { if (stored) keepUnreadable(stored); return clearSave(); }).then(() => location.reload());
    })));
}

try {
  boot().catch((err) => { console.error(err); showRescue(); });
} catch (err) {
  console.error(err);
  showRescue();
}
