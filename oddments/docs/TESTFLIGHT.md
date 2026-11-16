# Getting Clutterkin onto TestFlight

The iPhone app is the same game in a thin shell (Capacitor, as Pawst Lives uses), built by GitHub on a Mac it rents by the minute. Everything that can be done from this repository is done. What is left needs your Apple account, and is listed below in the order you would do it.

## Where things stand

| | Status |
| --- | --- |
| Xcode project (`ios/`), icon and launch image | In the repository |
| The app compiles, launches in the iOS Simulator, and keeps its save in native storage | Checked by the "Clutterkin iOS" workflow, job "build", which needs no secrets. Its screenshots are attached to each run. |
| Upload to TestFlight | **Working.** The "Clutterkin iOS" workflow archives, has Apple sign it and uploads it. Two builds have gone up, both on 16 November 2026: 0.1.0 (9), and 0.1.0 (13), which was built on the Xcode 27 Mac. Apple has processed both. An internal tester group, "Team", gets every build and the account holder is invited to it. |
| A real iPhone | Build 0.1.0 (9) has been installed from TestFlight and run. Build 0.1.0 (13) adds Tin Can Alley, the new icon, the stepping-stone fix and the folding-phone layout; nobody has yet reported running it. Sound, the Heirloom hunt and the loading screen came after it and need another upload. |

## What only you can do

### 1. Choose the bundle id

The bundle id is the app's permanent, behind-the-scenes name with Apple. Players never see it and it can never be changed once the app exists. Yours for Pawst Lives ends in `.pawstlives`; the natural one here is the same prefix ending in the game's name.

It contains your name, and this repository is public, so it is **not written anywhere in the repository**: the project carries a stand-in (`app.oddments.game`) and the real one is swapped in during the upload from a secret.

Register it at [developer.apple.com/account](https://developer.apple.com/account) → Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App. Give it a description, choose **Explicit**, type the bundle id, and continue. It needs no capabilities.

### 2. Create the app record

At [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Apps → **+** → New App:

- Platform **iOS**.
- **Name**: Clutterkin. It must not already be taken on the App Store (if it is, add a few words, for example "Clutterkin: Before Monday"); it can be changed later, right up until release. TestFlight testers see this name.
- Primary language English (U.S.).
- **Bundle ID**: the one from step 1.
- **SKU**: anything, for example `oddments-ios`.

The name under the icon on the phone is set separately and says "Clutterkin" (`CFBundleDisplayName` in `ios/App/App/Info.plist`, and `appName` in `capacitor.config.json`).

### 3. Add five secrets to this repository

GitHub → this repository → Settings → Secrets and variables → Actions → **New repository secret**. GitHub cannot copy secrets from the Pawst Lives repository, so the first four are the same values typed in again:

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `ASC_KEY_ID` | The API key's id: 10 letters and digits | App Store Connect → Users and Access → Integrations → App Store Connect API: the Key ID column |
| `ASC_ISSUER_ID` | A long id with four dashes | The same page, above the table of keys |
| `ASC_KEY_P8` | The whole text of the `AuthKey_XXXXXXXXXX.p8` file | The file you downloaded when the key was made. Apple lets it be downloaded once; if you no longer have it, make a new key with Access set to **Admin** and use its values instead. |
| `APPLE_TEAM_ID` | Your team id: 10 letters and digits | developer.apple.com/account → Membership details |
| `IOS_BUNDLE_ID` | The bundle id from step 1 | You chose it |

**The key must have Admin access.** Apple signs the upload with a certificate it keeps itself, and only does that for an Admin key. With any other access the upload stops at "Cloud signing permission error": this happened on the first two attempts here, with an App Manager key, and the same upload went through as soon as an Admin key replaced it. A key's access cannot be changed afterwards: generate a new one with Access set to Admin, replace `ASC_KEY_ID` and `ASC_KEY_P8`, and revoke the old one. The Issuer ID does not change.

### 4. Run the upload

GitHub → Actions → **Clutterkin iOS** → Run workflow → tick **Upload to TestFlight** → Run.

- A first job checks the secrets against Apple in a few seconds and says in plain words what is wrong if anything is. The one thing it cannot check is that the key has Admin access (step 3): that only shows when Apple is asked to sign. To run just this check, tick "Only check the Apple credentials" instead; run that way it also reports what Apple has done with each uploaded build and who can test.
- The second archives the app, has Apple sign it, and uploads it. About ten minutes.
- It finishes by making an internal tester group called "Team" that gets every build, and inviting the account holder (you), if nobody can test yet.

### 5. Install it

Apple takes a few minutes to process a build. Then: install the **TestFlight** app on your iPhone, accept the invitation Apple emails you, and install Clutterkin from there. Settings in the game shows which build you have.

The first build of an app sometimes waits on one question in App Store Connect (TestFlight → the build → "Missing Compliance"). The answer is already declared in the app (it uses no encryption beyond what iOS provides), so this should not appear; if it does, answer "None of the algorithms mentioned above".

## iPhone Duo

iPhone Duo is Apple's folding iPhone: a 5.4-inch screen when closed and a 7.6-inch one when open. It runs iPhone apps, so the game is not a separate product for it: the same app, laid out to fit.

| | Where it stands |
| --- | --- |
| The game's layout | Fills both screens, and takes being opened or closed in the middle of a walk or a fight without losing anything. Open, you see about a third more of the world across, lists go four to a row and a fight's moves two to a row. Held to by the browser test at 466x678 points (closed) and 669x951 (open: the size Apple's simulator draws the inner screen at). |
| Built with Xcode 27.1 | Yes. An app uses all of both screens only when built with an Xcode that knows the phone. The "Clutterkin on iPhone Duo" workflow builds with it, and so does "Clutterkin iOS" when its "xcode27" box is ticked: the Simulator check, the native save check and the upload rehearsal all pass there (slowly: that Mac's Simulator takes about 25 minutes over it). |
| On Apple's iPhone Duo simulator, closed | Seen. The game launches, fills the outer screen and keeps clear of the strip the phone puts down its right side for the clock and camera. That strip is wide: about 84 of the outer screen's 466 points, so closed, the game has about the room of a small iPhone. Screenshots are kept with every run of the workflow. |
| On the simulator, open | **Not seen.** The simulator starts closed, and nothing a script can do opens it (switching the inner screen on leaves it blank; opening is done by hand in the Simulator app on a Mac). The inner screen has only been tried at its size, 669x951 points, in a browser. |
| A real iPhone Duo | **Not tried by anyone.** |
| The builds on TestFlight | 0.1.0 (13) was built with Xcode 27.1, so it is made for iPhone Duo. 0.1.0 (9) was built with the older Xcode: by Apple's account an app built that way still runs on an iPhone Duo, but scaled, and without using all of the screen. |

To put a build on TestFlight that is made for iPhone Duo: run "Clutterkin iOS" with both "testflight" and "xcode27" ticked. Build 0.1.0 (13) went up that way.

What is not known until someone holds one: how it feels in the hand, whether the fold line crosses anything that matters (nothing has been arranged around it: you stand near the middle of the view, and pop-ups sit in the middle of the screen), and how fast the world draws on the open screen (in a desktop browser at that size it measured 51 to 58 frames a second after the drawing was capped; a phone's graphics chip should do better).

## Things to know

- **This repository is public, and so is every workflow log.** The upload job hides the secrets, prints only errors and the outcome from the signing step, and removes anything in quotes from those lines, because Xcode can print the certificate owner's name there. If you would rather not rely on that, move the game to a private repository of its own, as Pawst Lives is, before the first upload; nothing else needs to change.
- **Internal testers** (people on your App Store Connect team, up to 100) get builds immediately. **External testers** (anyone, by email or a public link) need a short one-time review by Apple of the first build, and a line or two of "what to test" text; add them under TestFlight in App Store Connect when you want them.
- **The icon** is made by `tools/ios-art.py` from one painting: the house-sitter with a lantern and a calm Dust Bunny (`docs/ART.md`). **The launch image** is a postcard of the lane painted from the game's own world by `tools/postcard.mjs`, the same picture as the game's loading screen. Build 0.1.0 (13) has the new icon but an earlier launch image; the postcard arrives with the next upload.
- **Nothing here is the App Store.** A public release also needs a privacy policy page, screenshots, a description, an age rating and Apple's review. Pawst Lives has all of that worked out (`docs/SUBMISSION.md` there) and it can be carried over when the game is ready.
- **Working on it from a Mac**: `npm install`, `npm run ios:sync`, then open `ios/App/App.xcodeproj`. Run `npm run ios:sync` again whenever anything under `web/` changes.
