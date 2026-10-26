// Cryptographic primitives for the verifier, using only WebCrypto:
// SHA-256, Ed25519 (checkpoints, witnesses, simulated TSAs, connector) and
// ECDSA P-256 with SHA-256 (device, firm and staff statements).
// Mirrors engine/sigs. See SPEC.md, "Keys and signatures".
(function (P) {
  "use strict";

  const subtle = globalThis.crypto && globalThis.crypto.subtle;

  const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  function b64encode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // b64decode accepts only canonical, padded standard base64.
  function b64decode(s) {
    if (typeof s !== "string" || !B64.test(s)) throw new Error("invalid base64");
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    if (b64encode(out) !== s) throw new Error("non-canonical base64");
    return out;
  }

  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  function unhex(s) {
    if (!/^([0-9a-f]{2})*$/.test(s)) throw new Error("invalid hex");
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  function concat(...parts) {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  async function sha256(bytes) { return new Uint8Array(await subtle.digest("SHA-256", bytes)); }

  // SPKI prefixes for the only two key encodings accepted.
  const ED25519_SPKI_PREFIX = unhex("302a300506032b6570032100");
  const P256_SPKI_PREFIX = unhex("3059301306072a8648ce3d020106082a8648ce3d03010703420004");

  // P-256 domain parameters, for point validation and the low-S rule.
  const p256 = {
    p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
    b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
    n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  };
  const toBig = (b) => BigInt("0x" + (hex(b) || "0"));
  const mod = (a, m) => ((a % m) + m) % m;

  function onP256(x, y) {
    const { p, b } = p256;
    if (x >= p || y >= p) return false;
    return mod(y * y, p) === mod(x * x * x - 3n * x + b, p);
  }

  // spkiInfo checks the exact canonical shape of an SPKI and names its
  // algorithm, or throws.
  function spkiInfo(der) {
    if (der.length === 44 && equalBytes(der.subarray(0, 12), ED25519_SPKI_PREFIX)) {
      return { alg: "ed25519", raw: der.subarray(12) };
    }
    if (der.length === 91 && equalBytes(der.subarray(0, 27), P256_SPKI_PREFIX)) {
      if (!onP256(toBig(der.subarray(27, 59)), toBig(der.subarray(59, 91)))) throw new Error("public key is not a point on P-256");
      return { alg: "ecdsa-p256-sha256" };
    }
    throw new Error("public key must be a canonical P-256 or Ed25519 SPKI");
  }

  const keyCache = new Map();

  // PublicKey wraps an imported SPKI key.
  async function importSpki(b64) {
    if (keyCache.has(b64)) return keyCache.get(b64);
    const der = b64decode(b64);
    const info = spkiInfo(der);
    const algo = info.alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
    const key = await subtle.importKey("spki", der, algo, false, ["verify"]);
    const k = { alg: info.alg, spki: der, b64, key, keyid: hex(await sha256(der)), raw: info.raw };
    keyCache.set(b64, k);
    return k;
  }

  // verify checks sig over msg with the encoding rules of SPEC.md: 64-byte
  // signatures; for ES256, IEEE P1363 r||s with low S.
  async function verify(k, msg, sig) {
    if (sig.length !== 64) return { ok: false, why: "signature is not a 64-byte raw signature (ES256 must be IEEE P1363 r||s, not DER)" };
    if (k.alg === "ed25519") {
      return { ok: await subtle.verify({ name: "Ed25519" }, k.key, sig, msg), why: "signature does not verify" };
    }
    const r = toBig(sig.subarray(0, 32)), s = toBig(sig.subarray(32));
    if (r === 0n || s === 0n || r >= p256.n || s >= p256.n) return { ok: false, why: "signature does not verify" };
    if (s > p256.n >> 1n) return { ok: false, why: "ECDSA signature has high S; only low-S (s <= n/2) is accepted" };
    return { ok: await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.key, sig, msg), why: "signature does not verify" };
  }

  const rawCache = new Map();
  async function importEd25519Raw(raw) {
    const id = hex(raw);
    if (!rawCache.has(id)) rawCache.set(id, await subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]));
    return rawCache.get(id);
  }
  async function verifyEd25519Raw(raw, msg, sig) {
    if (sig.length !== 64) return false;
    return subtle.verify({ name: "Ed25519" }, await importEd25519Raw(raw), sig, msg);
  }

  // featureCheck runs RFC 8032 test 1 and a P-256 import, so the page can
  // explain an unsupported browser instead of reporting false failures.
  async function featureCheck() {
    if (!subtle) {
      return { ok: false, why: "This page needs the Web Crypto API, which browsers only provide on https:// or localhost pages." };
    }
    try {
      const pub = unhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
      const sig = unhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
      if (!(await verifyEd25519Raw(pub, new Uint8Array(0), sig))) throw new Error("Ed25519 test vector failed");
      await subtle.importKey("spki", concat(P256_SPKI_PREFIX, unhex(
        "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296" +
        "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    } catch (e) {
      return { ok: false, why: "This browser does not support Ed25519 signatures in Web Crypto, which the verifier needs. Current Chrome, Edge, Firefox and Safari do; please update your browser. (" + e.message + ")" };
    }
    return { ok: true };
  }

  P.crypto = { b64encode, b64decode, hex, unhex, concat, equalBytes, sha256, spkiInfo, importSpki, verify, verifyEd25519Raw, featureCheck };
})(globalThis.Proof = globalThis.Proof || {});
