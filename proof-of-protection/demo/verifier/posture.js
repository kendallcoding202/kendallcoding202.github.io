// Statement content rules. The schema itself is data generated from the Go
// engine (schema.js), so both verifiers enforce exactly the same rules;
// this file only interprets it. Mirrors engine/posture/validate.go,
// including the order checks run in and the error messages.
(function (P) {
  "use strict";
  const RULE = "statements may carry only yes/no values, counts, enums and timestamps";
  const has = P.has;

  class ContentError extends Error {
    constructor(path, reason) { super(path ? path + ": " + reason : reason); this.path = path; }
  }
  const fail = (path, reason) => { throw new ContentError(path, reason); };
  const join = (path, k) => (path ? path + "." + k : k);
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
  const lowerHex = (s, n) => typeof s === "string" && s.length === n && /^[0-9a-f]*$/.test(s);

  const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
  function parseTime(s) {
    const m = typeof s === "string" && TS.exec(s);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    if (isNaN(d) || d.toISOString().slice(0, 19) + "Z" !== s) return null;
    return d;
  }

  function validID(s, prefixes) {
    return typeof s === "string" && prefixes.some((p) => s.startsWith(p) && lowerHex(s.slice(p.length), 16));
  }

  function check(v, s, path) {
    switch (s.t) {
      case "bool":
        if (typeof v !== "boolean") fail(path, "must be true or false (" + RULE + ")");
        return;
      case "int":
        if (!isInt(v)) fail(path, "must be an integer (" + RULE + ")");
        if (v < s.min || v > s.max) fail(path, "integer " + v + " is outside the allowed range " + s.min + ".." + s.max);
        return;
      case "enum":
        if (typeof v !== "string" || !s.values.includes(v)) fail(path, "must be one of " + s.values.join(", ") + " (" + RULE + ")");
        return;
      case "const":
        if (v !== s.value) fail(path, "must be " + JSON.stringify(s.value));
        return;
      case "timestamp":
        if (!parseTime(v)) fail(path, "must be a UTC timestamp like 2026-10-01T14:00:00Z");
        return;
      case "hex":
        if (!lowerHex(v, s.len)) fail(path, "must be " + s.len + " lowercase hex characters");
        return;
      case "id":
        if (!validID(v, s.prefixes)) fail(path, "must be a key-derived identifier (" + s.prefixes.join("/") + " followed by 16 hex characters)");
        return;
      case "spki":
        if (typeof v !== "string") fail(path, "must be a base64 public key");
        try { P.crypto.spkiInfo(P.crypto.b64decode(v)); } catch (e) { fail(path, "must be a canonical P-256 or Ed25519 public key: " + e.message); }
        return;
      case "array": {
        if (!Array.isArray(v)) fail(path, "must be an array");
        if (v.length < (s.min_items || 0) || v.length > (s.max_items || 0)) fail(path, "must have " + (s.min_items || 0) + " to " + (s.max_items || 0) + " items");
        v.forEach((e, i) => check(e, s.of, path + "[" + i + "]"));
        return;
      }
      case "counted_list": return checkCountedList(v, s, path);
      case "result_list": return checkResultList(v, s, path);
      case "object": return checkObject(v, s, path);
    }
    fail(path, "schema error: unknown type " + s.t);
  }

  function checkObject(v, s, path) {
    if (!isObj(v)) fail(path, "must be an object");
    const fields = Object.assign(Object.create(null), s.fields || {});
    if (s.switch) {
      const tag = v[s.switch.on];
      const extra = typeof tag === "string" && has(s.switch.cases, tag) ? s.switch.cases[tag] : null;
      if (!extra) {
        check(v[s.switch.on], s.fields[s.switch.on], join(path, s.switch.on));
        fail(join(path, s.switch.on), "unsupported value " + JSON.stringify(tag));
      }
      Object.assign(fields, extra);
    }
    // Unknown fields first: this is where a smuggled "hostname" or "path"
    // is caught.
    for (const k of Object.keys(v).sort()) {
      if (!has(fields, k)) fail(join(path, k), "field is not allowed (" + RULE + ")");
    }
    for (const k of Object.keys(fields).sort()) {
      if (!has(v, k)) fail(join(path, k), "required field is missing");
      check(v[k], fields[k], join(path, k));
    }
    for (const [a, b] of s.le || []) {
      if (v[a] > v[b]) fail(join(path, a), "must not exceed " + b + " (" + v[a] + " > " + v[b] + ")");
    }
  }

  function checkCountedList(v, s, path) {
    if (!isObj(v) || Object.keys(v).length !== 3) fail(path, "must be {items, total, truncated}");
    const { items, total, truncated } = v;
    if (!Array.isArray(items) || !isInt(total) || typeof truncated !== "boolean") fail(path, "must be {items: array, total: integer, truncated: true/false}");
    if (items.length > s.max_items) fail(join(path, "items"), "at most " + s.max_items + " items are allowed; set truncated instead");
    if (total < 0 || total > s.max_count * s.kinds.length) fail(join(path, "total"), "out of range");
    let sum = 0, prev = "";
    items.forEach((it, i) => {
      const ip = path + ".items[" + i + "]";
      if (!isObj(it) || Object.keys(it).length !== 2) fail(ip, "must be exactly {count, kind} (" + RULE + ")");
      if (typeof it.kind !== "string" || !s.kinds.includes(it.kind)) fail(join(ip, "kind"), "must be one of " + s.kinds.join(", ") + " (" + RULE + ")");
      if (!isInt(it.count) || it.count < 1 || it.count > s.max_count) fail(join(ip, "count"), "must be an integer 1.." + s.max_count);
      if (it.kind <= prev) fail(ip, "items must be sorted by kind with no repeats");
      prev = it.kind;
      sum += it.count;
    });
    if (!truncated && sum !== total) fail(join(path, "total"), "must equal the sum of item counts when truncated is false");
    if (truncated && (items.length !== s.max_items || sum >= total)) fail(join(path, "truncated"), "truncated lists must be full and total must exceed the listed counts");
  }

  function checkResultList(v, s, path) {
    if (!isObj(v) || Object.keys(v).length !== 3) fail(path, "must be {items, total, truncated}");
    const { items, total, truncated } = v;
    if (!Array.isArray(items) || !isInt(total) || typeof truncated !== "boolean") fail(path, "must be {items: array, total: integer, truncated: true/false}");
    if (items.length > s.max_items) fail(join(path, "items"), "at most " + s.max_items + " items are allowed; set truncated instead");
    if (total < 0 || total > 1000) fail(join(path, "total"), "out of range");
    let prev = "";
    items.forEach((it, i) => {
      const ip = path + ".items[" + i + "]";
      check(it, s.of, ip);
      if (it[s.key] <= prev) fail(ip, "items must be sorted by " + s.key + " with no repeats");
      prev = it[s.key];
    });
    if (!truncated && items.length !== total) fail(join(path, "total"), "must equal the number of items when truncated is false");
    if (truncated && (items.length !== s.max_items || total <= items.length)) fail(join(path, "truncated"), "truncated lists must be full and total must exceed the number of items");
  }

  const PREFIX = { device_agent: "dev_", cloud_connector: "con_", staff_attester: "stf_", external_scanner: "scn_" };

  // Statement wraps a validated statement with typed accessors.
  class Statement {
    constructor(obj) {
      this.raw = obj;
      this.predicateType = obj.predicateType;
      this.predicate = obj.predicate;
      this.subjectName = obj.subject[0].name;
      this.subjectDigest = obj.subject[0].digest.sha256;
    }
    get(path) {
      let cur = this.predicate;
      for (const p of path.split(".")) { if (!isObj(cur) || !has(cur, p)) return undefined; cur = cur[p]; }
      return cur;
    }
    str(path) { const v = this.get(path); return typeof v === "string" ? v : ""; }
    int(path) { const v = this.get(path); return isInt(v) ? v : 0; }
    bool(path) { return this.get(path) === true; }
    time(path) { return parseTime(this.str(path)); }
    get isPosture() { return this.predicateType === globalThis.ProofSchema.predicate_types.posture; }
  }

  // validate checks payload bytes and returns a Statement, or throws.
  function validate(payload) {
    let obj;
    try { obj = P.parseCanonical(payload); } catch (e) { throw new ContentError("", e.message); }
    if (!isObj(obj)) throw new ContentError("", "top-level value must be an object");
    return validateValue(obj);
  }

  function validateValue(obj) {
    const pt = obj.predicateType;
    const spec = typeof pt === "string" && has(globalThis.ProofSchema.statements, pt) ? globalThis.ProofSchema.statements[pt] : null;
    if (!spec) fail("predicateType", "unsupported predicate type " + JSON.stringify(pt));
    check(obj, spec, "");
    const st = new Statement(obj);
    if (st.isPosture) {
      if (st.subjectName !== st.str("attester")) fail("subject[0].name", "must equal predicate.attester");
      if (!st.str("attester").startsWith(PREFIX[st.str("attester_kind")])) fail("predicate.attester", "prefix does not match attester_kind");
    } else {
      let want = st.str("tenant");
      if (st.str("kind") === "attester") {
        want = st.str("attester");
        if (!want.startsWith(PREFIX[st.str("attester_kind")])) fail("predicate.attester", "prefix does not match attester_kind");
      }
      if (st.subjectName !== want) fail("subject[0].name", "must name the enrolled tenant or attester");
    }
    return st;
  }

  P.posture = { validate, validateValue, check, parseTime, ContentError, RULE, PREFIX };
})(globalThis.Proof = globalThis.Proof || {});
