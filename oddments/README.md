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
- **Eighty kinds of friend, and the two Keepsakes** (forty of the kinds new on 18 November 2026: two or three more in each of the eight places of the lane, and five in each of the four over the water), three moves each, six elements in a ring, fights of three against three. You make friends by reaching out in a fight, never by throwing anything. The three you set out with are introduced one by one at the start, and each has a story that comes round when a certain place is calmed. Any friend can be given a name of your own. Every kind grows up: a friend that reaches its kind's level grows into a new, bigger form with a new name (the three you set out with at level 8), and from the Wash on, more and more of the restless you meet have grown up too.
- **Two Keepsakes**, one for the end of each chapter: a creature there is only one of. Lullawren, a music-box nightingale, is out in the old orchard once all eight places of the lane are calm; Farewhale, a ship in a bottle, on the river's far bank once the four over the water are. Fluff, a small dust bunny with a red bow who got out of THE VACUUM (and who guides the cat in Pawst Lives), sits beside each, and the journal says "Follow Fluff" and where. A Keepsake takes eight pips of reaching out, twice anyone else, and cannot be made to stay: knock it out and it slips away unhurt, to be there again after a rest. Once it is your friend it comes out again only about one outing in ten, in its rare colours.
- **Something different each day.** One calm place is *lively tonight*: three or four groups wander there instead of one to three, and each of them is in its rare colours three times in twenty instead of one. It is a different place each real day, going round every calm place before any comes again, and the journal and the map say which. Nothing is lost by missing a day; there are no notifications, and the game asks the device only what the date is. Asked for on 18 November 2026 ("I want people to keep coming back to play") and agreed the same day.
- **Things to do once a place is calm**: a few are always wandering about in it, strays turn up along the roads between places, and every kind has rare Heirloom colours to find. The scrapbook keeps count.
- **People**: great-aunt Maribel on the telephone (she rings twice: once to begin, and once when the lane is quiet, about the far bank), and three neighbours to talk to.
- **Ringleaders can come home.** A ringleader still cannot be reached in a fight. But once its place is calm it takes the air outside, and each of the twelve has a wish that the save already shows: Old Summerlong wants a friend of every kind in the garden; the Crumbwyrm wants your Crumbwisp to grow up; the Spin Cycle wants a pair of socks, an Eelastic and a Frayling; Madam Treadle wants the bear with one eye to mend; THE VACUUM wants signing out of the depot, which takes beating Tansy Brisk all five times. Walk up and its card says what it wants and how far along you are. Grant it and it asks for one more bout, a friendly one, alone; win, and it comes home. As a friend it takes one turn a round like anyone and has about half the Health it had, which still makes it sturdier than any ordinary kind: so **only one ringleader walks with you at a time**.
- **An ending.** When both banks are quiet and Ines Tock has been told, great-aunt Maribel rings a third time, from the boat home; then a card says the story is told, thanks you, lists what is still awake (kinds to befriend, wishes to grant, Heirlooms to find, the lively place each night) and gives the credits. The game goes on after it. Settings has the credits at any time.
- **News, told once.** The first time a ringleader is out of doors, and each time Tansy Brisk is waiting somewhere new, a card says so and has to be answered. "What to do" lists every wish and how far along it is, and a gold ! at the edge of the screen points to whoever is waiting for a bout.
- **A rival.** Tansy Brisk, junior clearance officer of Spick & Span: where you calm them, she puts them in boxes, and she wants to see whose way works. She waits by the road at five points along the way (after the garden, the pantry, the Dusty Stacks, the Roaring Dark and the Tinker's Shed are calm), with a mark over her head, a line in the journal under "Also" and a mark on the map. Nobody has to stop. Walk up, hear her out, and say yes or "not just now"; yes is a bout, her three (a feather duster, a bar of soap and a travel iron, issued by the depot with numbers for names) against yours. Hers are not lost, so none can be reached: it is won or it is not. Over the five she changes her mind, and her three get names.
- **Sound**: effects, a lullaby in the lane and three fight tunes, all made in code, each with a switch in Settings.
- **A save** on the device and nowhere else, rebuilt field by field and rehearsed each time it is read. (The game sends it nowhere; an iPhone's own backup includes it, as it does every app's.)
- **Locked down.** A security audit on 18 November 2026 found nothing critical or high; what it did find is fixed and held by tests. `docs/SECURITY.md` has the whole account, and six things that only the owner can do in GitHub's settings. In the app there are no testing switches at all; on the web copy a link can no longer erase a save unasked; the Apple key is handed only to the steps of the upload that use it.

## Not done

- **A third chapter.** The far bank ends by saying there is more of the world beyond it. That is a promise, not a chapter: nothing of it is drawn, written or planned in the code.
- **Crumb is thin on the ground.** Six of the eighty kinds are Crumb (Fluff and Clank have more than twenty each), so Suds seldom gets to use its edge. A place full of food would put that right.

- **Nothing to carry, buy or pick up.** There are no items, no money and no shop, and no purchases of any kind.
- **The neighbours stand still.** Clutterkin and neighbours have one view each and only turn left or right; only the house-sitter turns to face the way they walk.
- **The house-sitter's four looks are still candidates**, taller and slimmer than the Pawst Lives cats. The art still wanted, with counts, is in `docs/ART.md`.
- **The App Store page is drafted, not entered.** `docs/APPSTORE.md` has a proposed name line, description, keywords, age-rating and privacy answers, notes for the reviewer, and the words for a privacy page and a support page; `store/screenshots/` has eight pictures at Apple's size (key art with the title, then seven of the real game in a matching frame). Nothing has been typed into App Store Connect or sent to Apple, the two pages are not published, and the version number is still 0.1.0. The price, what becomes of the free copy on the web, a proper trademark search for the name, and whose name goes on it are the owner's to decide, and are listed at the top of that file.

## Not verified

- **The rival and the ringleaders' wishes, by a person.** Both were built on 18 November 2026 and are in build (38). How strong Tansy Brisk is was set with the simulator's stand-in player, rested; nobody has played a bout with her. The twelve wishes have each been granted and won in tests, and three (Old Summerlong's, Madam Treadle's and THE VACUUM's) were looked at on screen from start to finish; where each ringleader stands out of doors was looked at for all twelve. How long each wish takes a person has not been measured: some are quick (a pair of socks) and some are meant to take weeks (three Heirlooms).

- **Sound coming back on an iPhone.** Reported twice from a real phone: after the app is minimised and opened again, there is no sound. The first fix (wake the sound's clock, whatever it calls its state) did not work there. The second, of 19 November 2026, goes by a guess at the cause that fits what was seen, and cannot be tested here: the phone tells the app it is back a moment before it really is, and a clock asked to run in that moment starts in name only, saying "running" and making no sound. So on an iPhone or iPad the old clock is now asked nothing on the way back, and the first touch makes a new one, which is what a fresh launch does and is known to work on that phone. A clock that says it is running and is not moving is also replaced at the next touch, on any device. And Settings has "Gone quiet? Restart sound", which makes a new clock on the spot, plays a chime, and says what the clock calls its state if it would not start: so if this fix fails too, the phone can say why. All of that is tested against a stand-in for the phone's clock. None of it has been heard on a phone. It is in build (41).

- **By a person, on a phone: almost none of it.** Ten builds are on TestFlight: 0.1.0 (9), (13), (16), (21), (24), (29), (31), (35), (38) and (41). The last seven went up on 18 November 2026 (Pacific time). Build (41) is the one to test: it has everything described here, with the second fix for the sound, "Restart sound" in Settings, and the cards that say a ringleader has a wish and that somebody is waiting. Apple reports it processed and available to the one tester. Build (38), an hour before it, was the first with the rival and the ringleaders' wishes; the owner played it and saw neither, which is why (41) says so on a card. Just before it went up, the "Clutterkin iOS" check (run 37, nothing uploaded) compiled the same code, rehearsed the upload archive, launched the app in Apple's iPhone simulator and proved a save survives there; I looked at its two screenshots, the intro and a saved game picked up again, and both are right. Build (35), an hour and a half before it, is (31) with the sound coming back when you return to the app and the security audit's changes; its upload was the first run of the upload job since the audit changed it, and it worked. That fix did not work: on 19 November 2026 the owner reported, from a phone, that the sound still stays off after the app is minimised and opened again. Build (29), an hour before it, lacks the lively place and was made with the older Xcode by mistake (a box left unticked), so on a folding iPhone Duo it would run scaled; (31) was made the usual way and replaces it. Apple reports both (29) and (31) processed and available to the one tester. Of (24): Apple has processed all four. Build (9), the first, has been run on a real iPhone. A screenshot sent later from the app on an iPhone (which build was not said) showed the top of the map hiding under the heading; that is fixed since. Nobody has yet reported running (13), (16), (21) or (24). So on a phone nobody has seen: the new names, going indoors and the seven painted rooms, the six places after Tin Can Alley, the other 26 kinds of friend, calm staying calm, the companions' stories, strays, the bigger world with its map, benches and mailboxes, names of your own, or the sound.
- **How hard it is.** Every place after the garden had its levels set with the simulator, and the stand-in player there never goes home early and never meets a wanderer or a stray. As far as is known, no person has played the six places after Tin Can Alley, and nobody at all has played the far bank. The figures under *Test it* are the simulator's.
- **How it sounds.** The sound was written and tested by something that cannot hear. Nobody has listened to it.
- **The published copy.** A check that starts the game from the web address, walks, fights and wins passes; but twice, on the first load just after publishing, the web server refused one of the several hundred pictures the game fetches before it shows. The game now asks again for a picture that fails, and fetches two dozen at a time instead of all at once. Whether that stops the refusals has not been seen yet: it can only be seen just after publishing.
- **How it looks.** I have looked at every screen in screenshots at 393 x 852, and the newer ones at 320 x 568 as well (the far bank, its four rooms and its ringleaders' fights at 393 x 852 only). The browser test plays the whole game in Chromium at six screen sizes; that is not Safari, and not a phone.
- **How fast it runs.** A long walk down the bigger world ran at 60 frames a second in the test browser. On a real phone it is unknown. The game now fetches about twice as many pictures before it shows (about 14 MB, where it was 8): how long that takes to start on a phone has not been measured, and the frame rate has not been measured again since the world grew by half and gained a river.
- **The iPhone app.** Build (41) holds everything. (Build (38) held everything but the second sound fix and the news cards; see above for what was checked before it went up. Nothing was run in the simulator between (38) and (41): the changes are to the game's own files, which the browser test covers.) Of the builds before it: build (31) held everything up to the lively place. With everything up to the Keepsakes in, the "Clutterkin iOS" check (run 28, 18 November 2026, nothing uploaded) compiled the app, rehearsed the upload archive, launched it in Apple's iPhone simulator and proved a save survives there; I looked at its two screenshots, the intro and a saved game picked up again, and both are right. That is the simulator, not a phone, and it shows the first screen only: nothing of the far bank has been seen in the app. Build 0.1.0 (24) was signed by Apple and uploaded on 18 November 2026, and Apple reports it processed and available to the one tester. Just before, on the same code, the "Clutterkin iOS" check (run 23, nothing uploaded) compiled the app, rehearsed the upload archive, launched it in Apple's iPhone simulator and proved a save survives there; I looked at its two screenshots: the intro, with the Map button showing behind it, and a resumed game being told about its three companions. That is a simulator with nobody touching it: it shows the app starts, not how it plays.
- **The names.** The game's name and every kind's name were looked for by web search and in lists of other games' names; nothing was found. That is a search, not a trademark check. The 86 names of chapter two (forty kinds, forty grown forms, four ringleaders, two Keepsakes) had a wider search the same day: card and creature databases, about a million wiki page titles, Steam, and a US trademark search. Two were taken and five more were too close to something; their seven replacements had a web search only. The names of the first forty grown forms were looked for on 18 November 2026, and nine were replaced (four for cause, five to be safe); two of the replacements, Drumcoil and Shroudmote, had only a short look in three databases. `docs/DESIGN.md`, *Names*, has the account.
- **iPhone Duo** (Apple's folding iPhone): the game is laid out for both of its screens and for being opened and closed mid-game, and has been built with Xcode 27.1 and run on Apple's iPhone Duo simulator closed. It has not been seen open in the simulator, or on a real one. `docs/TESTFLIGHT.md` has the whole account.
