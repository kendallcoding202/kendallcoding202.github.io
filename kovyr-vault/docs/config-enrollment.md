# Config pull at setup (enrollment codes) — parked spec

**Status: PARKED. Do not build yet.** The design is sound and the work is
well understood; the *timing* is wrong. See "Why not yet" — the trigger is
a change in how engagements are delivered, not a technical blocker.

---

## The problem it solves

Every machine needs a `config.json`: client name, watched folders, locked
folders, vault path, state path, report path. Today that is set by hand —
either editing the file or clicking through the Settings tab — **once per
machine**. Kimball & Roberts alone is 3 Windows boxes and 2 Macs.

Two failure modes come with doing it by hand:

- **Drift.** "Kimball & Roberts" on one machine and "Kimball and Roberts"
  on another silently splits reporting; nothing catches it.
- **It requires the operator.** Configuring a machine means Kendall at the
  keyboard or on a screenshare. That is the real constraint.

---

## How it works

1. **Define the client once, in halden.** Client name, folders to watch,
   folders to lock, vault location. halden generates a short enrollment
   code (e.g. `KVR-7F3A-9B2C`).
2. **On each machine:** install Vault. With no config present it shows an
   *"Enter your setup code"* screen instead of a blank Settings tab.
3. **Type the code.** Vault makes one call to halden: *this code — what is
   my configuration?*
4. **halden validates and returns the config.** Vault writes it locally
   and is configured. ~30 seconds.
5. **The code expires** after a time window or a machine count, so a
   leaked code is not useful later.

### What crosses the wire

| Direction | Contents |
|---|---|
| Up | The enrollment code and a device identifier. Nothing else. |
| Down | Settings the operator already chose: client name, folder paths, vault location. |
| **Never** | File contents, filenames discovered on the machine, scan results, findings, hashes, the passphrase. |

The folder paths flowing *down* are templates the operator picked in
halden (`C:\ClientData`), not anything read off the client's machine.
Nothing about the client's actual data moves in either direction.

---

## Benefits

1. **Consistency** — one source of truth for the client name and folder
   set, so reports aggregate correctly by construction.
2. **Speed** — ~5 minutes of clicking per machine becomes ~30 seconds.
3. **It removes the operator from the install** — a client can be emailed
   an installer and a code and set it up themselves. This is the actual
   value; the time saving is secondary.
4. **It is the enrollment step attestation needs anyway** (see
   `attestation.md`, blocker 2). Building this first would make that
   feature viable rather than un-shippable.

---

## Costs, honestly

- **The zero-egress sentence changes.** From *"nothing leaves the
  machine"* to *"no client data leaves the machine."* Vault would gain a
  genuine outbound connection for the first time. That is a material edit
  to a claim in the client-facing data-handling summary and must be
  reviewed, not amended after the fact.
- **Real work on both sides** — roughly a day or two. Vault needs the
  enrollment screen and fetch; halden needs an endpoint, code generation,
  expiry/consumption, and per-client config templates.
- **A new failure mode** — no internet at setup means no config. The
  manual Settings path must keep working as a fallback, permanently.
- **A new dependency** — Vault setup now depends on halden being up.
- **Code handling** — a leaked code discloses a client's name and folder
  conventions. Low severity, but it needs expiry plus single- or
  limited-use, and codes should not be reusable indefinitely.

---

## Why not yet

The remediation deliverable says *"Kendall will facilitate a 1–2 hour
meeting,"* *"Kendall will deliver the training,"* *"Kendall will provide
setup guides."* **The current delivery model already puts the operator on
site.**

If you are physically there for the assessment and training anyway, this
saves roughly 20 minutes across an entire five-machine engagement — while
costing a day or two of build across two codebases and a change to the
egress wording. That trade does not pay.

It is also worth noting the config *templates* are partly guesswork today.
Doing two or three engagements by hand teaches what they should actually
contain; building the template system first would bake in assumptions that
haven't been tested against a real client.

---

## Build order (when triggered)

1. **Settle the code semantics** — lifetime, machine count, what happens
   on reuse, and what a leaked code exposes.
2. **halden side first** — config templates per client, code generation,
   the validation endpoint. Vault is useless without it, and this is where
   the design risk lives.
3. **Vault: the enrollment screen** — shown only when no config exists,
   with "configure manually instead" always available.
4. **Vault: the fetch** — https-only, short timeout, clear failure
   messaging, never blocking manual setup.
5. **Update the data-handling summary and any legal wording** before
   release, not after.

Keep the manual Settings path as a first-class option forever. Enrollment
is a convenience, not a replacement.

---

## Revisit trigger

Build when **either** becomes true:

- Delivery shifts to **remote onboarding** — emailing a client an
  installer instead of configuring machines in person, **or**
- After two or three engagements, per-machine setup is genuinely annoying
  (multiple offices, many workstations, or repeat drift mistakes).

Also revisit if attestation (`attestation.md`) is ever greenlit — this is
its missing enrollment layer, and the two should then be designed
together.
