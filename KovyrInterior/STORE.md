# App Store / TestFlight submission kit — Kovyr Interior

Ready‑to‑paste listing copy, App Review notes, and a TestFlight plan. Fill the
bracketed placeholders. **Before you spend the $99:** confirm the "Kovyr" name /
domain / trademark (your `PHASES.md` flags it as provisional), and make sure the
app **builds and runs on a device** first.

---

## 1. App Store Connect — listing

- **App name:** Kovyr Interior
- **Subtitle (≤30 chars):** `Internal network scanner`
- **Primary category:** Utilities
- **Secondary category:** Developer Tools
- **Age rating:** 4+
- **Price:** Free (or as you choose)
- **Bundle ID:** `com.kovyr.interior` *(must match the app target)*
- **Support URL:** `https://kendallcoding202.github.io/` *(or a Kovyr page)*
- **Marketing URL (optional):** `https://kovyr.com/` *(confirm live)*
- **Privacy Policy URL:** host `PRIVACY.md` and link it — e.g.
  `https://kendallcoding202.github.io/kovyr-interior-privacy/`

### Promotional text (≤170 chars)
```
See what's on your network. Kovyr Interior discovers every device on your Wi‑Fi,
finds open ports, spots cameras, and runs speed, ping and trace tools.
```

### Description (≤4000 chars)
```
Kovyr Interior shows you what's actually connected to your Wi‑Fi. Point it at
your network and it discovers every reachable device, identifies what each one
likely is, and gives you a toolkit to investigate further — all from your iPhone.

DISCOVER YOUR NETWORK
• Scan your Wi‑Fi and list every device that responds
• See each device's IP, hostname, and advertised services (AirPlay, printers,
  file sharing, Chromecast, and more)
• Automatic device‑type guessing: router, phone, computer, printer, TV, camera,
  network storage, smart‑home, media server
• Your network at a glance: IP, subnet, and gateway

KNOW WHEN SOMETHING NEW APPEARS
• Devices you haven't seen before are flagged as New
• Optional notification when a new device joins
• History of every device seen, with first‑ and last‑seen times

A REAL TOOLKIT
• Find open ports on any device
• Router security check (detects NAT‑PMP automatic port forwarding)
• Find camera‑like devices (RTSP / ONVIF / DVR fingerprint)
• Internet speed test (download, upload, latency)
• Ping with a live round‑trip‑time chart
• Trace route

HOME‑SCREEN WIDGET
• See your device count and last scan at a glance

PRIVACY FIRST
• No account, no sign‑in
• Your scan data stays on your device — we don't collect it
• See our privacy policy for the network connections the tools make

A NOTE ON WHAT iOS ALLOWS
Kovyr Interior works within Apple's privacy rules: it can't read other devices'
MAC addresses or manufacturer, discovery is based on TCP and Bonjour, and trace
route is best‑effort. Only scan networks you own or are authorized to assess.
```

### Keywords (≤100 chars, comma‑separated)
```
network,scanner,wifi,lan,devices,ip,port scan,ping,speed test,router,bonjour,subnet,security,traceroute
```

### What's New (version 1.0)
```
First release. Discover devices on your Wi‑Fi, identify device types, get alerts
for new devices, and use the built‑in port scan, speed test, ping and trace tools.
```

---

## 2. App Review notes (paste into "Notes for Review")
```
Kovyr Interior is a local‑network utility. All scanning targets the USER'S OWN
Wi‑Fi network that the device is currently joined to.

How to test:
1. Ensure the test device is on a Wi‑Fi network (not cellular only).
2. Launch the app; on the Overview tab tap Scan (or pull to refresh).
3. Accept the Local Network permission prompt when it appears.
4. Devices on the local network will populate. Tap one for detail / port scan.
5. The Tools tab includes a speed test (Cloudflare), ping, and trace route.

Technical notes:
- Local Network access is used to discover devices via TCP connection probes and
  Bonjour/mDNS. NSLocalNetworkUsageDescription is set.
- Ping/trace use ICMP via an unprivileged SOCK_DGRAM socket (public API, the same
  approach as Apple's SimplePing sample). No private APIs are used.
- The speed test transfers test data to Cloudflare's public speed endpoints
  (speed.cloudflare.com). No user data is sent.
- Background App Refresh (fetch) is used only to re‑scan the user's own network
  and notify them of new devices; the toggle is in Settings and defaults OFF.
- No account or login. No analytics/tracking SDKs. Scan data is stored only on
  the device (and, for the widget, in the app's App Group container).
- "Find hidden camera" is a heuristic based on open camera/DVR ports; the UI
  states it is a hint, not a guarantee.

There is no login, so no demo account is required.
```

---

## 3. Screenshots (required)

Capture on device or Simulator. Required sizes for iPhone:
- **6.9" (iPhone 16 Pro Max, 1320×2868)** — required
- **6.5" (1242×2688 or 1284×2778)** — required for older layouts

Suggested set (5–6):
1. Overview with a populated device list + the network header card
2. A device detail screen (type, services, open ports)
3. Tools tab (the toolkit menu)
4. Speed test running
5. Ping chart
6. History / new‑device badge

Optional: a 13" iPad Pro set if you keep iPad support (target is Universal).

---

## 4. App Privacy (nutrition label answers)

- **Do you collect data?** → **No** (the developer collects nothing; data stays
  on device).
- No data types linked to the user; no tracking.
- If asked about third parties: the speed test contacts Cloudflare's public
  endpoints for throughput measurement only (no personal data). See `PRIVACY.md`.

---

## 5. TestFlight (recommended first / for personal + field use)

TestFlight lets you run the app on your own devices and share with up to 100
internal testers without public App Review — ideal if this stays a field tool.

1. In Xcode: **Product → Archive**, then **Distribute App → App Store Connect →
   Upload** (needs the paid program + a distribution signing cert; automatic
   signing handles it).
2. In App Store Connect → **TestFlight**, add yourself/testers to **Internal
   Testing** (internal testers skip Beta App Review).
3. Fill the **Test Information**:
   - **Beta App Description:** "Internal Wi‑Fi network scanner — discovers
     devices, open ports, and runs speed/ping/trace tools. Scan only networks
     you own or are authorized to assess."
   - **What to Test:** "Run a scan on your Wi‑Fi; open a device; try the Tools
     (port scan, speed test, ping). Toggle background scans in Settings."
   - **Feedback email:** [your email]
4. Install via the **TestFlight** app on your iPhone.

Note: the **App Group widget** and **background refresh** need the paid program;
core scanning also works with a free Apple ID for quick on‑device testing.

---

## 6. Pre‑submission checklist

- [ ] App builds and runs on a real device (fix any first‑build errors).
- [ ] Bundle IDs + App Group set and provisioned (`com.kovyr.interior*`).
- [ ] Privacy policy hosted; URL added in App Store Connect.
- [ ] Screenshots for required sizes.
- [ ] App icon present (ships in the asset catalog).
- [ ] "Kovyr" name / domain / trademark confirmed before public launch.
- [ ] Only scanning your own network in the review demo.
