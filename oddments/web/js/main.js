// Entry point: load the save, build the screens, hand over to the player.
import { Game } from './core/game.js';
import { newState, reviveState } from './core/state.js';
import { playable } from './core/trial.js';
import { putRight } from './core/story.js';
import { nameOf, calledOf } from './core/names.js';
import { SPECIES, ROOMS, MAX_LEVEL, roomOf, roomBuilt, moveOf, xpNeeded } from './core/balance.js';
import { loadAssets } from './ui/assets.js';
import { h, $, sprite } from './ui/dom.js';
import { modal, toast } from './ui/modals.js';
import { laneScreen } from './ui/lane.js';
import { insideScreen } from './ui/inside.js';
import { fightScreen } from './ui/fight.js';
import { friendsScreen, bookScreen, settingsScreen, lookDialog } from './ui/friends.js';
import { heirloomTag, bar } from './ui/parts.js';
import { loadSave, writeSave, clearSave, keepUnreadable } from './platform/storage.js';
import { unlockSound, setSound, hushSound, play, setScene, sceneFor, soundState } from './platform/sound.js';

const params = new URLSearchParams(location.search);
// Switches for testing in a browser: ?reset starts from a clean save, ?fast
// plays fights back quickly, ?seed=7 makes a new game the same every time,
// ?debug exposes the game as window.oddments. Where a host strips query
// strings they can come from an ODDMENTS_FLAGS object set before this loads.
const flags = window.ODDMENTS_FLAGS || {};
const flag = (name) => params.has(name) || !!flags[name];

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
  if (flag('reset')) await clearSave();
  let state = null;
  const stored = await loadSave();
  try {
    if (stored) state = reviveState(JSON.parse(stored), Date.now());
    // Well-formed is not enough: it must survive a rehearsal on a copy.
    if (state && !playable(state, Date.now())) state = null;
  } catch (err) {
    console.warn('could not read the save', err);
    state = null;
  }
  // A save that exists but cannot be used is about to be replaced by a new game. Keep a copy first.
  if (stored && !state) keepUnreadable(stored);
  const seed = Number(params.get('seed') || flags.seed);
  const game = new Game(state || (Number.isFinite(seed) && seed ? newState(Date.now(), seed) : newState(Date.now())), { now: Date.now() });

  // Sound: the two switches as the save has them. Nothing is heard until the first touch (a browser's
  // rule), every touch after that costs nothing, and away from the game there is silence.
  setSound({ effects: game.state.settings.sound, music: game.state.settings.music });
  window.addEventListener('pointerdown', unlockSound, true);
  window.addEventListener('keydown', unlockSound, true);
  document.addEventListener('visibilitychange', () => hushSound(document.hidden));
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
    resetGame() { frozen = true; clearSave().then(() => location.reload()); },
  };

  tabsRoot.replaceChildren(...TABS.map((tab) => h('button', { class: 'tab', data: { tab: tab.id }, onclick: () => ctx.show(tab.id) }, h('i', { class: `tabicon t-${tab.id}` }), h('span', null, tab.label))));

  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.save(); });
  window.addEventListener('pagehide', () => ctx.save());

  // A handle for tests and for poking at the game from a browser console.
  if (flag('debug') || location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.oddments = { game, ctx, sound: soundState };

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

  if (summary.cleared) {
    const next = ROOMS[ROOMS.indexOf(room) + 1];
    lines.push(h('p', { class: 'big' }, `${room.name} is calm!`), h('p', null, next && roomBuilt(next)
      ? `Everyone is rested, and the way on is open: ${next.name} is next. Ines Tock will want to hear. (${room.name} will stay calm now. A few will always be wandering about in it: go back for the friends still to make.)`
      : next ? `Everyone is rested. That is as far as the lane is built: ${next.name} comes next, and is not there yet. (${room.name} will stay calm now. A few will always be wandering about in it: go back for the friends still to make.)`
        : 'That is all eight. Every place on the lane is calm, and it is not Monday yet. Everyone is rested. Ines Tock will want to hear, and so will great-aunt Maribel: the telephone is at home.'));
    // For one of the three you set out with, this is where its story began; and here it is put right.
    const right = putRight(game.state, room.id);
    if (right) lines.push(h('div', { class: 'putright', data: { kind: right.kind } }, sprite(right.kind, !!game.state.friends.find((friend) => friend.species === right.kind).heirloom, 'flip'), h('p', null, right.text)));
  }
  else if (summary.won) lines.push(h('p', null, summary.strays ? `${foes.length > 1 ? 'They are' : 'It is'} calm now, and off home. Everyone catches their breath.` : 'They are calm now. Everyone catches their breath.'));
  else lines.push(h('p', null, 'Your friends are worn out. You carry them home for a rest. Whoever you calmed stays calm, and you keep everything they learned.'));

  for (const joined of summary.joined) {
    lines.push(h('div', { class: 'joined', data: { joined: joined.species } }, sprite(joined.species, joined.heirloom, 'flip'),
      h('div', null, h('b', null, `${name(joined.species)} comes home with you!`), joined.heirloom ? heirloomTag() : null, h('small', null, 'It is resting at home. Put it on your team from Friends; you can give it a name of your own there too.'))));
  }
  for (const species of summary.visited) lines.push(h('p', { class: 'note' }, `The ${name(species)} goes off happy. ${mine(species, 'Your own')} learned from the visit.`));
  for (const species of summary.heirlooms) lines.push(h('p', { class: 'note gold' }, `It left ${mine(species, 'your')} its Heirloom colours.`));

  if (summary.xp > 0) {
    lines.push(h('p', { class: 'xp' }, `+${summary.xp} experience each`));
    // Everyone who walked with you, and anyone at home who went up a level.
    lines.push(h('div', { class: 'gains' }, summary.gains.filter((gain) => gain.team || gain.to > gain.from).map((gain) => {
      const friend = game.friend(gain.id);
      const up = gain.to > gain.from;
      return h('div', { class: `gain${up ? ' up' : ''}` }, sprite(gain.species, !!(friend && friend.heirloom), 'flip'),
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
    actions: [{ id: 'next', label: summary.home ? 'Home' : 'Onward', onClick: () => ctx.show('lane') }],
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
