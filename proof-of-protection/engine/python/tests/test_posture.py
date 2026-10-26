"""The no-free-text rule: builders and the validator, adversarially."""

import ast
import datetime as dt
import pathlib
import unittest

from proofengine import canon, posture, sigs
from proofengine._schema import SCHEMA
from proofengine.posture import (AttesterKind, Count, DeviceChecks, DiskEncryption, EDRKind, Header, OSPatch,
                                 RemoteTool, ScanCheck, ScanResult, ScanStatus, Severity)

AT = dt.datetime(2026, 10, 14, 14, 5, tzinfo=dt.timezone.utc)


def keys():
    return sigs.generate(sigs.ES256), sigs.generate(sigs.ES256)


def header(tenant, att, kind=AttesterKind.DEVICE_AGENT):
    return Header(tenant.public(), att.public(), kind, 3, b"\x01" * 32, bytes.fromhex("abcdef" + "00" * 13), b"\xfe" * 32, AT)


def good_device(**kw):
    base = dict(disk_encryption=DiskEncryption.ON, os_patch=OSPatch.CURRENT, firewall_on=True, screen_lock_on=True,
                screen_lock_max_idle_min=10, edr_running=True, edr_kind=EDRKind.DEFENDER, local_admin_count=1,
                heartbeat_interval_s=300, heartbeats_24h=288)
    base.update(kw)
    return DeviceChecks(**base)


class Builder(unittest.TestCase):
    def test_builds_and_validates(self):
        t, d = keys()
        st = posture.validate(posture.build_device(header(t, d), good_device()))
        self.assertEqual(st.str("device.disk_encryption"), "on")
        self.assertEqual(st.str("attester"), posture.attester_id(AttesterKind.DEVICE_AGENT, d.public()))

    def test_builder_never_accepts_free_text(self):
        t, d = keys()
        h = header(t, d)
        for name, kw in {
            "path as enum": dict(disk_encryption=r"C:\Users\maria\Documents\client-ssn.xlsx"),
            "plain string enum": dict(disk_encryption="on"),
            "product name": dict(edr_kind="CrowdStrike Falcon on MARIA-LAPTOP"),
            "bool as string": dict(firewall_on="true"),
            "float count": dict(local_admin_count=1.5),
            "tool name string": dict(unapproved_remote_tools=[Count(r"anydesk \\fileserver\share", 1)]),
        }.items():
            with self.assertRaises((TypeError, ValueError), msg=name):
                posture.build_device(h, good_device(**kw))
        with self.assertRaises(ValueError):  # enum lookup itself refuses free text
            DiskEncryption("C:/Users/maria")
        with self.assertRaises(ValueError):
            posture.build_device(header(t, d), good_device(screen_lock_max_idle_min=5000))
        no_salt = Header(t.public(), d.public(), AttesterKind.DEVICE_AGENT, 1, bytes(32), bytes(16), bytes(32), AT)
        with self.assertRaises(ValueError):
            posture.build_device(no_salt, good_device())

    def test_counted_list_cap_and_truncation(self):
        t, d = keys()
        tools = [Count(RemoteTool.ANYDESK, 2), Count(RemoteTool.TEAMVIEWER, 1), Count(RemoteTool.VNC, 1),
                 Count(RemoteTool.RUSTDESK, 1), Count(RemoteTool.SPLASHTOP, 3)]
        st = posture.validate(posture.build_device(header(t, d), good_device(unapproved_remote_tools=tools)))
        lst = st.get("device.unapproved_remote_tools")
        self.assertTrue(lst["truncated"])
        self.assertEqual(lst["total"], 8)
        self.assertEqual(len(lst["items"]), posture.REMOTE_TOOLS_MAX_ITEMS)

    def test_scan_statements(self):
        t, _ = keys()
        svc = sigs.generate(sigs.ED25519)
        h = header(t, svc, AttesterKind.EXTERNAL_SCANNER)
        p = posture.build_scan(h, [ScanResult(ScanCheck.TLS_01, ScanStatus.PASS, Severity.INFO),
                                   ScanResult(ScanCheck.EMAIL_04, ScanStatus.WARN, Severity.MEDIUM)])
        st = posture.validate(p)
        self.assertEqual([r["check_id"] for r in st.get("scan.results.items")], ["EMAIL-04", "TLS-01"])
        self.assertTrue(st.str("attester").startswith("scn_"))
        with self.assertRaises((TypeError, ValueError)):
            posture.build_scan(h, [ScanResult("maplestreet.example", ScanStatus.PASS, Severity.INFO)])
        with self.assertRaises(ValueError):
            posture.build_scan(h, [ScanResult(ScanCheck.TLS_01, ScanStatus.PASS, Severity.INFO)] * 2)


class Validator(unittest.TestCase):
    def test_rejects_forbidden_content(self):
        t, d = keys()
        payload = posture.build_device(header(t, d), good_device())
        cases = {
            "hostname": lambda s, p, dv: dv.__setitem__("hostname", "MARIA-LAPTOP"),
            "path": lambda s, p, dv: dv.__setitem__("path", r"C:\Users\maria\Documents\client-ssn.xlsx"),
            "username": lambda s, p, dv: p.__setitem__("username", "maria"),
            "note": lambda s, p, dv: p.__setitem__("note", "Maria turned it off"),
            "top-level": lambda s, p, dv: s.__setitem__("comment", "x"),
            "path in enum": lambda s, p, dv: dv.__setitem__("disk_encryption", r"C:\Users\maria"),
            "padded enum": lambda s, p, dv: dv.__setitem__("disk_encryption", "on "),
            "string bool": lambda s, p, dv: dv.__setitem__("firewall_on", "true"),
            "int as bool": lambda s, p, dv: dv.__setitem__("firewall_on", 1),
            "bool as int": lambda s, p, dv: dv.__setitem__("local_admin_count", True),
            "float": lambda s, p, dv: dv.__setitem__("local_admin_count", 1.5),
            "object in enum": lambda s, p, dv: dv.__setitem__("edr_kind", {"name": "CrowdStrike"}),
            "case-variant key": lambda s, p, dv: dv.__setitem__("Disk_Encryption", dv.pop("disk_encryption")),
            "proto key": lambda s, p, dv: dv.__setitem__("__proto__", {"admin": True}),
            "hostname subject": lambda s, p, dv: s["subject"][0].__setitem__("name", "MARIA-LAPTOP"),
            "hostname in id": lambda s, p, dv: p.__setitem__("attester", "dev_MARIA-LAPTOP-0001"),
            "missing salt": lambda s, p, dv: p.pop("salt"),
            "zoned time": lambda s, p, dv: p.__setitem__("observed_at", "2026-10-14T10:05:00-04:00"),
            "list item path": lambda s, p, dv: dv.__setitem__("unapproved_remote_tools", {"items": [{"count": 1, "kind": "anydesk", "path": "C:/x"}], "total": 1, "truncated": False}),
        }
        for name, mutate in cases.items():
            obj = canon.parse(payload)
            mutate(obj, obj["predicate"], obj["predicate"]["device"])
            with self.assertRaises(posture.ContentError, msg=name):
                posture.validate_value(obj)
        for name, (a, b) in {"duplicate key": (b'"firewall_on":true', b'"firewall_on":true,"firewall_on":false'),
                             "escape": (b'"disk_encryption":"on"', b'"disk_encryption":"o\\u006e"'),
                             "whitespace": (b'"seq":3', b'"seq": 3')}.items():
            bad = payload.replace(a, b, 1)
            self.assertNotEqual(bad, payload, name)
            with self.assertRaises(posture.ContentError, msg=name):
                posture.validate(bad)


class Structure(unittest.TestCase):
    FORBIDDEN = {"os", "pathlib", "io", "shutil", "socket", "subprocess", "urllib", "http", "ssl", "glob", "tempfile",
                 "importlib", "ctypes", "sqlite3", "builtins"}

    def test_builder_and_dependencies_cannot_reach_files_or_network(self):
        pkg = pathlib.Path(posture.__file__).parent
        for mod in ["posture", "canon", "sigs", "dsse", "tsa", "brand", "_schema"]:
            tree = ast.parse((pkg / f"{mod}.py").read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                    names = [node.module]
                for n in names:
                    self.assertNotIn(n.split(".")[0], self.FORBIDDEN, f"{mod}.py imports {n}")
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {"open", "eval", "exec", "__import__"}, f"{mod}.py calls {node.func.id}")

    def test_enums_match_the_schema(self):
        dev = SCHEMA["statements"][posture.PREDICATE_POSTURE]["fields"]["predicate"]["switch"]["cases"]["device_agent"]["device"]["fields"]
        scan = SCHEMA["statements"][posture.PREDICATE_POSTURE]["fields"]["predicate"]["switch"]["cases"]["external_scanner"]["scan"]["fields"]["results"]["of"]["fields"]
        for enum_cls, values in [(DiskEncryption, dev["disk_encryption"]["values"]), (OSPatch, dev["os_patch_status"]["values"]),
                                 (EDRKind, dev["edr_kind"]["values"]), (RemoteTool, dev["unapproved_remote_tools"]["kinds"]),
                                 (ScanCheck, scan["check_id"]["values"]), (ScanStatus, scan["status"]["values"]),
                                 (Severity, scan["severity"]["values"])]:
            self.assertEqual(sorted(e.value for e in enum_cls), sorted(values), enum_cls.__name__)


if __name__ == "__main__":
    unittest.main()
