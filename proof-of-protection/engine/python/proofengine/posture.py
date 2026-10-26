"""What a statement may say: build statements from typed values and
validate statements from anywhere. Mirrors engine/posture.

The privacy rule is structural. Statements carry only booleans, integers,
enums and timestamps, plus fixed-format protocol identifiers (key-derived
IDs, hex digests and nonces, public keys). The builders accept only Enum
members, ints, bools, datetimes and keys: a plain string is refused before
anything is built, and every built statement is validated against the same
schema every verifier uses. This module imports nothing that touches files,
the network or the OS (tests enforce that), so the property can be checked
by tooling rather than by reviewer diligence.
"""

from __future__ import annotations

import datetime as dt
import enum
import hashlib
import secrets
from dataclasses import dataclass, field
from typing import Any

from . import brand, canon
from ._schema import SCHEMA
from .dsse import PAYLOAD_TYPE_IN_TOTO, Envelope, sign as dsse_sign
from .sigs import PublicKey, Signer, parse_public_key_b64
from .tsa import format_time, parse_time

RULE = "statements may carry only yes/no values, counts, enums and timestamps"
IN_TOTO_STATEMENT = SCHEMA["in_toto_statement_type"]
PREDICATE_POSTURE = SCHEMA["predicate_types"]["posture"]
PREDICATE_ENROLLMENT = SCHEMA["predicate_types"]["enrollment"]
assert PREDICATE_POSTURE == brand.PREDICATE_POSTURE, "brand.py is out of sync with the Go schema; run sync_schema.py"

PREFIX = {"device_agent": "dev_", "cloud_connector": "con_", "staff_attester": "stf_", "external_scanner": "scn_"}
PREFIX_TENANT = "tnt_"


# ---------------------------------------------------------------- validation


class ContentError(ValueError):
    def __init__(self, path: str, reason: str):
        super().__init__(f"{path}: {reason}" if path else reason)
        self.path = path


def _join(path: str, k: str) -> str:
    return f"{path}.{k}" if path else k


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _lower_hex(s, n) -> bool:
    return isinstance(s, str) and len(s) == n and all(c in "0123456789abcdef" for c in s)


def _valid_id(s, prefixes) -> bool:
    return isinstance(s, str) and any(s.startswith(p) and _lower_hex(s[len(p) :], 16) for p in prefixes)


def check(v: Any, s: dict, path: str) -> None:
    t = s["t"]
    if t == "bool":
        if not isinstance(v, bool):
            raise ContentError(path, f"must be true or false ({RULE})")
    elif t == "int":
        if not _is_int(v):
            raise ContentError(path, f"must be an integer ({RULE})")
        if v < s["min"] or v > s["max"]:
            raise ContentError(path, f"integer {v} is outside the allowed range {s['min']}..{s['max']}")
    elif t == "enum":
        if not isinstance(v, str) or v not in s["values"]:
            raise ContentError(path, f"must be one of {', '.join(s['values'])} ({RULE})")
    elif t == "const":
        if v != s["value"]:
            raise ContentError(path, f"must be {s['value']!r}")
    elif t == "timestamp":
        try:
            parse_time(v)
        except ValueError:
            raise ContentError(path, "must be a UTC timestamp like 2026-10-01T14:00:00Z") from None
    elif t == "hex":
        if not _lower_hex(v, s["len"]):
            raise ContentError(path, f"must be {s['len']} lowercase hex characters")
    elif t == "id":
        if not _valid_id(v, s["prefixes"]):
            raise ContentError(path, f"must be a key-derived identifier ({'/'.join(s['prefixes'])} followed by 16 hex characters)")
    elif t == "spki":
        try:
            parse_public_key_b64(v)
        except (ValueError, TypeError) as e:
            raise ContentError(path, f"must be a canonical P-256 or Ed25519 public key: {e}") from None
    elif t == "array":
        if not isinstance(v, list):
            raise ContentError(path, "must be an array")
        lo, hi = s.get("min_items", 0), s.get("max_items", 0)
        if not lo <= len(v) <= hi:
            raise ContentError(path, f"must have {lo} to {hi} items")
        for i, e in enumerate(v):
            check(e, s["of"], f"{path}[{i}]")
    elif t == "counted_list":
        _check_counted_list(v, s, path)
    elif t == "result_list":
        _check_result_list(v, s, path)
    elif t == "object":
        _check_object(v, s, path)
    else:
        raise ContentError(path, f"schema error: unknown type {t}")


def _check_object(v, s, path):
    if not isinstance(v, dict):
        raise ContentError(path, "must be an object")
    fields = dict(s.get("fields", {}))
    sw = s.get("switch")
    if sw:
        tag = v.get(sw["on"])
        extra = sw["cases"].get(tag) if isinstance(tag, str) else None
        if extra is None:
            check(v.get(sw["on"]), s["fields"][sw["on"]], _join(path, sw["on"]))
            raise ContentError(_join(path, sw["on"]), f"unsupported value {tag!r}")
        fields.update(extra)
    for k in sorted(v):  # unknown fields first: where a smuggled "hostname" is caught
        if k not in fields:
            raise ContentError(_join(path, k), f"field is not allowed ({RULE})")
    for k in sorted(fields):
        if k not in v:
            raise ContentError(_join(path, k), "required field is missing")
        check(v[k], fields[k], _join(path, k))
    for a, b in s.get("le", []):
        if v[a] > v[b]:
            raise ContentError(_join(path, a), f"must not exceed {b} ({v[a]} > {v[b]})")


def _list_envelope(v, path):
    if not isinstance(v, dict) or len(v) != 3:
        raise ContentError(path, "must be {items, total, truncated}")
    items, total, truncated = v.get("items"), v.get("total"), v.get("truncated")
    if not isinstance(items, list) or not _is_int(total) or not isinstance(truncated, bool):
        raise ContentError(path, "must be {items: array, total: integer, truncated: true/false}")
    return items, total, truncated


def _check_counted_list(v, s, path):
    items, total, truncated = _list_envelope(v, path)
    if len(items) > s["max_items"]:
        raise ContentError(_join(path, "items"), f"at most {s['max_items']} items are allowed; set truncated instead")
    if total < 0 or total > s["max_count"] * len(s["kinds"]):
        raise ContentError(_join(path, "total"), "out of range")
    prev, total_seen = "", 0
    for i, it in enumerate(items):
        ip = f"{path}.items[{i}]"
        if not isinstance(it, dict) or len(it) != 2:
            raise ContentError(ip, f"must be exactly {{count, kind}} ({RULE})")
        kind, n = it.get("kind"), it.get("count")
        if not isinstance(kind, str) or kind not in s["kinds"]:
            raise ContentError(_join(ip, "kind"), f"must be one of {', '.join(s['kinds'])} ({RULE})")
        if not _is_int(n) or n < 1 or n > s["max_count"]:
            raise ContentError(_join(ip, "count"), f"must be an integer 1..{s['max_count']}")
        if kind <= prev:
            raise ContentError(ip, "items must be sorted by kind with no repeats")
        prev = kind
        total_seen += n
    if not truncated and total_seen != total:
        raise ContentError(_join(path, "total"), "must equal the sum of item counts when truncated is false")
    if truncated and (len(items) != s["max_items"] or total_seen >= total):
        raise ContentError(_join(path, "truncated"), "truncated lists must be full and total must exceed the listed counts")


def _check_result_list(v, s, path):
    items, total, truncated = _list_envelope(v, path)
    if len(items) > s["max_items"]:
        raise ContentError(_join(path, "items"), f"at most {s['max_items']} items are allowed; set truncated instead")
    if total < 0 or total > 1000:
        raise ContentError(_join(path, "total"), "out of range")
    prev = ""
    for i, it in enumerate(items):
        ip = f"{path}.items[{i}]"
        check(it, s["of"], ip)
        if it[s["key"]] <= prev:
            raise ContentError(ip, f"items must be sorted by {s['key']} with no repeats")
        prev = it[s["key"]]
    if not truncated and len(items) != total:
        raise ContentError(_join(path, "total"), "must equal the number of items when truncated is false")
    if truncated and (len(items) != s["max_items"] or total <= len(items)):
        raise ContentError(_join(path, "truncated"), "truncated lists must be full and total must exceed the number of items")


class Statement:
    """A validated in-toto statement with typed accessors."""

    def __init__(self, raw: dict):
        self.raw = raw
        self.predicate_type = raw["predicateType"]
        self.predicate = raw["predicate"]
        self.subject_name = raw["subject"][0]["name"]
        self.subject_digest = raw["subject"][0]["digest"]["sha256"]

    def get(self, path: str) -> Any:
        cur: Any = self.predicate
        for p in path.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return None
            cur = cur[p]
        return cur

    def str(self, path: str) -> str:
        v = self.get(path)
        return v if isinstance(v, str) else ""

    def int(self, path: str) -> int:
        v = self.get(path)
        return v if _is_int(v) else 0

    def bool(self, path: str) -> bool:
        return self.get(path) is True

    def time(self, path: str) -> dt.datetime:
        return parse_time(self.str(path))

    @property
    def is_posture(self) -> bool:
        return self.predicate_type == PREDICATE_POSTURE


def validate(payload: bytes) -> Statement:
    try:
        obj = canon.parse_object(payload)
    except canon.CanonError as e:
        raise ContentError("", str(e)) from None
    return validate_value(obj)


def validate_value(obj: dict) -> Statement:
    pt = obj.get("predicateType")
    spec = SCHEMA["statements"].get(pt) if isinstance(pt, str) else None
    if spec is None:
        raise ContentError("predicateType", f"unsupported predicate type {pt!r}")
    check(obj, spec, "")
    st = Statement(obj)
    if st.is_posture:
        if st.subject_name != st.str("attester"):
            raise ContentError("subject[0].name", "must equal predicate.attester")
        if not st.str("attester").startswith(PREFIX[st.str("attester_kind")]):
            raise ContentError("predicate.attester", "prefix does not match attester_kind")
    else:
        want = st.str("tenant")
        if st.str("kind") == "attester":
            want = st.str("attester")
            if not want.startswith(PREFIX[st.str("attester_kind")]):
                raise ContentError("predicate.attester", "prefix does not match attester_kind")
        if st.subject_name != want:
            raise ContentError("subject[0].name", "must name the enrolled tenant or attester")
    return st


# ---------------------------------------------------------------- typed inputs


class _E(str, enum.Enum):
    def __str__(self) -> str:
        return self.value


class AttesterKind(_E):
    DEVICE_AGENT = "device_agent"
    CLOUD_CONNECTOR = "cloud_connector"
    STAFF_ATTESTER = "staff_attester"
    EXTERNAL_SCANNER = "external_scanner"


class DiskEncryption(_E):
    ON = "on"
    OFF = "off"
    SUSPENDED = "suspended"
    UNKNOWN = "unknown"


class OSPatch(_E):
    CURRENT = "current"
    UPDATES_PENDING = "updates_pending"
    OUT_OF_DATE = "out_of_date"
    UNSUPPORTED_OS = "unsupported_os"
    UNKNOWN = "unknown"


class EDRKind(_E):
    DEFENDER = "defender"
    THIRD_PARTY = "third_party"
    NONE = "none"


class RemoteTool(_E):
    ANYDESK = "anydesk"
    OTHER = "other_remote_tool"
    RUSTDESK = "rustdesk"
    SCREENCONNECT = "screenconnect"
    SPLASHTOP = "splashtop"
    TEAMVIEWER = "teamviewer"
    ULTRAVIEWER = "ultraviewer"
    VNC = "vnc"


class MailboxAlert(_E):
    FORWARDING_RULE_EXTERNAL = "forwarding_rule_external"
    IMPOSSIBLE_TRAVEL_APPROX = "impossible_travel_approx"
    NEW_ADMIN_ROLE = "new_admin_role"
    NEW_AUTH_METHOD = "new_auth_method"
    SIGNIN_UNUSUAL_COUNTRY_APPROX = "signin_unusual_country_approx"


class PaymentRequest(_E):
    BANK_DETAIL_CHANGE = "bank_detail_change"
    PAYROLL_CHANGE = "payroll_change"
    REFUND_REDIRECT = "refund_redirect"
    VENDOR_INVOICE_CHANGE = "vendor_invoice_change"
    WIRE_TRANSFER = "wire_transfer"


class DrillResult(_E):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class ScanCheck(_E):
    BREACH_01 = "BREACH-01"
    BREACH_02 = "BREACH-02"
    DNS_01 = "DNS-01"
    EMAIL_01 = "EMAIL-01"
    EMAIL_02 = "EMAIL-02"
    EMAIL_03 = "EMAIL-03"
    EMAIL_04 = "EMAIL-04"
    EMAIL_05 = "EMAIL-05"
    HTTP_01 = "HTTP-01"
    HTTP_02 = "HTTP-02"
    HTTP_03 = "HTTP-03"
    TLS_01 = "TLS-01"
    TLS_02 = "TLS-02"
    TLS_03 = "TLS-03"


class ScanStatus(_E):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    ERROR = "error"
    NOT_APPLICABLE = "not_applicable"


class Severity(_E):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class KeyProtection(_E):
    SOFTWARE = "software"
    TPM2 = "tpm2"
    SECURE_ENCLAVE = "secure_enclave"


class KeyAttestation(_E):
    NONE = "none"
    TPM2_QUOTE = "tpm2_quote"
    APPLE_MDA = "apple_mda"


class EnrollMethod(_E):
    ENROLLMENT_CODE = "enrollment_code"
    OWNER_APPROVAL = "owner_approval"


class DeviceClass(_E):
    LAPTOP = "laptop"
    DESKTOP = "desktop"
    SERVER = "server"
    NOT_A_DEVICE = "not_a_device"


class Platform(_E):
    WINDOWS = "windows"
    MACOS = "macos"
    MICROSOFT_365 = "microsoft_365"
    MOBILE_APP = "mobile_app"
    VENDOR_SERVICE = "vendor_service"


class StaffRole(_E):
    NONE = "none"
    OWNER = "owner"
    OFFICE_MANAGER = "office_manager"
    BOOKKEEPER = "bookkeeper"


REMOTE_TOOLS_MAX_ITEMS = 4
MAILBOX_ALERTS_MAX_ITEMS = 5
PAYMENT_KINDS_MAX_ITEMS = 5
SCAN_RESULTS_MAX_ITEMS = 32


def tenant_id(tenant_key: PublicKey) -> str:
    return PREFIX_TENANT + tenant_key.keyid()[:16]


def attester_id(kind: AttesterKind, key: PublicKey) -> str:
    return PREFIX[_enum(kind, AttesterKind, "kind").value] + key.keyid()[:16]


def payload_digest(payload: bytes) -> bytes:
    """The chain hash: each statement's prev is this digest of the one before."""
    return hashlib.sha256(payload).digest()


def new_salt() -> bytes:
    """256 random bits per statement keep its public commitment unguessable."""
    return secrets.token_bytes(32)


def _enum(v, cls, name):
    if not isinstance(v, cls):
        raise TypeError(f"{name} must be a {cls.__name__} member, not {type(v).__name__} (builders never accept free text)")
    return v


def _int(v, name):
    if not _is_int(v) or v < 0:
        raise TypeError(f"{name} must be a non-negative int")
    return v


def _bool(v, name):
    if not isinstance(v, bool):
        raise TypeError(f"{name} must be a bool")
    return v


def _time(v, name):
    if not isinstance(v, dt.datetime) or v.tzinfo is None:
        raise TypeError(f"{name} must be a timezone-aware datetime")
    return format_time(v.replace(microsecond=0))


def _bytes(v, n, name):
    if not isinstance(v, (bytes, bytearray)) or len(v) != n:
        raise TypeError(f"{name} must be {n} bytes")
    return bytes(v)


@dataclass(frozen=True)
class Count:
    kind: enum.Enum
    n: int


def _counted(counts: list[Count], cls, max_items: int) -> dict:
    sums: dict[str, int] = {}
    total = 0
    for c in counts:
        _enum(c.kind, cls, "kind")
        _int(c.n, "count")
        if c.n:
            sums[c.kind.value] = sums.get(c.kind.value, 0) + c.n
            total += c.n
    kinds = list(sums)
    truncated = len(kinds) > max_items
    if truncated:
        kinds = sorted(kinds, key=lambda k: (-sums[k], k))[:max_items]
    return {"items": [{"count": sums[k], "kind": k} for k in sorted(kinds)], "total": total, "truncated": truncated}


@dataclass(frozen=True)
class Header:
    tenant_key: PublicKey
    attester: PublicKey
    kind: AttesterKind
    seq: int
    prev: bytes
    nonce: bytes
    salt: bytes
    observed_at: dt.datetime


@dataclass(frozen=True)
class DeviceChecks:
    disk_encryption: DiskEncryption
    os_patch: OSPatch
    firewall_on: bool
    screen_lock_on: bool
    screen_lock_max_idle_min: int
    edr_running: bool
    edr_kind: EDRKind
    local_admin_count: int
    heartbeat_interval_s: int
    heartbeats_24h: int
    unapproved_remote_tools: list[Count] = field(default_factory=list)


@dataclass(frozen=True)
class TenantPosture:
    accounts_total: int
    accounts_mfa: int
    accounts_passkey: int
    admin_accounts: int
    devices_known: int
    devices_enrolled: int
    devices_unknown_seen: int = 0
    mailbox_alerts_24h: list[Count] = field(default_factory=list)
    mailbox_alerts_open: int = 0
    mailbox_alerts_resolved_24h: int = 0


@dataclass(frozen=True)
class ScanResult:
    check_id: ScanCheck
    status: ScanStatus
    severity: Severity


@dataclass(frozen=True)
class VerifyBeforePay:
    requests: int
    callback_verified: int
    second_approver: int
    blocked: int
    request_kinds: list[Count] = field(default_factory=list)


@dataclass(frozen=True)
class RestoreDrill:
    performed_at: dt.datetime
    result: DrillResult
    files_restored: int
    minutes_to_restore: int
    second_person_verified: bool


@dataclass(frozen=True)
class EnrollmentInfo:
    kind: AttesterKind
    key_protection: KeyProtection
    key_attestation: KeyAttestation
    method: EnrollMethod
    device_class: DeviceClass
    platform: Platform
    device_number: int
    staff_role: StaffRole


def _finish(predicate_type: str, subject: str, subject_digest: str, pred: dict) -> bytes:
    st = {
        "_type": IN_TOTO_STATEMENT,
        "predicateType": predicate_type,
        "subject": [{"name": subject, "digest": {"sha256": subject_digest}}],
        "predicate": pred,
    }
    try:
        validate_value(st)
    except ContentError as e:
        raise ValueError(f"builder refused statement: {e}") from None
    return canon.encode(st)


def _posture(h: Header, kind: AttesterKind, section: str, body: dict) -> bytes:
    if not isinstance(h, Header):
        raise TypeError("header must be a Header")
    if _enum(h.kind, AttesterKind, "kind") != kind:
        raise ValueError(f"{section} statements need attester kind {kind.value}")
    if not isinstance(h.tenant_key, PublicKey) or not isinstance(h.attester, PublicKey):
        raise TypeError("header keys must be PublicKey values")
    salt = _bytes(h.salt, 32, "salt")
    if salt == bytes(32):
        raise ValueError("header needs a random salt (see new_salt)")
    att = attester_id(h.kind, h.attester)
    pred = {
        "tenant": tenant_id(h.tenant_key), "attester": att, "attester_kind": h.kind.value, "seq": _int(h.seq, "seq"),
        "prev": _bytes(h.prev, 32, "prev").hex(), "nonce": _bytes(h.nonce, 16, "nonce").hex(), "salt": salt.hex(),
        "observed_at": _time(h.observed_at, "observed_at"), section: body,
    }
    return _finish(PREDICATE_POSTURE, att, h.attester.keyid(), pred)


def build_device(h: Header, c: DeviceChecks) -> bytes:
    return _posture(h, AttesterKind.DEVICE_AGENT, "device", {
        "disk_encryption": _enum(c.disk_encryption, DiskEncryption, "disk_encryption").value,
        "os_patch_status": _enum(c.os_patch, OSPatch, "os_patch").value,
        "firewall_on": _bool(c.firewall_on, "firewall_on"),
        "screen_lock_on": _bool(c.screen_lock_on, "screen_lock_on"),
        "screen_lock_max_idle_min": _int(c.screen_lock_max_idle_min, "screen_lock_max_idle_min"),
        "edr_running": _bool(c.edr_running, "edr_running"),
        "edr_kind": _enum(c.edr_kind, EDRKind, "edr_kind").value,
        "local_admin_count": _int(c.local_admin_count, "local_admin_count"),
        "unapproved_remote_tools": _counted(c.unapproved_remote_tools, RemoteTool, REMOTE_TOOLS_MAX_ITEMS),
        "heartbeat_interval_s": _int(c.heartbeat_interval_s, "heartbeat_interval_s"),
        "heartbeats_24h": _int(c.heartbeats_24h, "heartbeats_24h"),
    })


def build_tenant_posture(h: Header, t: TenantPosture) -> bytes:
    body = {k: _int(getattr(t, k), k) for k in (
        "accounts_total", "accounts_mfa", "accounts_passkey", "admin_accounts", "devices_known", "devices_enrolled",
        "devices_unknown_seen", "mailbox_alerts_open", "mailbox_alerts_resolved_24h")}
    body["source"] = "microsoft_365"
    body["mailbox_alerts_24h"] = _counted(t.mailbox_alerts_24h, MailboxAlert, MAILBOX_ALERTS_MAX_ITEMS)
    return _posture(h, AttesterKind.CLOUD_CONNECTOR, "tenant_posture", body)


_SEVERITY_RANK = {Severity.CRITICAL: 0, Severity.HIGH: 1, Severity.MEDIUM: 2, Severity.LOW: 3, Severity.INFO: 4}


def build_scan(h: Header, results: list[ScanResult]) -> bytes:
    """Server-observed evidence: the vendor's scanner checking the firm's own
    domain from outside. Evidence strength "scan-verified"."""
    seen = set()
    for r in results:
        _enum(r.check_id, ScanCheck, "check_id")
        _enum(r.status, ScanStatus, "status")
        _enum(r.severity, Severity, "severity")
        if r.check_id in seen:
            raise ValueError(f"check {r.check_id.value} reported twice")
        seen.add(r.check_id)
    kept = list(results)
    truncated = len(kept) > SCAN_RESULTS_MAX_ITEMS
    if truncated:
        kept = sorted(kept, key=lambda r: _SEVERITY_RANK[r.severity])[:SCAN_RESULTS_MAX_ITEMS]
    items = [{"check_id": r.check_id.value, "status": r.status.value, "severity": r.severity.value}
             for r in sorted(kept, key=lambda r: r.check_id.value)]
    return _posture(h, AttesterKind.EXTERNAL_SCANNER, "scan", {
        "source": "external_scan", "results": {"items": items, "total": len(results), "truncated": truncated}})


def build_staff_event(h: Header, event: VerifyBeforePay | RestoreDrill) -> bytes:
    if isinstance(event, VerifyBeforePay):
        body = {"kind": "verify_before_pay", "verify_before_pay": {
            **{k: _int(getattr(event, k), k) for k in ("requests", "callback_verified", "second_approver", "blocked")},
            "request_kinds": _counted(event.request_kinds, PaymentRequest, PAYMENT_KINDS_MAX_ITEMS)}}
    elif isinstance(event, RestoreDrill):
        body = {"kind": "backup_restore_drill", "backup_restore_drill": {
            "performed_at": _time(event.performed_at, "performed_at"),
            "result": _enum(event.result, DrillResult, "result").value,
            "files_restored": _int(event.files_restored, "files_restored"),
            "minutes_to_restore": _int(event.minutes_to_restore, "minutes_to_restore"),
            "second_person_verified": _bool(event.second_person_verified, "second_person_verified")}}
    else:
        raise TypeError("a staff event is a VerifyBeforePay or a RestoreDrill")
    return _posture(h, AttesterKind.STAFF_ATTESTER, "staff_event", body)


def build_tenant_genesis(tenant_key: PublicKey, name_commitment: bytes, at: dt.datetime, nonce: bytes, salt: bytes) -> bytes:
    """Create a tenant. Only a salted commitment to the firm's name is logged."""
    tid = tenant_id(tenant_key)
    pred = {
        "kind": "tenant_genesis", "tenant": tid, "enrolled_at": _time(at, "enrolled_at"),
        "nonce": _bytes(nonce, 16, "nonce").hex(), "salt": _bytes(salt, 32, "salt").hex(),
        "tenant_key": tenant_key.b64(), "tenant_key_alg": tenant_key.alg,
        "display_name_commitment": _bytes(name_commitment, 32, "name_commitment").hex(),
    }
    return _finish(PREDICATE_ENROLLMENT, tid, tenant_key.keyid(), pred)


def build_attester_enrollment(tenant_key: PublicKey, attester_key: PublicKey, info: EnrollmentInfo,
                              at: dt.datetime, nonce: bytes, salt: bytes) -> bytes:
    """Bind an attester key to a tenant. Sign with the tenant key, then the
    attester key (proof of possession)."""
    att = attester_id(info.kind, attester_key)
    pred = {
        "kind": "attester", "tenant": tenant_id(tenant_key), "enrolled_at": _time(at, "enrolled_at"),
        "nonce": _bytes(nonce, 16, "nonce").hex(), "salt": _bytes(salt, 32, "salt").hex(),
        "attester": att, "attester_kind": info.kind.value, "attester_key": attester_key.b64(),
        "attester_key_alg": attester_key.alg,
        "key_protection": _enum(info.key_protection, KeyProtection, "key_protection").value,
        "key_attestation": _enum(info.key_attestation, KeyAttestation, "key_attestation").value,
        "enrollment_method": _enum(info.method, EnrollMethod, "method").value,
        "device_class": _enum(info.device_class, DeviceClass, "device_class").value,
        "platform": _enum(info.platform, Platform, "platform").value,
        "device_number": _int(info.device_number, "device_number"),
        "staff_role": _enum(info.staff_role, StaffRole, "staff_role").value,
    }
    return _finish(PREDICATE_ENROLLMENT, att, attester_key.keyid(), pred)


def sign(payload: bytes, *signers: Signer) -> Envelope:
    return dsse_sign(PAYLOAD_TYPE_IN_TOTO, payload, *signers)
