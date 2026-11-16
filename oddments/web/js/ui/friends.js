// The screens at home: your friends and team, the scrapbook, and settings.
import { BUILD } from '../platform/build.js';
import { SPECIES, SPECIES_IDS, ELEMENTS, ELEMENT_IDS, TEAM_SIZE, LOOKS, NAME_LENGTH, VERSION, TITLE, HEIRLOOM, xpNeeded, MAX_LEVEL } from '../core/balance.js';
import { h, sprite } from './dom.js';
import { modal, toast } from './modals.js';
import { elementTag, heirloomTag, bar, oddmentCard } from './parts.js';

/** Everyone who has come home, and the three who walk with you. */
export function friendsScreen(ctx) {
  const { game } = ctx;
  const el = h('section', { id: 'friends', class: 'page' });

  function open(friend) {
    const team = game.state.team;
    const on = team.includes(friend.id);
    const actions = [];
    if (on && team.length > 1) actions.push({ id: 'rest', label: 'Rest at home', kind: 'plain', onClick: () => change(team.filter((id) => id !== friend.id)) });
    if (!on && team.length < TEAM_SIZE) actions.push({ id: 'join', label: 'Join the team', onClick: () => change([...team, friend.id]) });
    if (!on && team.length >= TEAM_SIZE) {
      for (const id of team) {
        const other = game.friend(id);
        actions.push({ id: `swap-${id}`, label: `Swap with ${SPECIES[other.species].name}`, kind: 'plain', onClick: () => change(team.map((x) => (x === id ? friend.id : x))) });
      }
    }
    oddmentCard({ species: friend.species, level: friend.level, heirloom: friend.heirloom, xp: friend.xp, actions });
  }

  function change(ids) {
    if (!game.setTeam(ids)) { toast('Rest at home first: the team only changes when everyone is rested.', { kind: 'bad' }); return; }
    ctx.save();
    draw();
  }

  function tile(friend, onTeam) {
    const kind = SPECIES[friend.species];
    return h('button', { class: `friend${onTeam ? ' on' : ''}${friend.heirloom ? ' rare' : ''}`, data: { friend: String(friend.id), species: friend.species }, onclick: () => open(friend) },
      sprite(friend.species, friend.heirloom, 'flip'),
      h('b', null, kind.name),
      h('span', { class: 'tags' }, elementTag(kind.element), h('small', null, `Lv ${friend.level}`)),
      friend.level >= MAX_LEVEL ? null : bar('xp', friend.xp / xpNeeded(friend.level)),
      friend.heirloom ? heirloomTag() : null);
  }

  function draw() {
    const team = game.team();
    const home = game.state.friends.filter((friend) => !game.state.team.includes(friend.id));
    el.replaceChildren(
      h('header', { class: 'bar-top' }, h('h1', null, 'Friends'), h('span', { class: 'count' }, `${game.state.friends.length} at home`)),
      h('h3', null, `Walking with you (${team.length}/${TEAM_SIZE})`),
      h('div', { class: 'grid team' }, team.map((friend) => tile(friend, true))),
      h('h3', null, 'Resting at home'),
      home.length
        ? h('div', { class: 'grid' }, home.map((friend) => tile(friend, false)))
        : h('p', { class: 'note' }, 'Nobody yet. In a fight, stop hitting one you like and Reach out to it; if you win, it comes home.'));
  }
  draw();
  return { el };
}

/** The scrapbook: every kind there is, and which you have met. */
export function bookScreen(ctx) {
  const { game } = ctx;
  const { book, friends } = game.state;
  const kinds = SPECIES_IDS;
  const canJoin = kinds.filter((id) => !SPECIES[id].boss);
  const tiles = kinds.map((id) => {
    const kind = SPECIES[id];
    const friend = friends.find((f) => f.species === id);
    const met = book[id].met;
    return h('button', {
      class: `page-tile${met ? '' : ' unmet'}${friend ? ' friend' : ''}`, data: { kind: id }, disabled: !met,
      onclick: () => oddmentCard({ species: id, level: friend ? friend.level : 1, heirloom: !!(friend && friend.heirloom), xp: friend ? friend.xp : null }),
    },
      sprite(id, !!(friend && friend.heirloom)),
      h('b', null, met ? kind.name : '???'),
      met ? elementTag(kind.element) : h('small', null, 'Not met'),
      h('span', { class: 'stamps' }, friend ? h('i', { class: 'stamp pal', title: 'A friend' }, '♥') : null, book[id].heirloom ? h('i', { class: 'stamp gold', title: 'Heirloom met' }, '❖') : null));
  });
  const el = h('section', { id: 'book', class: 'page' },
    h('header', { class: 'bar-top' }, h('h1', null, 'Scrapbook')),
    h('p', { class: 'note' }, `Met ${kinds.filter((id) => book[id].met).length} of ${kinds.length} · Friends ${friends.length} of ${canJoin.length} · Heirlooms seen ${canJoin.filter((id) => book[id].heirloom).length} of ${canJoin.length}`),
    h('div', { class: 'grid book' }, tiles),
    h('h3', null, 'Elements'),
    h('div', { class: 'ring' }, ELEMENT_IDS.map((id) => h('div', null, elementTag(id), h('span', null, ' beats '), elementTag(ELEMENTS[id].beats), h('small', null, ` ${ELEMENTS[id].why}.`)))),
    h('p', { class: 'note' }, `Beating an element: damage ×1.5. Being beaten by it: ×0.7. About one restless Oddment in ${Math.round(1 / HEIRLOOM.odds)} is an Heirloom, in rare colours.`));
  return { el };
}

export function settingsScreen(ctx) {
  const { game } = ctx;
  const { settings, player, stats } = game.state;
  const fast = h('button', { class: `switch${settings.fast ? ' on' : ''}`, role: 'switch', 'aria-label': 'Fast fights', data: { act: 'fast' } });
  fast.addEventListener('click', () => { settings.fast = !settings.fast; fast.classList.toggle('on', settings.fast); ctx.save(); });

  const el = h('section', { id: 'settings', class: 'page' },
    h('header', { class: 'bar-top' }, h('h1', null, 'Settings')),
    h('div', { class: 'card' },
      h('div', { class: 'toggle' }, h('div', null, 'Fast fights', h('small', null, 'Play the moves back quicker.')), fast)),
    h('div', { class: 'card you' },
      sprite(player.look),
      h('div', null, h('b', null, player.name), h('small', null, 'The house-sitter')),
      h('button', { class: 'btn plain small', data: { act: 'look' }, onclick: () => lookDialog(ctx, false) }, 'Change')),
    h('div', { class: 'card' },
      h('small', null, `Fights ${stats.battles} · won ${stats.wins} · friends made ${stats.befriended} · Heirlooms ${stats.heirlooms}`)),
    h('div', { class: 'card' },
      h('p', null, 'No ads, no tracking, no accounts, no purchases. This game never uses the network: your save lives on this device only.'),
      h('small', { data: { build: BUILD } }, `${TITLE} (working title) ${VERSION}${BUILD === 'dev' ? '' : `, build ${BUILD}`}. A playable slice: one place of eight.`)),
    h('button', {
      class: 'btn danger', data: { act: 'reset' },
      onclick: () => modal({
        title: 'Start over?', body: [h('p', null, 'This erases your save on this device: friends, levels and all. It cannot be undone.')],
        actions: [{ id: 'keep', label: 'Keep playing', kind: 'plain' }, { id: 'erase', label: 'Erase and start over', kind: 'danger', onClick: () => ctx.resetGame() }],
      }),
    }, 'Start over'));
  return { el };
}

/** Name and look. `first` is the intro: no way out but Begin. */
export function lookDialog(ctx, first) {
  const { game } = ctx;
  let look = game.state.player.look;
  const input = h('input', { type: 'text', maxLength: NAME_LENGTH, value: first ? '' : game.state.player.name, placeholder: 'Your name', autocomplete: 'off', spellcheck: false, data: { field: 'name' } });
  const looks = LOOKS.map((entry) => h('button', { class: `look${entry.id === look ? ' on' : ''}`, data: { look: entry.id }, 'aria-label': entry.name }, sprite(entry.id), h('small', null, entry.name)));
  looks.forEach((button, i) => button.addEventListener('click', () => {
    look = LOOKS[i].id;
    looks.forEach((b, j) => b.classList.toggle('on', j === i));
  }));
  const done = () => {
    if (first) game.begin({ name: input.value, look }); else game.setLook({ name: input.value, look });
    ctx.save();
    ctx.show(ctx.current);
  };
  return modal({
    title: first ? TITLE : 'You', cls: first ? 'intro' : 'looks', fixed: first,
    body: [
      first ? h('p', null, 'You are house-sitting for your great-aunt. The cats sleep all day. At night you find out why: the house is awake. The odd socks, the burnt toast, the dust under the bed.') : null,
      first ? h('p', null, 'The cats fight it. You are going to try talking to it.') : null,
      h('label', null, h('small', null, 'Who is house-sitting?'), input),
      h('div', { class: 'looks' }, looks),
    ],
    actions: [{ id: first ? 'begin' : 'save', label: first ? 'Begin' : 'Done', onClick: done }],
  });
}
