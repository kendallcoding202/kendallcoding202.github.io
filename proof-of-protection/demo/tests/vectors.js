// Runs the browser verifier (the same files the page loads) against the
// cross-language test vectors in engine/testdata/vectors, under Node's
// built-in WebCrypto. Usage: node tests/vectors.js
const fs = require("fs"), path = require("path"), vm = require("vm");

const demo = path.resolve(__dirname, "..");
const vectors = path.join(path.dirname(demo), "engine", "testdata", "vectors");
for (const f of ["verifier/schema.js", "verifier/strict-json.js", "verifier/crypto.js", "verifier/merkle.js", "verifier/note.js", "verifier/posture.js", "verifier/verify.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(demo, f), "utf8").replace(/^window\./gm, "globalThis."), { filename: f });
}
const P = globalThis.Proof, C = P.crypto;
const load = (n) => JSON.parse(fs.readFileSync(path.join(vectors, n), "utf8"));
const b64 = (s) => C.b64decode(s);
let failures = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failures++; console.log("  FAIL " + msg); } };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const throwsAsync = async (fn) => { try { await fn(); return false; } catch (e) { return true; } };

(async () => {
  // Schema: the embedded copy is the Go schema.
  const schema = load("posture-schema.json");
  check(JSON.stringify(globalThis.ProofSchema.statements) === JSON.stringify(schema.statements), "schema.js matches posture-schema.json");
  check(globalThis.ProofSchema.predicate_types.posture === schema.predicate_types.posture, "predicate type matches");

  // Canonicalization.
  const cv = load("canonicalization.json");
  for (const c of cv.canonicalize) {
    const out = P.canonical(P.parseStrictJSON(c.input));
    check(out === c.canonical, "canonicalize " + c.name);
    check(C.hex(await C.sha256(P.utf8(out))) === c.sha256, "sha256 " + c.name);
  }
  for (const c of cv.reject_as_canonical.concat(cv.reject_in_signed_data_always)) check(throws(() => P.parseCanonical(P.utf8(c.input))), "reject " + c.name);

  // DSSE.
  const dv = load("dsse.json");
  const pae = (t, p) => C.concat(P.utf8("DSSEv1 " + t.length + " " + t + " " + p.length + " "), p);
  check(C.hex(pae(dv.payload_type, b64(dv.payload))) === dv.pae_hex, "PAE");
  for (const s of dv.signatures) {
    const k = await C.importSpki(s.key.spki);
    check(k.keyid === s.key.keyid, "keyid " + s.key.alg);
    const env = P.parseCanonical(P.utf8(s.envelope_canonical));
    check((await C.verify(k, pae(env.payloadType, b64(env.payload)), b64(env.signatures[0].sig))).ok, "signature verifies " + s.key.alg);
  }
  for (const s of dv.must_reject) {
    const k = await C.importSpki(s.spki);
    check(!(await C.verify(k, C.unhex(dv.pae_hex), b64(s.sig))).ok, "reject " + s.name);
  }

  // Merkle.
  const mv = load("merkle.json");
  const leaves = [];
  for (let i = 0; i < mv.leaves_hex.length; i++) {
    const h = await P.merkle.leafHash(C.unhex(mv.leaves_hex[i]));
    check(C.hex(h) === mv.leaf_hashes_hex[i], "leaf hash " + i);
    leaves.push(h);
  }
  const tree = new P.merkle.Tree(leaves);
  for (let n = 1; n <= leaves.length; n++) check(C.hex(await tree.root(n)) === mv.roots_hex_by_size[n - 1], "root " + n);
  const root = (n) => C.unhex(mv.roots_hex_by_size[n - 1]);
  for (const c of mv.inclusion) {
    const proof = c.proof.map(b64);
    check((await tree.inclusionProof(c.index, c.size)).map(C.b64encode).join() === c.proof.join(), "inclusion proof generated " + c.index + "/" + c.size);
    check(await P.merkle.verifyInclusion(c.index, c.size, leaves[c.index], proof, root(c.size)), "inclusion verifies " + c.index + "/" + c.size);
  }
  for (const c of mv.consistency) {
    const proof = c.proof.map(b64);
    check((await tree.consistencyProof(c.from, c.to)).map(C.b64encode).join() === c.proof.join(), "consistency proof generated " + c.from + "->" + c.to);
    check(await P.merkle.verifyConsistency(c.from, c.to, proof, root(c.from), root(c.to)), "consistency verifies " + c.from + "->" + c.to);
  }

  // Notes, checkpoints, cosignatures.
  const nv = load("note.json");
  const ex = nv.c2sp_signed_note_example;
  check((await P.note.verifySignedBy(P.note.parseNote(ex.note), await P.note.parseVKey(ex.vkey))).ok, "C2SP example note");
  const cn = P.note.parseNote(nv.cosigned_checkpoint);
  check((await P.note.verifySignedBy(cn, await P.note.parseVKey(nv.log_vkey))).ok, "checkpoint signature");
  const cs = await P.note.verifyCosignature(cn, await P.note.parseVKey(nv.witness_vkey));
  check(cs.ok && cs.time === nv.cosignature_time, "witness cosignature");
  check(P.note.parseCheckpoint(cn.text).size === 12, "checkpoint body");

  // Statements.
  const sv = load("statement.json");
  const payload = P.utf8(sv.payload_canonical);
  check(!throws(() => P.posture.validate(payload)), "statement validates");
  check(C.hex(await C.sha256(payload)) === sv.payload_sha256_hex, "chain hash");
  const env = P.parseCanonical(P.utf8(sv.envelope_canonical));
  const digest = await C.sha256(P.utf8(sv.envelope_canonical));
  check(C.hex(digest) === sv.entry_digest_hex, "entry digest");
  check(C.hex(await P.merkle.leafHash(digest)) === sv.leaf_hash_hex, "leaf hash");
  const dk = await C.importSpki(sv.device_key.spki);
  check((await C.verify(dk, pae(env.payloadType, b64(env.payload)), b64(env.signatures[0].sig))).ok, "statement signature");
  check(!throws(() => P.posture.validate(P.utf8(sv.scan_payload_canonical))), "scan statement validates");
  for (const r of sv.must_reject_payloads) check(throws(() => P.posture.validate(P.utf8(r.payload))), "reject " + r.name);
  check("simulated-tsa/v1\n" + P.canonical(sv.timestamp_token.tst) === sv.tsa_signed_message, "TSA signed message");

  // The mini Proof Pack, genuine and tampered.
  const exp = load("mini-pack-expected.json");
  const trust = await P.verifier.parseTrust(P.parseStrictJSON(fs.readFileSync(path.join(vectors, "mini-trust-policy.json"), "utf8")));
  const packValue = P.parseStrictJSON(fs.readFileSync(path.join(vectors, "mini-pack.json"), "utf8"));
  let r = await P.verifier.verify(P.verifier.parsePack(packValue), trust);
  check(r.steps.every((s) => s.status === exp.steps[s.id]), "mini pack step statuses");
  check(P.canonical(r.computed) === P.canonical(exp.summary), "mini pack summary");
  const tampered = P.deepClone(packValue);
  for (const e of tampered.entries) {
    if (e.index === exp.tampered.entry_index) {
      const text = P.fromUtf8(b64(e.envelope.payload)).replace('"disk_encryption":"on"', '"disk_encryption":"off"');
      e.envelope.payload = C.b64encode(P.utf8(text));
    }
  }
  r = await P.verifier.verify(P.verifier.parsePack(tampered), trust);
  check(r.steps.filter((s) => s.status === "fail").map((s) => s.id).join() === exp.tampered.failed_steps.join(), "tampered mini pack fails at " + exp.tampered.failed_steps.join(", "));
  check(await throwsAsync(async () => P.verifier.parsePack(P.parseStrictJSON('{"pack_type":"proof-pack/v1"}'))), "malformed pack rejected");

  console.log(failures ? failures + " vector check(s) FAILED (" + passed + " passed)" : "all " + passed + " vector checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
