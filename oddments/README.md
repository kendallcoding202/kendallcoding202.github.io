# Clutterkin

**The house is awake. The cats fight it. You are going to try talking to it.**

A creature-collecting RPG for iPhone set in the world of Pawst Lives. The monsters are things from a house that came alive (an odd sock, burnt toast, the dust under the bed). You are a person, house-sitting, who befriends them and battles alongside them, three against three.

This is the **first complete version**: everything planned for it is built and passes its tests, and most of it has not yet been played by a person on a phone (see *Not verified*, at the end). One open world to walk, your own home to go indoors in, twelve places to calm in two chapters (eight on the lane, from the garden to the Roaring Dark; then four more over a river, on the far bank), eighty kinds of Clutterkin to make friends of, and a story that runs from great-aunt Maribel's first telephone call to both banks quiet. Chapter two, the far bank, was built on 18 November 2026 and has been played only by the tests.

- The design on one page: [docs/DESIGN.md](docs/DESIGN.md)
- The art that exists and the art still needed, with counts: [docs/ART.md](docs/ART.md)
- Getting it onto TestFlight, and what only you can do: [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md)
- Play it in a browser: <https://kendallcoding202.github.io/oddments/web/> (this repository is a public website, so that address is public)

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

`npm run sim` takes `[players] [--style=friendly|brawler|careless] [--visits=4] [--room=garden|alley|pantry|wash|stacks|rooftops|attic|dark|glasshouse|deepend|shed|mending]`. A later place is played by someone who has first calmed the ones before it. Whoever you calm stays calm, so an outing after the first picks up where the last stopped. Today a sensible stand-in player calms the garden in one go about nine times in ten and always by the second outing; Tin Can Alley about six times in ten, and nearly always by the second; and, once the three have grown up (about the Midnight Pantry), each of the next five places about eight times in ten or a little more, and all but always by the second outing. The Roaring Dark is the hardest of the lane: about half the time in one go, nine in ten by the second outing, ninety-nine in a hundred by the third. Over the water: the Glasshouse about 84 times in a hundred in one go, the Deep End 94, the Tinker's Shed 77, and the Mending Room, the last, 50 (92 by the second outing, 99 by the third). Those four were levelled to how strong the stand-in is when it gets there, about a level above each ringleader, as on the lane: as first drawn up they sat a level above the player, and the Glasshouse was calmed in one go 11 times in a hundred. Fights last two to six rounds, and a first outing to a restless place is three to four minutes of fighting (the simulator does not count the walking); a stroll through a calm one is under a minute. `tests/unit/pacing.test.mjs` holds the first two places to that shape; the other six are only reported by the simulator.

How much play that is: by the same rough clock, calming all twelve places takes a sensible stand-in player about 44 minutes of fighting over fifteen outings (the eight of the lane were about 29 minutes over ten), and making a friend of all eighty kinds about 90 minutes. The stand-in chooses in an instant and reads nothing. A person meeting it for the first time will take perhaps twice as long over the fights, and there is the walking (the whole world is crossed in about a quarter of a minute, so that is little), the talking and the looking about: call it an hour to an hour and a quarter from great-aunt Maribel's call to a quiet lane, an hour and a half to two hours to both banks quiet, and three to four hours to have made a friend of everyone. Those are guesses from the simulator's figures, not measurements of anyone playing. Heirlooms are the long game: one restless Clutterkin in 60 is one, one in 20 in a place already calm. A first turns up after about five outings (anywhere from the first to the fourteenth), and keeping all eighty is very long: after 1,500 outings (about six and a half hours of fighting) one simulated player in forty had every one, and the rest were three short. With forty kinds it took a median of about 880 outings.

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
    strays.js           lost Clutterkin out on the lane itself: who turns up, how strong, and how worn they leave the team
    story.js            the people of the lane, what each says and when, the goal, and the stories of the three you set out with
    names.js            what a friend is called: its kind's name, or one of your own
    world.js            the open world: what stands where, where feet can go, finding the way
    game.js             the Game object: every action a player can take
    state.js            the save format and repair of old or damaged saves
    trial.js            a save is rehearsed on a copy before the game trusts it
    auto.js             a plain stand-in player, for the simulator and the rehearsal
    util.js             the seeded random generator
  js/ui/                the screens: the world you walk in and its map, the inside of a building, the fight (and how one works), friends, scrapbook
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

## What is in it

- **The world.** One open map, three phone screens across and about ten down, in seven stretches whose names show in the heading: The Lane (home, the garden, Tin Can Alley, the Midnight Pantry), Bramble Way, Lampwick Row (the Wash, the Dusty Stacks), Long Meadow, Chimney Hill (Moonlit Rooftops, the Tick-Tock Attic, and the Roaring Dark); then a river from side to side with one bridge over it, Kettle Bridge, and beyond it Far Bank (the Glasshouse, the Deep End) and Bobbin Row (the Tinker's Shed, the Mending Room). The gate on the bridge has eight locks, and opens when all eight places of the lane are calm. You find your way by a map (a *Map* button beside the goal at the top of the screen), by signposts, and by a gold arrow toward your goal. There are four benches to rest on and nine mailboxes to send Ines Tock your news from, so nothing means walking the whole way back.
- **Twelve places to calm**, in two chapters, in the order you reach them walking, each ending in a ringleader, who hands you the key to the place when it is calm: twelve painted keys on a key ring, the far bank's four on hooks that appear when you learn of it. Whoever you calm stays calm, through a rest and through being carried home. Ten are buildings you walk into; those and your home are painted rooms.
- **Eighty kinds of friend** (forty of them new on 18 November 2026: two or three more in each of the eight places of the lane, and five in each of the four over the water), three moves each, six elements in a ring, fights of three against three. You make friends by reaching out in a fight, never by throwing anything. The three you set out with are introduced one by one at the start, and each has a story that comes round when a certain place is calmed. Any friend can be given a name of your own. Every kind grows up: a friend that reaches its kind's level grows into a new, bigger form with a new name (the three you set out with at level 8), and from the Wash on, more and more of the restless you meet have grown up too.
- **Things to do once a place is calm**: a few are always wandering about in it, strays turn up along the roads between places, and every kind has rare Heirloom colours to find. The scrapbook keeps count.
- **People**: great-aunt Maribel on the telephone (she rings twice: once to begin, and once when the lane is quiet, about the far bank), and three neighbours to talk to.
- **Sound**: effects, a lullaby in the lane and three fight tunes, all made in code, each with a switch in Settings.
- **A save** on the device and nowhere else, rebuilt field by field and rehearsed each time it is read.

## Not done

- **The Keepsakes.** One rare, one-of-a-kind creature for the end of each chapter was asked for on 18 November 2026. Both are painted (with their rare colours) and named, and neither is in the game yet.
- **Something to come back for each day.** Asked for the same day ("I want people to keep coming back"). What is there: strays change each time you set out, a few wander every calm place, and every kind has rare colours to find. Nothing yet changes from one day to the next, and nothing is planned in the code. The far bank ends by saying there is more of the world beyond it; that is a promise of a third chapter, not a third chapter.
- **Crumb is thin on the ground.** Six of the eighty kinds are Crumb (Fluff and Clank have more than twenty each), so Suds seldom gets to use its edge. A place full of food would put that right.

- **Nothing to carry, buy or pick up.** There are no items, no money and no shop, and no purchases of any kind.
- **The neighbours stand still.** Clutterkin and neighbours have one view each and only turn left or right; only the house-sitter turns to face the way they walk.
- **The house-sitter's four looks are still candidates**, taller and slimmer than the Pawst Lives cats. The art still wanted, with counts, is in `docs/ART.md`.
- **Nothing for the App Store.** No description, screenshots, age rating answers or price have been written or chosen, and the version number is still 0.1.0. The price is the owner's decision.

## Not verified

- **By a person, on a phone: almost none of it.** Five builds are on TestFlight: 0.1.0 (9), (13), (16), (21) and (24). The last two went up on 18 November 2026, and (24) has everything described here. Apple has processed all four. Build (9), the first, has been run on a real iPhone. A screenshot sent later from the app on an iPhone (which build was not said) showed the top of the map hiding under the heading; that is fixed since. Nobody has yet reported running (13), (16), (21) or (24). So on a phone nobody has seen: the new names, going indoors and the seven painted rooms, the six places after Tin Can Alley, the other 26 kinds of friend, calm staying calm, the companions' stories, strays, the bigger world with its map, benches and mailboxes, names of your own, or the sound.
- **How hard it is.** Every place after the garden had its levels set with the simulator, and the stand-in player there never goes home early and never meets a wanderer or a stray. As far as is known, no person has played the six places after Tin Can Alley, and nobody at all has played the far bank. The figures under *Test it* are the simulator's.
- **How it sounds.** The sound was written and tested by something that cannot hear. Nobody has listened to it.
- **How it looks.** I have looked at every screen in screenshots at 393 x 852, and the newer ones at 320 x 568 as well (the far bank, its four rooms and its ringleaders' fights at 393 x 852 only). The browser test plays the whole game in Chromium at six screen sizes; that is not Safari, and not a phone.
- **How fast it runs.** A long walk down the bigger world ran at 60 frames a second in the test browser. On a real phone it is unknown. The game now fetches about twice as many pictures before it shows (about 14 MB, where it was 8): how long that takes to start on a phone has not been measured, and the frame rate has not been measured again since the world grew by half and gained a river.
- **The iPhone app.** Nothing after build (24) is in a build: not the element tags, not the smoother hover, not the forty new kinds, not the far bank. Build 0.1.0 (24) was signed by Apple and uploaded on 18 November 2026, and Apple reports it processed and available to the one tester. Just before, on the same code, the "Clutterkin iOS" check (run 23, nothing uploaded) compiled the app, rehearsed the upload archive, launched it in Apple's iPhone simulator and proved a save survives there; I looked at its two screenshots: the intro, with the Map button showing behind it, and a resumed game being told about its three companions. That is a simulator with nobody touching it: it shows the app starts, not how it plays.
- **The names.** The game's name and every kind's name were looked for by web search and in lists of other games' names; nothing was found. That is a search, not a trademark check. The 86 names of chapter two (forty kinds, forty grown forms, four ringleaders, two Keepsakes) had a wider search the same day: card and creature databases, about a million wiki page titles, Steam, and a US trademark search. Two were taken and five more were too close to something; their seven replacements had a web search only. The names of the first forty grown forms were looked for on 18 November 2026, and nine were replaced (four for cause, five to be safe); two of the replacements, Drumcoil and Shroudmote, had only a short look in three databases. `docs/DESIGN.md`, *Names*, has the account.
- **iPhone Duo** (Apple's folding iPhone): the game is laid out for both of its screens and for being opened and closed mid-game, and has been built with Xcode 27.1 and run on Apple's iPhone Duo simulator closed. It has not been seen open in the simulator, or on a real one. `docs/TESTFLIGHT.md` has the whole account.
