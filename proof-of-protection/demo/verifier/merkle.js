// RFC 6962 / RFC 9162 Merkle trees: hashing, proof verification (RFC 9162
// 2.1.3.2 and 2.1.4.2) and, for the demo's attack scenarios, proof
// generation. Mirrors engine/merkle.
(function (P) {
  "use strict";
  const C = P.crypto;

  const leafHash = (data) => C.sha256(C.concat(new Uint8Array([0]), data));
  const nodeHash = (l, r) => C.sha256(C.concat(new Uint8Array([1]), l, r));

  async function verifyInclusion(index, size, leaf, proof, root) {
    if (index >= size) return false;
    let fn = index, sn = size - 1, r = leaf;
    for (const p of proof) {
      if (sn === 0) return false;
      if (fn % 2 === 1 || fn === sn) {
        r = await nodeHash(p, r);
        if (fn % 2 === 0) {
          while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
        }
      } else {
        r = await nodeHash(r, p);
      }
      fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
    }
    return sn === 0 && C.equalBytes(r, root);
  }

  async function verifyConsistency(first, second, proof, firstRoot, secondRoot) {
    if (first > second) return false;
    if (first === second) return proof.length === 0 && C.equalBytes(firstRoot, secondRoot);
    if (first === 0) return proof.length === 0;
    if (proof.length === 0) return false;
    if ((first & (first - 1)) === 0) proof = [firstRoot].concat(proof);
    let fn = first - 1, sn = second - 1;
    while (fn % 2 === 1) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    let fr = proof[0], sr = proof[0];
    for (const c of proof.slice(1)) {
      if (sn === 0) return false;
      if (fn % 2 === 1 || fn === sn) {
        fr = await nodeHash(c, fr);
        sr = await nodeHash(c, sr);
        if (fn % 2 === 0) {
          while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
        }
      } else {
        sr = await nodeHash(sr, c);
      }
      fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
    }
    return sn === 0 && C.equalBytes(fr, firstRoot) && C.equalBytes(sr, secondRoot);
  }

  // Tree builds proofs over a fixed list of leaf hashes (RFC 6962 2.1).
  class Tree {
    constructor(leafHashes) { this.leaves = leafHashes; this.memo = new Map(); }
    static split(n) { let k = 1; while (k * 2 < n) k *= 2; return k; }
    async mth(lo, hi) {
      if (hi - lo === 1) return this.leaves[lo];
      const key = lo + ":" + hi;
      if (!this.memo.has(key)) {
        const k = Tree.split(hi - lo);
        this.memo.set(key, (async () => nodeHash(await this.mth(lo, lo + k), await this.mth(lo + k, hi)))());
      }
      return this.memo.get(key);
    }
    async root(size) { return size === 0 ? C.sha256(new Uint8Array(0)) : this.mth(0, size); }
    async path(m, lo, hi) {
      if (hi - lo === 1) return [];
      const k = Tree.split(hi - lo);
      if (m < k) return (await this.path(m, lo, lo + k)).concat([await this.mth(lo + k, hi)]);
      return (await this.path(m - k, lo + k, hi)).concat([await this.mth(lo, lo + k)]);
    }
    async inclusionProof(index, size) { return this.path(index, 0, size); }
    async subproof(m, lo, hi, b) {
      if (m === hi - lo) return b ? [] : [await this.mth(lo, hi)];
      const k = Tree.split(hi - lo);
      if (m <= k) return (await this.subproof(m, lo, lo + k, b)).concat([await this.mth(lo + k, hi)]);
      return (await this.subproof(m - k, lo + k, hi, false)).concat([await this.mth(lo, lo + k)]);
    }
    async consistencyProof(m, n) { return m === 0 || m === n ? [] : this.subproof(m, 0, n, true); }
  }

  P.merkle = { leafHash, nodeHash, verifyInclusion, verifyConsistency, Tree };
})(globalThis.Proof = globalThis.Proof || {});
