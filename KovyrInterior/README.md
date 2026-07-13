# Kovyr Interior — internal-network scanner for iOS

A native SwiftUI iOS app that discovers devices on a local Wi-Fi network and
provides a set of network diagnostic tools. It is the **on-site / internal**
companion to **Kovyr** (the passive *external* security-posture product) — the
field tool for the internal side of an assessment that the external scan can't
see. Built to run on a real device and be submittable to the App Store.

> **Scope & relationship to Kovyr.** Kovyr Interior is a **standalone iOS app**
> in this repo. It does **not** modify or depend on the Kovyr (`halden`) codebase.
> Because it actively probes a network, using it on a *client's* network is an
> active internal assessment and must sit behind the same **written-authorization
> gate** as Kovyr's Phase 3 (see Kovyr's `AUTHORIZATION_TO_TEST.md`). Treat it as
> a prototype / field tool, not part of the passive automated product.

## Requirements

- **macOS with Xcode 16 or newer** (the project uses file-system-synchronized
  groups, an Xcode 16 feature).
- An **iPhone/iPad running iOS 17+**. Most networking features require a *real
  device* on Wi-Fi — the Simulator shares the Mac's network and can't probe a
  phone's subnet the same way.
- A free or paid **Apple Developer account** for on-device signing.

## Build & run

1. Open `KovyrInterior.xcodeproj` in Xcode.
2. Select the **KovyrInterior** target → **Signing & Capabilities**.
3. Set your **Team**. The bundle identifier ships as `com.kovyr.interior`
   (widget: `com.kovyr.interior.widget`); change the prefix to one your team
   owns if needed.
4. Plug in your iPhone, select it as the run destination, and press **Run**.
5. On first scan, iOS shows a **Local Network** permission prompt — tap **Allow**.
   (Without this, discovery finds nothing.)

### Required one-time setup for the widget (App Group)

The home-screen widget shares data with the app through an **App Group**. This
needs signing configuration that only your Apple account can create:

1. Keep the two bundle IDs consistent: the widget ID must be prefixed by the app
   ID (ships as `com.kovyr.interior` / `com.kovyr.interior.widget`).
2. Select the **KovyrInterior** target → **Signing & Capabilities** →
   **+ Capability** → **App Groups**, and add `group.com.kovyr.interior`.
3. Do the same for the **KovyrInteriorWidgetExtension** target, using the *same*
   group.
4. If you change the group id, update it in four places to match:
   `KovyrInterior/Shared/SharedState.swift`, `KovyrInteriorWidget/SharedState.swift`,
   and both `.entitlements` files. (They ship set to `group.com.kovyr.interior`.)

If you skip this, the app still builds and runs — the widget just shows zeros.
(App Groups may require a paid Apple Developer membership; a free account can
still run the app itself. If widget signing fails, remove the
**KovyrInteriorWidgetExtension** target and the app is unaffected.)

### Background scanning

Turn on **Settings → Automatic background scans** in the app. iOS decides when
background refresh actually runs, and the system-wide **Settings → General →
Background App Refresh** must be enabled. Background tasks do **not** run on the
Simulator — test on a real device.

## What it does

### Overview tab
- Reads the Wi-Fi IP, subnet (CIDR) and gateway.
- Discovers live devices by:
  - a concurrent **TCP sweep** of every host in the subnet,
  - **Bonjour / mDNS** service discovery (AirPlay, Chromecast, printers, SMB…),
  - **reverse DNS** for friendly hostnames.
- Per-device detail screen with **inferred device type**, services,
  **first-seen** date, and an on-demand **port scan**.
- **Device-type guessing**: each device is classified (Router, Phone, Computer,
  Printer, TV/Streamer, Camera, Network Storage, Smart Home, Media Server…) from
  its open ports and Bonjour services, with a matching icon.
- **New-device detection**: devices not seen before are flagged with a *New*
  badge and trigger a **local notification** ("New device joined"). The first
  scan seeds the baseline silently.

### History tab
- A log of recent scans (time, device count, how many were new).
- Every device seen, with first-seen / last-seen times — useful as an internal
  asset inventory (Kovyr / FTC Safeguards §314.4 element 2/3).
- Persisted across launches; clearable from the toolbar.

### Settings tab
- Toggle **automatic background scans** (periodic re-scan + new-device alerts).
- Shortcut to system notification settings; app/version info.

### Home-screen widget
- Small and medium widgets showing the **device count**, **new-device count**,
  and **last scan time**, updated after each scan via a shared App Group.

### Tools tab
| Tool | Notes |
|------|-------|
| **Find open ports** | Full TCP port scan of any host. |
| **Router security check** | Detects **NAT-PMP** auto port-forwarding and shows the public IP. |
| **Find hidden camera** | Flags devices exposing camera/DVR ports (RTSP, ONVIF, Hikvision, Dahua). |
| **Speed test** | Download/upload/latency via Cloudflare's speed endpoints. |
| **Ping** | Real ICMP echo (round-trip time chart, min/avg/max/loss). |
| **Trace route** | Best-effort — see limitations. |

## iOS platform limitations (by design, not bugs)

These are Apple sandbox restrictions that affect *every* non-jailbroken iOS
network app:

- **No MAC addresses / manufacturer** of other devices — iOS blocks this for
  privacy. Kovyr Interior fingerprints devices via Bonjour + open ports instead.
- **Discovery is TCP + Bonjour based**, not ARP/ICMP sweep. A device that has
  every port closed and advertises no Bonjour services may not appear.
- **Trace route** is limited: iOS does not deliver the intermediate ICMP
  "time-exceeded" messages to sandboxed apps, so middle hops often show `* no
  reply`. The destination usually resolves.
- **Full UPnP/SSDP inspection** needs Apple's *multicast entitlement*
  (`com.apple.developer.networking.multicast`), which must be requested from
  Apple. The router check uses unicast NAT-PMP, which needs no special
  entitlement.

## Project layout

```
KovyrInterior/
├─ KovyrInterior.xcodeproj/
├─ KovyrInterior/                    # App target
│  ├─ KovyrInteriorApp.swift         # @main app + tab shell
│  ├─ Info.plist                     # Local Network, Bonjour, background tasks
│  ├─ KovyrInterior.entitlements     # App Group
│  ├─ Models/                        # Device, device-type, service & port catalogs
│  ├─ Networking/                    # Scanner, probes, ping, speed test, store, tools
│  ├─ Shared/                        # SharedState (App Group bridge) + Brand color
│  └─ Views/                         # Overview / Tools / History / Settings UI
└─ KovyrInteriorWidget/              # Widget extension target
   ├─ KovyrInteriorWidget.swift      # WidgetBundle + timeline + views
   ├─ SharedState.swift              # copy of the App Group bridge
   ├─ Info.plist                     # NSExtension (widgetkit)
   └─ KovyrInteriorWidget.entitlements
```

> Note: the internal source folders keep concise names; every user-facing name,
> bundle ID, app group, accent color (#1E3A5F Kovyr navy) and icon is Kovyr.

## A note on new-device detection & background scanning

New-device alerts fire when a **scan runs** (foreground). iOS does not allow an
app to keep scanning the network continuously in the background, so this can't
watch a network 24/7 like a router-based service would. Open the app and scan
(or pull-to-refresh) to check for new arrivals.

Device identity across scans is best-effort: it keys on a device's Bonjour or
DNS name when available, falling back to IP. Because DHCP can reassign IPs, a
device with no stable name may occasionally re-appear as "new".

## Roadmap ideas

- Export findings and feed them into Kovyr's report / evidence pipeline as
  authorization-gated **internal-scan** evidence (design only until the gate exists).
- Request the multicast entitlement to add full UPnP/SSDP discovery.
- Live Activity for an in-progress scan.
- Per-device notes / naming and "trusted" marking.
