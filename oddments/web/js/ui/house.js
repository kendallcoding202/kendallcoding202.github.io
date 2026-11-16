// The path through a room: where you are on it, how the team is, and the way on.
import { SPECIES, roomOf } from '../core/balance.js';
import { h, sprite } from './dom.js';
import { bar } from './parts.js';

/** A room's path: where you are on it, how the team is, and the way on. */
export function pathScreen(ctx) {
  const { game } = ctx;
  const visit = game.state.visit;
  const room = roomOf(visit.room);
  const spot = room.path[visit.stop];
  const health = game.teamHealth();

  const stops = room.path.map((stop, i) => {
    const boss = !!stop.boss;
    const met = boss && game.state.book[stop.boss].met;
    return h('span', { class: `stop${i < visit.stop ? ' done' : i === visit.stop ? ' here' : ''}${boss ? ' boss' : ''}`, data: { stop: String(i) } },
      boss ? sprite(stop.boss, false, met ? '' : 'shadowy') : (i < visit.stop ? '✓' : String(i + 1)),
      i === visit.stop ? sprite(game.state.player.look, false, 'sitter') : null);
  });

  const team = game.team().map((friend, i) => {
    const hp = health[i];
    return h('div', { class: `teamcard${hp.hp <= 0 ? ' down' : ''}` },
      sprite(friend.species, friend.heirloom, 'flip'),
      h('div', null, h('b', null, SPECIES[friend.species].name), h('small', null, `Lv ${friend.level}`), bar(`hp${hp.hp / hp.max < 0.3 ? ' low' : ''}`, hp.hp / hp.max, `${hp.hp} / ${hp.max}`)));
  });

  const el = h('section', { id: 'path' },
    h('div', { class: 'scene' },
      h('img', { class: 'bg', src: `assets/bg/${room.bg}.webp`, alt: '' }),
      h('div', { class: 'roundpill' }, h('b', null, room.name)),
      h('div', { class: 'stops' }, stops)),
    h('div', { class: 'panel' },
      h('h2', null, spot.name),
      h('p', null, spot.boss ? `Stop ${visit.stop + 1} of ${room.path.length}. Something big is waiting.` : `Stop ${visit.stop + 1} of ${room.path.length}. Something is rustling.`),
      h('div', { class: 'teamlist' }, team),
      h('button', { class: 'btn gold', data: { act: 'onward' }, onclick: () => { if (game.startEncounter()) ctx.show('fight'); } }, spot.boss ? 'Face the boss' : 'Onward'),
      h('button', { class: 'btn plain', data: { act: 'home' }, onclick: () => { if (game.leaveRoom()) { ctx.save(); ctx.show('lane'); } } }, 'Back out to the lane')));
  return { el };
}
