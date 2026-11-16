# Clutterkin

**The house is awake. The cats fight it. You are going to try talking to it.**

A creature-collecting RPG for iPhone set in the world of Pawst Lives. The monsters are things from a house that came alive (Sock Eel, Toast Ghost, Dust Bunny). You are a person, house-sitting, who befriends them and battles alongside them, three against three.

This is the **framework and a playable slice**, not the finished game: the whole neighbourhood to walk around, and the first two of its eight places (the garden, then Tin Can Alley) to play.

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
npm run sim               # how long fights last and how hard a place is
npm run e2e               # plays the real game in headless Chromium by tapping
node tests/e2e/preview.mjs            # builds the preview and smoke-tests it
node tests/e2e/preview.mjs https://kendallcoding202.github.io/oddments/web/   # the same against the published copy
```

`npm run e2e` needs Playwright: `npm install --no-save playwright && npx playwright install chromium`.

`npm run sim` takes `[players] [--style=friendly|brawler|careless] [--visits=4] [--room=garden|alley]`. A later place is played by someone who has first calmed the ones before it. Today a sensible player calms the garden on the first visit about four times in five and always by the second; Tin Can Alley about half the time on a first visit, nearly always by the second and always by the third. Fights last two to six rounds, and a visit is about four minutes of fighting (the simulator does not count the walking). `tests/unit/pacing.test.mjs` holds the game to that shape.

How much play that is: by the same rough clock, calming both places takes a sensible player about 11 minutes of fighting and three visits, and making a friend of all fourteen kinds about 15. With the walking and talking, call it half an hour to see everything that is built. Heirlooms are the long game: a first one turns up after about four visits, and keeping one of each of the eleven kinds that are ever met restless took simulated players a median of about 180 visits (a little over two hours of fighting, more with the walking). The three you start with are never met restless, so their Heirlooms cannot be found at all yet.

## How it is built

The same way as Pawst Lives.

```
web/                    the game: what ships
  js/core/              rules only. No drawing, no clock, no storage; runs in Node
    balance.js          every number and name. Tune here.
    battle.js           the fight: turn order, damage, moves, Calls, reaching out
    progress.js         experience, levels, who comes home
    rooms.js            who is restless in a place, what ground they hold, and a visit: from stepping in to resting at home
    story.js            the people of the lane, what each says and when, and the goal
    world.js            the open world: what stands where, where feet can go, finding the way
    game.js             the Game object: every action a player can take
    state.js            the save format and repair of old or damaged saves
    trial.js            a save is rehearsed on a copy before the game trusts it
    auto.js             a plain stand-in player, for the simulator and the rehearsal
    util.js             the seeded random generator
  js/ui/                the screens: the world you walk in, the fight, friends, scrapbook
  js/platform/          storage, and the one file that knows about the iOS app's native side
  assets/               sprites, room paintings, the painted world, font (about 2 MB)
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

Two places of eight can be played: the other six are buildings you can walk up to, with nothing behind their doors, and the story stops where Tin Can Alley does. Three neighbours stand in the world and talk, but they stand still, and there is nothing to pick up or do besides meeting Clutterkin. Friends on the green are for looking at, not talking to. You see it from above in 2D. The house-sitter turns to face the way they walk; Clutterkin and neighbours have one view each and only turn left or right. No sound at all yet: no music and no effects. No purchases. Clutterkin do not grow up yet (the table says into what; the rule and the art are not there). Heirlooms can be found and kept, but nothing helps you look for one (see `docs/DESIGN.md`).

The buildings, trees, lamps, hedges, grass, and the alley's junk, fence and cobbles are painted (four generated images, see `docs/ART.md`); the streets, their stepping stones, the gateways and the name plates are still drawn in code. The four house-sitter looks are still candidates, taller and slimmer than the Pawst Lives cats. The app icon is painted, with one touch-up done in code (the pencil in her hair).

The balance has only been played by bots: the alley's levels were set with the simulator and no person has played it yet. The browser test runs in Chromium at phone sizes. The first build on TestFlight, 0.1.0 (9), has been run on a real iPhone, but it is from before Tin Can Alley, the new icon and the stepping-stone fix: those are on the web copy and need a new upload to reach a phone (`docs/TESTFLIGHT.md`). In iOS's own web engine the alley has not been looked at.
