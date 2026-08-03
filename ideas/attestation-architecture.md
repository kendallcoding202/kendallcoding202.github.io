# How #1 works without breaking Kovyr Vault's local-only promise

*Addendum to [subscription-app-ideas.md](./subscription-app-ideas.md).*

## The objection

Kovyr Vault's design commitment is zero client-data egress — strong enough that
`0.14.0` **removed** the breach-scan feature to achieve it, and `sensitive.py`
documents it as an invariant: *"Files are read and matched entirely on the
machine. Nothing is transmitted."* A multi-tenant dashboard for brokers and MSPs
appears to require exactly the thing the product refuses to do.

It doesn't — but only if the boundary is drawn deliberately and enforced in
code, not in a README paragraph.

## Three tiers of data, and only one of them moves

The existing modules already separate cleanly:

| Tier | Examples in your code | Egress |
|---|---|---|
| **1. Control state** | `posture.Check.status` (on/off/unknown), `diskcrypto` result, `days_since_backup`, `failed_unlocks`, `canary_alerts`, `integrity_verified` | **Leaves the machine** |
| **2. Local identifiers** | `snapshot["groups"][].paths`, `groups[].sha256`, filenames, `sensitive` findings' paths | **Never leaves** |
| **3. Contents** | The bytes of client files; the actual SSNs and card numbers `sensitive.py` matches | **Never read off-disk, never leaves, already true today** |

Tier 3 was never in question. Tier 2 is where the real risk lives — a file path
like `C:\Clients\Delgado v. Aetna\settlement-draft.docx` leaks privileged
information in the path *alone*, and a content SHA-256 is a fingerprint that can
confirm whether a machine holds a specific known document. Both stay local,
permanently.

Tier 1 is the insight: **"BitLocker is on" is not client data.** It's a fact
about the machine's configuration. That's the entire evidence set an insurance
questionnaire asks for, and it fits in about two kilobytes.

## Attestations, not telemetry

The distinction that makes this work: the endpoint does not stream observations
to a server that then decides what they mean. The endpoint computes everything
locally — exactly as it does today — and emits a **signed attestation**: a small,
fixed-schema statement of control state, with a signature and a timestamp.

Proposed `kovyr.attestation.v1`, built entirely from fields your modules already
produce:

```json
{
  "schema": "kovyr.attestation.v1",
  "device": "a7f3c1e2-...",            // random UUID minted at enrollment
  "label": "front-desk-2",             // MSP-assigned; agent never sends hostname
  "tenant": "acme-dental",
  "generated_at": "2026-08-03T14:02:11Z",
  "agent_version": "0.16.0",
  "platform": "windows",

  "controls": {
    "disk":       { "status": true,  "source": "manage-bde" },
    "firewall":   { "status": true,  "source": "netsh" },
    "screenlock": { "status": false, "source": "powercfg" },
    "antivirus":  { "status": true,  "source": "Get-MpComputerStatus" }
  },

  "vault": {
    "present": true, "entries": 412, "integrity_verified": true,
    "days_since_backup": 2, "failed_unlocks_since_last": 0
  },

  "exposure": {
    "unencrypted_sensitive_files": 3, "types": ["ssn"],
    "duplicate_groups": 17, "excess_copies": 41
  },

  "drift":      { "new_since_last": 2, "canary_alerts": 0 },
  "audit_head": "9c4b...",             // head hash of the local audit chain
  "signature":  "ed25519:..."
}
```

Every value is a boolean, an integer, an enum, or a timestamp. There is no field
in which a path, filename, hostname, username, or content hash *can* be
expressed — not because the code avoids filling one in, but because none exists.

Note `audit_head`: `audit.py` already maintains a hash-chained append-only log.
Committing the chain head into each attestation means an MSP can't quietly
backdate or rewrite a client's history — the chain either verifies against the
sequence of attestations you hold, or it doesn't. For insurance evidence that's
worth more than the control states themselves.

## Enforcing it in code, not prose

A promise in a README degrades. Three mechanisms make this one hold:

1. **Type-level separation.** `attest.py` accepts only `posture.Check` objects
   and integers. It never imports `ScanResult`, never receives a `Path`, and has
   no access to `sensitive.Finding`. The unsafe data is not in scope, so it
   cannot be serialized by accident.

2. **An adversarial test.** Run a scan over a fixture tree containing
   deliberately incriminating paths (`Clients/Delgado v Aetna/ssn-list.csv`),
   build an attestation, then assert that no fixture path, filename, path
   separator, or content hash appears anywhere in the serialized bytes — and
   that the JSON's key set is exactly the allowlist. This is the same shape as
   your existing `test_packet` / `test_posture` tests. It fails loudly the day
   someone adds a convenient debug field.

3. **`kovyr-vault attest --print`.** Prints the exact bytes that would be
   transmitted, and sends nothing. The client's own IT person can run it before
   approving deployment. A verifiable claim beats a trustworthy one.

Every transmission also appends to the existing audit log, so the machine itself
holds a tamper-evident record of everything that ever left it.

## Who performs the egress — three transports

Ranked by how much of the original promise they preserve:

**A. MSP-mediated (most faithful).** The agent has no network stack at all. It
writes a signed attestation file; the MSP's existing RMM (NinjaOne, Datto,
Level) collects it on the same schedule it already collects everything else and
posts it to the portal. Kovyr Vault itself still transmits nothing — the egress
decision belongs to the MSP, who already has full administrative access to that
endpoint and a signed agreement covering it. This is the honest default, and
RMM collection is automated enough that you lose nothing operationally.

**B. Direct upload, opt-in.** The agent posts its own attestation over HTTPS,
signed with a per-device key. Simpler for MSPs without mature RMM. Requires the
restated promise below.

**C. Self-hosted aggregator.** You ship the rollup server as a container the MSP
runs themselves. Nothing reaches your infrastructure at all. This is a genuine
differentiator against Cynomi and every other SaaS-only vCISO platform, and it's
a defensible premium tier — but it complicates support, so treat it as a
year-two enterprise offering, not a launch requirement.

Start with A, offer B, sell C later.

## The promise, restated so it stays true

Don't quietly weaken "nothing leaves." Sharpen it:

> **Client data never leaves the machine.** Not file contents, not filenames,
> not paths, not content hashes — the same guarantee as always, now enforced by
> the type system and an adversarial test rather than by discipline.
>
> **What leaves is a signed control-state attestation**: roughly forty booleans
> and counters describing whether the machine's protections are switched on.
> Run `kovyr-vault attest --print` to read every byte before you enable it.

That's a stronger claim than the current one, because it's specific and
checkable. "We don't send anything" invites the question *are you sure?*. "We
send exactly this, here's the command to print it" answers it.

## The one piece that genuinely stretches the principle

The Microsoft 365 / Google Workspace connectors I proposed for MFA coverage are
a **different trust story** and shouldn't be waved through on the strength of
the above. They mean an OAuth app reading a tenant's admin configuration
server-side — a second egress path, from the client's cloud rather than their
endpoint, that the local-only architecture doesn't cover.

Options, in order of preference:

1. **Defer it.** Ship endpoint controls only. Carriers ask about MFA, but MFA
   is answerable from the M365 admin console in two minutes; the endpoint
   controls are the ones nobody can currently evidence. Solve the unsolved half
   first.
2. **Run it from the endpoint.** A privileged workstation makes the Graph call
   locally and folds the result into the same attestation. Same boundary, same
   schema, no new egress path.
3. **Accept it as a clearly-labeled separate module** with its own consent step,
   never bundled silently into the agent's install.

Option 2 is the elegant answer and preserves the architecture exactly. Take it
if the auth flow cooperates; fall back to 1 if it doesn't.

## What this costs you

Being honest about the trade: the local-only constraint means your dashboard
shows *counts and states*, never drill-down. A broker sees "3 unencrypted files
containing SSNs on front-desk-2" and cannot click through to see which files —
that requires someone at the client site running the local tool. Some
competitors will demo better.

That's the right trade for this buyer. The MSPs and brokers you're selling to
are themselves terrified of holding client PII — a platform that structurally
cannot leak their clients' data is easier for them to adopt, not harder. It's
the same reason `0.14.0` removed breach-scan: the constraint is the product.
