"""A complete flow built entirely in Python: tenant, devices, the vendor's
scanner, ingest checks, timestamps, checkpoints, witnesses, tiles, a Proof
Pack, and attacks on it."""

import datetime as dt
import os
import pathlib
import tempfile
import unittest

from proofengine import canon, note, pack, posture, sigs, tlog, tsa, witness
from proofengine.posture import (AttesterKind, DeviceClass, DeviceChecks, DiskEncryption, EDRKind, EnrollMethod,
                                 EnrollmentInfo, Header, KeyAttestation, KeyProtection, OSPatch, Platform, ScanCheck,
                                 ScanResult, ScanStatus, Severity, StaffRole)

UTC = dt.timezone.utc
START = dt.datetime(2026, 10, 1, tzinfo=UTC)


class World:
    def __init__(self, days=5, gap_day=2):
        self.now = START - dt.timedelta(days=1)
        clock = lambda: self.now  # noqa: E731
        self.log_signer = sigs.generate(sigs.ED25519)
        self.log = tlog.Log("example.com/py-log", self.log_signer._key)
        tsa_signers = [sigs.generate(sigs.ED25519) for _ in range(2)]
        auths = [tsa.SimulatedAuthority(f"tsa-{i}.example", s, lambda i=i: self.now + dt.timedelta(seconds=i + 1)) for i, s in enumerate(tsa_signers)]
        self.server = tlog.Server(self.log, auths, clock)
        self.witnesses = [witness.Witness(f"witness-{i}.example", sigs.generate(sigs.ED25519)._key, clock) for i in range(3)]
        self.tenant = sigs.generate(sigs.ES256)
        self.devices = [sigs.generate(sigs.ES256) for _ in range(2)]
        self.scanner = sigs.generate(sigs.ED25519)
        self.name, self.salt = "Example Firm (python test)", "ab" * 32
        self.prev, self.seq, self.envs = {}, {}, {}
        tid = posture.tenant_id(self.tenant.public())
        g = posture.build_tenant_genesis(self.tenant.public(), pack.name_commitment(self.name, self.salt), self.now,
                                         self.server.issue_nonce(tid), posture.new_salt())
        self.submit(posture.sign(g, self.tenant))
        for n, (key, kind) in enumerate([(d, AttesterKind.DEVICE_AGENT) for d in self.devices] + [(self.scanner, AttesterKind.EXTERNAL_SCANNER)], 1):
            self.now += dt.timedelta(minutes=1)
            aid = posture.attester_id(kind, key.public())
            dev = kind == AttesterKind.DEVICE_AGENT
            info = EnrollmentInfo(kind, KeyProtection.SOFTWARE, KeyAttestation.NONE, EnrollMethod.ENROLLMENT_CODE if dev else EnrollMethod.OWNER_APPROVAL,
                                  DeviceClass.LAPTOP if dev else DeviceClass.NOT_A_DEVICE, Platform.WINDOWS if dev else Platform.VENDOR_SERVICE,
                                  n if dev else 0, StaffRole.NONE)
            p = posture.build_attester_enrollment(self.tenant.public(), key.public(), info, self.now, self.server.issue_nonce(aid), posture.new_salt())
            self.submit(posture.sign(p, self.tenant, key))
            self.prev[aid], self.seq[aid] = posture.payload_digest(p), 0
        self.saved = None
        for day in range(days):
            base = START + dt.timedelta(days=day)
            self.now = base + dt.timedelta(hours=6)
            self.report(self.scanner, AttesterKind.EXTERNAL_SCANNER, lambda h: posture.build_scan(h, [
                ScanResult(ScanCheck.EMAIL_04, ScanStatus.WARN if day < 3 else ScanStatus.PASS, Severity.MEDIUM),
                ScanResult(ScanCheck.TLS_01, ScanStatus.PASS, Severity.INFO)]))
            for i, d in enumerate(self.devices):
                if i == 1 and day == gap_day:
                    continue  # silent day: a gap
                self.now = base + dt.timedelta(hours=14, minutes=7 * i)
                self.report(d, AttesterKind.DEVICE_AGENT, lambda h: posture.build_device(h, self.checks(on=not (i == 0 and day == 3))))
            self.now = base + dt.timedelta(hours=23, minutes=50)
            self.checkpoint()
            if day == 1:
                self.saved = self.log.latest_text()

    def checks(self, on=True):
        return DeviceChecks(DiskEncryption.ON if on else DiskEncryption.OFF, OSPatch.CURRENT, True, True, 10, True, EDRKind.DEFENDER, 1, 300, 288)

    def submit(self, env):
        self.now += dt.timedelta(seconds=10)
        return self.server.submit(env)

    def header(self, key, kind):
        aid = posture.attester_id(kind, key.public())
        return aid, Header(self.tenant.public(), key.public(), kind, self.seq[aid] + 1, self.prev[aid],
                           self.server.issue_nonce(aid), posture.new_salt(), self.now)

    def report(self, key, kind, build):
        aid, h = self.header(key, kind)
        payload = build(h)
        env = posture.sign(payload, key)
        ev = self.submit(env)
        self.seq[aid], self.prev[aid] = h.seq, posture.payload_digest(payload)
        self.envs[(aid, h.seq)] = env
        return ev

    def checkpoint(self):
        signed = self.log.sign_checkpoint()
        for w in self.witnesses:
            seen = w.seen.get(self.log.origin)
            proof = self.log.consistency_proof(seen["size"], self.log.size) if seen else []
            self.log.add_cosignature(w.cosign(signed, self.log.vkey(), proof))

    def trust(self):
        return pack.parse_trust_policy(self.trust_json())

    def trust_json(self):
        return canon.encode({
            "policy_type": pack.POLICY_TYPE, "demo_only": True,
            "log": {"origin": self.log.origin, "vkey": self.log.vkey()},
            "witnesses": [{"name": w.name, "vkey": w.vkey(), "label": w.name, "simulated": True} for w in self.witnesses],
            "witness_quorum": 2,
            "timestamp_authorities": [{"name": a.name(), "kind": tsa.KIND_SIMULATED, "public_key": a._signer.public().b64(), "label": a.name(), "simulated": True}
                                      for a in self.server._tsas],
            "timestamp_quorum": 2, "limits": {"max_report_delay_s": 900, "max_clock_skew_s": 300, "max_tsa_spread_s": 300}})

    def pack(self):
        return pack.build(self.server, self.trust(), pack.Request(posture.tenant_id(self.tenant.public()), self.name, self.salt,
                                                                  "2026-10-01", "2026-10-05", START + dt.timedelta(days=5), True, [self.saved]))


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = World()
        cls.p = cls.w.pack()
        cls.trust = cls.w.trust()
        out = os.environ.get("PROOF_EXPORT_DIR")
        if out:  # lets the Go and browser verifiers check a Python-built pack
            pathlib.Path(out).mkdir(parents=True, exist_ok=True)
            (pathlib.Path(out) / "python-built.pack.json").write_bytes(cls.p.to_json())
            (pathlib.Path(out) / "python-built.trust.json").write_bytes(cls.w.trust_json())

    def test_pack_verifies_and_reports_the_gap_and_lapse(self):
        r = pack.verify(pack.parse(self.p.to_json()), self.trust)
        self.assertTrue(r.verified, r.text())
        self.assertEqual([(g["device_number"], g["from"]) for g in r.gaps], [(2, "2026-10-03")])
        self.assertEqual([lp["checks"] for lp in r.computed["lapses"]], [["disk_encryption"]])
        self.assertIn("1 external scanner", r.step("enrollment").detail)

    def test_ingest_rejections(self):
        w = self.w
        aid = posture.attester_id(AttesterKind.DEVICE_AGENT, w.devices[0].public())
        with self.assertRaisesRegex(tlog.IngestError, "replay"):
            w.server.submit(w.envs[(aid, 1)])
        _, h = w.header(w.devices[0], AttesterKind.DEVICE_AGENT)
        old = Header(h.tenant_key, h.attester, h.kind, h.seq, h.prev, h.nonce, h.salt, w.now - dt.timedelta(days=1))
        with self.assertRaisesRegex(tlog.IngestError, "backdated"):
            w.server.submit(posture.sign(posture.build_device(old, w.checks()), w.devices[0]))
        _, h = w.header(w.devices[0], AttesterKind.DEVICE_AGENT)
        with self.assertRaisesRegex(tlog.IngestError, "not valid for the enrolled key"):
            w.server.submit(posture.sign(posture.build_device(h, w.checks()), sigs.generate(sigs.ES256)))

    def test_attacks_fail(self):
        w = self.w
        raw = self.p.to_json()
        # A report deleted from the middle of a device's chain.
        p = pack.parse(raw)
        p.entries = [e for e in p.entries if not (b'"device":' in e.evidence.envelope.payload and
                                                  posture.validate(e.evidence.envelope.payload).str("observed_at").startswith("2026-10-02T14:00"))]
        self.assertEqual(len(p.entries), len(pack.parse(raw).entries) - 1)
        self.assertEqual(pack.verify(p, self.trust).failed_steps(), ["sequence", "gaps"])
        # Missing witness quorum.
        p = pack.parse(raw)
        n = note.parse(p.checkpoint)
        p.checkpoint = str(note.Note(n.text, n.sigs[:2]))
        self.assertEqual(pack.verify(p, self.trust).failed_steps(), ["witnesses"])
        # Forged statement (a hostname smuggled in, signed by the real device key).
        p = pack.parse(raw)
        e = next(e for e in p.entries if b'"device":' in e.evidence.envelope.payload)
        st = canon.parse(e.evidence.envelope.payload)
        st["predicate"]["device"]["hostname"] = "MARIA-LAPTOP"
        signer = next(d for d in w.devices if posture.attester_id(AttesterKind.DEVICE_AGENT, d.public()) == st["predicate"]["attester"])
        from proofengine import dsse
        e.evidence.envelope = dsse.sign(dsse.PAYLOAD_TYPE_IN_TOTO, canon.encode(st), signer)
        r = pack.verify(p, self.trust)
        self.assertEqual(r.step("signatures").status, "pass")
        self.assertIn("field is not allowed", " ".join(r.step("content").problems))

    def test_witness_refuses_fork(self):
        w = self.w
        fork = tlog.Log(w.log.origin, w.log_signer._key)
        for d in w.log.digests[:-1]:
            fork.append(d)
        signed = fork.sign_checkpoint()
        with self.assertRaises(witness.ForkError):
            w.witnesses[0].cosign(signed, fork.vkey(), [])

    def test_public_tiles_reveal_nothing(self):
        w = self.w
        with tempfile.TemporaryDirectory() as d:
            w.log.write_tiles(d)
            blob = b"".join(p.read_bytes() for p in pathlib.Path(d).rglob("*") if p.is_file())
            secrets_ = [w.name.encode(), posture.tenant_id(w.tenant.public()).encode(), b"disk_encryption", b"EMAIL-04", b"in-toto"]
            for ev in w.server.evidence:
                secrets_ += [ev.statement.str("attester").encode(), ev.statement.str("salt").encode(), ev.envelope.payload[:40]]
            for s in secrets_:
                if s:
                    self.assertNotIn(s, blob)
            entries = (pathlib.Path(d) / "tile" / "entries" / "000.p" / str(w.log.size)).read_bytes()
            self.assertEqual(len(entries), 34 * w.log.size)  # 2-byte length + 32-byte digest each


if __name__ == "__main__":
    unittest.main()
