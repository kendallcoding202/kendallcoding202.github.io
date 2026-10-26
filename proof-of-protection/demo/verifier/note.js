// C2SP signed notes, tlog-checkpoint bodies and tlog-cosignature/v1
// witness cosignatures. Mirrors engine/note.
(function (P) {
  "use strict";
  const C = P.crypto;
  const DASH = String.fromCharCode(0x2014) + " ";
  const TYPE_ED25519 = 1, TYPE_COSIG = 4;

  function validName(name) {
    return typeof name === "string" && name.length > 0 && !/[\s+]/u.test(name) && !/[\u0000-\u001f]/.test(name);
  }

  async function keyID(name, type, raw) {
    const h = await C.sha256(C.concat(P.utf8(name), new Uint8Array([0x0a, type]), raw));
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  }

  // parseVKey parses "<name>+<hex id>+<base64(type||key)>" and checks the ID.
  async function parseVKey(s) {
    const a = s.indexOf("+"), b = s.indexOf("+", a + 1);
    if (a < 0 || b < 0) throw new Error("malformed verifier key");
    const name = s.slice(0, a), idHex = s.slice(a + 1, b);
    if (!validName(name) || !/^[0-9a-f]{8}$/.test(idHex)) throw new Error("malformed verifier key");
    const raw = C.b64decode(s.slice(b + 1));
    if (raw.length !== 33 || (raw[0] !== TYPE_ED25519 && raw[0] !== TYPE_COSIG)) throw new Error("unsupported verifier key");
    const id = parseInt(idHex, 16);
    if (id !== (await keyID(name, raw[0], raw.subarray(1)))) throw new Error("verifier key ID does not match the key");
    return { name, id, type: raw[0], key: raw.subarray(1) };
  }

  function parseNote(s) {
    if (typeof s !== "string" || !s.endsWith("\n")) throw new Error("note does not end with a newline");
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 && c !== 0x0a) throw new Error("note contains a control character");
    }
    const sep = s.lastIndexOf("\n\n");
    if (sep < 0) throw new Error("note has no signature block");
    const text = s.slice(0, sep + 1);
    const sigs = s.slice(sep + 2, -1).split("\n").map((line) => {
      if (!line.startsWith(DASH)) throw new Error("malformed signature line");
      const f = line.slice(DASH.length).split(" ");
      if (f.length !== 2 || !validName(f[0])) throw new Error("malformed signature line");
      const raw = C.b64decode(f[1]);
      if (raw.length < 5) throw new Error("malformed signature");
      return { name: f[0], id: ((raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3]) >>> 0, sig: raw.subarray(4), line };
    });
    if (sigs.length === 0) throw new Error("note has no signatures");
    return { text, sigs };
  }

  function parseCheckpoint(text) {
    const lines = text.slice(0, -1).split("\n");
    if (!text.endsWith("\n") || lines.length !== 3) throw new Error("checkpoint must be exactly origin, size and root hash lines");
    if (lines[0] === "") throw new Error("checkpoint origin is empty");
    if (!/^(0|[1-9][0-9]*)$/.test(lines[1]) || !Number.isSafeInteger(Number(lines[1]))) throw new Error("checkpoint size is not a canonical decimal");
    const root = C.b64decode(lines[2]);
    if (root.length !== 32) throw new Error("checkpoint root hash is not 32 bytes");
    return { origin: lines[0], size: Number(lines[1]), root };
  }

  async function verifySignedBy(note, vk) {
    if (vk.type !== TYPE_ED25519) return { ok: false, why: "not a note key" };
    for (const s of note.sigs) {
      if (s.name === vk.name && s.id === vk.id) {
        const ok = await C.verifyEd25519Raw(vk.key, P.utf8(note.text), s.sig);
        return { ok, why: ok ? "" : "signature by " + vk.name + " does not verify" };
      }
    }
    return { ok: false, why: "no signature by " + vk.name };
  }

  function cosignatureMessage(text, t) { return P.utf8("cosignature/v1\ntime " + t + "\n" + text); }

  // verifyCosignature returns {ok, time, why}.
  async function verifyCosignature(note, vk) {
    if (vk.type !== TYPE_COSIG) return { ok: false, why: "not a cosignature key" };
    for (const s of note.sigs) {
      if (s.name === vk.name && s.id === vk.id) {
        if (s.sig.length !== 72) return { ok: false, why: "malformed cosignature" };
        let t = 0;
        for (let i = 0; i < 8; i++) t = t * 256 + s.sig[i];
        const ok = await C.verifyEd25519Raw(vk.key, cosignatureMessage(note.text, t), s.sig.subarray(8));
        return { ok, time: t, why: ok ? "" : "does not verify for this checkpoint" };
      }
    }
    return { ok: false, why: "no cosignature" };
  }

  P.note = { parseVKey, parseNote, parseCheckpoint, verifySignedBy, verifyCosignature, keyID, TYPE_ED25519, TYPE_COSIG };
})(globalThis.Proof = globalThis.Proof || {});
