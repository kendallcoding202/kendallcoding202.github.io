// Entry point: load the save, build the screens, hand over to the player.
import { Game } from './core/game.js';
import { newState, reviveState } from './core/state.js';
import { playable } from './core/trial.js';
import { SPECIES, roomOf, moveOf } from './core/balance.js';
import { loadAssets } from './ui/assets.js';
import { h, $, sprite } from './ui/dom.js';
import { modal, toast } from './ui/modals.js';
import { pathScreen } from './ui/house.js';
import { laneScreen } from './ui/lane.js';
import { fightScreen } from './ui/fight.js';
import { friendsScreen, bookScreen, settingsScreen, lookDialog } from './ui/friends.js';
import { heirloomTag } from './ui/parts.js';
import { loadSave, writeSave, clearSave, keepUnreadable } from './platform/storage.js';

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
const SCREENS = { path: pathScreen, fight: fightScreen };
for (const tab of TABS) SCREENS[tab.id] = tab.build;

// Once the save is being erased, nothing may write the old game back
// (the page saves itself as it unloads, which would undo the change).
let frozen = false;

function boot() {
  if (flag('reset')) clearSave();
  let state = null;
  const stored = loadSave();
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

  let showing = null;
  const screenRoot = $('#screen');
  const tabsRoot = $('#tabs');
  const ctx = {
    game,
    fast: flag('fast'),
    current: 'lane',
    save: () => (frozen ? false : writeSave(game.serialize(Date.now()))),
    /** Shows a screen. Where the game is decides: a fight or a path cannot be left by a tab. */
    show(name) {
      const place = game.place();
      const target = place === 'fight' ? 'fight' : place === 'path' ? 'path' : (TABS.some((tab) => tab.id === name) ? name : 'lane');
      if (showing && showing.gone) showing.gone();
      ctx.current = target;
      const screen = SCREENS[target](ctx);
      showing = screen;
      screenRoot.replaceChildren(screen.el);
      screenRoot.scrollTop = 0;
      screenRoot.dataset.screen = target;
      tabsRoot.hidden = place !== 'lane';
      for (const button of tabsRoot.children) button.classList.toggle('on', button.dataset.tab === target);
      if (screen.shown) screen.shown();
    },
    showTab: (name) => ctx.show(name),
    afterFight: (summary, foes) => resultDialog(ctx, summary, foes),
    resetGame() { frozen = true; clearSave(); location.reload(); },
  };

  tabsRoot.replaceChildren(...TABS.map((tab) => h('button', { class: 'tab', data: { tab: tab.id }, onclick: () => ctx.show(tab.id) }, h('i', { class: `tabicon t-${tab.id}` }), h('span', null, tab.label))));

  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.save(); });
  window.addEventListener('pagehide', () => ctx.save());

  // A handle for tests and for poking at the game from a browser console.
  if (flag('debug') || location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.oddments = { game, ctx };

  return loadAssets((p) => { $('#bootfill').style.width = `${Math.round(p * 100)}%`; }).then(() => {
    $('#app').hidden = false;
    ctx.show('lane');
    if (!game.state.started) lookDialog(ctx, true);
    $('#boot').classList.add('done');
    setTimeout(() => $('#boot').remove(), 500);
  });
}

/** What a fight left behind, then on along the path or home. */
function resultDialog(ctx, summary, foes) {
  const { game } = ctx;
  const room = roomOf(summary.room);
  const lines = [];
  const name = (species) => SPECIES[species].name;

  if (summary.cleared) lines.push(h('p', { class: 'big' }, `${room.name} is cleared!`), h('p', null, 'The way on is open. (The next room is not built yet: this slice ends here. You can walk the garden again to make more friends.)'));
  else if (summary.won) lines.push(h('p', null, 'The way is clear. Everyone catches their breath.'));
  else lines.push(h('p', null, 'Your friends are worn out. You carry them home for a rest: you keep everything they learned.'));

  for (const joined of summary.joined) {
    lines.push(h('div', { class: 'joined', data: { joined: joined.species } }, sprite(joined.species, joined.heirloom, 'flip'),
      h('div', null, h('b', null, `${name(joined.species)} comes home with you!`), joined.heirloom ? heirloomTag() : null, h('small', null, 'It is resting at home. Put it on your team from Friends.'))));
  }
  for (const species of summary.visited) lines.push(h('p', { class: 'note' }, `The ${name(species)} goes off happy. Your own ${name(species)} learned from the visit.`));
  for (const species of summary.heirlooms) lines.push(h('p', { class: 'note gold' }, `It left your ${name(species)} its Heirloom colours.`));

  if (summary.xp > 0) {
    lines.push(h('p', { class: 'xp' }, `+${summary.xp} experience each`));
    for (const gain of summary.gains.filter((g) => g.to > g.from)) {
      lines.push(h('div', { class: 'levelup' }, sprite(gain.species, !!(game.friend(gain.id) && game.friend(gain.id).heirloom), 'flip'),
        h('div', null, h('b', null, `${name(gain.species)} is now level ${gain.to}`), gain.team ? null : h('small', null, ' (at home)'),
          gain.learned.map((id) => h('small', { class: 'learned' }, `Learned ${moveOf(id).name}`)))));
    }
  }
  if (!summary.won && foes.some((foe) => foe.settled)) lines.push(h('p', { class: 'note' }, 'The one you calmed slipped away in the muddle.'));

  modal({
    title: summary.cleared ? 'Room cleared' : summary.won ? 'Won' : 'Home again', cls: `result ${summary.won ? 'won' : 'lost'}`, fixed: true, body: lines,
    actions: [{ id: 'next', label: summary.home ? 'Back to the lane' : 'Onward', onClick: () => ctx.show(summary.home ? 'lane' : 'path') }],
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
      const stored = loadSave();
      if (stored) keepUnreadable(stored);
      clearSave();
      location.reload();
    })));
}

try {
  boot().catch((err) => { console.error(err); showRescue(); });
} catch (err) {
  console.error(err);
  showRescue();
}
