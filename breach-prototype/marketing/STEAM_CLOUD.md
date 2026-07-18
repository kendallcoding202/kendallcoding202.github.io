# BREACH — Steam Cloud save setup

BREACH persists one small JSON blob: the Operator Profile (wins, per-campaign Threat cleared, per-operator wins, unlocked achievements). All reads/writes go through `src/ui/storage.ts`, so which backend stores it is a one-file decision.

## How it works today
- **Web / itch build:** `localStorage`. Persists per-browser.
- **Tauri desktop build:** `localStorage` inside the webview. Persists per-machine, but is NOT a file Steam can see — so for real Cloud sync, switch the desktop build to the file backend below.
- **Manual backup (all builds):** the Achievements panel has **Export save** (downloads `breach-save.json`) and **Import save** (merges a file back in, taking the best of each stat so it never erases progress). This is the zero-Steam fallback and a good "move between machines" path.

## Recommended: Steam Auto-Cloud (no Steamworks code)
Auto-Cloud syncs files matching a path pattern you configure in Steamworks — the game just has to write its save to a real file. This is the least-code path for a Tauri app.

**1. Switch the desktop save to a file.** In `storage.ts`, back `readRaw`/`writeRaw` with the Tauri FS plugin when running under Tauri (feature-detect `window.__TAURI__`), writing to the app-data dir:

```ts
// pseudocode — desktop backend for storage.ts
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
const FILE = "profile.json";
// writeRaw: await writeTextFile(FILE, value, { baseDir: BaseDirectory.AppData });
// readRaw:  await readTextFile(FILE, { baseDir: BaseDirectory.AppData });
```

(Reads become async, so `loadProfile` would hydrate once at startup into the existing in-memory `cache`; the rest of the code already reads the cache synchronously.)

**2. Configure Auto-Cloud in Steamworks** → *Application → Cloud*:
- **Root:** `App Install Directory` won't work for a per-user save; use the OS-appropriate root that maps to where Tauri's `AppData` writes:
  - Windows: `WinAppDataRoaming` → subdir your Tauri identifier (`com.kendallcoding.breach`)
  - macOS: `MacAppSupport` → same subdir
  - Linux: `LinuxXdgDataHome` → same subdir
- **Path pattern:** `profile.json` (or `*.json`)
- Set a **byte/file quota** (a few MB is ample — the save is < 4 KB).

**3. Enable Cloud** for the app and per-depot. Test by clearing local save, launching on a second machine signed into the same account, and confirming progress appears.

## Alternative: Steamworks Cloud API (ISteamRemoteStorage)
If you later add the Steamworks SDK (e.g. via a Rust `steamworks` crate in the Tauri shell), route `storage.ts` through `FileWrite`/`FileRead` instead. More control (conflict handling, per-file timestamps) at the cost of native glue. Auto-Cloud is enough for a single small save; reserve the API for when you need cloud-aware conflict resolution.

## Checklist before launch
- [ ] Desktop build writes the save to a file (not just webview localStorage).
- [ ] Auto-Cloud root/pattern matches the Tauri AppData path for all three OSes.
- [ ] Cloud quota set; Cloud enabled on the app + depots.
- [ ] Verified round-trip on a second machine.
- [ ] Export/Import still works as the offline backup path.
