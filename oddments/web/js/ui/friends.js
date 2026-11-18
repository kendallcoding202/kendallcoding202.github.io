// The screens at home: your friends and team, the scrapbook, and settings.
import { BUILD } from '../platform/build.js';
import { SPECIES, SPECIES_IDS, ELEMENTS, ELEMENT_IDS, TEAM_SIZE, LOOKS, NAME_LENGTH, VERSION, TITLE, HEIRLOOM, ROOMS, roomBuilt, xpNeeded, MAX_LEVEL } from '../core/balance.js';
import { nameOf, artOf, kindNameOf } from '../core/names.js';
import { h, sprite } from './dom.js';
import { modal, toast } from './modals.js';
import { elementTag, heirloomTag, bar, oddmentCard } from './parts.js';
import { setSound, unlockSound } from '../platform/sound.js';
import { keyRing } from './keys.js';

/** Everyone who has come home, and the three who walk with you. */
export function friendsScreen(ctx) {
  const { game } = ctx;
  const el = h('section', { id: 'friends', class: 'page' });

  function open(friend) {
    const team = game.state.team;
    const on = team.includes(friend.id);
    const actions = [];
    // Only one ringleader walks with you at a time: a way onto the team that would make two is not offered, and the card says why.
    const fits = (ids) => game.mayTeam(ids) !== 'chiefs';
    let barred = false;
    if (on && team.length > 1) actions.push({ id: 'rest', label: 'Rest at home', kind: 'plain', onClick: () => change(team.filter((id) => id !== friend.id)) });
    if (!on && team.length < TEAM_SIZE) {
      if (fits([...team, friend.id])) actions.push({ id: 'join', label: 'Join the team', onClick: () => change([...team, friend.id]) });
      else barred = true;
    }
    if (!on && team.length >= TEAM_SIZE) {
      for (const id of team) {
        const other = game.friend(id);
        const swapped = team.map((x) => (x === id ? friend.id : x));
        if (!fits(swapped)) { barred = true; continue; }
        actions.push({ id: `swap-${id}`, label: `Swap with ${nameOf(other)}`, kind: 'plain', onClick: () => change(swapped) });
      }
    }
    const walking = team.map((id) => game.friend(id)).find((other) => other && SPECIES[other.species].boss);
    const extra = barred && walking ? [h('p', { class: 'note gold', data: { act: 'onechief' } }, `${nameOf(walking)} is walking with you already, and only one ringleader does at a time. Swap the two of them, or send ${nameOf(walking)} home to rest first.`)] : [];
    // A name of your own for it. (The dialog opens once this one has closed.)
    actions.push({ id: 'name', label: friend.nick ? 'Change its name' : 'Give it a name', kind: 'plain', onClick: () => { setTimeout(() => nameDialog(ctx, friend, draw), 0); } });
    oddmentCard({ species: friend.species, level: friend.level, heirloom: friend.heirloom, xp: friend.xp, name: nameOf(friend), grown: !!friend.grown, extra, actions });
  }

  function change(ids) {
    const may = game.mayTeam(ids);
    if (may !== true || !game.setTeam(ids)) { toast(may === 'chiefs' ? 'Only one ringleader walks with you at a time.' : 'Rest at home first: the team only changes when everyone is rested.', { kind: 'bad' }); return; }
    ctx.save();
    draw();
  }

  function tile(friend, onTeam) {
    const kind = SPECIES[friend.species];
    return h('button', { class: `friend${onTeam ? ' on' : ''}${friend.heirloom ? ' rare' : ''}${friend.grown ? ' grown' : ''}${kind.boss ? ' chief' : ''}`, data: { friend: String(friend.id), species: friend.species }, onclick: () => open(friend) },
      sprite(artOf(friend), friend.heirloom, 'flip'),
      h('b', null, nameOf(friend)),
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
  const chiefs = kinds.filter((id) => SPECIES[id].boss);
  // A ringleader whose place is calm has a wish: its page says what, and how far along it is.
  const wishNote = (id, yours) => {
    const wish = game.wish(id);
    if (!wish || yours || !game.waiting().some((one) => one.id === id)) return [];
    return [h('div', { class: `wish${wish.granted ? ' granted' : ''}`, data: { act: 'wish' } },
      h('b', null, wish.granted ? `Wish granted: ${wish.wish}` : `Wish: ${wish.wish}`),
      h('small', null, wish.granted ? 'Waiting out of doors, for one more bout: a friendly one. Win it, and you have a ringleader for a friend.' : `${wish.how} After that, one more bout, a friendly one: win it, and you have a ringleader for a friend.`),
      wish.granted ? null : bar('xp', wish.have / wish.need, `${wish.have} of ${wish.need}`))];
  };
  const tiles = kinds.map((id) => {
    const kind = SPECIES[id];
    const friend = friends.find((f) => f.species === id);
    const met = book[id].met;
    return h('button', {
      class: `page-tile${met ? '' : ' unmet'}${friend ? ' friend' : ''}${friend && friend.heirloom ? ' rare' : ''}${friend && friend.grown ? ' grown' : ''}`, data: { kind: id }, disabled: !met,
      onclick: () => oddmentCard({ species: id, level: friend ? friend.level : 1, heirloom: !!(friend && friend.heirloom), xp: friend ? friend.xp : null, grown: !!(friend && friend.grown), extra: wishNote(id, !!friend) }),
    },
      // (Yours, as it is now: its grown form once it has grown up.)
      sprite(friend ? artOf(friend) : id, !!(friend && friend.heirloom)),
      h('b', null, met ? (friend ? kindNameOf(friend) : kind.name) : '???'),
      met ? elementTag(kind.element) : h('small', null, 'Not met'),
      // A heart for a friend. For its Heirloom: a gold mark once yours wears the colours, a hollow one if
      // you have only seen it.
      h('span', { class: 'stamps' }, friend ? h('i', { class: 'stamp pal', title: 'A friend' }, '♥') : null,
        // A ringleader with a wish still to grant; or one whose wish is granted, waiting.
        !friend && kind.boss && game.wish(id) && game.waiting().some((one) => one.id === id) ? h('i', { class: `stamp wishing${game.wish(id).granted ? ' granted' : ''}`, title: game.wish(id).granted ? 'Wish granted: waiting out of doors' : 'Has a wish' }, game.wish(id).granted ? '!' : '?') : null,
        book[id].grown ? h('i', { class: 'stamp grownup', title: 'Grown up' }, '▲') : null,
        SPECIES[id].keepsake && book[id].met ? h('i', { class: 'stamp keep', title: 'A Keepsake: one of a kind' }, '★') : null,
        friend && friend.heirloom ? h('i', { class: 'stamp gold', title: 'Heirloom kept' }, '❖')
          : book[id].heirloom ? h('i', { class: 'stamp seen', title: 'Heirloom seen, not kept' }, '◇') : null));
  });
  // The hunt: which Heirlooms you have, which you have seen get away, and which are still out there.
  const kept = canJoin.filter((id) => friends.some((f) => f.species === id && f.heirloom));
  const seen = canJoin.filter((id) => book[id].heirloom && !kept.includes(id));
  const toFind = canJoin.filter((id) => !kept.includes(id));
  const calm = ROOMS.filter((room) => game.state.rooms[room.id].clears > 0);
  const one = (odds) => `one in ${Math.round(1 / odds)}`;
  const hunt = h('div', { class: 'card hunt', data: { kept: String(kept.length), seen: String(seen.length) } },
    h('div', { class: 'huntline' }, h('b', null, 'Heirlooms'), bar('xp', kept.length / canJoin.length, `${kept.length} of ${canJoin.length} kept`)),
    h('p', null, `About ${one(HEIRLOOM.odds)} restless Clutterkin is an Heirloom, in rare colours: ${one(HEIRLOOM.calmOdds)} in a place you have calmed, where kinds like the three you set out with come calling too. You can see one glint before you walk up. Reach out to it and win; if you already have that kind, yours takes its colours.`),
    h('small', { data: { act: 'where' } }, calm.length ? `Calm now, so best for looking: ${calm.map((room) => room.name).join(', ')}.` : 'Nowhere is calm yet. Calm a place and go back to it.'),
    toFind.length
      ? h('small', { data: { act: 'tofind' } }, `Still to find: ${toFind.map((id) => (book[id].met ? SPECIES[id].name : '???') + (seen.includes(id) ? ' (seen)' : '')).join(', ')}.`)
      : h('small', { class: 'gold', data: { act: 'tofind' } }, 'You have every one of them.'));
  const el = h('section', { id: 'book', class: 'page' },
    h('header', { class: 'bar-top' }, h('h1', null, 'Scrapbook')),
    h('p', { class: 'note', data: { act: 'counts' } }, `Met ${kinds.filter((id) => book[id].met).length} of ${kinds.length} · Friends ${friends.filter((friend) => !SPECIES[friend.species].boss).length} of ${canJoin.length} · Ringleaders home ${friends.filter((friend) => SPECIES[friend.species].boss).length} of ${chiefs.length} · Grown up ${canJoin.filter((id) => book[id].grown).length} of ${canJoin.length} · Heirlooms ${kept.length} of ${canJoin.length}`),
    keyRing(game.state),
    hunt,
    h('div', { class: 'grid book' }, tiles),
    h('h3', null, 'Elements'),
    h('div', { class: 'ring' }, ELEMENT_IDS.map((id) => h('div', null, elementTag(id), h('span', null, ' beats '), elementTag(ELEMENTS[id].beats), h('small', null, ` ${ELEMENTS[id].why}.`)))),
    h('p', { class: 'note' }, 'Beating an element: damage ×1.5. Being beaten by it: ×0.7.'));
  return { el };
}

export function settingsScreen(ctx) {
  const { game } = ctx;
  const { settings, player, stats } = game.state;
  const fast = h('button', { class: `switch${settings.fast ? ' on' : ''}`, role: 'switch', 'aria-label': 'Fast fights', data: { act: 'fast' } });
  fast.addEventListener('click', () => { settings.fast = !settings.fast; fast.classList.toggle('on', settings.fast); ctx.save(); });
  // Sound effects and music each have a switch of their own.
  const flip = (key, label) => {
    const button = h('button', { class: `switch${settings[key] ? ' on' : ''}`, role: 'switch', 'aria-label': label, data: { act: key } });
    button.addEventListener('click', () => {
      settings[key] = !settings[key];
      button.classList.toggle('on', settings[key]);
      setSound({ effects: settings.sound, music: settings.music });
      unlockSound();
      ctx.save();
    });
    return button;
  };
  const sound = flip('sound', 'Sound effects');
  const music = flip('music', 'Music');

  const el = h('section', { id: 'settings', class: 'page' },
    h('header', { class: 'bar-top' }, h('h1', null, 'Settings')),
    h('div', { class: 'card' },
      h('div', { class: 'toggle' }, h('div', null, 'Sound effects', h('small', null, 'Footsteps, taps, and what happens in a fight.')), sound),
      h('div', { class: 'toggle' }, h('div', null, 'Music', h('small', null, 'A lullaby out in the lane, something livelier in a fight.')), music),
      h('div', { class: 'toggle' }, h('div', null, 'Fast fights', h('small', null, 'Play the moves back quicker.')), fast)),
    h('div', { class: 'card you' },
      sprite(player.look),
      h('div', null, h('b', null, player.name), h('small', null, 'The house-sitter')),
      h('button', { class: 'btn plain small', data: { act: 'look' }, onclick: () => lookDialog(ctx, false) }, 'Change')),
    h('div', { class: 'card' },
      h('small', null, `Fights ${stats.battles} · won ${stats.wins} · friends made ${stats.befriended} · Heirlooms ${stats.heirlooms}`)),
    h('div', { class: 'card' },
      h('p', null, 'No ads, no tracking, no accounts, no purchases. This game never uses the network: your save lives on this device only.'),
      h('small', { data: { build: BUILD } }, `${TITLE} ${VERSION}${BUILD === 'dev' ? '' : `, build ${BUILD}`}. ${ROOMS.filter(roomBuilt).length} places to calm, ${SPECIES_IDS.filter((id) => !SPECIES[id].boss).length} friends to make.`)),
    h('button', {
      class: 'btn danger', data: { act: 'reset' },
      onclick: () => modal({
        title: 'Start over?', body: [h('p', null, 'This erases your save on this device: friends, levels and all. It cannot be undone.')],
        actions: [{ id: 'keep', label: 'Keep playing', kind: 'plain' }, { id: 'erase', label: 'Erase and start over', kind: 'danger', onClick: () => ctx.resetGame() }],
      }),
    }, 'Start over'));
  return { el };
}

/**
 * What you call a friend. It answers to its kind's name; a name of your own is used everywhere
 * instead, until you take it away again. `after` runs once it has changed.
 */
export function nameDialog(ctx, friend, after) {
  const { game } = ctx;
  const kind = { name: kindNameOf(friend) }; // what its kind is called as it stands now: its grown form's name, once grown
  // The keyboard's return key is Done.
  const input = h('input', { type: 'text', maxLength: NAME_LENGTH, value: friend.nick || '', placeholder: kind.name, autocomplete: 'off', spellcheck: false, enterKeyHint: 'done', 'aria-label': `What you call your ${kind.name}`, data: { field: 'nick' },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); dialog.el.querySelector('[data-id="save"]').click(); } } });
  const set = (text) => {
    const was = nameOf(friend);
    const now = game.nameFriend(friend.id, text);
    if (now === null) return;
    ctx.save();
    if (now !== was) toast(now === kind.name ? `${kind.name} again.` : `${now} it is.`, { kind: 'good' });
    after();
  };
  const dialog = modal({
    title: 'What do you call it?', cls: 'naming',
    body: [
      h('div', { class: 'namingtop' }, sprite(artOf(friend), friend.heirloom, 'flip'),
        h('p', null, `Its kind is ${kind.name}, and it answers to that. It will answer to a name of your own just as gladly.`)),
      h('label', null, h('small', null, `A name of your own (up to ${NAME_LENGTH} letters)`), input),
    ],
    actions: [...(friend.nick ? [{ id: 'own', label: `Just ${kind.name}`, kind: 'plain', onClick: () => set('') }] : []), { id: 'save', label: 'Done', onClick: () => set(input.value) }],
  });
  return dialog;
}

/** Name and look. `first` is the intro: no way out but Begin. */
export function lookDialog(ctx, first) {
  const { game } = ctx;
  let look = game.state.player.look;
  // (The keyboard's return key puts the keyboard away: there is still a look to choose.)
  const input = h('input', { type: 'text', maxLength: NAME_LENGTH, value: first ? '' : game.state.player.name, placeholder: 'Your name', autocomplete: 'off', spellcheck: false, enterKeyHint: 'done', data: { field: 'name' },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } } });
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
