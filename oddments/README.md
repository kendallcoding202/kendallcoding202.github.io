# Clutterkin

**The house is awake. The cats fight it. You are going to try talking to it.**

A creature-collecting RPG for iPhone set in the world of Pawst Lives. The monsters are things from a house that came alive (Sock Eel, Toast Ghost, Dust Bunny). You are a person, house-sitting, who befriends them and battles alongside them, three against three.

This is the **framework and a playable slice**, not the finished game: the whole neighbourhood to walk around, and the first of its eight places (the garden) to play.

- The design on one page: [docs/DESIGN.md](docs/DESIGN.md)
- The art that exists and the art still needed, with counts: [docs/ART.md](docs/ART.md)
- Getting it onto TestFlight, and what only you can do: [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md)
- Play the slice: <https://kendallcoding202.github.io/oddments/web/> (this repository is a public website, so that address is public)

No ads, no analytics, no accounts, no purchases, no network calls. The save lives on the device and nowhere else.

## The name

The game is called **Clutterkin**, and so are its creatures: one Clutterkin, many Clutterkin. To Mr. Spick, the clearance man, they are clutter. To you they become kin. Ines Tock says as much the first time you meet her.

A web search of the App Store, Google Play, Steam and trademark listings found no app, game or trademark by that name. That is a search, not a legal check. (Two earlier ideas were dropped for cause: a trademark application exists for "Oddkins", and "Wakelings" is an App Store game.)

Inside the repository some things still carry the first working title, on purpose: the folder and the web address (`oddments/`), the name of the save on the device (`oddments.save`, so nobody's save is lost) and the handle for poking at the game from a browser console (`window.oddments`). None of these is seen by a player.

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
    story.js            the people of the lane, what each says and when, and the goal
    world.js            the open world: what stands where, where feet can go, finding the way
    game.js             the Game object: every action a player can take
    state.js            the save format and repair of old or damaged saves
    trial.js            a save is rehearsed on a copy before the game trusts it
    auto.js             a plain stand-in player, for the simulator and the rehearsal
    util.js             the seeded random generator
  js/ui/                the screens: the world you walk in, the fight, friends, scrapbook
  js/platform/          storage, and the one file that knows about the iOS app's native side
  assets/               sprites, room paintings, font (about 1 MB)
tests/unit/             a test per rule (node:test)
tests/e2e/              the browser test, the preview smoke test, a screenshot tool
ios/                    the Xcode project for the iPhone app (the same game in a thin shell)
tools/                  simulator, art pipeline, Heirloom recolours, preview build, local server, App Store Connect helper
art/raw/                full-size originals of the art made for this game
docs/                   the design and the art list
```

- Every roll comes from one seeded generator kept in the save, so the same seed and the same choices always give the same fight.
- A save is rebuilt field by field when it is loaded, and then rehearsed on a copy. `tests/unit/hostile.test.mjs` treats the save as an attack.
- The page's content security policy allows its own files and nothing else: no inline script or style, and no network at all. `tests/unit/sealed.test.mjs` holds that, and fails if any other game's words turn up in what a player can read.
- Nothing newer than iOS 15.0 is used (`tests/unit/compat.test.mjs`).

## Not done

One place of eight can be played: the other seven are buildings you can walk up to, with nothing behind their doors, and the story stops where the garden does. Three neighbours stand in the world and talk, but they stand still, and there is nothing to pick up or do besides meeting Clutterkin. Friends on the green are for looking at, not talking to. You see it from above in 2D. The house-sitter turns to face the way they walk; Clutterkin and neighbours have one view each and only turn left or right. No sound, no purchases. The iPhone app builds and runs in Apple's Simulator, but it has not been uploaded to TestFlight or run on a real iPhone: that needs your Apple account (`docs/TESTFLIGHT.md`). Clutterkin do not grow up yet (the table says into what; the rule and the art are not there). The buildings, trees, lamps, hedges and grass are painted (two generated images, see `docs/ART.md`); the streets, their stepping stones, the garden gate and the name plates are still drawn in code. The four house-sitter looks are still candidates, taller and slimmer than the Pawst Lives cats. The app's icon is a stand-in. The balance has only been played by bots. The browser test runs in Chromium at phone sizes. In iOS's own web engine the game has only been launched and looked at (first screen, and resumed from a save), not played through.
