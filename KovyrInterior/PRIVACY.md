# Privacy Policy — Kovyr Interior

_Last updated: [DATE]_

Kovyr Interior ("the app") is a local‑network utility for iOS. This policy
explains what the app does with information. **Fill in the bracketed contact
details before publishing.**

## Summary

- The app has **no account and no login**.
- We (the developer) **do not collect, transmit, sell, or share any personal
  information** about you.
- Everything the app discovers about your network is **stored only on your
  device**.
- The app contains **no third‑party analytics, advertising, or tracking SDKs**.

## What the app does

Kovyr Interior scans the Wi‑Fi network your device is connected to and shows the
devices it finds, along with diagnostic tools (port scan, speed test, ping, and
trace route). To do this, it reads the device names, IP addresses, open ports,
and Bonjour/mDNS services that other devices on your network make available.

## Information stored on your device

The app saves the following **locally on your device only** (in the app's private
container and its App Group container shared with the home‑screen widget):

- A history of devices it has seen (name, IP, first‑seen and last‑seen times).
- A log of recent scans (time, device count, number of new devices).
- A summary (device count, new‑device count, last scan time) for the widget.

This information never leaves your device through us, and there is no server that
receives it. You can erase it at any time with **History → Clear**, or by
deleting the app.

## Network connections the tools make

By its nature, a network tool makes network connections. For transparency:

- **Device discovery** connects to addresses on **your own local network** to see
  which devices respond. No data about you is sent — these are reachability
  probes.
- **Ping and Trace Route** send packets to a host **you enter**.
- **Speed Test** transfers throughput test data to **Cloudflare's** public speed
  endpoints (`speed.cloudflare.com`) to measure your connection. This is test
  traffic, not personal data; it is subject to Cloudflare's own privacy policy.
- **Reverse DNS** lookups are handled by your device's configured DNS resolver.

None of these transmit your personal information to the developer.

## Permissions the app requests

- **Local Network** — required to discover and probe devices on your Wi‑Fi.
  Without it, scanning finds nothing.
- **Notifications** (optional) — to alert you when a new device joins your
  network. You can decline or disable this in iOS Settings.
- **Background App Refresh** (optional, off by default) — to periodically re‑scan
  your own network and notify you of new devices. You control this in the app's
  Settings and in iOS Settings.

## Responsible use

Only scan networks you own or are authorized to assess. You are responsible for
using the app in compliance with applicable laws.

## Children

The app is not directed to children and does not knowingly collect information
from anyone. No personal information is collected at all.

## Changes to this policy

We may update this policy; the "Last updated" date will change accordingly.
Material changes will be reflected here.

## Contact

Questions about this policy: **[Kendall Sorenson — kendall@kovyr.com]**
(confirm this address is live before publishing).
