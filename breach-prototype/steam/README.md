# BREACH — SteamPipe upload

These VDF scripts upload the Windows build to Steam. You only touch them once you have a Steamworks app and its App/Depot IDs.

## What you need first
- A Steamworks account with **BREACH** (full) created → its **App ID** and **Depot ID**.
- A separate **BREACH Demo** app created and linked to the full app → its own **App ID** + **Depot ID**. (Steam demos are separate apps.)
- The **SteamPipe / ContentBuilder** tool — either `steamcmd` or the ContentBuilder in the Steamworks SDK download.
- A Windows build of the game (see below).

## 1. Get the Windows build
Two ways:
- **CI (recommended):** run the *Windows desktop build* GitHub Action (Actions tab → Run workflow). Download the `breach-exe-full` and `breach-exe-demo` artifacts — each is a self-contained `BREACH.exe`.
- **Local:** on a Windows machine, `cd breach-prototype && npm ci && npm run desktop:build` (full) or `npm run desktop:demo` (demo). The exe lands at `breach-prototype/src-tauri/target/release/BREACH.exe`.

> The Tauri exe is self-contained on Windows (WebView2 ships with Windows 10/11). If you later add assets/DLLs, drop them next to the exe and they'll be included.

## 2. Stage the content
- Copy the full-game `BREACH.exe` into `steam/content_full/`
- Copy the demo `BREACH.exe` into `steam/content_demo/`

(These folders are kept in git via `.gitkeep`; the exes themselves are git-ignored.)

## 3. Fill in the IDs
Edit the four VDFs and replace the placeholders:
- `app_build_full.vdf` → `FULL_APP_ID`, `FULL_DEPOT_ID`
- `depot_build_full.vdf` → `FULL_DEPOT_ID`
- `app_build_demo.vdf` → `DEMO_APP_ID`, `DEMO_DEPOT_ID`
- `depot_build_demo.vdf` → `DEMO_DEPOT_ID`

## 4. Upload
From the `steam/` folder, with absolute paths:
```
steamcmd +login <builder_account> +run_app_build "%CD%\app_build_full.vdf" +quit
steamcmd +login <builder_account> +run_app_build "%CD%\app_build_demo.vdf" +quit
```
Use a dedicated builder account with 2FA, not your personal login.

## 5. Set it live on a playtest branch
`setlive` is intentionally empty in the scripts (so an upload never auto-publishes). After the build appears in **Steamworks → your app → Builds**, set it live on a branch:
- For closed testing, create a branch named e.g. `playtest` (password-optional) and set the build live there.
- Enable **Steam Playtest** on the app so testers get a "Request Access" button on the store page — approve them and they download that branch.

## Launch config reminder (Steamworks web UI, not these files)
- **Installation → Launch Options:** executable `BREACH.exe`.
- **General Installation:** set the install folder name.
- **Cloud:** see `../marketing/STEAM_CLOUD.md` for the Auto-Cloud path/pattern.
