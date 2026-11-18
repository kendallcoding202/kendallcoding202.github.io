# Clutterkin — security

An audit of the game, the iPhone app and the pipeline that builds and uploads it, asked for by the owner on 18 November 2026 ("a thorough and deep dive security audit of the app, make sure it's locked down tight"). Two reads were made: one by the session that wrote the game, of what can be seen from outside (the published site, the public logs, what Apple reports); and one by a separate reviewer that was given the code and told nothing of the first's conclusions. This is what they found, what was changed, and what is the owner's to do.

**In one line:** nothing critical or high. The game itself held to what it claims almost everywhere. The real weaknesses were in how the Apple key was handed round in the build pipeline, one testing switch that worked from a link, and a debug handle that was live in the app. Those are fixed. What is left needs the owner's hands in GitHub's settings, and is listed under *The owner's to do*.

## What the game is, for this purpose

A single-player game with no accounts, no purchases, no ads and no network calls. So there is no server to break into, no other player to harm, no payment to steal and no personal data collected. What is worth protecting is: the player's save; the player's device (nothing the game shows may run as code); the owner's Apple account (the key that can upload builds); the owner's privacy (this repository and everything its workflows print are public); and the supply chain (that what is built is what is in the repository).

## Found, and fixed

| # | What | How serious | What was done |
|---|---|---|---|
| 1 | **The Apple key was in reach of every step of the upload**, including the steps that fetch other people's code (installing packages, building Swift packages while archiving). One compromised package could have read a key that has Admin access to the Apple account. The key file was also written to disk before the archive was built. | Medium | No secret is set for a job as a whole any more. Each is handed only to the step that uses it. The key is written to disk after the archive is made, just before signing, and removed whatever happens. `tests/unit/security.test.mjs` holds the workflow to that, line by line. |
| 2 | **A link could erase a save.** On the web copy, opening the game's address with `?reset` on the end erased the saved game at once, with no question asked and no copy kept. Anyone could send such a link. | Medium for the web copy; not reachable in the app | A person with a game saved is now asked first (a test driving the browser is not), and a game erased on purpose, by a link or from Settings, is set aside under its own name instead of destroyed. |
| 3 | **The testing switches worked in the app.** `?debug`, `?reset`, `?seed`, `?fast`, `?day` and a flags object a host page could set were honoured everywhere, and the game object was handed to any script as `window.oddments` whenever the page's address was "localhost", which inside the app it always is. Nothing could reach them from outside the app today; that is not the same as their not being there. | Low | In a numbered build, which is what the app is, there are no switches at all: `web/js/platform/switches.js` is the one place they are read, and in a numbered build it reads nothing. The game object is handed out only in a copy for testing. A switch must be a plain value somebody set, never something inherited. |
| 4 | **What Apple says about an error went into the public log as it came**, right after a request that carries the account holder's name and email; and the scrubbing of Xcode's signing output caught double quotes only. | Low | Apple's words are passed through `scrub` first: no email address, nothing in quotes of any kind, none of our own identifiers, and no more than 300 characters. The signing step's filter now also takes out single-quoted text, addresses and a certificate owner's name. The tool masks the bundle id as it actually uses it, and prints a tester group's name only if it is the one it made itself. |
| 5 | **Key files could be committed by accident.** Nothing in `.gitignore` covered them, and the instructions have the owner handling an `AuthKey_*.p8` file by hand. | Low | `*.p8`, `AuthKey_*`, `.env`, `*.p12`, `*.mobileprovision` and `ExportOptions.plist` are ignored. None was ever committed. |
| 6 | **The test browser was whatever was newest that day.** The tests workflow installed the latest Playwright on every push. It holds no secrets, but unread code ran on every change. | Low | Pinned to a named version (1.63.0). |
| 7 | **The house-sitter's name was not cleaned the way a friend's name is.** Characters that cannot be seen, or that turn text round (U+202E), survived in it. It is only ever shown as text, so this was cosmetic. | Note | It goes through the same `tidyName` as every other name now, typed or from a save. |
| 8 | **A save's list of hints already shown kept any key of up to 24 characters**, `__proto__` and `constructor` among them. No harm came of it (checked), but it was a list that took anything. | Note | Only plain lower-case names set to true are kept. |
| 9 | **A damaged copy of the save could hide a good one.** In the app the save is kept in two places; the copy that claimed the later date was used, and if it could not be read the game started afresh and overwrote both. | Note (robustness) | Every copy is tried in turn, the newest first. |

## Looked at, and found sound

- **Nothing the game shows can run as code.** There is no `innerHTML`, `document.write`, `eval`, `new Function`, string timer, dynamic import or built link anywhere in the game. Every name a player can type is put on the screen as text. Picture addresses are built only from ids the game has checked. (`tests/unit/sealed.test.mjs` holds this.)
- **The page's policy** allows the game's own scripts, styles, pictures and font, and nothing else: no inline script or style, no `eval`, nowhere to connect to, no base address, no forms.
- **The game reaches nothing.** No fetch, no socket, no beacon, no service worker, no outside address in any file that ships. Sound is made in code.
- **A hostile save cannot break the game or run anything.** It is rebuilt field by field, numbers are clamped, lists are capped, positions are checked, and the result is rehearsed on a copy before it is used. The reviewer threw 3,000 mangled saves at it and then walked, talked and fought with each: none threw, none was unplayable, 18 were refused, and nothing was written where it should not be.
- **The app** asks for no permission, has no web addresses of its own that another app could open, makes no exception to secure transport, cannot be navigated to another site (a link would open in Safari), and cannot be inspected in the build that ships. Its privacy manifest says no tracking and no data collected, which is true. The only thing it does that the web copy does not is keep the save in the app's own settings.
- **The workflows** can only read the repository. The ones that hold secrets can only be started by hand. Nothing a stranger writes (a commit message, a branch name, a pull request) is ever put into a command. Uploads are never cancelled half-way. Every action is pinned to an exact commit, and each of those commits was checked against the official release it claims to be.
- **The public logs.** The log of the upload of 18 November 2026 was fetched and searched: the owner's name appears nowhere but in the public repository's own path, nothing shaped like a bundle id appears, and no key material.
- **The repository.** No key, token or password in the files or in the history that could be read. No email address or home folder under `oddments/`. None of the 770 committed pictures carries hidden details of who made it or where.
- **Dependencies.** The game uses no package at all. The app's runtime is Capacitor (core, iOS, preferences, splash screen, status bar). `npm audit` reports nothing.
- **The published site** is served over HTTPS only, with strict transport security.

## The owner's to do

These need settings only the owner can change, or are choices that are the owner's.

1. **Put the Apple secrets behind a protected environment.** Today they are repository secrets, which any workflow file on any branch can ask for: someone (or something) that can push a branch can add a workflow that reads them. In GitHub: *Settings → Environments → New environment*, call it `app-store`, restrict it to the `main` branch and add yourself as a required reviewer; move the five secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`) into it and delete them from the repository's own; then say so, and `environment: app-store` is added to the two jobs that use them. After that every upload, and every look at Apple's status, waits for your click in GitHub. That is the point of it.
2. **Protect `main`.** *Settings → Branches*: require a pull request or at least block force pushes and deletion. The published game is whatever is on `main`.
3. **Hide your email address in commits.** Fifty commits in this public repository carry a personal Gmail address as their author. *GitHub → Settings → Emails*: tick "Keep my email addresses private" and "Block command line pushes that expose my email", and use the `noreply` address GitHub gives you from then on. The fifty already public can only be changed by rewriting the history, which breaks every copy of the repository: probably not worth it, but it is your address.
4. **Turn on secret scanning and push protection** (*Settings → Code security*), so that a key pasted by mistake is refused before it is public.
5. **Two workflows that are not the game's use actions pinned only by name**: `kovyr-vault-build.yml` (with permission to write to the repository) and `windows-build.yml`. If one of those names were hijacked it could push to `main`, and so change the published game. They belong to other projects, so they were left alone; pinning them to exact commits is a few lines each.
6. **Consider giving the game an address of its own.** The web copy shares its address with every other page of this site (About Me, Contact Me, Home). A browser keeps one store per address, so a flaw in any of those pages could read or erase the game's save. None was seen.

## Left as it is, on purpose

- **A save can be written by hand.** Somebody who edits their own save can give themselves every friend at the top level. What reading a save enforces is that nothing in it can break the game or put you in a fight that could not happen; it does not, and cannot, prove you earned what it says. With no accounts and no other players, the only person this cheats is the one doing it.
- **"On this device and nowhere else"** is true of the game: it sends the save nowhere. An iPhone's own backup (to iCloud or a computer) includes the app's data, as it does every app's.
- **The page can be put in a frame** by another site. A policy against that can only be sent by a web server, and GitHub Pages sends none. Browsers give a framed copy its own separate store, so it cannot see the real save, and there is nothing in the game worth tricking a tap out of.
- **The whole repository is published**, tools, tests, notes and original paintings, not only the game. Nothing in it is secret. A `_config.yml` at the top of the site could leave them out; that file belongs to the whole site, not to this game.
- **The bundle id is kept secret only because it contains the owner's name**, and it stops being secret the day the app is in the App Store, where the seller's name is shown beside it. `docs/TESTFLIGHT.md` no longer says how it is made up.
- **`require-trusted-types-for 'script'`** would have the browser itself refuse markup written from text. The game writes none, and a test holds it to that. It was not added because it could not be tried in the app's own web view from here, and a policy the app's browser misreads would stop the game from starting.

## Not checked

- Anything on a real iPhone: that the page's policy holds under the app's own address, and that the app's web view behaves as its settings say.
- GitHub's settings: who may push, whether `main` is protected, whether secret scanning is on, which branch the site is published from.
- The history before July 2026 (the copy of the repository that was read does not go back further).
- What Apple and Xcode really print when signing fails. The scrubbing is tested against made-up text, not theirs.
- The upload job itself since it was changed. Its two Apple steps on Linux can be run without uploading anything; the Mac part runs only when a build is uploaded. Until one is, the reordering there is read and tested as text, not run.
- Whether asking for the Swift packages by exact, recorded versions (`Package.resolved`) builds: that file can only be made on a Mac.
