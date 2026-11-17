# Clutterkin

**The house is awake. The cats fight it. You are going to try talking to it.**

A creature-collecting RPG for iPhone set in the world of Pawst Lives. The monsters are things from a house that came alive (an odd sock, burnt toast, the dust under the bed). You are a person, house-sitting, who befriends them and battles alongside them, three against three.

This is the **framework and all eight places in a first form**, not the finished game: the whole neighbourhood to walk around, your own home to go indoors in, and all eight places to calm, from the garden to the Roaring Dark. Six of them are buildings you walk into. Forty kinds of Clutterkin can be made friends of.

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

The browser test plays at six screen sizes, from a small phone to a folding phone open, and opens and closes that one in the middle of a fight.

`npm run e2e` needs Playwright: `npm install --no-save playwright && npx playwright install chromium`.

`npm run sim` takes `[players] [--style=friendly|brawler|careless] [--visits=4] [--room=garden|alley|pantry|wash|stacks|rooftops|attic|dark]`. A later place is played by someone who has first calmed the ones before it. Whoever you calm stays calm, so an outing after the first picks up where the last stopped. Today a sensible stand-in player calms the garden in one go about nine times in ten and always by the second outing; Tin Can Alley, the Midnight Pantry and the Wash about two times in three in one go; the Dusty Stacks, Moonlit Rooftops and the Tick-Tock Attic about half the time; and each of those seven nearly always within two outings and always within three or four. The Roaring Dark is the hardest: about one in four in one go, seven in ten by the second outing, more than nine in ten by the third. Fights last two to six rounds, and a first outing to a restless place is three to four minutes of fighting (the simulator does not count the walking); a stroll through a calm one is under a minute. `tests/unit/pacing.test.mjs` holds the first two places to that shape; the other six are only reported by the simulator.

How much play that is: by the same rough clock, calming all eight places takes a sensible stand-in player about 34 minutes of fighting over thirteen outings, and making a friend of all forty kinds about 52 minutes. With the walking and talking, call it an hour and a half to see everything that is built; that part is a guess, because the simulator does not walk. Heirlooms are the long game: a first one turns up after about ten outings, and after 420 outings simulated players had kept a median of 34 of the 40, nearly all found strolling through places already calmed, where they come out three times as often.

## How it is built

The same way as Pawst Lives.

```
web/                    the game: what ships
  js/core/              rules only. No drawing, no clock, no storage; runs in Node
    balance.js          every number and name. Tune here.
    battle.js           the fight: turn order, damage, moves, Calls, reaching out
    progress.js         experience, levels, who comes home
    rooms.js            who is restless in a place, what ground they hold, which groups are calm for good, and a visit: from stepping in to resting at home; and a stroll through a place that is calm
    indoors.js          the floors of the buildings you can walk into: where feet can go, what there is to do
    story.js            the people of the lane, what each says and when, and the goal
    world.js            the open world: what stands where, where feet can go, finding the way
    game.js             the Game object: every action a player can take
    state.js            the save format and repair of old or damaged saves
    trial.js            a save is rehearsed on a copy before the game trusts it
    auto.js             a plain stand-in player, for the simulator and the rehearsal
    util.js             the seeded random generator
  js/ui/                the screens: the world you walk in, the inside of a building, the fight (and how one works), friends, scrapbook
  js/platform/          storage, sound, and the one file that knows about the iOS app's native side
  assets/               sprites, the paintings fights are seen against, the painted world, the painted rooms, font (about 5 MB)
tests/unit/             a test per rule (node:test)
tests/e2e/              the browser test, the preview smoke test, a screenshot tool
ios/                    the Xcode project for the iPhone app (the same game in a thin shell)
tools/                  simulator, art pipeline, Heirloom recolours, the loading screen's postcard, preview build, local server, App Store Connect helper
art/raw/                full-size originals of the art made for this game
docs/                   the design and the art list
```

- Every roll comes from one seeded generator kept in the save, so the same seed and the same choices always give the same fight.
- A save is rebuilt field by field when it is loaded, and then rehearsed on a copy. `tests/unit/hostile.test.mjs` treats the save as an attack.
- The page's content security policy allows its own files and nothing else: no inline script or style, and no network at all. `tests/unit/sealed.test.mjs` holds that, and fails if any other game's words turn up in what a player can read.
- Nothing newer than iOS 15.0 is used (`tests/unit/compat.test.mjs`).

## Not done

All eight places can be played, and the story runs from great-aunt Maribel's call to a quiet lane. The six places you walk into, and your home, are painted: each has a back wall, a floor and a dozen things standing on it (21 generated images, on 16 November 2026). They have been looked at on a 393 x 852 screen only, by me, in screenshots. The last five places were made in one go: their kinds, moves and levels were set with the simulator and no person has played them. Three neighbours stand in the world and talk, but they stand still, and there is nothing to pick up. You see it all from above or from the front in 2D. The house-sitter turns to face the way they walk; Clutterkin and neighbours have one view each and only turn left or right. There is sound (effects, a lullaby in the lane, three fight tunes, all made in code, with a switch for each in Settings), but it was written and tested by something that cannot hear. No purchases. Clutterkin do not grow up yet (the table says into what; the rule and the art are not there). The map is one neighbourhood, about three phone screens across; roads on to other areas are not built, though going through a door from one area to another now is.

The buildings, trees, lamps, hedges, grass, and the alley's junk, fence and cobbles are painted (four generated images, see `docs/ART.md`); the streets, their stepping stones, the gateways and the name plates are drawn in code. The seven rooms you can walk into are painted too (twenty-one more images); only their light and shade is code. The four house-sitter looks are still candidates, taller and slimmer than the Pawst Lives cats. The app icon is painted, with one touch-up done in code (the pencil in her hair).

The balance has only been played by bots: every place after the garden had its levels set with the simulator. On 16 November 2026 the rule changed so that whoever you calm stays calm, and each fight now teaches 30% more so that the team keeps pace without anyone being fought twice; the figures above are from after that change, and no person has played with it yet. The browser test runs in Chromium at phone sizes. Three builds are on TestFlight. 0.1.0 (9), the first, has been run on a real iPhone. 0.1.0 (13) added Tin Can Alley, the new icon and the folding-phone layout; 0.1.0 (16) adds sound, the Heirloom hunt and the loading screen. Apple has processed all three. A screenshot sent from the app on an iPhone (which build was not said) showed the top of the map hiding under the heading: that is fixed in the game since. Everything since is on the web copy only and needs another upload to reach a phone (`docs/TESTFLIGHT.md`): the new names, going indoors, the Midnight Pantry and the five places after it, the other 26 kinds of friend, calm places staying calm, calmed groups staying calm through a rest (and fights teaching 30% more), the seven painted rooms, the dust as a fight begins, two more fight tunes, "Not yet!", the plainer tags over targets, and how a fight works. Nothing has been heard by a person.

iPhone Duo (Apple's folding iPhone): the game is laid out for both of its screens and for being opened and closed mid-game, and has been built with Xcode 27.1 and run on Apple's iPhone Duo simulator closed. It has not been seen open in the simulator, or on a real one, and build 0.1.0 (13) on TestFlight is the first made for it. `docs/TESTFLIGHT.md` has the whole account.
