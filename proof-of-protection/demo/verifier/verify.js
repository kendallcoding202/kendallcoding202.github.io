// Proof Pack verification in the browser. A line-by-line mirror of
// engine/pack (Parse, Verify, summarize): same steps, same order, same
// rules, same messages, so the browser and the Go CLI reach the same
// verdict on the same file. Nothing here trusts the pack for keys: the
// trust policy is loaded separately (a production verifier pins it).
(function (P) {
  "use strict";
  const C = P.crypto, M = P.merkle, N = P.note, S = P.posture, has = P.has;
  const IN_TOTO = "application/vnd.in-toto+json";
  const PACK_TYPE = "proof-pack/v1";
  const POLICY_TYPE = "proof-trust-policy/v1";
  const DAY = 86400000;

  // ---------- strict containers ----------

  function fields(v, what, keys) {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(what + " must be an object");
    if (Object.keys(v).length !== keys.length) throw new Error(what + " must have exactly the fields " + keys.join(", "));
    for (const k of keys) if (!has(v, k)) throw new Error(what + " is missing " + JSON.stringify(k));
    return v;
  }

  function decodeHashes(v) {
    if (!Array.isArray(v) || v.length > 64) throw new Error("proof must be an array of base64 hashes");
    return v.map((s) => { const b = C.b64decode(s); if (b.length !== 32) throw new Error("proof hash is not 32 bytes"); return b; });
  }

  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

  function envelopeFromValue(v) {
    fields(v, "envelope", ["payload", "payloadType", "signatures"]);
    if (typeof v.payloadType !== "string") throw new Error("envelope: payloadType must be a printable ASCII string");
    P.canonical(v.payloadType);
    if (!Array.isArray(v.signatures) || v.signatures.length === 0) throw new Error("envelope: signatures must be a non-empty array");
    const signatures = v.signatures.map((s, i) => {
      fields(s, "envelope signature " + i, ["keyid", "sig"]);
      if (typeof s.keyid !== "string") throw new Error("envelope signature " + i + ": keyid must be a string");
      P.canonical(s.keyid);
      return { keyid: s.keyid, sig: C.b64decode(s.sig) };
    });
    return { payloadType: v.payloadType, payload: C.b64decode(v.payload), signatures, value: v };
  }

  // parsePack mirrors pack.Parse: exact fields, strict values.
  function parsePack(v) {
    fields(v, "pack", ["pack_type", "canonicalization", "product", "sample", "issued_at", "range", "tenant", "log", "entries", "summary"]);
    if (v.pack_type !== PACK_TYPE) throw new Error("not a " + PACK_TYPE + " file");
    if (v.canonicalization !== P.CANON_VERSION) throw new Error("unsupported canonicalization");
    if (typeof v.product !== "string" || typeof v.sample !== "boolean" || !S.parseTime(v.issued_at)) throw new Error("bad pack header");
    fields(v.range, "range", ["from", "to"]);
    if (!isDate(v.range.from) || !isDate(v.range.to) || v.range.to < v.range.from) throw new Error("range must be two dates YYYY-MM-DD, in order");
    fields(v.tenant, "tenant", ["id", "display_name", "display_name_salt"]);
    fields(v.log, "log", ["origin", "checkpoint", "earlier_checkpoints"]);
    if (!Array.isArray(v.log.earlier_checkpoints) || !Array.isArray(v.entries)) throw new Error("bad pack lists");
    const earlier = v.log.earlier_checkpoints.map((e) => {
      fields(e, "earlier checkpoint", ["checkpoint", "consistency_proof"]);
      return { checkpoint: e.checkpoint, proof: decodeHashes(e.consistency_proof) };
    });
    const entries = v.entries.map((e, i) => {
      fields(e, "entry " + i, ["index", "envelope", "timestamps", "inclusion_proof"]);
      if (!Number.isSafeInteger(e.index) || e.index < 0) throw new Error("entry " + i + ": index must be a non-negative integer");
      if (!Array.isArray(e.timestamps)) throw new Error("entry " + i + ": timestamps must be an array");
      e.timestamps.forEach((t) => { if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("timestamp token must be an object"); P.canonical(t); });
      return { index: e.index, envelope: envelopeFromValue(e.envelope), timestamps: e.timestamps, proof: decodeHashes(e.inclusion_proof) };
    });
    return {
      sample: v.sample, product: v.product, issuedAt: v.issued_at, from: v.range.from, to: v.range.to,
      tenantId: v.tenant.id, displayName: v.tenant.display_name, displayNameSalt: v.tenant.display_name_salt,
      logOrigin: v.log.origin, checkpoint: v.log.checkpoint, earlier, entries, summary: v.summary,
    };
  }

  async function parseTrust(v) {
    fields(v, "trust policy", ["policy_type", "demo_only", "log", "witnesses", "witness_quorum", "timestamp_authorities", "timestamp_quorum", "limits"]);
    if (v.policy_type !== POLICY_TYPE) throw new Error("not a " + POLICY_TYPE + " file");
    fields(v.log, "log", ["origin", "vkey"]);
    const logKey = await N.parseVKey(v.log.vkey);
    if (logKey.type !== N.TYPE_ED25519 || logKey.name !== v.log.origin) throw new Error("trust policy: log vkey must be an Ed25519 note key named after the log origin");
    const witnesses = [];
    for (const w of v.witnesses) {
      fields(w, "witness", ["name", "vkey", "label", "simulated"]);
      const vk = await N.parseVKey(w.vkey);
      if (vk.type !== N.TYPE_COSIG || vk.name !== w.name) throw new Error("trust policy: bad witness key for " + w.name);
      witnesses.push({ name: w.name, label: w.label, simulated: w.simulated, vk });
    }
    const tsas = [];
    for (const a of v.timestamp_authorities) {
      fields(a, "timestamp authority", ["name", "kind", "public_key", "label", "simulated"]);
      tsas.push({ name: a.name, kind: a.kind, label: a.label, simulated: a.simulated, key: await C.importSpki(a.public_key) });
    }
    fields(v.limits, "limits", ["max_report_delay_s", "max_clock_skew_s", "max_tsa_spread_s"]);
    const t = {
      demoOnly: v.demo_only, logOrigin: v.log.origin, logKey, witnesses, witnessQuorum: v.witness_quorum, tsas, tsaQuorum: v.timestamp_quorum,
      maxDelay: v.limits.max_report_delay_s * 1000, maxSkew: v.limits.max_clock_skew_s * 1000, maxSpread: v.limits.max_tsa_spread_s * 1000,
    };
    if (!(t.witnessQuorum >= 1 && t.witnessQuorum <= witnesses.length)) throw new Error("trust policy: witness quorum must be between 1 and the number of witnesses");
    if (!(t.tsaQuorum >= 2 && t.tsaQuorum <= tsas.length)) throw new Error("trust policy: at least two independent timestamp authorities are required");
    if (!(t.maxDelay > 0 && t.maxSkew >= 0 && t.maxSpread > 0)) throw new Error("trust policy: limits must be positive");
    return t;
  }

  // ---------- formatting (matches the Go wording) ----------

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDay = (d) => MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  const fmtTime = (d) => fmtDay(d) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC";
  const plural = (n) => (n === 1 ? "" : "s");
  function fmtDuration(ms) {
    if (ms < 60000) return Math.floor(ms / 1000) + " seconds";
    const days = Math.floor(ms / DAY), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60;
    const parts = [];
    if (days > 0) parts.push(days + " day" + plural(days));
    if (h > 0) parts.push(h + " h");
    if (m > 0) parts.push(m + " min");
    return parts.join(" ");
  }
  const dateOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const isoDate = (d) => d.toISOString().slice(0, 10);

  const CLASS = { laptop: "Laptop", desktop: "Desktop", server: "Server" };
  const ROLE = { owner: "Owner", office_manager: "Office manager", bookkeeper: "Bookkeeper" };
  function attesterLabel(a) {
    if (a.kind === "device_agent") return (CLASS[a.cls] || "Device") + " D" + pad(a.number);
    if (a.kind === "cloud_connector") return "Microsoft 365 connector";
    if (a.kind === "external_scanner") return "External scan";
    if (a.kind === "staff_attester") return (ROLE[a.role] || "Staff") + " (staff attestation)";
    return a.id;
  }

  const CHECK_LABEL = {
    disk_encryption: "disk encryption off", edr_running: "antivirus/EDR not running", firewall: "firewall off",
    os_patch: "operating system out of date", remote_tools: "unapproved remote-control tool", screen_lock: "screen lock off",
    devices_not_enrolled: "known devices not enrolled", mailbox_alert_open: "mailbox-takeover alert open", mfa: "accounts without MFA",
    unknown_device: "unknown device seen", payment_not_verified: "payment request not called back", restore_drill_failed: "restore drill failed",
    external_check_failed: "an external check failed",
  };

  // ---------- decoding ----------

  // decode turns a parsed pack into items with statements and labels. It
  // does no cryptography, so the page can render the evidence at once.
  function decode(pack) {
    const items = pack.entries.map((e) => {
      const it = { e, index: e.index, env: e.envelope, st: null, stErr: null, sigOK: false, enrolOK: false, tsOK: false, inclOK: false, tsTime: null };
      if (e.envelope.payloadType !== IN_TOTO) it.stErr = new Error("payload type " + JSON.stringify(e.envelope.payloadType) + " is not an in-toto statement");
      else { try { it.st = S.validate(e.envelope.payload); } catch (err) { it.stErr = err; } }
      it.kind = it.st && !it.st.isPosture ? it.st.str("kind") : "";
      it.posture = !!(it.st && it.st.isPosture);
      return it;
    });
    const attesters = new Map(), genesis = [], dupEnroll = [];
    for (const it of items) {
      if (it.kind === "tenant_genesis") genesis.push(it);
      if (it.kind === "attester") {
        let b64 = it.st.str("attester_key");
        try { C.spkiInfo(C.b64decode(b64)); } catch (e) { continue; }
        const id = it.st.str("attester");
        if (attesters.has(id)) { dupEnroll.push(it); continue; }
        attesters.set(id, { id, kind: it.st.str("attester_kind"), keyB64: b64, it, cls: it.st.str("device_class"),
          number: it.st.int("device_number"), role: it.st.str("staff_role"), platform: it.st.str("platform"), protect: it.st.str("key_protection") });
      }
    }
    const labels = new Map();
    for (const [id, a] of attesters) { a.label = attesterLabel(a); labels.set(id, a.label); }
    const name = (id) => labels.get(id) || id;
    for (const it of items) {
      if (!it.st) it.label = "Log entry " + it.index;
      else if (it.posture) it.label = name(it.st.str("attester")) + " report #" + it.st.int("seq") + " (" + fmtDay(it.st.time("observed_at")) + ")";
      else if (it.kind === "tenant_genesis") it.label = "The firm's enrollment record";
      else it.label = "Enrollment of " + name(it.st.str("attester"));
    }
    return { pack, items, attesters, genesis, dupEnroll, name };
  }

  // ---------- verification ----------

  function newStep(def) { return { id: def.ID, title: def.Title, status: "pass", checked: 0, detail: "", problems: [], notes: [] }; }
  function failStep(s, msg) { s.status = "fail"; s.problems.push(msg); }

  async function nameCommitment(name, salt) {
    return C.hex(await C.sha256(P.utf8("tenant-name-commitment/v1\n" + salt + "\n" + name)));
  }

  // verify runs every step; onStep(step) is called as each one finishes.
  async function verify(pack, trust, onStep) {
    const d = decode(pack);
    const { items, attesters } = d;
    const steps = globalThis.ProofSchema.steps.map(newStep);
    const step = Object.fromEntries(steps.map((s) => [s.id, s]));
    const report = { verified: false, tenant: pack.tenantId, display_name: pack.displayName, from: pack.from, to: pack.to, sample: pack.sample, steps, computed: null, decoded: d, gaps: [] };
    const done = async (id) => { if (onStep) await onStep(step[id], report); };

    // Keys from this tenant's enrollment records.
    let tenantKey = null;
    const keyById = new Map();
    for (const it of d.genesis) {
      if (it.st.str("tenant") === pack.tenantId && !tenantKey) {
        try { tenantKey = await C.importSpki(it.st.str("tenant_key")); keyById.set(tenantKey.keyid, tenantKey); } catch (e) { /* reported below */ }
      }
    }
    for (const a of attesters.values()) {
      try { a.key = await C.importSpki(a.keyB64); keyById.set(a.key.keyid, a.key); } catch (e) { a.key = null; }
    }

    // 1. Signatures.
    let s = step.signatures;
    const algs = { "ecdsa-p256-sha256": 0, ed25519: 0 };
    for (const it of items) {
      const env = it.env, pae = dssePAE(env.payloadType, env.payload);
      const sigOK = async (i, k) => env.signatures[i] && env.signatures[i].keyid === k.keyid && (await C.verify(k, pae, env.signatures[i].sig)).ok;
      let ok = false;
      if (it.kind === "tenant_genesis") {
        s.checked++;
        let k = null;
        try { k = await C.importSpki(it.st.str("tenant_key")); } catch (e) { /* invalid */ }
        ok = env.signatures.length === 1 && k !== null && (await sigOK(0, k));
        if (ok) algs[k.alg]++;
      } else if (it.kind === "attester") {
        const a = attesters.get(it.st.str("attester"));
        s.checked += 2;
        if (!tenantKey) failStep(s, it.label + ": there is no firm enrollment to check the firm's signature against");
        else if (env.signatures.length !== 2 || !(await sigOK(0, tenantKey))) failStep(s, it.label + ": not signed by the firm's enrollment key");
        else if (!a || !a.key || !(await sigOK(1, a.key))) failStep(s, it.label + ": the enrolled key did not prove possession (second signature invalid)");
        else { ok = true; algs[tenantKey.alg]++; algs[a.key.alg]++; }
      } else {
        s.checked++;
        let key = null;
        if (it.posture) { const a = attesters.get(it.st.str("attester")); if (a && a.key) key = a.key; }
        if (!key && env.signatures.length > 0) key = keyById.get(env.signatures[0].keyid) || null;
        if (env.signatures.length !== 1) failStep(s, it.label + ": expected exactly one signature, found " + env.signatures.length);
        else if (!key) failStep(s, it.label + ": signed by a key that is not enrolled for this firm");
        else if (env.signatures[0].keyid !== key.keyid) failStep(s, it.label + ": signed by a different key than the one enrolled for this device");
        else {
          const r = await C.verify(key, pae, env.signatures[0].sig);
          if (!r.ok) failStep(s, it.label + ": the signature does not match the content, so the report was changed after it was signed (" + r.why + ")");
          else { ok = true; algs[key.alg]++; }
        }
      }
      it.sigOK = ok;
    }
    s.detail = s.status === "pass"
      ? s.checked + " of " + s.checked + " signatures valid (ECDSA P-256: " + algs["ecdsa-p256-sha256"] + ", Ed25519: " + algs.ed25519 + ")"
      : "Signature problems in " + s.problems.length + " of " + items.length + " entries";
    await done("signatures");

    // 2. Content rules.
    s = step.content;
    for (const it of items) { s.checked++; if (it.stErr) failStep(s, it.label + ": " + it.stErr.message); }
    s.detail = s.status === "pass"
      ? "All " + s.checked + " statements carry only yes/no answers, counts, categories and times; no names, paths or free text"
      : s.problems.length + " statements break the content rules";
    await done("content");

    // 3. Enrollment.
    await verifyEnrollment(pack, step.enrollment, d, tenantKey);
    await done("enrollment");

    // 4. Sequence and replay.
    await verifySequence(step.sequence, d);
    await done("sequence");

    // 5. Timestamps.
    await verifyTimestamps(step.timestamps, items, trust);
    await done("timestamps");

    // 6-9. The log.
    const cp = await verifyCheckpoint(step.checkpoint, pack, trust);
    await verifyInclusion(step.inclusion, items, cp);
    await done("inclusion");
    await done("checkpoint");
    await verifyConsistency(step.consistency, pack, trust, cp);
    await done("consistency");
    await verifyWitnesses(step.witnesses, cp.note, trust);
    await done("witnesses");

    // 10. Gaps and summary.
    const sum = summarize(pack, d);
    report.computed = sum.value;
    report.gaps = sum.gaps;
    verifySummary(step.gaps, pack, report, d);
    await done("gaps");

    report.simulated = trust.witnesses.filter((w) => w.simulated).map((w) => "witness " + w.name)
      .concat(trust.tsas.filter((a) => a.simulated).map((a) => "timestamp authority " + a.name));
    report.verified = steps.every((x) => x.status !== "fail");
    return report;
  }

  function dssePAE(type, payload) {
    const head = P.utf8("DSSEv1 " + P.utf8(type).length + " " + type + " " + payload.length + " ");
    return C.concat(head, payload);
  }

  async function verifyEnrollment(pack, s, d, tenantKey) {
    const { items, attesters, genesis, dupEnroll } = d;
    let g = null;
    if (genesis.length === 0) failStep(s, "The pack has no firm enrollment (tenant genesis) record");
    else if (genesis.length > 1) failStep(s, "The pack has " + genesis.length + " firm enrollment records; there must be exactly one");
    else g = genesis[0];
    if (g) {
      s.checked++;
      if (g.st.str("tenant") !== pack.tenantId || !tenantKey) failStep(s, "The firm enrollment is for a different firm (" + g.st.str("tenant") + ")");
      else if ("tnt_" + tenantKey.keyid.slice(0, 16) !== pack.tenantId) failStep(s, "The firm ID is not derived from the firm's enrollment key");
      else g.enrolOK = true;
      if ((await nameCommitment(pack.displayName, pack.displayNameSalt)) !== g.st.str("display_name_commitment")) {
        failStep(s, "The firm name in this pack (" + JSON.stringify(pack.displayName) + ") is not the name committed at enrollment");
      }
    }
    for (const it of dupEnroll) failStep(s, it.label + ": the same key was enrolled twice");
    const counts = { device_agent: 0, cloud_connector: 0, external_scanner: 0, staff_attester: 0 };
    let software = 0;
    for (const a of attesters.values()) {
      const it = a.it;
      s.checked++;
      if (it.st.str("tenant") !== pack.tenantId) failStep(s, it.label + ": enrolled in a different firm");
      else if (!a.key || S.PREFIX[a.kind] + a.key.keyid.slice(0, 16) !== a.id) failStep(s, it.label + ": the device ID is not derived from its key");
      else if (g && (it.index <= g.index || it.st.time("enrolled_at") < g.st.time("enrolled_at"))) failStep(s, it.label + ": enrolled before the firm itself was");
      else {
        it.enrolOK = !!(g && g.enrolOK);
        counts[a.kind] = (counts[a.kind] || 0) + 1;
        if (a.kind === "device_agent") software++;
      }
    }
    let latestConn = null;
    for (const it of items) {
      if (!it.posture) continue;
      s.checked++;
      const a = attesters.get(it.st.str("attester"));
      if (it.st.str("tenant") !== pack.tenantId) failStep(s, it.label + ": belongs to a different firm");
      else if (!a) failStep(s, it.label + ": comes from a device or service with no enrollment record in this pack");
      else if (a.kind !== it.st.str("attester_kind")) failStep(s, it.label + ": does not match how the attester was enrolled");
      else if (a.it.index >= it.index || it.st.time("observed_at") < a.it.st.time("enrolled_at")) failStep(s, it.label + ": dated before the device was enrolled");
      else {
        it.enrolOK = a.it.enrolOK;
        if (a.kind === "cloud_connector" && it.sigOK && (!latestConn || it.st.time("observed_at") > latestConn.st.time("observed_at"))) latestConn = it;
      }
    }
    if (latestConn) {
      const known = latestConn.st.int("tenant_posture.devices_known"), enrolled = latestConn.st.int("tenant_posture.devices_enrolled");
      if (counts.device_agent < enrolled) failStep(s, "Microsoft 365 reports " + enrolled + " enrolled devices but this pack includes only " + counts.device_agent + "; a device was left out");
      s.notes.push("Coverage: " + enrolled + " of " + known + " devices known to Microsoft 365 are enrolled");
      const unknown = latestConn.st.int("tenant_posture.devices_unknown_seen");
      if (unknown > 0) s.notes.push(unknown + " unknown device(s) seen signing in");
    }
    if (software > 0) s.notes.push(software + " device key(s) are software keys (prototype). Production devices use TPM 2.0 or Secure Enclave keys, checked against the chip maker's certificate");
    s.detail = s.status === "pass"
      ? "1 firm, " + counts.device_agent + " devices, " + counts.cloud_connector + " cloud connector, " + counts.external_scanner + " external scanner, " + counts.staff_attester + " staff attester enrolled; every statement comes from an enrolled key"
      : s.problems.length + " enrollment problem(s)";
  }

  async function verifySequence(s, d) {
    const { items, attesters, name } = d;
    const nonces = new Map(), chains = new Map();
    for (const it of items) {
      if (!it.st) continue;
      const n = it.st.str("nonce");
      if (nonces.has(n)) {
        const first = nonces.get(n);
        if (C.equalBytes(first.env.payload, it.env.payload)) {
          failStep(s, first.label + " was logged a second time at log position " + it.index + " (first at " + first.index + "): an old report was replayed");
          continue;
        }
        failStep(s, it.label + " reuses the one-time server challenge of " + first.label + ", so it is a replay");
      } else nonces.set(n, it);
      if (it.posture) {
        const id = it.st.str("attester");
        if (!chains.has(id)) chains.set(id, []);
        chains.get(id).push(it);
      }
    }
    let total = 0;
    for (const id of Array.from(chains.keys()).sort()) {
      const chain = chains.get(id).slice().sort((a, b) => (a.st.int("seq") - b.st.int("seq")) || (a.index - b.index));
      total += chain.length;
      const nm = name(id), first = chain[0];
      if (first.st.int("seq") === 1) {
        const a = attesters.get(id);
        if (a && first.st.str("prev") !== C.hex(await C.sha256(a.it.env.payload))) failStep(s, first.label + " does not link back to the device's enrollment record");
      } else {
        s.notes.push(nm + ": chain starts at report #" + first.st.int("seq") + " (earlier reports are outside this pack's dates)");
      }
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1], b = chain[i], sa = a.st.int("seq"), sb = b.st.int("seq");
        if (sb === sa) failStep(s, "Two different reports both claim to be " + b.label + " (log positions " + a.index + " and " + b.index + ")");
        else if (sb > sa + 1) {
          if (sb === sa + 2) failStep(s, nm + ": report #" + (sa + 1) + " is missing from this pack; report #" + sb + " says it follows it (deleted or withheld)");
          else failStep(s, nm + ": reports #" + (sa + 1) + " to #" + (sb - 1) + " are missing from this pack (deleted or withheld)");
        } else {
          if (b.st.str("prev") !== C.hex(await C.sha256(a.env.payload))) failStep(s, b.label + " does not link to report #" + sa + " before it; the history was altered");
          if (b.index < a.index || b.st.time("observed_at") < a.st.time("observed_at")) failStep(s, b.label + " is out of order with report #" + sa);
        }
      }
    }
    s.checked = total;
    s.detail = s.status === "pass"
      ? total + " reports from " + chains.size + " devices and services: numbered in order, each linked to the one before, no repeats, nothing missing"
      : s.problems.length + " sequence problem(s)";
  }

  async function entryDigest(env) { return C.sha256(P.utf8(P.canonical(env.value))); }

  async function verifyToken(tok, imprintHex, trust) {
    if (!tok || typeof tok !== "object") throw new Error("unknown timestamp token kind");
    if (tok.kind === "rfc3161") throw new Error("RFC 3161 tokens are specified but not verified by this prototype");
    if (tok.kind !== "simulated-tsa/v1") throw new Error("unknown timestamp token kind " + JSON.stringify(tok.kind));
    if (Object.keys(tok).length !== 3) throw new Error("timestamp token must have exactly kind, sig and tst");
    const tst = tok.tst;
    if (!tst || typeof tst !== "object" || Object.keys(tst).length !== 4) throw new Error("timestamp token tst must have exactly gen_time, imprint, serial and tsa");
    const t = trust.tsas.find((a) => a.name === tst.tsa && a.kind === "simulated-tsa/v1");
    if (!t) throw new Error("timestamp from untrusted authority " + JSON.stringify(tst.tsa));
    const sig = C.b64decode(tok.sig);
    const msg = P.utf8("simulated-tsa/v1\n" + P.canonical(tst));
    const r = await C.verify(t.key, msg, sig);
    if (!r.ok) throw new Error("timestamp from " + tst.tsa + ": " + r.why);
    if (tst.imprint !== imprintHex) throw new Error("timestamp from " + tst.tsa + " is for a different document");
    if (!Number.isSafeInteger(tst.serial)) throw new Error("timestamp serial is not an integer");
    const gt = S.parseTime(tst.gen_time);
    if (!gt) throw new Error("timestamp from " + tst.tsa + ": bad timestamp");
    return { tsa: tst.tsa, time: gt };
  }

  async function verifyTimestamps(s, items, trust) {
    let tokens = 0;
    for (const it of items) {
      s.checked++;
      it.digest = await entryDigest(it.env);
      const imprint = C.hex(it.digest);
      const valid = new Map();
      let firstErr = null;
      for (const tok of it.e.timestamps) {
        try {
          const v = await verifyToken(tok, imprint, trust);
          if (!valid.has(v.tsa)) valid.set(v.tsa, v.time);
        } catch (e) { if (!firstErr) firstErr = e; }
      }
      if (valid.size < trust.tsaQuorum) {
        failStep(s, it.label + ": " + valid.size + " valid timestamp(s) from independent authorities, " + trust.tsaQuorum + " required" + (firstErr ? " (" + firstErr.message + ")" : ""));
        continue;
      }
      const times = Array.from(valid.values());
      const lo = new Date(Math.min(...times)), hi = new Date(Math.max(...times));
      tokens += valid.size;
      it.tsTime = lo;
      if (hi - lo > trust.maxSpread) { failStep(s, it.label + ": the two timestamp authorities disagree by " + fmtDuration(hi - lo)); continue; }
      if (!it.st) continue;
      const claimed = it.st.isPosture ? it.st.time("observed_at") : it.st.time("enrolled_at");
      if (lo - claimed > trust.maxDelay) {
        failStep(s, it.label + " says it was made " + fmtTime(claimed) + ", but the timestamp authorities first saw it " + fmtTime(lo) + ", " + fmtDuration(lo - claimed) + " later: it was backdated or replayed");
      } else if (claimed - lo > trust.maxSkew) {
        failStep(s, it.label + " is dated " + fmtTime(claimed) + ", after the timestamp authorities saw it (" + fmtTime(lo) + ")");
      } else it.tsOK = true;
    }
    s.detail = s.status === "pass"
      ? tokens + " timestamps valid: every entry was stamped by " + trust.tsaQuorum + " independent authorities within " + fmtDuration(trust.maxDelay) + " of when it says it was made"
      : s.problems.length + " timestamp problem(s)";
    if (trust.tsas.some((a) => a.simulated)) s.notes.push("The timestamp authorities are simulated in this prototype (local keys). Production uses independent RFC 3161 timestamp authorities");
  }

  async function verifyCheckpoint(s, pack, trust) {
    s.checked = 1;
    let note, cp;
    try { note = N.parseNote(pack.checkpoint); } catch (e) { failStep(s, "The checkpoint is malformed: " + e.message); s.detail = "No valid checkpoint"; return { ok: false }; }
    try { cp = N.parseCheckpoint(note.text); } catch (e) { failStep(s, "The checkpoint is malformed: " + e.message); s.detail = "No valid checkpoint"; return { ok: false, note }; }
    if (cp.origin !== trust.logOrigin || pack.logOrigin !== trust.logOrigin) failStep(s, "The checkpoint is for log " + JSON.stringify(cp.origin) + ", not the trusted log " + JSON.stringify(trust.logOrigin));
    const r = await N.verifySignedBy(note, trust.logKey);
    if (!r.ok) failStep(s, "The checkpoint is not validly signed by the log: " + r.why);
    s.detail = s.status === "pass" ? "Signed by " + cp.origin + "; the log held " + cp.size + " entries" : "The checkpoint signature is not valid";
    return { ok: true, cp, note };
  }

  async function verifyInclusion(s, items, latest) {
    const seen = new Map();
    for (const it of items) {
      s.checked++;
      if (!latest.ok) continue;
      if (seen.has(it.index)) { failStep(s, seen.get(it.index).label + " and " + it.label + " both claim log position " + it.index); continue; }
      seen.set(it.index, it);
      const leaf = await M.leafHash(it.digest || (await entryDigest(it.env)));
      if (!(await M.verifyInclusion(it.index, latest.cp.size, leaf, it.e.proof, latest.cp.root))) {
        failStep(s, it.label + ": does not match log entry " + it.index + ", so it is not the statement that was logged");
        continue;
      }
      it.inclOK = true;
    }
    if (!latest.ok) { failStep(s, "No valid checkpoint to check inclusion against"); s.detail = "Not checked"; }
    else s.detail = s.status === "pass" ? "All " + items.length + " entries are proven to be in the append-only log of " + latest.cp.size + " entries" : s.problems.length + " entries are not proven to be in the log";
    s.notes.push("The public log holds only fingerprints (SHA-256 of each statement); the results stay private until the firm shares them");
  }

  async function verifyConsistency(s, pack, trust, latest) {
    if (pack.earlier.length === 0) { s.status = "warn"; s.detail = "No earlier checkpoint was supplied, so this relies on the witnesses (next step)"; return; }
    for (const e of pack.earlier) {
      s.checked++;
      let note, cp;
      try { note = N.parseNote(e.checkpoint); cp = N.parseCheckpoint(note.text); } catch (err) { failStep(s, "An earlier checkpoint is malformed: " + err.message); continue; }
      let when = "";
      for (const w of trust.witnesses) {
        const r = await N.verifyCosignature(note, w.vk);
        if (r.ok) { when = " (witnessed " + fmtTime(new Date(r.time * 1000)) + ")"; break; }
      }
      const signed = await N.verifySignedBy(note, trust.logKey);
      if (!signed.ok || cp.origin !== trust.logOrigin) failStep(s, "The earlier checkpoint of " + cp.size + " entries is not signed by the trusted log");
      else if (!latest.ok) failStep(s, "No valid current checkpoint to compare the earlier one" + when + " against");
      else if (cp.size > latest.cp.size) failStep(s, "The log shrank from " + cp.size + " entries" + when + " to " + latest.cp.size + ": entries were removed");
      else if (!(await M.verifyConsistency(cp.size, latest.cp.size, e.proof, cp.root, latest.cp.root))) {
        failStep(s, "The checkpoint of " + cp.size + " entries saved earlier" + when + " is not consistent with today's log of " + latest.cp.size + ": entries were removed or changed after the fact");
      } else s.notes.push("The firm's saved checkpoint of " + cp.size + " entries" + when + " is a prefix of today's " + latest.cp.size + "-entry log");
    }
    s.detail = s.status === "pass" ? s.checked + " earlier checkpoint(s) proven consistent: nothing was removed or rewritten" : "The log's history does not match a checkpoint saved earlier";
  }

  async function verifyWitnesses(s, note, trust) {
    s.checked = trust.witnesses.length;
    let valid = 0;
    const bad = [];
    if (note) {
      for (const w of trust.witnesses) {
        const r = await N.verifyCosignature(note, w.vk);
        if (r.ok) { valid++; s.notes.push(w.label + " cosigned at " + fmtTime(new Date(r.time * 1000))); }
        else if (r.why.includes("does not verify")) bad.push(w.label + ": its cosignature is for a different checkpoint");
      }
    }
    if (valid < trust.witnessQuorum) {
      s.status = "fail";
      s.problems = bad.concat(["Only " + valid + " of " + trust.witnesses.length + " witnesses cosigned this checkpoint; " + trust.witnessQuorum + " are required. Witnesses refuse to cosign a log that rewrote its history"]);
      s.detail = valid + " of " + trust.witnesses.length + " witnesses (quorum of " + trust.witnessQuorum + " not met)";
    } else {
      s.notes.push(...bad);
      s.detail = valid + " of " + trust.witnesses.length + " independent witnesses cosigned the same log state (" + trust.witnessQuorum + " required)";
    }
    if (trust.witnesses.some((w) => w.simulated)) s.notes.push("The witnesses are simulated in this prototype (local keys)");
  }

  // ---------- summary (mirrors pack/summary.go) ----------

  function lapseChecks(st) {
    const out = [];
    switch (st.str("attester_kind")) {
      case "device_agent":
        if (st.str("device.disk_encryption") !== "on") out.push("disk_encryption");
        if (!st.bool("device.edr_running")) out.push("edr_running");
        if (!st.bool("device.firewall_on")) out.push("firewall");
        if (["out_of_date", "unsupported_os"].includes(st.str("device.os_patch_status"))) out.push("os_patch");
        if (st.int("device.unapproved_remote_tools.total") > 0) out.push("remote_tools");
        if (!st.bool("device.screen_lock_on")) out.push("screen_lock");
        break;
      case "cloud_connector":
        if (st.int("tenant_posture.devices_enrolled") < st.int("tenant_posture.devices_known")) out.push("devices_not_enrolled");
        if (st.int("tenant_posture.mailbox_alerts_open") > 0) out.push("mailbox_alert_open");
        if (st.int("tenant_posture.accounts_mfa") < st.int("tenant_posture.accounts_total")) out.push("mfa");
        if (st.int("tenant_posture.devices_unknown_seen") > 0) out.push("unknown_device");
        break;
      case "external_scanner": {
        const items = st.get("scan.results.items");
        if (Array.isArray(items) && items.some((r) => r && r.status === "fail")) out.push("external_check_failed");
        break;
      }
      case "staff_attester":
        if (st.str("staff_event.kind") === "verify_before_pay" && st.int("staff_event.verify_before_pay.callback_verified") < st.int("staff_event.verify_before_pay.requests")) out.push("payment_not_verified");
        if (st.str("staff_event.kind") === "backup_restore_drill" && st.str("staff_event.backup_restore_drill.result") !== "success") out.push("restore_drill_failed");
        break;
    }
    return out.sort();
  }

  // Attester kinds that must report every day; a day without a valid report
  // from one of them is a gap.
  const EXPECTED_DAILY = new Set(["device_agent", "cloud_connector", "external_scanner"]);

  // Evidence strength of an attester's facts. The prototype never grants
  // "hardware": that needs a verified TPM or Secure Enclave attestation.
  function strengthOf(a) {
    return { cloud_connector: "platform", staff_attester: "staff_attested", external_scanner: "scan_verified" }[a.kind] || "software";
  }

  function summarize(pack, d) {
    const from = new Date(pack.from + "T00:00:00Z"), to = new Date(pack.to + "T00:00:00Z");
    const evidence = d.items.filter((it) => {
      if (!(it.posture && it.sigOK && it.enrolOK && it.tsOK && it.inclOK)) return false;
      const day = dateOf(it.st.time("observed_at"));
      return day >= from && day <= to;
    });
    evidence.sort((a, b) => (a.st.time("observed_at") - b.st.time("observed_at")) ||
      (a.st.str("attester") < b.st.str("attester") ? -1 : a.st.str("attester") > b.st.str("attester") ? 1 : 0) || (a.st.int("seq") - b.st.int("seq")));
    const coverage = { connector_reports: 0, devices_known: 0, devices_enrolled: 0, devices_unknown_seen: 0, accounts_total: 0, accounts_mfa: 0, accounts_passkey: 0, device_enrollments: 0 };
    const covered = new Map(), lapses = [];
    for (const it of evidence) {
      const id = it.st.str("attester");
      if (!covered.has(id)) covered.set(id, new Set());
      covered.get(id).add(isoDate(dateOf(it.st.time("observed_at"))));
      if (it.st.str("attester_kind") === "cloud_connector") {
        coverage.connector_reports++;
        for (const k of ["devices_known", "devices_enrolled", "devices_unknown_seen", "accounts_total", "accounts_mfa", "accounts_passkey"]) coverage[k] = it.st.int("tenant_posture." + k);
      }
      const checks = lapseChecks(it.st);
      if (checks.length) lapses.push({ attester: id, date: isoDate(dateOf(it.st.time("observed_at"))), seq: it.st.int("seq"), checks });
    }
    const list = [];
    for (const a of d.attesters.values()) {
      if (a.it.enrolOK && a.it.sigOK && a.it.tsOK && a.it.inclOK && EXPECTED_DAILY.has(a.kind)) list.push(a);
      if (a.kind === "device_agent" && a.it.enrolOK) coverage.device_enrollments++;
    }
    list.sort((x, y) => (x.number - y.number) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const gaps = [];
    for (const a of list) {
      let start = new Date(dateOf(a.it.st.time("enrolled_at")).getTime() + DAY);
      if (start < from) start = from;
      let run = null;
      for (let t = start.getTime(); t <= to.getTime(); t += DAY) {
        const ds = isoDate(new Date(t));
        if (covered.has(a.id) && covered.get(a.id).has(ds)) { run = null; continue; }
        if (!run) { run = { attester: a.id, attester_kind: a.kind, device_number: a.number, from: ds, to: ds, days: 1 }; gaps.push(run); }
        else { run.to = ds; run.days++; }
      }
    }
    return { value: { coverage, gaps, lapses }, gaps };
  }

  function gapText(name, g) {
    const f = new Date(g.from + "T00:00:00Z"), t = new Date(g.to + "T00:00:00Z");
    let span = fmtDay(f);
    if (g.days > 1) span += " to " + fmtDay(t);
    return name(g.attester) + " sent no reports " + span + " (" + g.days + " day" + plural(g.days) + ")";
  }

  function safeCanonical(v) { try { return P.canonical(v); } catch (e) { return null; } }

  function verifySummary(s, pack, report, d) {
    s.checked = 1;
    const want = P.canonical(report.computed), got = safeCanonical(pack.summary);
    if (got !== want) {
      s.status = "fail";
      const claimed = pack.summary && typeof pack.summary === "object" ? pack.summary : {};
      const keyOf = (o) => safeCanonical(o) || JSON.stringify(o);
      const set = (v) => new Map((Array.isArray(v) ? v : []).filter((o) => o && typeof o === "object").map((o) => [keyOf(o), o]));
      const lapseText = (o) => d.name(o.attester) + " on " + fmtDay(new Date(o.date + "T00:00:00Z")) + ": " + (Array.isArray(o.checks) ? o.checks : []).map((c) => CHECK_LABEL[c] || c).join(", ");
      const out = [];
      let ev = set(report.computed.gaps), cl = set(claimed.gaps);
      for (const [k, o] of ev) if (!cl.has(k)) out.push("The summary hides a gap the evidence shows: " + gapText(d.name, o));
      for (const [k, o] of cl) if (!ev.has(k)) out.push("The summary claims a gap the evidence does not show: " + gapText(d.name, o));
      ev = set(report.computed.lapses); cl = set(claimed.lapses);
      for (const [k, o] of ev) if (!cl.has(k)) out.push("The summary hides a lapse the evidence shows: " + lapseText(o));
      for (const [k, o] of cl) if (!ev.has(k)) out.push("The summary claims a lapse the evidence does not show: " + lapseText(o));
      if (keyOf(report.computed.coverage) !== keyOf(claimed.coverage)) out.push("The summary's coverage numbers differ from the evidence");
      s.problems = out.sort();
      if (s.problems.length === 0) s.problems.push("The pack's summary does not match what the evidence shows");
      s.detail = "The summary on this pack does not match the signed evidence";
      return;
    }
    s.detail = report.gaps.length === 0
      ? "No gaps: every enrolled device and service reported every day, and the summary matches the evidence"
      : report.gaps.length + " gap(s) disclosed, matching the evidence: " + report.gaps.map((g) => gapText(d.name, g)).join("; ");
  }

  P.verifier = { strengthOf, parsePack, parseTrust, decode, verify, summarize, lapseChecks, entryDigest, fmtDay, fmtTime, fmtDuration, isoDate, dateOf, gapText, CHECK_LABEL };
})(globalThis.Proof = globalThis.Proof || {});
