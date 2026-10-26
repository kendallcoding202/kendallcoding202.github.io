// Strict JSON and strict-json-c14n/v1 canonicalization.
//
// JSON.parse is not used for anything the verifier relies on: it silently
// keeps the last of duplicate keys, accepts 1.0 and 1e2, and turns large
// integers into approximations. This parser rejects all of those, and
// builds objects with a null prototype so a "__proto__" key is just data.
// Mirrors engine/canon. See SPEC.md, "Canonical JSON".
(function (P) {
  "use strict";

  const CANON_VERSION = "strict-json-c14n/v1";

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function parseStrictJSON(text) {
    let i = 0;
    const n = text.length;
    const fail = (msg) => { throw new Error(msg + " at offset " + i); };
    const ws = () => {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++; else break;
      }
    };
    const str = () => {
      i++; // opening quote
      let out = "";
      for (;;) {
        if (i >= n) fail("unterminated string");
        const c = text.charCodeAt(i);
        if (c === 0x22) { i++; return out; }
        if (c < 0x20) fail("control character in string");
        if (c === 0x5c) {
          const e = text[i + 1];
          i += 2;
          switch (e) {
            case '"': out += '"'; break;
            case "\\": out += "\\"; break;
            case "/": out += "/"; break;
            case "b": out += "\b"; break;
            case "f": out += "\f"; break;
            case "n": out += "\n"; break;
            case "r": out += "\r"; break;
            case "t": out += "\t"; break;
            case "u": {
              const hex = text.slice(i, i + 4);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("bad escape");
              const cu = parseInt(hex, 16);
              i += 4;
              if (cu >= 0xd800 && cu <= 0xdbff) {
                const lo = text.slice(i, i + 6);
                if (!/^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/.test(lo)) fail("lone surrogate");
                out += String.fromCharCode(cu, parseInt(lo.slice(2), 16));
                i += 6;
              } else if (cu >= 0xdc00 && cu <= 0xdfff) {
                fail("lone surrogate");
              } else {
                out += String.fromCharCode(cu);
              }
              break;
            }
            default: fail("bad escape");
          }
          continue;
        }
        if (c >= 0xd800 && c <= 0xdfff) { // keep valid pairs, reject lone halves
          const d = text.charCodeAt(i + 1);
          if (c > 0xdbff || !(d >= 0xdc00 && d <= 0xdfff)) fail("lone surrogate");
          out += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        out += text[i++];
      }
    };
    const num = () => {
      const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 40));
      if (!m) fail("bad number");
      if (m[2] || m[3]) fail("non-integer numbers are not allowed");
      if (m[0] === "-0") fail("negative zero is not allowed");
      const v = Number(m[0]);
      if (!Number.isSafeInteger(v)) fail("integer outside the safe range");
      i += m[0].length;
      return v;
    };
    const value = (depth) => {
      if (depth > 64) fail("nesting too deep");
      ws();
      const c = text[i];
      if (c === "{") {
        i++;
        const o = Object.create(null);
        ws();
        if (text[i] === "}") { i++; return o; }
        for (;;) {
          ws();
          if (text[i] !== '"') fail("expected a string key");
          const k = str();
          if (has(o, k)) fail("duplicate object key " + JSON.stringify(k));
          ws();
          if (text[i] !== ":") fail("expected ':'");
          i++;
          o[k] = value(depth + 1);
          ws();
          if (text[i] === ",") { i++; continue; }
          if (text[i] === "}") { i++; return o; }
          fail("expected ',' or '}'");
        }
      }
      if (c === "[") {
        i++;
        const a = [];
        ws();
        if (text[i] === "]") { i++; return a; }
        for (;;) {
          a.push(value(depth + 1));
          ws();
          if (text[i] === ",") { i++; continue; }
          if (text[i] === "]") { i++; return a; }
          fail("expected ',' or ']'");
        }
      }
      if (c === '"') return str();
      if (text.startsWith("true", i)) { i += 4; return true; }
      if (text.startsWith("false", i)) { i += 5; return false; }
      if (text.startsWith("null", i)) fail("null is not allowed");
      if (c === "-" || (c >= "0" && c <= "9")) return num();
      fail("unexpected character");
    };
    const v = value(0);
    ws();
    if (i !== n) fail("unexpected data after the top-level value");
    return v;
  }

  function checkCanonicalString(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c > 0x7e || c === 0x22 || c === 0x5c) {
        throw new Error("character 0x" + c.toString(16) + " at offset " + i + " is outside the canonical string alphabet");
      }
    }
  }

  // canonical returns the strict-json-c14n/v1 text of a value.
  function canonical(v, depth) {
    depth = depth || 0;
    if (depth > 32) throw new Error("nesting too deep");
    if (typeof v === "string") { checkCanonicalString(v); return '"' + v + '"'; }
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new Error("only safe integers are allowed");
      return String(v);
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) return "[" + v.map((e) => canonical(e, depth + 1)).join(",") + "]";
    if (v && typeof v === "object") {
      const keys = Object.keys(v).sort();
      return "{" + keys.map((k) => {
        checkCanonicalString(k);
        if (k === "") throw new Error("empty object key");
        return '"' + k + '":' + canonical(v[k], depth + 1);
      }).join(",") + "}";
    }
    throw new Error(v === null ? "null is not allowed" : "unsupported value");
  }

  const utf8 = new TextEncoder();
  const utf8Strict = new TextDecoder("utf-8", { fatal: true });

  // parseCanonical accepts bytes only if they are exactly canonical.
  function parseCanonical(bytes) {
    const text = utf8Strict.decode(bytes);
    const v = parseStrictJSON(text);
    if (canonical(v) !== text) throw new Error("not in canonical form (" + CANON_VERSION + ")");
    return v;
  }

  function deepClone(v) {
    if (Array.isArray(v)) return v.map(deepClone);
    if (v && typeof v === "object") {
      const o = Object.create(null);
      for (const k of Object.keys(v)) o[k] = deepClone(v[k]);
      return o;
    }
    return v;
  }

  // toJSONText renders a parsed value as ordinary (pretty) JSON.
  function toJSONText(v) { return JSON.stringify(v, null, 1); }

  P.CANON_VERSION = CANON_VERSION;
  P.has = has;
  P.parseStrictJSON = parseStrictJSON;
  P.canonical = canonical;
  P.parseCanonical = parseCanonical;
  P.utf8 = (s) => utf8.encode(s);
  P.fromUtf8 = (b) => utf8Strict.decode(b);
  P.deepClone = deepClone;
  P.toJSONText = toJSONText;
})(globalThis.Proof = globalThis.Proof || {});
