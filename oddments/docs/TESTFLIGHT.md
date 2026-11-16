# Getting Clutterkin onto TestFlight

The iPhone app is the same game in a thin shell (Capacitor, as Pawst Lives uses), built by GitHub on a Mac it rents by the minute. Everything that can be done from this repository is done. What is left needs your Apple account, and is listed below in the order you would do it.

## Where things stand

| | Status |
| --- | --- |
| Xcode project (`ios/`), stand-in icon and launch image | In the repository |
| The app compiles, launches in the iOS Simulator, and keeps its save in native storage | Checked by the "Clutterkin iOS" workflow, job "build", which needs no secrets. Its screenshots are attached to each run. |
| Upload to TestFlight | Wired up (job "testflight"), **not yet run**: it needs the app record and the five secrets below. |
| A real iPhone | Not tried. TestFlight is how that happens. |

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
| `ASC_KEY_P8` | The whole text of the `AuthKey_XXXXXXXXXX.p8` file | The file you downloaded when the key was made. Apple lets it be downloaded once; if you no longer have it, make a new key with the same Access as the one Pawst Lives uses (the Access column of the keys table shows it) and use its three values instead. |
| `APPLE_TEAM_ID` | Your team id: 10 letters and digits | developer.apple.com/account → Membership details |
| `IOS_BUNDLE_ID` | The bundle id from step 1 | You chose it |

### 4. Run the upload

GitHub → Actions → **Clutterkin iOS** → Run workflow → tick **Upload to TestFlight** → Run.

- A first job checks the secrets against Apple in a few seconds and says in plain words what is wrong if anything is.
- The second archives the app, has Apple sign it, and uploads it. About ten minutes.
- It finishes by making an internal tester group called "Team" that gets every build, and inviting the account holder (you), if nobody can test yet.

### 5. Install it

Apple takes a few minutes to process a build. Then: install the **TestFlight** app on your iPhone, accept the invitation Apple emails you, and install Clutterkin from there. Settings in the game shows which build you have.

The first build of an app sometimes waits on one question in App Store Connect (TestFlight → the build → "Missing Compliance"). The answer is already declared in the app (it uses no encryption beyond what iOS provides), so this should not appear; if it does, answer "None of the algorithms mentioned above".

## Things to know

- **This repository is public, and so is every workflow log.** The upload job hides the secrets, prints only errors and the outcome from the signing step, and removes anything in quotes from those lines, because Xcode can print the certificate owner's name there. If you would rather not rely on that, move the game to a private repository of its own, as Pawst Lives is, before the first upload; nothing else needs to change.
- **Internal testers** (people on your App Store Connect team, up to 100) get builds immediately. **External testers** (anyone, by email or a public link) need a short one-time review by Apple of the first build, and a line or two of "what to test" text; add them under TestFlight in App Store Connect when you want them.
- **The icon and launch image are stand-ins**: the Dust Bunny in lamplight, composed by `tools/ios-art.py` from art already in the game. Proper icon art is on the list in `docs/ART.md`.
- **Nothing here is the App Store.** A public release also needs a privacy policy page, screenshots, a description, an age rating and Apple's review. Pawst Lives has all of that worked out (`docs/SUBMISSION.md` there) and it can be carried over when the game is ready.
- **Working on it from a Mac**: `npm install`, `npm run ios:sync`, then open `ios/App/App.xcodeproj`. Run `npm run ios:sync` again whenever anything under `web/` changes.
