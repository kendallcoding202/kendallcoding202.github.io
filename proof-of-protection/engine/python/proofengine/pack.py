"""Proof Packs: build, parse and verify. Mirrors engine/pack (same steps,
same order, same rules, same messages), so Go, Python and the browser reach
the same verdict on the same file.

A pack holds the firm's full signed statements for a date range, their
timestamp tokens, inclusion proofs against a witnessed checkpoint, earlier
checkpoints the firm kept, and a summary. Verification is offline and uses
only the pack and a trust policy that the verifier pins (never the pack).
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from . import brand, canon, merkle, note, posture, tsa
from .dsse import PAYLOAD_TYPE_IN_TOTO, pae
from .sigs import ED25519, ES256, PublicKey, parse_public_key_b64
from .tlog import Evidence, entry_digest, evidence_from_value, leaf_hash

PACK_TYPE = "proof-pack/v1"
POLICY_TYPE = "proof-trust-policy/v1"
NAME_COMMITMENT_TYPE = "tenant-name-commitment/v1"
DAY = dt.timedelta(days=1)

STEPS = [
    ("signatures", "Statement signatures"),
    ("content", "Only yes/no answers, counts, categories and times"),
    ("enrollment", "Devices enrolled in the log"),
    ("sequence", "Sequence and no replay"),
    ("timestamps", "Timestamps from two independent authorities"),
    ("inclusion", "Merkle inclusion proofs"),
    ("checkpoint", "Log checkpoint signature"),
    ("consistency", "Log history never rewritten"),
    ("witnesses", "Witness quorum"),
    ("gaps", "Gaps disclosed"),
]

EXPECTED_DAILY = {"device_agent", "cloud_connector", "external_scanner"}


def name_commitment(name: str, salt_hex: str) -> bytes:
    return hashlib.sha256(f"{NAME_COMMITMENT_TYPE}\n{salt_hex}\n{name}".encode("utf-8")).digest()


def _b64(h: bytes) -> str:
    return base64.b64encode(h).decode("ascii")


def _hashes(v) -> list[bytes]:
    if not isinstance(v, list) or len(v) > 64:
        raise ValueError("proof must be an array of base64 hashes")
    out = []
    for s in v:
        b = base64.b64decode(s, validate=True) if isinstance(s, str) else b""
        if len(b) != 32 or _b64(b) != s:
            raise ValueError("proof hash is not canonical base64 of 32 bytes")
        out.append(b)
    return out


def _fields(v, what: str, keys: list[str]) -> dict:
    if not isinstance(v, dict):
        raise ValueError(f"{what} must be an object")
    if set(v) != set(keys):
        raise ValueError(f"{what} must have exactly the fields {', '.join(keys)}")
    return v


def _date(s) -> dt.date:
    try:
        d = dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        raise ValueError("bad date") from None
    if d.isoformat() != s:
        raise ValueError("bad date")
    return d


@dataclass
class Entry:
    evidence: Evidence
    proof: list[bytes]

    def value(self) -> dict:
        v = self.evidence.value()
        v["inclusion_proof"] = [_b64(h) for h in self.proof]
        return v


@dataclass
class Pack:
    sample: bool
    product: str
    issued_at: dt.datetime
    date_from: str
    date_to: str
    tenant_id: str
    display_name: str
    display_name_salt: str
    log_origin: str
    checkpoint: str
    earlier: list[tuple[str, list[bytes]]] = field(default_factory=list)
    entries: list[Entry] = field(default_factory=list)
    summary: Any = None

    def to_json(self) -> bytes:
        """One entry per line, like the Go writer (byte-identical output)."""
        def enc(v):
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        lines = [
            "{",
            f' "pack_type": "{PACK_TYPE}",',
            f' "canonicalization": "{canon.VERSION}",',
            f' "product": {enc(self.product)},',
            f' "sample": {"true" if self.sample else "false"},',
            f' "issued_at": "{tsa.format_time(self.issued_at)}",',
            f' "range": {enc({"from": self.date_from, "to": self.date_to})},',
            f' "tenant": {enc({"display_name": self.display_name, "display_name_salt": self.display_name_salt, "id": self.tenant_id})},',
            ' "log": ' + enc({"checkpoint": self.checkpoint, "earlier_checkpoints": [
                {"checkpoint": c, "consistency_proof": [_b64(h) for h in p]} for c, p in self.earlier], "origin": self.log_origin}) + ",",
            ' "entries": [',
        ]
        for i, e in enumerate(self.entries):
            lines.append("  " + canon.encode(e.value()).decode("ascii") + ("," if i < len(self.entries) - 1 else ""))
        lines.append(" ],")
        summary = json.dumps(self.summary, indent=1, ensure_ascii=False, sort_keys=True).replace("\n", "\n ")
        lines.append(f' "summary": {summary}')
        lines.append("}")
        return ("\n".join(lines) + "\n").encode("utf-8")


def parse(b: bytes) -> Pack:
    """Strictly parse a Proof Pack file."""
    v = canon.parse_container(b)
    top = _fields(v, "pack", ["pack_type", "canonicalization", "product", "sample", "issued_at", "range", "tenant", "log", "entries", "summary"])
    if top["pack_type"] != PACK_TYPE:
        raise ValueError(f"not a {PACK_TYPE} file")
    if top["canonicalization"] != canon.VERSION:
        raise ValueError("unsupported canonicalization")
    if not isinstance(top["product"], str) or not isinstance(top["sample"], bool):
        raise ValueError("bad pack header")
    rng = _fields(top["range"], "range", ["from", "to"])
    f, t = _date(rng["from"]), _date(rng["to"])
    if t < f or (t - f).days > 366:
        raise ValueError("range must be two dates, in order, at most a year apart")
    ten = _fields(top["tenant"], "tenant", ["id", "display_name", "display_name_salt"])
    lg = _fields(top["log"], "log", ["origin", "checkpoint", "earlier_checkpoints"])
    if not isinstance(lg["earlier_checkpoints"], list) or not isinstance(top["entries"], list):
        raise ValueError("bad pack lists")
    p = Pack(top["sample"], top["product"], tsa.parse_time(top["issued_at"]), rng["from"], rng["to"],
             ten["id"], ten["display_name"], ten["display_name_salt"], lg["origin"], lg["checkpoint"], summary=top["summary"])
    for e in lg["earlier_checkpoints"]:
        eo = _fields(e, "earlier checkpoint", ["checkpoint", "consistency_proof"])
        p.earlier.append((eo["checkpoint"], _hashes(eo["consistency_proof"])))
    for i, e in enumerate(top["entries"]):
        eo = _fields(e, f"entry {i}", ["index", "envelope", "timestamps", "inclusion_proof"])
        proof = _hashes(eo["inclusion_proof"])
        p.entries.append(Entry(evidence_from_value({k: eo[k] for k in ("index", "envelope", "timestamps")}), proof))
    return p


# ---------------------------------------------------------------- trust policy


@dataclass
class TrustPolicy:
    demo_only: bool
    log_origin: str
    log_key: note.VerifierKey
    witnesses: list[dict]  # name, vkey (VerifierKey), label, simulated
    witness_quorum: int
    tsas: list[dict]  # name, kind, key (PublicKey), label, simulated
    tsa_quorum: int
    max_delay: dt.timedelta
    max_skew: dt.timedelta
    max_spread: dt.timedelta

    @property
    def trusted_tsas(self) -> list[tsa.Trusted]:
        return [tsa.Trusted(a["name"], a["kind"], a["key"]) for a in self.tsas]


def parse_trust_policy(b: bytes) -> TrustPolicy:
    v = canon.parse_container(b)
    top = _fields(v, "trust policy", ["policy_type", "demo_only", "log", "witnesses", "witness_quorum", "timestamp_authorities", "timestamp_quorum", "limits"])
    if top["policy_type"] != POLICY_TYPE:
        raise ValueError(f"not a {POLICY_TYPE} file")
    lg = _fields(top["log"], "log", ["origin", "vkey"])
    lk = note.parse_vkey(lg["vkey"])
    if lk.type != note.TYPE_ED25519 or lk.name != lg["origin"]:
        raise ValueError("trust policy: log vkey must be an Ed25519 note key named after the log origin")
    ws = []
    for w in top["witnesses"]:
        wo = _fields(w, "witness", ["name", "vkey", "label", "simulated"])
        vk = note.parse_vkey(wo["vkey"])
        if vk.type != note.TYPE_COSIGNATURE or vk.name != wo["name"]:
            raise ValueError(f"trust policy: bad witness key for {wo['name']}")
        ws.append({"name": wo["name"], "vkey": vk, "label": wo["label"], "simulated": wo["simulated"]})
    ts = []
    for a in top["timestamp_authorities"]:
        ao = _fields(a, "timestamp authority", ["name", "kind", "public_key", "label", "simulated"])
        ts.append({"name": ao["name"], "kind": ao["kind"], "key": parse_public_key_b64(ao["public_key"]), "label": ao["label"], "simulated": ao["simulated"]})
    lim = _fields(top["limits"], "limits", ["max_report_delay_s", "max_clock_skew_s", "max_tsa_spread_s"])
    t = TrustPolicy(top["demo_only"], lg["origin"], lk, ws, top["witness_quorum"], ts, top["timestamp_quorum"],
                    dt.timedelta(seconds=lim["max_report_delay_s"]), dt.timedelta(seconds=lim["max_clock_skew_s"]),
                    dt.timedelta(seconds=lim["max_tsa_spread_s"]))
    if not 1 <= t.witness_quorum <= len(ws):
        raise ValueError("trust policy: witness quorum must be between 1 and the number of witnesses")
    if not 2 <= t.tsa_quorum <= len(ts):
        raise ValueError("trust policy: at least two independent timestamp authorities are required")
    if t.max_delay <= dt.timedelta(0) or t.max_skew < dt.timedelta(0) or t.max_spread <= dt.timedelta(0):
        raise ValueError("trust policy: limits must be positive")
    return t


# ---------------------------------------------------------------- formatting

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _fmt_day(d) -> str:
    return f"{_MONTHS[d.month - 1]} {d.day}"


def _fmt_time(t: dt.datetime) -> str:
    t = t.astimezone(dt.timezone.utc)
    return f"{_fmt_day(t)} {t.hour:02d}:{t.minute:02d} UTC"


def _plural(n: int) -> str:
    return "" if n == 1 else "s"


def _fmt_duration(d: dt.timedelta) -> str:
    secs = int(d.total_seconds())
    if secs < 60:
        return f"{secs} seconds"
    days, h, m = secs // 86400, (secs // 3600) % 24, (secs // 60) % 60
    parts = []
    if days:
        parts.append(f"{days} day{_plural(days)}")
    if h:
        parts.append(f"{h} h")
    if m:
        parts.append(f"{m} min")
    return " ".join(parts)


CHECK_LABEL = {
    "disk_encryption": "disk encryption off", "edr_running": "antivirus/EDR not running", "firewall": "firewall off",
    "os_patch": "operating system out of date", "remote_tools": "unapproved remote-control tool", "screen_lock": "screen lock off",
    "devices_not_enrolled": "known devices not enrolled", "mailbox_alert_open": "mailbox-takeover alert open",
    "mfa": "accounts without MFA", "unknown_device": "unknown device seen", "payment_not_verified": "payment request not called back",
    "restore_drill_failed": "restore drill failed", "external_check_failed": "an external check failed",
}

_CLASS = {"laptop": "Laptop", "desktop": "Desktop", "server": "Server"}
_ROLE = {"owner": "Owner", "office_manager": "Office manager", "bookkeeper": "Bookkeeper"}


def _attester_label(a: dict) -> str:
    if a["kind"] == "device_agent":
        return f"{_CLASS.get(a['class'], 'Device')} D{a['number']:02d}"
    if a["kind"] == "cloud_connector":
        return "Microsoft 365 connector"
    if a["kind"] == "external_scanner":
        return "External scan"
    if a["kind"] == "staff_attester":
        return _ROLE.get(a["role"], "Staff") + " (staff attestation)"
    return a["id"]


# ---------------------------------------------------------------- verification


@dataclass
class Step:
    id: str
    title: str
    status: str = "pass"
    checked: int = 0
    detail: str = ""
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def fail(self, msg: str) -> None:
        self.status = "fail"
        self.problems.append(msg)


@dataclass
class Report:
    verified: bool
    tenant: str
    display_name: str
    date_from: str
    date_to: str
    sample: bool
    steps: list[Step]
    computed: dict
    gaps: list[dict]
    simulated: list[str]
    labels: dict

    def step(self, sid: str) -> Step:
        return next(s for s in self.steps if s.id == sid)

    def failed_steps(self) -> list[str]:
        return [s.id for s in self.steps if s.status == "fail"]

    def gap_text(self, g: dict) -> str:
        f, t = _date(g["from"]), _date(g["to"])
        span = _fmt_day(f) + (" to " + _fmt_day(t) if g["days"] > 1 else "")
        return f"{self.labels.get(g['attester'], g['attester'])} sent no reports {span} ({g['days']} day{_plural(g['days'])})"

    def text(self) -> str:
        out = [f"{brand.PRODUCT}: Proof Pack verification", "", f"  Firm:    {self.display_name}  [{self.tenant}]",
               f"  Period:  {self.date_from} to {self.date_to}"]
        if self.sample:
            out.append("  SAMPLE DATA: fictional firm, demo keys. This proves nothing about a real business.")
        out.append("")
        for i, s in enumerate(self.steps, 1):
            out.append(f"{ {'pass': '[PASS]', 'fail': '[FAIL]', 'warn': '[WARN]'}[s.status]} {i:2d}. {s.title}")
            if s.detail:
                out.append(f"           {s.detail}")
            out += [f"         - {p}" for p in s.problems[:12]]
            out += [f"           note: {n}" for n in s.notes]
        out.append("")
        if self.verified:
            out.append("RESULT: VERIFIED. Every check passed." + (f" {len(self.gaps)} gap(s) disclosed:" if self.gaps else " No gaps."))
            out += [f"  - {self.gap_text(g)}" for g in self.gaps]
        else:
            failed = [s.title for s in self.steps if s.status == "fail"]
            out.append(f"RESULT: NOT VERIFIED. {len(failed)} check(s) failed: {'; '.join(failed)}.")
        if self.simulated:
            out += ["", f"Simulated in this prototype: {', '.join(self.simulated)}."]
        return "\n".join(out) + "\n"


class _Item:
    def __init__(self, e: Entry):
        self.e = e
        self.env = e.evidence.envelope
        self.index = e.evidence.index
        self.digest = entry_digest(self.env)
        self.st: posture.Statement | None = None
        self.st_err: Exception | None = None
        if self.env.payload_type != PAYLOAD_TYPE_IN_TOTO:
            self.st_err = ValueError(f"payload type {self.env.payload_type!r} is not an in-toto statement")
        else:
            try:
                self.st = posture.validate(self.env.payload)
            except posture.ContentError as err:
                self.st_err = err
        self.kind = self.st.str("kind") if self.st is not None and not self.st.is_posture else ""
        self.posture = self.st is not None and self.st.is_posture
        self.sig_ok = self.enrol_ok = self.ts_ok = self.incl_ok = False
        self.label = ""


def _verify_sig(env, i, key) -> bool:
    try:
        env.verify_signature(i, key)
        return True
    except ValueError:
        return False


def verify(p: Pack, trust: TrustPolicy) -> Report:
    """Run every step (never stopping early) and report."""
    steps = [Step(i, t) for i, t in STEPS]
    step = {s.id: s for s in steps}
    items = [_Item(e) for e in p.entries]

    tenant_key, genesis, attesters, key_by_id, dup_enroll = None, [], {}, {}, []
    for it in items:
        if it.kind == "tenant_genesis":
            genesis.append(it)
            try:
                k = parse_public_key_b64(it.st.str("tenant_key"))
            except ValueError:
                continue
            if it.st.str("tenant") == p.tenant_id and tenant_key is None:
                tenant_key = k
                key_by_id[k.keyid()] = k
        elif it.kind == "attester":
            try:
                k = parse_public_key_b64(it.st.str("attester_key"))
            except ValueError:
                continue
            aid = it.st.str("attester")
            if aid in attesters:
                dup_enroll.append(it)
                continue
            attesters[aid] = {"id": aid, "kind": it.st.str("attester_kind"), "key": k, "it": it,
                              "class": it.st.str("device_class"), "number": it.st.int("device_number"), "role": it.st.str("staff_role")}
            key_by_id[k.keyid()] = k
    labels = {aid: _attester_label(a) for aid, a in attesters.items()}
    name = lambda aid: labels.get(aid, aid)  # noqa: E731
    for it in items:
        if it.st is None:
            it.label = f"Log entry {it.index}"
        elif it.posture:
            it.label = f"{name(it.st.str('attester'))} report #{it.st.int('seq')} ({_fmt_day(it.st.time('observed_at'))})"
        elif it.kind == "tenant_genesis":
            it.label = "The firm's enrollment record"
        else:
            it.label = "Enrollment of " + name(it.st.str("attester"))

    # 1. Signatures.
    s = step["signatures"]
    algs = {ES256: 0, ED25519: 0}
    for it in items:
        env, ok = it.env, False
        if it.kind == "tenant_genesis":
            s.checked += 1
            try:
                k = parse_public_key_b64(it.st.str("tenant_key"))
                ok = len(env.signatures) == 1 and _verify_sig(env, 0, k)
            except ValueError:
                ok = False
            if ok:
                algs[k.alg] += 1
        elif it.kind == "attester":
            a = attesters.get(it.st.str("attester"))
            s.checked += 2
            if tenant_key is None:
                s.fail(f"{it.label}: there is no firm enrollment to check the firm's signature against")
            elif len(env.signatures) != 2 or not _verify_sig(env, 0, tenant_key):
                s.fail(f"{it.label}: not signed by the firm's enrollment key")
            elif a is None or not _verify_sig(env, 1, a["key"]):
                s.fail(f"{it.label}: the enrolled key did not prove possession (second signature invalid)")
            else:
                ok = True
                algs[tenant_key.alg] += 1
                algs[a["key"].alg] += 1
        else:
            s.checked += 1
            key = None
            if it.posture and it.st.str("attester") in attesters:
                key = attesters[it.st.str("attester")]["key"]
            if key is None and env.signatures:
                key = key_by_id.get(env.signatures[0][0])
            if len(env.signatures) != 1:
                s.fail(f"{it.label}: expected exactly one signature, found {len(env.signatures)}")
            elif key is None:
                s.fail(f"{it.label}: signed by a key that is not enrolled for this firm")
            elif env.signatures[0][0] != key.keyid():
                s.fail(f"{it.label}: signed by a different key than the one enrolled for this device")
            else:
                try:
                    key.verify(pae(env.payload_type, env.payload), env.signatures[0][1])
                    ok = True
                    algs[key.alg] += 1
                except ValueError as err:
                    s.fail(f"{it.label}: the signature does not match the content, so the report was changed after it was signed ({err})")
        it.sig_ok = ok
    s.detail = (f"{s.checked} of {s.checked} signatures valid (ECDSA P-256: {algs[ES256]}, Ed25519: {algs[ED25519]})"
                if s.status == "pass" else f"Signature problems in {len(s.problems)} of {len(items)} entries")

    # 2. Content.
    s = step["content"]
    for it in items:
        s.checked += 1
        if it.st_err is not None:
            s.fail(f"{it.label}: {it.st_err}")
    s.detail = (f"All {s.checked} statements carry only yes/no answers, counts, categories and times; no names, paths or free text"
                if s.status == "pass" else f"{len(s.problems)} statements break the content rules")

    _verify_enrollment(p, step["enrollment"], items, genesis, tenant_key, attesters, dup_enroll)
    _verify_sequence(step["sequence"], items, attesters, name)
    _verify_timestamps(step["timestamps"], items, trust)
    latest, latest_note = _verify_checkpoint(step["checkpoint"], p, trust)
    _verify_inclusion(step["inclusion"], items, latest)
    _verify_consistency(step["consistency"], p, trust, latest)
    _verify_witnesses(step["witnesses"], latest_note, trust)
    computed, gaps = _summarize(p, items, attesters)
    simulated = [f"witness {w['name']}" for w in trust.witnesses if w["simulated"]] + \
                [f"timestamp authority {a['name']}" for a in trust.tsas if a["simulated"]]
    r = Report(False, p.tenant_id, p.display_name, p.date_from, p.date_to, p.sample, steps, computed, gaps, simulated, labels)
    _verify_summary(step["gaps"], p, r)
    r.verified = not r.failed_steps()
    return r


def _verify_enrollment(p, s, items, genesis, tenant_key, attesters, dups):
    g = None
    if not genesis:
        s.fail("The pack has no firm enrollment (tenant genesis) record")
    elif len(genesis) > 1:
        s.fail(f"The pack has {len(genesis)} firm enrollment records; there must be exactly one")
    else:
        g = genesis[0]
    if g is not None:
        s.checked += 1
        if g.st.str("tenant") != p.tenant_id or tenant_key is None:
            s.fail(f"The firm enrollment is for a different firm ({g.st.str('tenant')})")
        elif posture.tenant_id(tenant_key) != p.tenant_id:
            s.fail("The firm ID is not derived from the firm's enrollment key")
        else:
            g.enrol_ok = True
        if name_commitment(p.display_name, p.display_name_salt).hex() != g.st.str("display_name_commitment"):
            s.fail(f"The firm name in this pack ({json.dumps(p.display_name, ensure_ascii=False)}) is not the name committed at enrollment")
    for it in dups:
        s.fail(f"{it.label}: the same key was enrolled twice")
    counts = {"device_agent": 0, "cloud_connector": 0, "external_scanner": 0, "staff_attester": 0}
    software = 0
    for a in attesters.values():
        it = a["it"]
        s.checked += 1
        if it.st.str("tenant") != p.tenant_id:
            s.fail(f"{it.label}: enrolled in a different firm")
        elif posture.attester_id(posture.AttesterKind(a["kind"]), a["key"]) != a["id"]:
            s.fail(f"{it.label}: the device ID is not derived from its key")
        elif g is not None and (it.index <= g.index or it.st.time("enrolled_at") < g.st.time("enrolled_at")):
            s.fail(f"{it.label}: enrolled before the firm itself was")
        else:
            it.enrol_ok = g is not None and g.enrol_ok
            counts[a["kind"]] = counts.get(a["kind"], 0) + 1
            if a["kind"] == "device_agent":
                software += 1
    latest_conn = None
    for it in items:
        if not it.posture:
            continue
        s.checked += 1
        a = attesters.get(it.st.str("attester"))
        if it.st.str("tenant") != p.tenant_id:
            s.fail(f"{it.label}: belongs to a different firm")
        elif a is None:
            s.fail(f"{it.label}: comes from a device or service with no enrollment record in this pack")
        elif a["kind"] != it.st.str("attester_kind"):
            s.fail(f"{it.label}: does not match how the attester was enrolled")
        elif a["it"].index >= it.index or it.st.time("observed_at") < a["it"].st.time("enrolled_at"):
            s.fail(f"{it.label}: dated before the device was enrolled")
        else:
            it.enrol_ok = a["it"].enrol_ok
            if a["kind"] == "cloud_connector" and it.sig_ok and (latest_conn is None or it.st.time("observed_at") > latest_conn.st.time("observed_at")):
                latest_conn = it
    if latest_conn is not None:
        known, enrolled = latest_conn.st.int("tenant_posture.devices_known"), latest_conn.st.int("tenant_posture.devices_enrolled")
        if counts["device_agent"] < enrolled:
            s.fail(f"Microsoft 365 reports {enrolled} enrolled devices but this pack includes only {counts['device_agent']}; a device was left out")
        s.notes.append(f"Coverage: {enrolled} of {known} devices known to Microsoft 365 are enrolled")
        unknown = latest_conn.st.int("tenant_posture.devices_unknown_seen")
        if unknown:
            s.notes.append(f"{unknown} unknown device(s) seen signing in")
    if software:
        s.notes.append(f"{software} device key(s) are software keys (prototype). Production devices use TPM 2.0 or Secure Enclave keys, checked against the chip maker's certificate")
    s.detail = (f"1 firm, {counts['device_agent']} devices, {counts['cloud_connector']} cloud connector, {counts['external_scanner']} external scanner, "
                f"{counts['staff_attester']} staff attester enrolled; every statement comes from an enrolled key"
                if s.status == "pass" else f"{len(s.problems)} enrollment problem(s)")


def _verify_sequence(s, items, attesters, name):
    nonces, chains = {}, {}
    for it in items:
        if it.st is None:
            continue
        n = it.st.str("nonce")
        if n in nonces:
            first = nonces[n]
            if first.env.payload == it.env.payload:
                s.fail(f"{first.label} was logged a second time at log position {it.index} (first at {first.index}): an old report was replayed")
                continue
            s.fail(f"{it.label} reuses the one-time server challenge of {first.label}, so it is a replay")
        else:
            nonces[n] = it
        if it.posture:
            chains.setdefault(it.st.str("attester"), []).append(it)
    total = 0
    for aid in sorted(chains):
        chain = sorted(chains[aid], key=lambda x: (x.st.int("seq"), x.index))
        total += len(chain)
        nm, first = name(aid), chain[0]
        if first.st.int("seq") == 1:
            a = attesters.get(aid)
            if a is not None and first.st.str("prev") != posture.payload_digest(a["it"].env.payload).hex():
                s.fail(f"{first.label} does not link back to the device's enrollment record")
        else:
            s.notes.append(f"{nm}: chain starts at report #{first.st.int('seq')} (earlier reports are outside this pack's dates)")
        for a, b in zip(chain, chain[1:]):
            sa, sb = a.st.int("seq"), b.st.int("seq")
            if sb == sa:
                s.fail(f"Two different reports both claim to be {b.label} (log positions {a.index} and {b.index})")
            elif sb > sa + 1:
                if sb == sa + 2:
                    s.fail(f"{nm}: report #{sa + 1} is missing from this pack; report #{sb} says it follows it (deleted or withheld)")
                else:
                    s.fail(f"{nm}: reports #{sa + 1} to #{sb - 1} are missing from this pack (deleted or withheld)")
            else:
                if b.st.str("prev") != posture.payload_digest(a.env.payload).hex():
                    s.fail(f"{b.label} does not link to report #{sa} before it; the history was altered")
                if b.index < a.index or b.st.time("observed_at") < a.st.time("observed_at"):
                    s.fail(f"{b.label} is out of order with report #{sa}")
    s.checked = total
    s.detail = (f"{total} reports from {len(chains)} devices and services: numbered in order, each linked to the one before, no repeats, nothing missing"
                if s.status == "pass" else f"{len(s.problems)} sequence problem(s)")


def _verify_timestamps(s, items, trust):
    tokens = 0
    for it in items:
        s.checked += 1
        valid, first_err = {}, None
        for tok in it.e.evidence.timestamps:
            try:
                v = tsa.verify(tok, it.digest, trust.trusted_tsas)
                valid.setdefault(v.tsa, v.gen_time)
            except (ValueError, KeyError, TypeError) as err:
                first_err = first_err or err
        if len(valid) < trust.tsa_quorum:
            reason = f" ({first_err})" if first_err else ""
            s.fail(f"{it.label}: {len(valid)} valid timestamp(s) from independent authorities, {trust.tsa_quorum} required{reason}")
            continue
        lo, hi = min(valid.values()), max(valid.values())
        tokens += len(valid)
        if hi - lo > trust.max_spread:
            s.fail(f"{it.label}: the two timestamp authorities disagree by {_fmt_duration(hi - lo)}")
            continue
        if it.st is None:
            continue
        claimed = it.st.time("observed_at") if it.st.is_posture else it.st.time("enrolled_at")
        if lo - claimed > trust.max_delay:
            s.fail(f"{it.label} says it was made {_fmt_time(claimed)}, but the timestamp authorities first saw it {_fmt_time(lo)}, "
                   f"{_fmt_duration(lo - claimed)} later: it was backdated or replayed")
        elif claimed - lo > trust.max_skew:
            s.fail(f"{it.label} is dated {_fmt_time(claimed)}, after the timestamp authorities saw it ({_fmt_time(lo)})")
        else:
            it.ts_ok = True
    s.detail = (f"{tokens} timestamps valid: every entry was stamped by {trust.tsa_quorum} independent authorities within "
                f"{_fmt_duration(trust.max_delay)} of when it says it was made" if s.status == "pass" else f"{len(s.problems)} timestamp problem(s)")
    if any(a["simulated"] for a in trust.tsas):
        s.notes.append("The timestamp authorities are simulated in this prototype (local keys). Production uses independent RFC 3161 timestamp authorities")


def _verify_checkpoint(s, p, trust):
    s.checked = 1
    try:
        n = note.parse(p.checkpoint)
        cp = note.parse_checkpoint(n.text)
    except (ValueError, TypeError) as err:
        s.fail(f"The checkpoint is malformed: {err}")
        s.detail = "No valid checkpoint"
        return None, None
    if cp.origin != trust.log_origin or p.log_origin != trust.log_origin:
        s.fail(f"The checkpoint is for log {cp.origin!r}, not the trusted log {trust.log_origin!r}")
    try:
        n.verify_signed_by(trust.log_key)
    except ValueError as err:
        s.fail(f"The checkpoint is not validly signed by the log: {err}")
    s.detail = f"Signed by {cp.origin}; the log held {cp.size} entries" if s.status == "pass" else "The checkpoint signature is not valid"
    return cp, n


def _verify_inclusion(s, items, cp):
    seen = {}
    for it in items:
        s.checked += 1
        if cp is None:
            continue
        if it.index in seen:
            s.fail(f"{seen[it.index].label} and {it.label} both claim log position {it.index}")
            continue
        seen[it.index] = it
        if not merkle.verify_inclusion(it.index, cp.size, leaf_hash(it.digest), it.e.proof, cp.root):
            s.fail(f"{it.label}: does not match log entry {it.index}, so it is not the statement that was logged")
            continue
        it.incl_ok = True
    if cp is None:
        s.fail("No valid checkpoint to check inclusion against")
        s.detail = "Not checked"
    else:
        s.detail = (f"All {len(items)} entries are proven to be in the append-only log of {cp.size} entries"
                    if s.status == "pass" else f"{len(s.problems)} entries are not proven to be in the log")
    s.notes.append("The public log holds only fingerprints (SHA-256 of each statement); the results stay private until the firm shares them")


def _verify_consistency(s, p, trust, cp):
    if not p.earlier:
        s.status = "warn"
        s.detail = "No earlier checkpoint was supplied, so this relies on the witnesses (next step)"
        return
    for text, proof in p.earlier:
        s.checked += 1
        try:
            n = note.parse(text)
            ec = note.parse_checkpoint(n.text)
        except (ValueError, TypeError) as err:
            s.fail(f"An earlier checkpoint is malformed: {err}")
            continue
        when = ""
        for w in trust.witnesses:
            try:
                t = n.verify_cosignature(w["vkey"])
                when = f" (witnessed {_fmt_time(dt.datetime.fromtimestamp(t, dt.timezone.utc))})"
                break
            except ValueError:
                pass
        try:
            n.verify_signed_by(trust.log_key)
            signed = ec.origin == trust.log_origin
        except ValueError:
            signed = False
        if not signed:
            s.fail(f"The earlier checkpoint of {ec.size} entries is not signed by the trusted log")
        elif cp is None:
            s.fail(f"No valid current checkpoint to compare the earlier one{when} against")
        elif ec.size > cp.size:
            s.fail(f"The log shrank from {ec.size} entries{when} to {cp.size}: entries were removed")
        elif not merkle.verify_consistency(ec.size, cp.size, proof, ec.root, cp.root):
            s.fail(f"The checkpoint of {ec.size} entries saved earlier{when} is not consistent with today's log of {cp.size}: entries were removed or changed after the fact")
        else:
            s.notes.append(f"The firm's saved checkpoint of {ec.size} entries{when} is a prefix of today's {cp.size}-entry log")
    s.detail = (f"{s.checked} earlier checkpoint(s) proven consistent: nothing was removed or rewritten"
                if s.status == "pass" else "The log's history does not match a checkpoint saved earlier")


def _verify_witnesses(s, n, trust):
    s.checked = len(trust.witnesses)
    valid, bad = 0, []
    if n is not None:
        for w in trust.witnesses:
            try:
                t = n.verify_cosignature(w["vkey"])
                valid += 1
                s.notes.append(f"{w['label']} cosigned at {_fmt_time(dt.datetime.fromtimestamp(t, dt.timezone.utc))}")
            except ValueError as err:
                if "does not verify" in str(err):
                    bad.append(f"{w['label']}: its cosignature is for a different checkpoint")
    if valid < trust.witness_quorum:
        s.status = "fail"
        s.problems = bad + [f"Only {valid} of {len(trust.witnesses)} witnesses cosigned this checkpoint; {trust.witness_quorum} are required. "
                            "Witnesses refuse to cosign a log that rewrote its history"]
        s.detail = f"{valid} of {len(trust.witnesses)} witnesses (quorum of {trust.witness_quorum} not met)"
    else:
        s.notes.extend(bad)
        s.detail = f"{valid} of {len(trust.witnesses)} independent witnesses cosigned the same log state ({trust.witness_quorum} required)"
    if any(w["simulated"] for w in trust.witnesses):
        s.notes.append("The witnesses are simulated in this prototype (local keys)")


def lapse_checks(st: posture.Statement) -> list[str]:
    out = []
    k = st.str("attester_kind")
    if k == "device_agent":
        if st.str("device.disk_encryption") != "on":
            out.append("disk_encryption")
        if not st.bool("device.edr_running"):
            out.append("edr_running")
        if not st.bool("device.firewall_on"):
            out.append("firewall")
        if st.str("device.os_patch_status") in ("out_of_date", "unsupported_os"):
            out.append("os_patch")
        if st.int("device.unapproved_remote_tools.total") > 0:
            out.append("remote_tools")
        if not st.bool("device.screen_lock_on"):
            out.append("screen_lock")
    elif k == "cloud_connector":
        if st.int("tenant_posture.devices_enrolled") < st.int("tenant_posture.devices_known"):
            out.append("devices_not_enrolled")
        if st.int("tenant_posture.mailbox_alerts_open") > 0:
            out.append("mailbox_alert_open")
        if st.int("tenant_posture.accounts_mfa") < st.int("tenant_posture.accounts_total"):
            out.append("mfa")
        if st.int("tenant_posture.devices_unknown_seen") > 0:
            out.append("unknown_device")
    elif k == "external_scanner":
        if any(isinstance(r, dict) and r.get("status") == "fail" for r in st.get("scan.results.items") or []):
            out.append("external_check_failed")
    elif k == "staff_attester":
        if st.str("staff_event.kind") == "verify_before_pay" and \
                st.int("staff_event.verify_before_pay.callback_verified") < st.int("staff_event.verify_before_pay.requests"):
            out.append("payment_not_verified")
        if st.str("staff_event.kind") == "backup_restore_drill" and st.str("staff_event.backup_restore_drill.result") != "success":
            out.append("restore_drill_failed")
    return sorted(out)


def _summarize(p, items, attesters):
    f, t = _date(p.date_from), _date(p.date_to)
    day = lambda it: it.st.time("observed_at").date()  # noqa: E731  (UTC datetimes)
    evidence = [it for it in items if it.posture and it.sig_ok and it.enrol_ok and it.ts_ok and it.incl_ok and f <= day(it) <= t]
    evidence.sort(key=lambda it: (it.st.time("observed_at"), it.st.str("attester"), it.st.int("seq")))
    coverage = {k: 0 for k in ("connector_reports", "devices_known", "devices_enrolled", "devices_unknown_seen",
                               "accounts_total", "accounts_mfa", "accounts_passkey", "device_enrollments")}
    covered, lapses = {}, []
    for it in evidence:
        aid = it.st.str("attester")
        covered.setdefault(aid, set()).add(day(it))
        if it.st.str("attester_kind") == "cloud_connector":
            coverage["connector_reports"] += 1
            for k in ("devices_known", "devices_enrolled", "devices_unknown_seen", "accounts_total", "accounts_mfa", "accounts_passkey"):
                coverage[k] = it.st.int("tenant_posture." + k)
        checks = lapse_checks(it.st)
        if checks:
            lapses.append({"attester": aid, "date": day(it).isoformat(), "seq": it.st.int("seq"), "checks": checks})
    lst = []
    for a in attesters.values():
        ai = a["it"]
        if ai.enrol_ok and ai.sig_ok and ai.ts_ok and ai.incl_ok and a["kind"] in EXPECTED_DAILY:
            lst.append(a)
        if a["kind"] == "device_agent" and ai.enrol_ok:
            coverage["device_enrollments"] += 1
    lst.sort(key=lambda a: (a["number"], a["id"]))
    gaps = []
    for a in lst:
        start = max(a["it"].st.time("enrolled_at").date() + DAY, f)
        run = None
        d = start
        while d <= t:
            if d in covered.get(a["id"], ()):
                run = None
            elif run is None:
                run = {"attester": a["id"], "attester_kind": a["kind"], "device_number": a["number"], "from": d.isoformat(), "to": d.isoformat(), "days": 1}
                gaps.append(run)
            else:
                run["to"], run["days"] = d.isoformat(), run["days"] + 1
            d += DAY
    return {"coverage": coverage, "gaps": gaps, "lapses": lapses}, gaps


def _safe_canonical(v):
    try:
        return canon.encode(v)
    except canon.CanonError:
        return None


def _verify_summary(s, p, r):
    s.checked = 1
    if _safe_canonical(p.summary) != canon.encode(r.computed):
        s.status = "fail"
        claimed = p.summary if isinstance(p.summary, dict) else {}
        key = lambda o: _safe_canonical(o) or repr(o)  # noqa: E731
        as_set = lambda v: {key(o): o for o in (v if isinstance(v, list) else []) if isinstance(o, dict)}  # noqa: E731

        def lapse_text(o):
            checks = ", ".join(CHECK_LABEL.get(c, c) for c in (o.get("checks") or []))
            return f"{r.labels.get(o.get('attester'), o.get('attester'))} on {_fmt_day(_date(o.get('date')))}: {checks}"

        out = []
        ev, cl = as_set(r.computed["gaps"]), as_set(claimed.get("gaps"))
        out += [f"The summary hides a gap the evidence shows: {r.gap_text(o)}" for k, o in ev.items() if k not in cl]
        out += [f"The summary claims a gap the evidence does not show: {r.gap_text(o)}" for k, o in cl.items() if k not in ev]
        ev, cl = as_set(r.computed["lapses"]), as_set(claimed.get("lapses"))
        out += [f"The summary hides a lapse the evidence shows: {lapse_text(o)}" for k, o in ev.items() if k not in cl]
        out += [f"The summary claims a lapse the evidence does not show: {lapse_text(o)}" for k, o in cl.items() if k not in ev]
        if key(r.computed["coverage"]) != key(claimed.get("coverage")):
            out.append("The summary's coverage numbers differ from the evidence")
        s.problems = sorted(out) or ["The pack's summary does not match what the evidence shows"]
        s.detail = "The summary on this pack does not match the signed evidence"
        return
    if not r.gaps:
        s.detail = "No gaps: every enrolled device and service reported every day, and the summary matches the evidence"
    else:
        s.detail = f"{len(r.gaps)} gap(s) disclosed, matching the evidence: " + "; ".join(r.gap_text(g) for g in r.gaps)


# ---------------------------------------------------------------- building


@dataclass
class Request:
    tenant_id: str
    display_name: str
    display_name_salt: str
    date_from: str
    date_to: str
    issued_at: dt.datetime
    sample: bool = False
    earlier: list[str] = field(default_factory=list)


def build(server, trust: TrustPolicy, req: Request) -> Pack:
    """Assemble a pack from a tlog.Server (or anything with .log and
    .evidence) and compute its summary by running the verifier itself."""
    log = server.log
    latest = log.latest_text()
    size = note.parse_checkpoint(note.parse(latest).text).size
    f, t = _date(req.date_from), _date(req.date_to)
    p = Pack(req.sample, brand.PRODUCT, req.issued_at, req.date_from, req.date_to, req.tenant_id, req.display_name,
             req.display_name_salt, log.origin, latest, summary={})
    for ev in server.evidence:
        st = ev.statement
        if st is None or st.str("tenant") != req.tenant_id or ev.index >= size:
            continue
        if st.is_posture:
            if not f <= st.time("observed_at").date() <= t:
                continue
        elif st.time("enrolled_at").date() > t:
            continue
        p.entries.append(Entry(ev, log.inclusion_proof(ev.index, size)))
    p.entries.sort(key=lambda e: e.evidence.index)
    for e in req.earlier:
        m = note.parse_checkpoint(note.parse(e).text).size
        p.earlier.append((e, log.consistency_proof(m, size)))
    p.summary = verify(p, trust).computed
    return p
