# Oddments (working title)

**The house is awake. The cats fight it. You are going to try talking to it.**

A creature-collecting RPG for iPhone set in the world of Pawst Lives. The monsters are things from a house that came alive (Sock Eel, Toast Ghost, Dust Bunny). You are a person, house-sitting, who befriends them and battles alongside them, three against three.

This is the **framework and a playable slice**, not the finished game: the whole neighbourhood to walk around, and the first of its eight places (the garden) to play.

- The design on one page: [docs/DESIGN.md](docs/DESIGN.md)
- The art that exists and the art still needed, with counts: [docs/ART.md](docs/ART.md)
- Play the slice: <https://kendallcoding202.github.io/oddments/web/> (this repository is a public website, so that address is public)

No ads, no analytics, no accounts, no purchases, no network calls. The save lives on the device and nowhere else.

## The name

"Oddments" is a placeholder (it is also what the creatures are called). The name is yours to choose. Five suggestions:

1. **Oddments** — odd socks, odd ends, the things left over. Short, and it names the creatures.
2. **Homebodies** — household things that got bodies.
3. **Housewarming** — what you are doing to a house full of grumpy things.
4. **While the Cats Sleep** — ties it to Pawst Lives: the cats fight at night, you work the day shift.
5. **Things That Go Clank** — a wink at "bump in the night", with one of our elements in it.

None of these has been checked against the App Store or trademarks.

## Run it

```sh
npm start                 # http://127.0.0.1:5174
```

There is nothing to install and no build step: `web/` is plain JavaScript modules and runs as it is. Useful address switches: `?reset` starts from a clean save, `?fast` plays fights back quickly, `?seed=7` makes a new game the same every time, `?debug` exposes the game as `window.oddments` in the console.

## Test it

```sh
npm test                  # every rule, the save, pacing, iOS 15, the sealed page (about 3 seconds)
npm run sim               # how long fights last and how hard the first place is
npm run e2e               # plays the real game in headless Chromium by tapping
node tests/e2e/preview.mjs            # builds the preview and smoke-tests it
node tests/e2e/preview.mjs https://kendallcoding202.github.io/oddments/web/   # the same against the published copy
```

`npm run e2e` needs Playwright: `npm install --no-save playwright && npx playwright install chromium`.

`npm run sim` takes `[players] [--style=friendly|brawler|careless] [--visits=4]`. Today a sensible player clears the garden on the first visit about four times in five and always by the second; fights last two to five rounds; a visit is about four minutes of fighting (the simulator does not count the walking). `tests/unit/pacing.test.mjs` holds the game to that shape.

## How it is built

The same way as Pawst Lives.

```
web/                    the game: what ships
  js/core/              rules only. No drawing, no clock, no storage; runs in Node
    balance.js          every number and name. Tune here.
    battle.js           the fight: turn order, damage, moves, Calls, reaching out
    progress.js         experience, levels, who comes home
    rooms.js            who is restless in a place, and a visit: from stepping in to resting at home
    world.js            the open world: what stands where, where feet can go, finding the way
    game.js             the Game object: every action a player can take
    state.js            the save format and repair of old or damaged saves
    trial.js            a save is rehearsed on a copy before the game trusts it
    auto.js             a plain stand-in player, for the simulator and the rehearsal
    util.js             the seeded random generator
  js/ui/                the screens: the world you walk in, the fight, friends, scrapbook
  js/platform/          storage. The only code that knows where the save lives.
  assets/               sprites, room paintings, font (about 1 MB)
tests/unit/             a test per rule (node:test)
tests/e2e/              the browser test, the preview smoke test, a screenshot tool
tools/                  simulator, art pipeline, Heirloom recolours, preview build, local server
art/raw/                full-size originals of the art made for this game
docs/                   the design and the art list
```

- Every roll comes from one seeded generator kept in the save, so the same seed and the same choices always give the same fight.
- A save is rebuilt field by field when it is loaded, and then rehearsed on a copy. `tests/unit/hostile.test.mjs` treats the save as an attack.
- The page's content security policy allows its own files and nothing else: no inline script or style, and no network at all. `tests/unit/sealed.test.mjs` holds that, and fails if any other game's words turn up in what a player can read.
- Nothing newer than iOS 15.0 is used (`tests/unit/compat.test.mjs`).

## Not done

One place of eight can be played: the other seven are buildings you can walk up to, with nothing behind their doors. The world is one neighbourhood about two and a half screens across; it has no people in it yet, nothing to pick up or do besides meeting Oddments, and friends on the green are for looking at, not talking to. You see it from above in 2D; you always face left or right, never toward or away. No sound, no iOS wrapper, no App Store work, no purchases. Oddments do not grow up yet (the table says into what; the rule and the art are not there). The buildings, trees, lamps, hedges and grass are painted (two generated images, see `docs/ART.md`); the streets, their stepping stones, the garden gate and the name plates are still drawn in code. The house-sitter is one of four candidate looks, not a final sprite. The rest of the cast are names in the design, not people in the game. The balance has only been played by bots. Everything has been run in Chromium at phone sizes; nothing has been run on an iPhone or in Safari.
