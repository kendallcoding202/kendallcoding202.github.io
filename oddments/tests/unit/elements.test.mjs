// The six household elements and the ring they make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, ELEMENT_IDS, STRONG, WEAK, elementEdge, elementMult, softSpotOf } from '../../web/js/core/balance.js';

test('there are six elements, each with a name, a colour and a reason', () => {
  assert.equal(ELEMENT_IDS.length, 6);
  for (const id of ELEMENT_IDS) {
    const element = ELEMENTS[id];
    assert.match(element.name, /^[A-Z][a-z]+$/);
    assert.match(element.color, /^#[0-9a-f]{6}$/);
    assert.ok(element.why.startsWith(element.name) && element.why.endsWith(ELEMENTS[element.beats].name), element.why);
  }
});

test('the elements make one ring: each beats exactly one and is beaten by exactly one', () => {
  for (const id of ELEMENT_IDS) {
    assert.ok(ELEMENTS[ELEMENTS[id].beats], `${id} beats a real element`);
    assert.notEqual(ELEMENTS[id].beats, id);
    assert.equal(ELEMENT_IDS.filter((other) => ELEMENTS[other].beats === id).length, 1, `${id} is beaten by one`);
  }
  // Following "beats" from anywhere visits all six before coming home: one ring, not two.
  const walked = [];
  for (let at = ELEMENT_IDS[0]; !walked.includes(at); at = ELEMENTS[at].beats) walked.push(at);
  assert.equal(walked.length, 6);
});

test('a move is strong into what its element beats, weak into what beats it, even otherwise', () => {
  assert.ok(STRONG > 1 && WEAK < 1 && WEAK > 0);
  let strong = 0;
  let weak = 0;
  for (const attack of ELEMENT_IDS) {
    for (const defend of ELEMENT_IDS) {
      const edge = elementEdge(attack, defend);
      assert.equal(edge + elementEdge(defend, attack), 0, 'what is strong one way is weak the other');
      assert.equal(elementMult(attack, defend), edge > 0 ? STRONG : edge < 0 ? WEAK : 1);
      if (edge > 0) strong++;
      if (edge < 0) weak++;
    }
    assert.equal(elementEdge(attack, attack), 0, 'never against itself');
  }
  assert.equal(strong, 6);
  assert.equal(weak, 6);
  assert.equal(elementEdge('fluff', 'suds'), 1);
  assert.equal(elementEdge('suds', 'fluff'), -1);
  assert.equal(elementEdge('fluff', 'crumb'), 0);
});

test('a move with no element, or a made-up one, is simply even', () => {
  assert.equal(elementMult(null, 'suds'), 1);
  assert.equal(elementMult('constructor', 'suds'), 1);
  assert.equal(elementMult('suds', undefined), 1);
});

test('an Oddkin has a soft spot for the element it beats', () => {
  for (const id of ELEMENT_IDS) assert.equal(softSpotOf(id), ELEMENTS[id].beats);
});
