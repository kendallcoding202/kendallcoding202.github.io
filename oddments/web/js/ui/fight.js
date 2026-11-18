// The fight screen. The rules live in core/battle.js; this draws them.
//
// The engine runs ahead: when the player chooses, it resolves that move and
// every reply up to the next choice, and leaves a list of events. This
// screen plays those events back one at a time, so what is on screen is
// always the fight as told so far, not as it already stands.
import { SPECIES, CALLS, CALL_IDS, ELEMENTS, BRACE, moveOf, roomOf, elementEdge } from '../core/balance.js';
import { unitOf } from '../core/battle.js';
import { h, sprite, setText, wait } from './dom.js';
import { modal } from './modals.js';
import { elementTag, moveLine, oddmentCard } from './parts.js';
import { lineFor, toGo, howItGoes } from './text.js';
import { howToFight, EDGE_WORDS } from './howto.js';
import { play as sound } from '../platform/sound.js'; // (this screen has a `play` of its own: playing back the fight)
import { artOf } from '../core/names.js';
import { CAST } from '../core/story.js';

export function fightScreen(ctx) {
  const { game } = ctx;
  const battle = game.battle;
  const visit = game.state.visit;
  const bout = game.bout; // a bout with somebody who was waiting by the road: { who, meeting }, or null
  const wild = game.wild >= 0 || !!bout; // out on the lane (strays, or a bout): no place, and no stop of one
  const room = wild ? null : roomOf(visit.room);
  const spot = wild ? null : room.path[game.facing];
  const pace = () => (game.state.settings.fast || ctx.fast ? 0.2 : 1);
  const pause = (ms) => wait(ms * pace());

  const view = {}; // key -> what is on screen for that fighter
  let cursor = 0; // the next event to play
  let orderAt = 0; // how far along the round's order we are
  let busy = true;
  let armed = null; // a move or Call waiting for its target
  let notReady = 0; // the pips left on whoever was just reached and was not ready (0: nobody was)
  let over = false;

  // ------------------------------------------------------------ building

  // A fighter on screen: its sprite standing on the ground, a shadow under its
  // feet, and below that a small bar for its Health (and, for a restless one,
  // the pips of its Huff). Names and numbers are a tap away, not in the air.
  function buildUnit(unit) {
    const fill = h('i');
    const pips = h('div', { class: 'pips' });
    const chips = h('div', { class: 'chips' });
    const edge = h('span', { class: 'edge', hidden: true });
    const body = h('div', { class: 'body' }, sprite(artOf(unit), unit.heirloom, 'sprite'));
    // In a boss fight the boss's company stands either side of it, whichever slots they hold.
    const company = battle.units.filter((u) => u.side === 'foe' && !u.boss);
    const corner = unit.side === 'foe' && !unit.boss && company.length < battle.units.filter((u) => u.side === 'foe').length ? ` side${company.indexOf(unit)}` : '';
    const el = h('button', {
      class: `unit ${unit.side}${unit.boss ? ' boss' : ''}${unit.heirloom ? ' rare' : ''}${unit.grown ? ' grown' : ''} s${unit.slot}${corner}${SPECIES[unit.species].fly ? ' fly' : ''}`,
      data: { unit: unit.key }, 'aria-label': `${unit.name}, level ${unit.level}`, onclick: () => tapUnit(unit.key),
    }, body, h('i', { class: 'shadow' }), h('div', { class: 'foot' }, h('span', { class: `el el-${unit.element} under`, data: { element: unit.element } }, ELEMENTS[unit.element].name), h('div', { class: 'hpbar' }, fill), pips, chips), edge);
    view[unit.key] = { unit, el, body, fill, pips, chips, edge, hp: unit.maxHp, huff: unit.maxHuff, gone: false };
    return el;
  }
  const both = (key, fn) => fn(view[key].el);

  const allies = battle.units.filter((unit) => unit.side === 'ally');
  const foes = battle.units.filter((unit) => unit.side === 'foe');
  const floaters = h('div', { class: 'floaters' });
  const roundEl = h('b', null, 'Round 1');
  const caller = h('div', { class: 'caller' }, sprite(game.state.player.look));
  // In a bout, whoever the other three belong to is not on the field either: they stand at the other
  // end of the same strip, facing you across it. (The owner asked for this: "at the bottom like where you see my character".)
  const backer = bout ? h('div', { class: 'caller theirs', data: { who: bout.who }, title: CAST[bout.who].name }, sprite(CAST[bout.who].art)) : null;
  const units = [...allies, ...foes].map(buildUnit);
  const arena = h('div', { class: `arena${foes.some((unit) => unit.boss) ? ' bossfight' : ''}` },
    h('img', { class: 'bg', src: `assets/bg/${wild ? 'bg_lane' : room.bg}.webp`, alt: '' }),
    h('div', { class: 'topline' },
      h('div', { class: 'roundpill' }, roundEl, h('span', null, bout ? `Out on the lane · a bout with ${CAST[bout.who].name}` : wild ? (SPECIES[foes[0].species].keepsake ? 'Out in the open · a Keepsake' : `Out on the lane · ${['a stray', 'two strays', 'three strays'][foes.length - 1] || 'strays'}`) : visit.stroll ? `${spot.name} · calm` : `${spot.name} · ${howItGoes(visit, room)}`)),
      h('button', { class: 'iconbtn menu', 'aria-label': 'Menu', data: { act: 'menu' }, onclick: openMenu }, '⋯')),
    units, floaters);
  const orderEl = h('div', { class: 'order' });
  const sayEl = h('div', { class: 'say', 'aria-live': 'polite' });
  const panel = h('div', { class: 'panel' });
  const root = h('section', { id: 'fight', data: { busy: '1' } }, arena, orderEl, sayEl, panel);

  const nameOf = (key) => view[key].unit.name;
  const kindOf = (key) => view[key].unit.species;
  const say = (text) => { if (text) setText(sayEl, text); };

  // ------------------------------------------------------------ drawing

  function drawPlate(key) {
    const v = view[key];
    v.fill.style.width = `${Math.max(0, v.hp / v.unit.maxHp) * 100}%`;
    v.fill.className = v.hp / v.unit.maxHp < 0.3 ? 'low' : '';
    if (v.unit.maxHuff > 0) {
      v.pips.replaceChildren(...Array.from({ length: v.unit.maxHuff }, (_, i) => h('i', { class: i < v.huff ? 'on' : '' })));
      v.pips.title = `Huff ${v.huff}/${v.unit.maxHuff}`;
    }
  }

  function drawChips(key) {
    const v = view[key];
    const seen = new Set();
    const chips = [];
    for (const mod of v.unit.mods) {
      const id = `${mod.stat}${mod.by > 0 ? '+' : '-'}`;
      if (seen.has(id)) continue;
      seen.add(id);
      chips.push(h('i', { class: mod.by > 0 ? 'up' : 'down', title: `${mod.stat} ${mod.by > 0 ? 'up' : 'down'}` }, `${mod.stat === 'oomph' ? 'O' : mod.stat === 'grit' ? 'G' : 'P'}${mod.by > 0 ? '▲' : '▼'}`));
    }
    v.chips.replaceChildren(...chips);
  }

  function drawOrder(order) {
    orderAt = 0;
    orderEl.replaceChildren(h('small', null, 'Turns'), ...order.map((key, i) => {
      const unit = view[key].unit;
      return h('span', { class: `chip ${unit.side}`, data: { i: String(i), key } }, sprite(artOf(unit), unit.heirloom));
    }));
  }

  function markTurn(key) {
    const chips = Array.from(orderEl.querySelectorAll('.chip'));
    let index = chips.findIndex((chip, i) => i >= orderAt && chip.dataset.key === key);
    if (index < 0) index = orderAt;
    chips.forEach((chip, i) => { chip.classList.toggle('now', i === index); chip.classList.toggle('past', i < index); });
    orderAt = index + 1;
    for (const k of Object.keys(view)) both(k, (el) => el.classList.toggle('turn', k === key));
  }

  function float(key, text, cls, ms = 900) {
    const v = view[key];
    const el = h('span', { class: `float ${cls}` }, text);
    const box = v.el.getBoundingClientRect();
    const frame = arena.getBoundingClientRect();
    // (A speech bubble is kept on the screen: over whoever stands at the edge it would otherwise hang off it.)
    const inset = cls === 'bubble' ? 46 : 0;
    el.style.left = `${Math.max(inset, Math.min(frame.width - inset, box.left - frame.left + box.width / 2))}px`;
    el.style.top = `${cls === 'bubble' ? box.top - frame.top - 31 : box.top - frame.top + box.height * 0.2}px`;
    floaters.append(el);
    setTimeout(() => el.remove(), ms);
  }

  /** A ring where something lands. */
  function burst(key, cls = '') {
    const box = view[key].body.getBoundingClientRect();
    const frame = arena.getBoundingClientRect();
    const el = h('i', { class: `burst ${cls}`.trim() });
    el.style.left = `${box.left - frame.left + box.width / 2}px`;
    el.style.top = `${box.top - frame.top + box.height * 0.55}px`;
    floaters.append(el);
    setTimeout(() => el.remove(), 480);
  }

  function flash(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation if it is already running
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // ------------------------------------------------------------ playing events

  async function playEvent(event) {
    switch (event.t) {
      case 'start':
        for (const snap of event.units) { view[snap.key].hp = snap.hp; view[snap.key].huff = snap.huff; drawPlate(snap.key); if (snap.hp <= 0) leave(snap.key, 'down'); }
        break;
      case 'round':
        setText(roundEl, `Round ${event.n}`);
        drawOrder(event.order);
        await pause(260);
        break;
      case 'turn':
        markTurn(event.who);
        await pause(view[event.who].unit.side === 'foe' ? 380 : 60);
        break;
      case 'use':
        say(lineFor(event, nameOf));
        flash(view[event.who].el, event.move === BRACE.id || !moveOf(event.move).power ? 'cast' : 'lunge', 440);
        sound(event.move === BRACE.id ? 'brace' : 'use');
        await pause(400);
        break;
      case 'hit': {
        const v = view[event.target];
        v.hp = event.hp;
        drawPlate(event.target);
        float(event.target, `−${event.dmg}${event.edge > 0 ? '!' : ''}`, event.edge > 0 ? 'dmg strong' : event.edge < 0 ? 'dmg weak' : 'dmg');
        burst(event.target, event.edge > 0 ? 'strong' : '');
        flash(v.el, 'hurt', 400);
        sound(event.edge > 0 ? 'strong' : event.edge < 0 ? 'weak' : 'hit');
        if (event.edge > 0 || event.down) flash(arena, 'shake', 320);
        say(lineFor(event, nameOf));
        await pause(event.edge ? 520 : 380);
        if (event.down) { leave(event.target, 'down'); sound('faint'); await pause(260); }
        break;
      }
      case 'mend':
        view[event.target].hp = event.hp;
        drawPlate(event.target);
        float(event.target, `+${event.amount}`, 'heal');
        burst(event.target, 'heal');
        sound('mend');
        say(lineFor(event, nameOf));
        await pause(400);
        break;
      case 'mod':
        float(event.target, `${event.stat === 'oomph' ? 'Oomph' : event.stat === 'grit' ? 'Grit' : 'Pep'} ${event.by > 0 ? '▲' : '▼'}`, event.by > 0 ? 'up' : 'down');
        sound(event.by > 0 ? 'up' : 'down');
        say(lineFor(event, nameOf));
        await pause(340);
        break;
      case 'call':
        say(lineFor(event, nameOf));
        flash(caller, 'calling', 420);
        sound(event.call === 'reach' ? 'reach' : 'call');
        await pause(380);
        break;
      case 'huff': {
        const v = view[event.target];
        v.huff = event.huff;
        drawPlate(event.target);
        flash(v.pips, 'pop', 400);
        sound(event.by > 0 ? 'huff' : 'pip');
        say(lineFor(event, nameOf, kindOf));
        if (event.by < 0 && event.huff > 0) {
          // Reached, and not ready to come: it turns its back on you where everyone can see, and says so.
          flash(v.el, 'refuse', 900);
          float(event.target, 'Not yet!', 'bubble', 1300);
          sound('notyet');
          notReady = event.huff;
          await pause(900);
        } else await pause(360);
        break;
      }
      case 'settle':
        say(lineFor(event, nameOf));
        leave(event.target, 'settled');
        float(event.target, '♥', 'heart');
        sound('settle');
        await pause(700);
        break;
      case 'end':
        over = true;
        say(event.won ? 'The way is clear.' : event.why === 'conceded' ? 'You walk away.' : event.why === 'draw' ? 'Everyone is too tired to go on.' : 'Your friends are worn out.');
        await pause(520);
        break;
      default:
        break;
    }
  }

  function leave(key, how) {
    const v = view[key];
    v.gone = true;
    both(key, (el) => { el.classList.add(how); el.classList.remove('turn'); });
    for (const chip of orderEl.querySelectorAll(`.chip[data-key="${key}"]`)) chip.classList.add('gone');
  }

  let playing = false;
  async function play() {
    if (playing) return;
    playing = true;
    busy = true;
    root.dataset.busy = '1';
    disarm();
    drawPanel();
    notReady = 0;
    while (cursor < battle.events.length) await playEvent(battle.events[cursor++]);
    for (const key of Object.keys(view)) { view[key].hp = view[key].unit.hp; view[key].huff = view[key].unit.huff; drawPlate(key); drawChips(key); }
    playing = false;
    busy = false;
    root.dataset.busy = '0';
    if (over) { finish(); return; }
    const who = game.choices().unit;
    // After a Reach out that was not enough, the turn is still yours: say how far there is to go, and whose move it is.
    say(notReady ? `${toGo(notReady)} ${who.name}'s turn.` : `${who.name}'s turn. Pick a move.`);
    drawPanel();
  }

  // ------------------------------------------------------------ choosing

  // What the controls show while nobody can choose (moves playing back, or the fight just
  // starting): the same shape as a real turn, switched off, so the screen never changes height.
  function standIn() {
    const unit = allies.find((ally) => ally.hp > 0) || allies[0];
    const off = (id) => ({ id, wait: 0, ready: false, targets: null, used: false });
    return { unit, moves: [...unit.moves.map((slot) => off(slot.id)), off(BRACE.id)], calls: CALL_IDS.map(off), idle: true };
  }

  function drawPanel() {
    const live = busy || over ? null : game.choices();
    if (!live && panel.childElementCount) {
      panel.classList.add('waiting');
      for (const b of panel.querySelectorAll('button')) b.disabled = true;
      return;
    }
    const options = live || standIn();
    panel.classList.toggle('waiting', !live);
    const { unit } = options;
    const button = (option) => {
      const move = moveOf(option.id);
      const on = armed && armed.type === 'move' && armed.id === option.id;
      return h('button', {
        class: `move${move.element ? ` el-${move.element}` : ' plain'}${on ? ' armed' : ''}`, disabled: !option.ready, data: { move: option.id },
        onclick: () => choose('move', option),
      },
        h('b', null, move.name),
        option.wait > 0 ? h('small', null, `Ready in ${option.wait} turn${option.wait === 1 ? '' : 's'}`) : null,
        option.wait > 0 ? null : h('small', { class: 'short' }, option.id === BRACE.id ? 'Take a third less' : shortLine(move)),
        option.wait > 0 ? null : h('small', { class: 'long' }, `${moveLine(option.id)}.`),
        move.element ? h('i', { class: 'dot' }, ELEMENTS[move.element].name) : null);
    };
    // Always four places: the moves it knows, the ones it has yet to learn, and Brace last.
    const known = options.moves.slice(0, -1).map(button);
    const later = SPECIES[unit.species].moves.filter(([, at]) => at > unit.level)
      .map(([, at]) => h('div', { class: 'moveslot' }, h('b', null, 'A move to learn'), h('small', null, `At level ${at}`)));
    const moves = [...known, ...later, button(options.moves[options.moves.length - 1])];
    const calls = options.calls.map((option) => {
      const call = CALLS[option.id];
      const on = armed && armed.type === 'call' && armed.id === option.id;
      const why = options.idle ? '' : option.used ? 'Used this round' : option.wait > 0 ? 'Next round' : option.targets.length ? '' : option.id === 'reach' ? (bout ? 'Not lost' : 'Nobody to reach') : 'Nobody is hurt';
      return h('button', { class: `call${on ? ' armed' : ''}`, disabled: !option.ready, data: { call: option.id }, title: call.desc, onclick: () => choose('call', option) },
        h('b', null, call.name), why ? h('small', null, why) : null);
    });
    panel.replaceChildren(
      h('div', { class: 'who' }, sprite(artOf(unit), unit.heirloom), h('div', null, h('b', null, unit.name), elementTag(unit.element)),
        armed ? h('button', { class: 'btn plain small', data: { act: 'cancel' }, onclick: () => { disarm(); drawPanel(); } }, 'Cancel') : null),
      h('div', { class: 'moves' }, moves),
      h('div', { class: 'calls' }, caller, h('div', { class: 'set' }, h('small', null, `${game.state.player.name}'s Call · one a round`), h('div', null, calls)), backer));
  }

  const shortLine = (move) => {
    if (move.power && move.sap) return `${Math.round(move.power * 100)}% · lowers ${move.sap.stat === 'grit' ? 'Grit' : move.sap.stat === 'pep' ? 'Pep' : 'Oomph'}`;
    if (move.power) return `${Math.round(move.power * 100)}%${move.aim === 'foes' ? ' to all' : ''}`;
    if (move.mend) return `Mend ${Math.round(move.mend * 100)}%${move.aim === 'allies' ? ' all' : move.aim === 'self' ? ' self' : ''}`;
    if (move.boost) return `${move.boost.stat === 'grit' ? 'Grit' : move.boost.stat === 'pep' ? 'Pep' : 'Oomph'} up`;
    return `Lowers ${move.sap.stat === 'grit' ? 'Grit' : move.sap.stat === 'pep' ? 'Pep' : 'Oomph'}`;
  };

  function choose(type, option) {
    if (busy || over || !option.ready) return;
    if (armed && armed.type === type && armed.id === option.id) { disarm(); drawPanel(); return; }
    disarm();
    const targets = option.targets;
    if (!targets) { commit({ type, id: option.id }); return; }
    if (targets.length === 1) { commit({ type, id: option.id, target: targets[0] }); return; }
    armed = { type, id: option.id, targets };
    const move = type === 'move' ? moveOf(option.id) : null;
    const actor = game.choices().unit;
    for (const key of targets) {
      const v = view[key];
      both(key, (el) => el.classList.add('pick'));
      if (move && move.power) {
        const edge = elementEdge(move.element, v.unit.element);
        // What this move will do to them, in words that cannot be read the other way round.
        if (edge) { v.edge.hidden = false; v.edge.className = `edge two ${edge > 0 ? 'strong' : 'weak'}`; setText(v.edge, edge > 0 ? EDGE_WORDS.strong : EDGE_WORDS.weak); }
      }
      if (type === 'call' && option.id === 'reach') {
        const soft = allies.some((ally) => ally.hp > 0 && ally.element === ELEMENTS[v.unit.element].beats);
        v.edge.hidden = false; v.edge.className = `edge ${soft ? 'strong' : 'even'}`; setText(v.edge, soft ? '−3 pips' : '−2 pips');
      }
    }
    say(type === 'call' ? `${CALLS[option.id].name}: tap who.` : `${actor.name}: tap a target for ${move.name}.`);
    drawPanel();
  }

  function disarm() {
    armed = null;
    for (const key of Object.keys(view)) { both(key, (el) => el.classList.remove('pick')); view[key].edge.hidden = true; }
  }

  function tapUnit(key) {
    if (busy || over) return;
    if (armed) {
      if (armed.targets.includes(key)) commit({ type: armed.type, id: armed.id, target: key });
      return;
    }
    const unit = unitOf(battle, key);
    oddmentCard({ species: unit.species, level: unit.level, heirloom: unit.heirloom, grown: unit.grown, name: unit.side === 'ally' || unit.owned ? unit.name : '', huff: unit.side === 'foe' ? unit.huff : null, owner: unit.owned && bout ? CAST[bout.who].name : '' });
  }

  function commit(action) {
    if (busy || over) return;
    if (!game.act(action)) { disarm(); drawPanel(); return; }
    play();
  }

  // ------------------------------------------------------------ menu and ending

  function openMenu() {
    if (over) return;
    const fast = h('button', { class: `switch${game.state.settings.fast ? ' on' : ''}`, role: 'switch', 'aria-label': 'Fast fights', data: { act: 'fast' } });
    fast.addEventListener('click', () => { game.state.settings.fast = !game.state.settings.fast; fast.classList.toggle('on', game.state.settings.fast); ctx.save(); });
    modal({
      title: 'Fight', cls: 'menu',
      body: [
        h('div', { class: 'toggle' }, h('div', null, 'Fast fights', h('small', null, 'Play the moves back quicker.')), fast),
        h('p', { class: 'note' }, 'Tap a move, then who it is for. Tap anyone on the field to read about them.'),
        h('p', { class: 'note' }, 'To bring one home, stop hitting it and Reach out. Each hit you land puts a pip back.'),
      ],
      actions: [
        { id: 'stay', label: 'Back to the fight', kind: 'plain' },
        { id: 'howto', label: 'How a fight works', kind: 'plain', onClick: () => { howToFight(); } },
        { id: 'concede', label: 'Walk away', kind: 'danger', onClick: () => { if (!busy && game.concede()) play(); } },
      ],
    });
  }

  function finish() {
    const summary = game.finishBattle();
    ctx.save();
    ctx.afterFight(summary, foes);
  }

  // The fight may already be several events old: whoever is quicker than the team has acted.
  // Before your very first, how a fight works is explained; the fight waits until that has been read.
  if (game.state.seen.fights) play();
  else { game.state.seen.fights = true; ctx.save(); howToFight(play); }
  return { el: root };
}
