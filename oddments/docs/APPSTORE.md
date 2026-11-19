# Clutterkin — the App Store page, drafted

Everything App Store Connect asks for before an app can be submitted, with a proposed answer for each. Nothing here has been entered anywhere or sent to Apple. Lines marked **YOURS** are decisions or details only the owner can give. Written 19 November 2026.

## What is still to do, in order

1. **YOURS:** hear the sound come back on a phone (build 43), and have one person play the game through.
2. **YOURS:** decide the five things under *Only the owner can decide*, below.
3. Publish the privacy and support pages (drafted at the end of this file).
4. Set the version to 1.0.0 and upload that build.
5. **YOURS:** in App Store Connect, fill the page from this file, attach the eight screenshots, pick the build, and press Submit.

## Only the owner can decide

| | What | What I would do |
| --- | --- | --- |
| Price | Free, or paid once | **Paid once, about $3.99. No ads, no purchases.** The game is whole and has nothing to sell inside it. A paid app needs the Paid Apps agreement, and bank and tax details, in App Store Connect under *Business* before it can go on sale. |
| **The free copy on the web** | The whole game can be played free at `kendallcoding202.github.io/oddments/web/`, and its source is in a public repository. | **Decide before charging.** Selling an app that is free one link away is a choice, not an accident. Three ways: take the web copy down at launch; keep only the first place or two playable there, as a trial; or leave it, and treat the app as the convenient way to have it. I would keep a trial of the garden and Tin Can Alley. |
| The name | "Clutterkin" was looked for by web search and in lists of game names, and nothing was found. That is not a trademark search. | Have the name searched properly (USPTO at least) before money changes hands on it. |
| Who it is by | The seller name on the page is the name on the Apple developer account. The copyright line and the support page need a name too. | Use what the Pawst Lives pages use. |
| The four house-sitter looks | They came out taller and slimmer than the Pawst Lives cats, and were left as candidates. | Keep them for 1.0: they are consistent with each other and with the five people of the cast. Repaint only if they bother you on the phone. |

## The page

**Name** (30 characters at most): `Clutterkin`

**Subtitle** (30 at most), three to choose from:
- `Befriend what the house forgot` (30)
- `A cosy night of making friends` (30)
- `Calm the house. Keep the keys.` (30)

**Category:** Games. Primary: Role Playing. Secondary: Adventure. (The app already says Role Playing in its own settings.)

**Promotional text** (170 at most; can be changed without a new build):

> The odd sock, the burnt toast, the dust under the bed: they are all awake, and the clearance van comes on Monday. Make friends of them before then. No ads. Nothing to buy.

**Description** (4,000 at most):

> You are house-sitting for your great-aunt. The cats sleep all day. At night you find out why: the house is awake. So is the whole lane.
>
> The odd sock that came out of the wash alone. The slice of toast somebody forgot. The dust under the spare bed. They are Clutterkin: things that were left, lost or forgotten, and are restless about it. On Monday morning the council's clearance van takes away anything that will not sit still.
>
> So before Monday, you calm them down. All of them.
>
> MAKE FRIENDS, DO NOT THROW THINGS
> Fights are three against three, one turn at a time. Your friends stand up for you. But you need not flatten anybody: Reach out to one you like, keep reaching, and it may calm down and come home with you. Every kind has a soft spot. Bring the right company and it goes easier.
>
> EIGHTY KINDS TO BEFRIEND
> A sock goblin. A gargoyle that is really a water spout. A teddy bear with one eye. A ship in a bottle that brought its own sea. Each has three moves, an element of its own, and a grown-up form to grow into. A few come out in rare Heirloom colours, if you know where to look.
>
> SIX ELEMENTS, ALL OURS
> Spark singes Fluff. Fluff mops up Suds. Suds wash away Crumb. Crumb jams Clank. Clank mows Sprout. Sprout grounds Spark.
>
> AN OPEN LANE TO WALK
> Twelve places to calm across two chapters: a garden, an alley of bins, a pantry at midnight, a launderette, a library, the rooftops, an attic of clocks, the cupboard under the stairs, and four more over Kettle Bridge. Walk it at your own pace. Rest on a bench. Post a note to a neighbour.
>
> RINGLEADERS WITH WISHES
> Every place has a ringleader, too proud to reach. Calm its place and it comes outside, with a wish. Grant the wish, win one more friendly bout, and it comes home too.
>
> A RIVAL WITH A CLIPBOARD
> Tansy Brisk, junior clearance officer, thinks a mess belongs in a box. She would like to see whose way works. Nobody has to stop for her.
>
> SOMETHING EVERY DAY
> One calm place is lively each night, with more wandering there and far more of them in their rare colours.
>
> AND NOTHING ELSE
> No ads. No purchases. No accounts. No tracking. The game never uses the internet: your save lives on your phone and nowhere else.

**Keywords** (100 characters at most, commas, no spaces; nobody else's names):

`cozy,cosy,rpg,creature,monster,turn based,offline,story,friends,pets,adventure,no ads,house,ghost`

**What's New:** not asked for a first version.

**Copyright:** `2026` followed by the owner's name. **YOURS.**

**Support URL:** `https://kendallcoding202.github.io/oddments/support/` (page drafted below; not published yet)

**Privacy Policy URL:** `https://kendallcoding202.github.io/oddments/privacy/` (drafted below; not published yet)

**Marketing URL:** leave empty.

## Screenshots

Eight, in `store/screenshots/`, each 1290 x 2796 (Apple's 6.9-inch iPhone size, the only one an iPhone-only app must supply; Apple scales it for smaller phones). `store/contact-sheet.jpg` shows all eight side by side. `npm run store:shots` makes them again.

The owner asked that the first ones be made to look good ("like the loading screen ... if you need to generate art for it do it"), so they are a designed set, not bare captures:

- **The first is key art with the title over it**, as the loading screen has it. The picture (`store/art/keyart.jpg`) was painted for this, from a sheet of the game's own characters, so everyone in it is who they are in the game: the house-sitter with her lantern on the path up to the house, and thirteen Clutterkin round her. Its night sky is carried on upward for the title to stand in.
- **The other seven are the real game**, photographed as it runs and not drawn over, each set in the same frame: a caption in the title's lettering, the screen below, the key art out of focus behind, and one or two of the game's own creatures standing by.

| File | Caption | What the screen shows |
| --- | --- | --- |
| `1-clutterkin` | Clutterkin. The house is awake. | Key art |
| `2-reach-out` | Reach out, make a friend | A fight in the garden, one of them half won over |
| `3-eighty-kinds` | Eighty kinds to befriend | The scrapbook: friends, grown forms, Heirlooms |
| `4-ringleaders` | Calm every ringleader | The Crumbwyrm, in the Midnight Pantry |
| `5-growing-up` | Watch them grow up | Two friends growing up after a fight |
| `6-wishes` | Grant a wish, gain a ringleader | Old Summerlong outside the garden, with its wish |
| `7-indoors` | Every room is wide awake | Inside the Midnight Pantry |
| `8-the-lane` | A whole lane to wander | Out in the lane at night |

One thing to know: Apple's rule is that screenshots show the app in use, "not merely the title art". A key-art first picture followed by gameplay is what most games do, and seven of these eight are gameplay; but if a reviewer objects, put `2-reach-out` first and the key art second, or drop it.

No preview video is proposed.

## Age rating

Apple asks a list of questions and works the rating out. Proposed answers:

| Question | Answer |
| --- | --- |
| Cartoon or fantasy violence | **Infrequent or mild.** Fights are turn-based; nobody is hurt or dies; the worn-out "catch their breath". |
| Realistic violence, prolonged or graphic violence | None |
| Profanity or crude humour | None |
| Mature or suggestive themes, horror or fear themes | None. (Things in a house come alive at night; it is played for comfort, not fright.) |
| Sexual content or nudity | None |
| Alcohol, tobacco or drug use or references | None |
| Medical or treatment information | None |
| Gambling, simulated gambling, contests | None. (A rare-colour creature is a chance in a fight, bought with nothing.) |
| Unrestricted web access | No |
| User-generated content, messaging, chat | No |
| Advertising | No |
| Made for Kids | **No.** It suits children, but the Kids category brings extra rules; leave it out. |

Expected result: 4+.

## App privacy

**Data collection: "No, we do not collect data from this app."** True of the game: it has no accounts, no analytics, no ads, and makes no network request of any kind (a test holds it to that). The app's own privacy manifest already says the same.

## Other questions App Store Connect asks

| | Answer |
| --- | --- |
| Encryption (export compliance) | Uses none. The app already declares so, so the question is not asked at each upload. |
| Content rights | Contains no third-party content. The creature and room art is the owner's own, from Pawst Lives; the rest was made for this game. The font is Fredoka, under the SIL Open Font License, whose text ships with the game. |
| Sign-in needed to review | No |
| Devices | iPhone only, upright only, iOS 15 or later |
| Languages | English |
| Availability | Everywhere |

**Notes for the reviewer** (the box on the submission page):

> Clutterkin is a single-player game with no sign-in, no network use, no purchases and no ads. Everything is available from first launch: tap Begin, read the short introduction, then tap or drag to walk. Walk through the garden gate (up and to the left of the house) to meet the first group; in a fight, tap a move, or tap "Reach out" and then one of them to make a friend of it. The save is kept on the device.

## Draft: the privacy page

> **Clutterkin privacy policy**
>
> **The short version.** Clutterkin collects nothing. It has no accounts, no ads and no analytics, and it never connects to the internet.
>
> **What the game stores, and where.** Your progress (your friends, the places you have calmed, your settings and the name you chose for your house-sitter) is saved on your device, in the app's own storage. It is not sent to us or to anyone else. Your device's own backup, if you use one, includes it as it includes every app's data.
>
> **What the game does not do.** It does not ask for your name, email, location, contacts, photos, camera or microphone. It does not track you across apps or websites. It contains no third-party code that does.
>
> **Purchases.** There is nothing to buy inside the game.
>
> **Children.** The game is suitable for children and collects nothing from anyone, of any age.
>
> **These web pages.** This page is hosted by GitHub Pages, which, like any web host, receives the address of a visitor's device when a page is requested. The game itself never visits them.
>
> **Deleting your data.** Delete the app and the save goes with it. Inside the game, Settings has "Start over".
>
> **Changes.** If this ever changes, this page will say so, with the date.
>
> **Contact.** [the owner's contact, as on the support page]

## Draft: the support page

> **Clutterkin support**
>
> Clutterkin is an iPhone game by [the owner's name].
>
> **Getting started.** Tap or drag to walk. Walk up to a door or a gate to go in. Tap the gold "Goal" at the top for what to do next, the map, and your wishes.
>
> **Fights.** Three against three, one turn at a time. Tap a move, then who it is for. Once a round you can make a Call: Reach out to make a friend, Cheer on to help a friend hit harder, or Patch up to mend one. Tap anyone in a fight to see what they are.
>
> **Making friends.** Reach out to one of them until its Huff is gone, and win the fight: it comes home with you. Hitting one you are reaching out to puts its Huff back up. You keep one friend of each kind.
>
> **Worn out?** Rest at home or on a bench. Whoever you have calmed stays calm.
>
> **Ringleaders.** A ringleader cannot be reached. Once its place is calm it stands outside, with a wish: "What to do" lists them. Grant a wish and win its friendly bout, and it comes home. One ringleader walks with you at a time.
>
> **No sound?** Check the switch on the side of the phone and the volume, then Settings in the game: "Gone quiet? Restart sound".
>
> **Saves.** Progress saves on your device by itself. There is no account. Deleting the app deletes the save.
>
> **Contact.** [the owner's contact]. It helps to say which iPhone and iOS version you have.
