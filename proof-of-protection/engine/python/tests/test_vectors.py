"""The shared cross-language vectors (engine/testdata/vectors)."""

import base64
import json
import unittest

from proofengine import brand, canon, dsse, merkle, note, pack, posture, sigs, tlog, tsa
from proofengine._schema import SCHEMA

from .helpers import VECTORS, vector


class Vectors(unittest.TestCase):
    def test_schema_is_in_sync_with_go(self):
        self.assertEqual(SCHEMA, vector("posture-schema.json"), "run: python3 -I sync_schema.py")
        self.assertEqual(SCHEMA["predicate_types"]["posture"], brand.PREDICATE_POSTURE)
        self.assertEqual(SCHEMA["predicate_types"]["enrollment"], brand.PREDICATE_ENROLLMENT)

    def test_canonicalization(self):
        v = vector("canonicalization.json")
        self.assertEqual(v["version"], canon.VERSION)
        for c in v["canonicalize"]:
            out = canon.canonicalize(c["input"].encode("utf-8"))
            self.assertEqual(out.decode(), c["canonical"], c["name"])
            canon.parse(out)
        for k in ("reject_as_canonical", "reject_in_signed_data_always"):
            for c in v[k]:
                with self.assertRaises(canon.CanonError, msg=c["name"]):
                    canon.parse(c["input"].encode("utf-8"))

    def test_dsse(self):
        v = vector("dsse.json")
        payload = base64.b64decode(v["payload"])
        self.assertEqual(dsse.pae(v["payload_type"], payload).hex(), v["pae_hex"])
        for s in v["signatures"]:
            k = s["key"]
            pk = sigs.parse_public_key_b64(k["spki"])
            self.assertEqual(pk.keyid(), k["keyid"])
            env = dsse.parse(s["envelope_canonical"].encode())
            env.verify_signature(0, pk)
            signer = sigs.load_pkcs8(base64.b64decode(k["pkcs8"]))
            self.assertEqual(signer.public().keyid(), k["keyid"])
            if k["alg"] == sigs.ED25519:  # deterministic: must reproduce exactly
                self.assertEqual(dsse.sign(v["payload_type"], payload, signer).canonical().decode(), s["envelope_canonical"])
            else:  # our own ES256 signature must verify everywhere
                dsse.sign(v["payload_type"], payload, signer).verify_signature(0, pk)
        pae_bytes = bytes.fromhex(v["pae_hex"])
        for s in v["must_reject"]:
            with self.assertRaises(sigs.SignatureError, msg=s["name"]):
                sigs.parse_public_key_b64(s["spki"]).verify(pae_bytes, base64.b64decode(s["sig"]))

    def test_merkle(self):
        v = vector("merkle.json")
        t = merkle.Tree()
        for leaf, want in zip(v["leaves_hex"], v["leaf_hashes_hex"]):
            h = merkle.leaf_hash(bytes.fromhex(leaf))
            self.assertEqual(h.hex(), want)
            t.append(h)
        for n, want in enumerate(v["roots_hex_by_size"], 1):
            self.assertEqual(t.root(n).hex(), want)
        self.assertEqual(merkle.empty_root().hex(), v["empty_root_hex"])
        root = lambda n: bytes.fromhex(v["roots_hex_by_size"][n - 1])  # noqa: E731
        for c in v["inclusion"]:
            proof = [base64.b64decode(h) for h in c["proof"]]
            self.assertEqual(t.inclusion_proof(c["index"], c["size"]), proof)
            self.assertTrue(merkle.verify_inclusion(c["index"], c["size"], t.leaf_hash_at(c["index"]), proof, root(c["size"])))
        for c in v["consistency"]:
            proof = [base64.b64decode(h) for h in c["proof"]]
            self.assertEqual(t.consistency_proof(c["from"], c["to"]), proof)
            self.assertTrue(merkle.verify_consistency(c["from"], c["to"], proof, root(c["from"]), root(c["to"])))

    def test_note(self):
        v = vector("note.json")
        ex = v["c2sp_signed_note_example"]
        note.parse(ex["note"]).verify_signed_by(note.parse_vkey(ex["vkey"]))
        log_key = sigs.ed25519_from_seed(bytes.fromhex(v["log_key_seed_hex"]))._key
        self.assertEqual(note.sign(v["checkpoint_body"], note.parse_vkey(v["log_vkey"]).name, log_key), v["signed_checkpoint"])
        n = note.parse(v["cosigned_checkpoint"])
        n.verify_signed_by(note.parse_vkey(v["log_vkey"]))
        self.assertEqual(n.verify_cosignature(note.parse_vkey(v["witness_vkey"])), v["cosignature_time"])
        self.assertEqual(note.cosignature_message(n.text, v["cosignature_time"]).decode(), v["cosigned_message"])
        w_key = sigs.ed25519_from_seed(bytes.fromhex(v["witness_key_seed_hex"]))._key
        line = note.cosign(n.text, note.parse_vkey(v["witness_vkey"]).name, w_key, v["cosignature_time"])
        self.assertIn(line.line, v["cosigned_checkpoint"])

    def test_statement(self):
        v = vector("statement.json")
        payload = v["payload_canonical"].encode()
        st = posture.validate(payload)
        self.assertEqual(st.predicate_type, v["predicate_type"])
        self.assertEqual(posture.payload_digest(payload).hex(), v["payload_sha256_hex"])
        env = dsse.parse(v["envelope_canonical"].encode())
        env.verify_signature(0, sigs.parse_public_key_b64(v["device_key"]["spki"]))
        digest = tlog.entry_digest(env)
        self.assertEqual(digest.hex(), v["entry_digest_hex"])
        self.assertEqual(tlog.leaf_hash(digest).hex(), v["leaf_hash_hex"])
        tok = canon.parse_container(json.dumps(v["timestamp_token"]).encode())
        trusted = [tsa.Trusted("tsa-vector.example", tsa.KIND_SIMULATED, sigs.parse_public_key_b64(v["tsa_key"]["spki"]))]
        tsa.verify(tok, digest, trusted)
        self.assertEqual(tsa.simulated_message(tok["tst"]).decode(), v["tsa_signed_message"])
        posture.validate(v["scan_payload_canonical"].encode())
        dsse.parse(v["scan_envelope_canonical"].encode()).verify_signature(0, sigs.parse_public_key_b64(v["scanner_key"]["spki"]))
        for r in v["must_reject_payloads"]:
            with self.assertRaises(posture.ContentError, msg=r["name"]):
                posture.validate(r["payload"].encode())

    def test_mini_pack(self):
        exp = vector("mini-pack-expected.json")
        trust = pack.parse_trust_policy((VECTORS / "mini-trust-policy.json").read_bytes())
        raw = (VECTORS / "mini-pack.json").read_bytes()
        p = pack.parse(raw)
        self.assertEqual(p.to_json(), raw, "pack serialization must be byte-identical to Go's")
        r = pack.verify(p, trust)
        self.assertEqual({s.id: s.status for s in r.steps}, exp["steps"])
        self.assertEqual(canon.encode(r.computed), canon.encode(exp["summary"]))
        tm = exp["tampered"]
        for e in p.entries:
            if e.evidence.index == tm["entry_index"]:
                e.evidence.envelope.payload = e.evidence.envelope.payload.replace(b'"disk_encryption":"on"', b'"disk_encryption":"off"', 1)
        self.assertEqual(pack.verify(p, trust).failed_steps(), tm["failed_steps"])


if __name__ == "__main__":
    unittest.main()
