# NetScan — a Fing-style network scanner for iOS

A native SwiftUI iOS app that discovers devices on your local Wi-Fi network and
provides a set of network diagnostic tools, modeled on Fing. Built to run on a
real device and be submittable to the App Store.

## Requirements

- **macOS with Xcode 16 or newer** (the project uses file-system-synchronized
  groups, an Xcode 16 feature).
- An **iPhone/iPad running iOS 17+**. Most networking features require a *real
  device* on Wi-Fi — the Simulator shares the Mac's network and can't probe a
  phone's subnet the same way.
- A free or paid **Apple Developer account** for on-device signing.

## Build & run

1. Open `NetScan.xcodeproj` in Xcode.
2. Select the **NetScan** target → **Signing & Capabilities**.
3. Set your **Team** and change the **Bundle Identifier** from
   `com.example.NetScan` to something unique (e.g. `com.yourname.NetScan`).
4. Plug in your iPhone, select it as the run destination, and press **Run**.
5. On first scan, iOS shows a **Local Network** permission prompt — tap **Allow**.
   (Without this, discovery finds nothing.)

## What it does

### Overview tab
- Reads your Wi-Fi IP, subnet (CIDR) and gateway.
- Discovers live devices by:
  - a concurrent **TCP sweep** of every host in the subnet,
  - **Bonjour / mDNS** service discovery (AirPlay, Chromecast, printers, SMB…),
  - **reverse DNS** for friendly hostnames.
- Per-device detail screen with services and an on-demand **port scan**.

### Tools tab
| Tool | Notes |
|------|-------|
| **Find open ports** | Full TCP port scan of any host. |
| **Router security check** | Detects **NAT-PMP** auto port-forwarding and shows your public IP. |
| **Find hidden camera** | Flags devices exposing camera/DVR ports (RTSP, ONVIF, Hikvision, Dahua). |
| **Speed test** | Download/upload/latency via Cloudflare's speed endpoints. |
| **Ping** | Real ICMP echo (round-trip time chart, min/avg/max/loss). |
| **Trace route** | Best-effort — see limitations. |

## iOS platform limitations (by design, not bugs)

These are Apple sandbox restrictions that affect *every* non-jailbroken iOS
network app, including Fing:

- **No MAC addresses / manufacturer** of other devices — iOS blocks this for
  privacy. NetScan fingerprints devices via Bonjour + open ports instead.
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
NetScan/
├─ NetScan.xcodeproj/
└─ NetScan/
   ├─ NetScanApp.swift        # @main app + tab shell
   ├─ Info.plist              # Local Network + Bonjour declarations
   ├─ Models/                 # Device, service & port catalogs
   ├─ Networking/             # Scanner, probes, ping, speed test, tools
   └─ Views/                  # Overview + Tools UI
```

## Roadmap ideas

- Persist scan history and flag *new* devices joining the network.
- Push/local notification when an unknown device appears.
- Request the multicast entitlement to add full UPnP discovery.
- Device-type guessing from open-port fingerprints.
